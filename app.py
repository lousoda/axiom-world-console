from fastapi import FastAPI, HTTPException, Query, Body
from pydantic import BaseModel, Field
from typing import Literal, Dict, Any, Optional, List
import time
import os
import json
import inspect
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).with_name(".env"))
import re
import requests

# =============================
# Module-level constants
# =============================
MAX_LOGS = 5000
MOVE_COST_MON = 1

app = FastAPI(title="World Model Agent (MVP)")

# ============================================================
# WORLD STATE
# ============================================================

def make_initial_world_state() -> Dict[str, Any]:
    return {
        "tick": 0,
        "locations": ["spawn", "market", "workshop"],
        "agents": [],
        "action_queue": [],
        "logs": [],
        "economy": {
            "workshop_capacity_per_tick": 1,
            "workshop_capacity_left": 1,
        },
        "entry": {
            "used_tx_hashes": [],
        },
    }

world_state: Dict[str, Any] = make_initial_world_state()

def reset_in_place() -> None:
    """Очищає state без заміни dict-об’єкта (менше сюрпризів)."""
    fresh = make_initial_world_state()
    world_state.clear()
    world_state.update(fresh)

def log(event: str, data: Dict[str, Any]) -> None:
    logs = world_state.setdefault("logs", [])
    logs.append({
        "time": time.time(),
        "tick": world_state.get("tick", 0),
        "event": event,
        "data": data,
    })
    # keep memory bounded for long-running demos
    if isinstance(logs, list) and len(logs) > MAX_LOGS:
        del logs[: len(logs) - MAX_LOGS]

def find_agent(agent_id: int) -> Dict[str, Any]:
    for a in world_state.get("agents", []):
        if isinstance(a, dict) and a.get("id") == agent_id:
            return a
    raise HTTPException(status_code=404, detail="Agent not found")

# ============================================================
# PERSISTENCE (JSON snapshot)
# ============================================================

DEFAULT_SNAPSHOT_PATH = Path(os.getenv("WORLD_SNAPSHOT_PATH", "world_snapshot.json"))
LAST_SAVED: Optional[dict] = None  # метадані останнього сейва

def _snapshot_path(path: Optional[str] = None) -> Path:
    p = Path(path) if path else DEFAULT_SNAPSHOT_PATH
    # Якщо передали директорію (існуючу) — пишемо стандартне ім'я в ній.
    if p.exists() and p.is_dir():
        p = p / "world_snapshot.json"
    return p

def save_world_state(path: Optional[str] = None, include_logs: bool = True) -> dict:
    """
    Зберігає snapshot у JSON.
    Робимо shallow copy, щоб snapshot був ізольований від live dict.
    """
    global LAST_SAVED
    p = _snapshot_path(path)

    # Створюємо parent директорію, якщо її нема (на випадок кастомного path).
    if p.parent and not p.parent.exists():
        p.parent.mkdir(parents=True, exist_ok=True)

    ws = dict(world_state)  # shallow copy
    if not include_logs:
        ws["logs"] = []

    snapshot = {
        "schema_version": 1,
        "saved_at": time.time(),
        "world_state": ws,
    }

    # атомарний запис: tmp -> replace
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)

    LAST_SAVED = {
        "path": str(p),
        "saved_at": snapshot["saved_at"],
        "tick": world_state.get("tick", 0),
        "agents": len(world_state.get("agents", [])),
        "logs": len(world_state.get("logs", [])),
        "include_logs": include_logs,
    }
    return {"ok": True, **LAST_SAVED}

def _normalize_loaded_state(loaded: Dict[str, Any]) -> Dict[str, Any]:
    """
    Після load гарантуємо базові ключі + адекватні дефолти,
    щоб /world, /tick, /persist/status не падали на KeyError.
    """
    base = make_initial_world_state()

    for k in ["tick", "locations", "agents", "action_queue", "logs", "economy", "entry"]:
        if k in loaded:
            base[k] = loaded[k]

    if not isinstance(base["tick"], int):
        base["tick"] = int(base["tick"]) if str(base["tick"]).isdigit() else 0

    if not isinstance(base["locations"], list):
        base["locations"] = ["spawn", "market", "workshop"]

    if not isinstance(base["agents"], list):
        base["agents"] = []

    if not isinstance(base["action_queue"], list):
        base["action_queue"] = []

    if not isinstance(base["logs"], list):
        base["logs"] = []

    # Economy defaults (for older snapshots)
    if not isinstance(base.get("economy"), dict):
        base["economy"] = {}
    base["economy"].setdefault("workshop_capacity_per_tick", 1)
    base["economy"].setdefault(
        "workshop_capacity_left",
        base["economy"]["workshop_capacity_per_tick"],
    )

    # Entry defaults (for older snapshots)
    if not isinstance(base.get("entry"), dict):
        base["entry"] = {}
    used = base["entry"].get("used_tx_hashes")
    if not isinstance(used, list):
        used = []
    norm_used: List[str] = []
    for h in used:
        if isinstance(h, str):
            hh = h.strip().lower()
            if hh.startswith("0x") and len(hh) >= 10:
                norm_used.append(hh)
    base["entry"]["used_tx_hashes"] = norm_used

    # Keep only dict agents with id; ensure required fields so tick/auto don't KeyError
    allowed_goals = {"earn", "wander", "idle"}
    valid_agents: List[Dict[str, Any]] = []
    for a in base["agents"]:
        if not isinstance(a, dict) or a.get("id") is None:
            continue
        a.setdefault("pos", "spawn")
        a.setdefault("balance_mon", 0)
        a.setdefault("status", "active")
        a.setdefault("inventory", [])
        a.setdefault("auto", False)
        a.setdefault("cooldown_until_tick", 0)
        a.setdefault("goal", "earn")
        if a.get("goal") not in allowed_goals:
            a["goal"] = "earn"
        valid_agents.append(a)
    base["agents"] = valid_agents

    return base

def load_world_state(path: Optional[str] = None) -> dict:
    p = _snapshot_path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Snapshot not found: {p}")

    raw = p.read_text(encoding="utf-8")
    data = json.loads(raw)

    if data.get("schema_version") != 1:
        raise HTTPException(status_code=400, detail="Unsupported snapshot schema_version")

    loaded = data.get("world_state")
    if not isinstance(loaded, dict):
        raise HTTPException(status_code=400, detail="Snapshot world_state is invalid")

    normalized = _normalize_loaded_state(loaded)

    world_state.clear()
    world_state.update(normalized)

    log("persist_load", {"path": str(p), "saved_at": data.get("saved_at")})
    return {
        "ok": True,
        "path": str(p),
        "saved_at": data.get("saved_at"),
        "tick": world_state.get("tick", 0),
        "agents": len(world_state.get("agents", [])),
        "logs": len(world_state.get("logs", [])),
    }

def persistence_status(path: Optional[str] = None) -> dict:
    p = _snapshot_path(path)
    return {
        "ok": True,
        "default_path": str(DEFAULT_SNAPSHOT_PATH),
        "exists": p.exists(),
        "path": str(p),
        "last_saved": LAST_SAVED,
        "current": {
            "tick": world_state.get("tick", 0),
            "agents": len(world_state.get("agents", [])),
            "queued_actions": len(world_state.get("action_queue", [])),
            "logs": len(world_state.get("logs", [])),
        },
    }

class PersistSaveRequest(BaseModel):
    path: Optional[str] = None
    include_logs: bool = True

class PersistLoadRequest(BaseModel):
    path: Optional[str] = None

@app.get("/persist/status")
def persist_status(path: Optional[str] = None):
    return persistence_status(path=path)

@app.post("/persist/save")
def persist_save(req: PersistSaveRequest = Body(default=PersistSaveRequest())):
    target = _snapshot_path(req.path)
    # Log BEFORE saving so the snapshot includes this event.
    log("persist_save", {"path": str(target), "include_logs": req.include_logs})
    res = save_world_state(path=req.path, include_logs=req.include_logs)
    return res

@app.post("/persist/load")
def persist_load(req: PersistLoadRequest = Body(default=PersistLoadRequest())):
    return load_world_state(path=req.path)

# ============================================================
# MONAD MAINNET (token-gated entry)
# ============================================================

MONAD_CHAIN_ID = int(os.getenv("MONAD_CHAIN_ID", "143"))
MONAD_RPC_URL = os.getenv("MONAD_RPC_URL", "https://rpc.monad.xyz")
MONAD_TREASURY_ADDRESS = os.getenv("MONAD_TREASURY_ADDRESS", "").strip()

MIN_ENTRY_FEE_WEI_ENV = os.getenv("MIN_ENTRY_FEE_WEI", "").strip()
MIN_ENTRY_FEE_MON_ENV = os.getenv("MIN_ENTRY_FEE_MON", "").strip()

ALLOW_FREE_JOIN = os.getenv("ALLOW_FREE_JOIN", "false").strip().lower() in {"1", "true", "yes"}

TX_HASH_RE = re.compile(r"^0x[a-fA-F0-9]{64}$")
ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


def _parse_min_fee_wei() -> int:
    if MIN_ENTRY_FEE_WEI_ENV:
        try:
            return int(MIN_ENTRY_FEE_WEI_ENV)
        except Exception:
            return 0
    if MIN_ENTRY_FEE_MON_ENV:
        try:
            mon = float(MIN_ENTRY_FEE_MON_ENV)
            if mon <= 0:
                return 0
            return int(mon * (10 ** 18))
        except Exception:
            return 0
    return 0


def _rpc_call(method: str, params: list) -> Any:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    last_err = None
    for attempt in range(2):
        try:
            r = requests.post(MONAD_RPC_URL, json=payload, timeout=10)
            r.raise_for_status()
            data = r.json()
            break
        except Exception as e:
            last_err = e
            if attempt == 0:
                continue
            raise HTTPException(status_code=502, detail=f"Monad RPC error: {e}")
    else:
        raise HTTPException(status_code=502, detail=f"Monad RPC error: {last_err}")

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Monad RPC returned non-JSON response")

    if data.get("error"):
        raise HTTPException(status_code=502, detail=f"Monad RPC error: {data.get('error')}")

    return data.get("result")


def _hex_to_int(x: Any) -> int:
    if x is None:
        return 0
    if isinstance(x, int):
        return x
    if isinstance(x, str):
        s = x.strip().lower()
        if s.startswith("0x"):
            try:
                return int(s, 16)
            except Exception:
                return 0
        try:
            return int(s)
        except Exception:
            return 0
    return 0


def verify_entry_tx(tx_hash: str) -> Dict[str, Any]:
    txh = (tx_hash or "").strip().lower()
    if not TX_HASH_RE.match(txh):
        raise HTTPException(status_code=400, detail="Invalid entry_tx_hash format")

    if not MONAD_TREASURY_ADDRESS or not ADDRESS_RE.match(MONAD_TREASURY_ADDRESS):
        raise HTTPException(status_code=500, detail="Server misconfigured: MONAD_TREASURY_ADDRESS not set")

    min_fee_wei = _parse_min_fee_wei()
    if min_fee_wei <= 0:
        raise HTTPException(status_code=500, detail="Server misconfigured: MIN_ENTRY_FEE_WEI or MIN_ENTRY_FEE_MON not set")

    used = world_state.setdefault("entry", {}).setdefault("used_tx_hashes", [])
    if isinstance(used, list) and txh in [str(x).lower() for x in used if isinstance(x, str)]:
        raise HTTPException(status_code=409, detail="Entry tx hash already used")

    tx = _rpc_call("eth_getTransactionByHash", [txh])
    if not tx or not isinstance(tx, dict):
        raise HTTPException(status_code=404, detail="Transaction not found on Monad mainnet")

    receipt = _rpc_call("eth_getTransactionReceipt", [txh])
    if not receipt or not isinstance(receipt, dict):
        raise HTTPException(status_code=404, detail="Transaction receipt not found (not confirmed yet)")

    status = _hex_to_int(receipt.get("status"))
    if status != 1:
        raise HTTPException(status_code=400, detail="Transaction failed (status != 1)")

    _to = tx.get("to")
    to_addr = (_to if isinstance(_to, str) else "").strip().lower()
    if to_addr != MONAD_TREASURY_ADDRESS.strip().lower():
        raise HTTPException(status_code=400, detail="Transaction recipient does not match treasury")

    value_wei = _hex_to_int(tx.get("value"))
    if value_wei < min_fee_wei:
        raise HTTPException(status_code=402, detail="Insufficient MON paid for entry")

    tx_chain_id = tx.get("chainId")
    if tx_chain_id is not None and _hex_to_int(tx_chain_id) != MONAD_CHAIN_ID:
        raise HTTPException(status_code=400, detail="Transaction chainId does not match Monad mainnet")

    _frm = tx.get("from")
    frm = (_frm if isinstance(_frm, str) else "").strip().lower()
    block_number = _hex_to_int(receipt.get("blockNumber"))

    return {
        "ok": True,
        "tx_hash": txh,
        "from": frm,
        "to": to_addr,
        "value_wei": value_wei,
        "min_fee_wei": min_fee_wei,
        "block_number": block_number,
    }

# ============================================================
# BASIC
# ============================================================


@app.get("/")
def root():
    return {"status": "world model agent alive"}


# Debug endpoints
@app.get("/debug/info")
def debug_info():
    return {
        "pid": os.getpid(),
        "cwd": os.getcwd(),
        "default_snapshot_path": str(DEFAULT_SNAPSHOT_PATH),
        "tick": world_state.get("tick", 0),
        "agents": len(world_state.get("agents", [])),
    }

# Debug endpoint to show which file and version of _auto_policy_for_agent is running
@app.get("/debug/source")
def debug_source():
    # Prove which file uvicorn actually imported, and show whether the autopolicy includes the funds-guard text.
    try:
        src = inspect.getsource(_auto_policy_for_agent)
    except Exception as e:
        src = f"<inspect failed: {e}>"

    lines = src.splitlines()
    return {
        "ok": True,
        "module_file": __file__,
        "cwd": os.getcwd(),
        # coarse: any guard text
        "has_any_insufficient_funds_guard": "insufficient funds" in src,
        # specific: the three guards we expect
        "has_guard_recent_capacity_denial": "recent capacity denial but insufficient funds for move" in src,
        "has_guard_wander": "wander but insufficient funds for move" in src,
        "has_guard_not_in_workshop": "not in workshop" in src and "insufficient funds for move" in src,
        "auto_policy_num_lines": len(lines),
        "auto_policy_first_120_lines": "\n".join(lines[:120]),
    }

@app.get("/debug/routes")
def debug_routes():
    routes = []
    for r in app.routes:
        path = getattr(r, "path", None)
        methods = getattr(r, "methods", None)
        if not path or not methods:
            continue
        routes.append({"path": path, "methods": sorted(list(methods))})
    routes.sort(key=lambda x: x["path"])
    return {"ok": True, "routes": routes}

@app.get("/world")
def get_world():
    return {
        "tick": world_state.get("tick", 0),
        "locations": world_state.get("locations", []),
        "agents": world_state.get("agents", []),
        "queued_actions": len(world_state.get("action_queue", [])),
        "logs": len(world_state.get("logs", [])),
        "economy": world_state.get("economy", {}),
        "entry": world_state.get("entry", {}),
    }

@app.get("/logs")
def get_logs(limit: int = Query(50, ge=1, le=500)):
    logs = world_state.get("logs", [])
    if not isinstance(logs, list):
        logs = []
    return logs[-limit:]

@app.get("/agents/{agent_id}")
def get_agent(agent_id: int):
    return find_agent(agent_id)

# ============================================================
# JOIN
# ============================================================

class JoinRequest(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    deposit_mon: int = Field(default=0, ge=0)
    entry_tx_hash: Optional[str] = None
    wallet_address: Optional[str] = None

@app.post("/join")
def join(req: JoinRequest):
    # MON token-gated entry (Monad mainnet)
    if not ALLOW_FREE_JOIN:
        if not req.entry_tx_hash:
            log("entry_denied_missing_tx", {"name": req.name})
            raise HTTPException(status_code=402, detail="Payment required: provide entry_tx_hash")

        v = verify_entry_tx(req.entry_tx_hash)
        entry = world_state.setdefault("entry", {})
        if not isinstance(entry, dict):
            entry = {}
            world_state["entry"] = entry
        used = entry.get("used_tx_hashes", [])
        if not isinstance(used, list):
            used = []
            entry["used_tx_hashes"] = used
        used.append(v["tx_hash"])
        log(
            "entry_verified",
            {
                "name": req.name,
                "tx_hash": v["tx_hash"],
                "from": v.get("from"),
                "to": v.get("to"),
                "value_wei": v.get("value_wei"),
                "min_fee_wei": v.get("min_fee_wei"),
                "block_number": v.get("block_number"),
            },
        )

    agent = {
        "id": len(world_state["agents"]) + 1,
        "name": req.name,
        "balance_mon": req.deposit_mon,
        "pos": "spawn",
        "status": "active",
        "inventory": [],
        "auto": False,
        "cooldown_until_tick": 0,
        "goal": "earn",
        "entry_tx_hash": (req.entry_tx_hash or "").strip().lower() if req.entry_tx_hash else None,
        "entry_payer": None,
        "wallet_address": (req.wallet_address or "").strip().lower() if req.wallet_address else None,
    }

    if not ALLOW_FREE_JOIN and req.entry_tx_hash:
        try:
            logs_list = world_state.get("logs", [])
            if isinstance(logs_list, list) and len(logs_list) > 0:
                last = logs_list[-1]
                if isinstance(last, dict) and last.get("event") == "entry_verified":
                    data = last.get("data") if isinstance(last.get("data"), dict) else {}
                    agent["entry_payer"] = data.get("from")
        except Exception:
            pass

    world_state["agents"].append(agent)
    log("join", {"agent_id": agent["id"], "name": agent["name"], "deposit_mon": agent["balance_mon"]})
    return {"ok": True, "agent": agent}

# ============================================================
# ACTION
# ============================================================

ActionType = Literal["move", "earn", "say"]

class ActRequest(BaseModel):
    agent_id: int
    type: ActionType
    payload: Dict[str, Any] = Field(default_factory=dict)

@app.post("/act")
def act(req: ActRequest):
    _ = find_agent(req.agent_id)
    payload = req.payload or {}

    if req.type == "move":
        to = payload.get("to")
        locs = world_state.get("locations", ["spawn", "market", "workshop"])
        if not isinstance(locs, list):
            locs = ["spawn", "market", "workshop"]
        if to is None or not isinstance(to, str) or to not in locs:
            raise HTTPException(
                status_code=400,
                detail="move requires payload.to (string, one of: spawn, market, workshop)",
            )

    elif req.type == "earn":
        amount = payload.get("amount", 1)
        if not isinstance(amount, int) or amount <= 0:
            raise HTTPException(status_code=400, detail="earn.amount must be positive int")

    elif req.type == "say":
        text = payload.get("text", "")
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(status_code=400, detail="say.text must be non-empty string")

    action = {
        "queued_at_tick": world_state["tick"],
        "agent_id": req.agent_id,
        "type": req.type,
        "payload": payload,
    }
    world_state["action_queue"].append(action)
    log("queued_action", action)

    return {"ok": True, "queued": action}

# ============================================================
# TICK
# ============================================================

@app.post("/tick")
def tick(steps: int = Query(1, ge=1, le=100)):
    applied_total = 0

    for _ in range(steps):
        world_state["tick"] += 1

        # Reset economy capacity each tick
        econ = world_state.get("economy", {})
        if not isinstance(econ, dict):
            econ = {}
            world_state["economy"] = econ
        cap_per_tick = int(econ.get("workshop_capacity_per_tick", 1))
        econ["workshop_capacity_left"] = cap_per_tick

        queue = world_state.get("action_queue", [])
        if not isinstance(queue, list):
            log("action_queue_corrupt", {"type": str(type(queue))})
            queue = []
        world_state["action_queue"] = []

        applied_this_tick = 0

        for action in queue:
            if not isinstance(action, dict):
                log("action_skipped_invalid", {"action": action, "reason": "not a dict"})
                continue
            agent_id = action.get("agent_id")
            if agent_id is None:
                log("action_skipped_invalid", {"action": action, "reason": "missing agent_id"})
                continue
            try:
                agent = find_agent(agent_id)
            except HTTPException:
                log("action_skipped_unknown_agent", {"action": action})
                continue

            a_type = action.get("type")
            payload = action.get("payload") or {}

            if a_type is None:
                log("action_skipped_invalid", {"action": action, "reason": "missing type"})
                continue

            if a_type == "move":
                to = payload.get("to")
                if to is None or not isinstance(to, str) or to not in world_state.get("locations", []):
                    log("move_denied_invalid_payload", {"agent_id": agent.get("id"), "payload": payload})
                    continue

                # Economy v2 sink: moving costs 1 MON
                cost = MOVE_COST_MON
                bal = int(agent.get("balance_mon", 0))
                if bal < cost:
                    log(
                        "move_denied_insufficient_funds",
                        {"agent_id": agent.get("id"), "pos": agent.get("pos"), "to": to, "balance_mon": bal, "cost": cost},
                    )
                    continue

                agent["balance_mon"] = bal - cost
                log(
                    "move_cost",
                    {"agent_id": agent.get("id"), "cost": cost, "balance_mon": agent["balance_mon"], "to": to},
                )

                agent["pos"] = to
                log("move", {"agent_id": agent["id"], "to": agent["pos"]})
                applied_this_tick += 1

            elif a_type == "earn":
                if agent["pos"] != "workshop":
                    log("earn_denied_wrong_location", {"agent_id": agent["id"], "pos": agent["pos"]})
                else:
                    # Economy v2: workshop capacity constraint per tick
                    left = int(econ.get("workshop_capacity_left", 0))
                    if left <= 0:
                        log("earn_denied_capacity", {"agent_id": agent["id"], "pos": agent["pos"], "left": left})
                        penalty_until = world_state["tick"] + 2  
                        agent["cooldown_until_tick"] = max(int(agent.get("cooldown_until_tick", 0)), penalty_until)
                        log("cooldown_penalty", {"agent_id": agent["id"], "until": agent["cooldown_until_tick"], "reason": "capacity"})
                        agent["last_denied_reason"] = "capacity"
                        agent["last_denied_tick"] = world_state["tick"]
                        continue

                    amount = payload.get("amount", 1)
                    agent["balance_mon"] = int(agent.get("balance_mon", 0)) + int(amount)
                    econ["workshop_capacity_left"] = left - 1
                    log(
                        "earn",
                        {
                            "agent_id": agent["id"],
                            "amount": int(amount),
                            "balance_mon": agent["balance_mon"],
                            "capacity_left": econ["workshop_capacity_left"],
                        },
                    )
                    applied_this_tick += 1

            elif a_type == "say":
                log("say", {"agent_id": agent["id"], "text": payload.get("text", ""), "pos": agent["pos"]})
                applied_this_tick += 1

        applied_total += applied_this_tick
        log("tick", {"applied_actions": applied_this_tick})

    return {"ok": True, "tick": world_state["tick"], "applied_actions": applied_total}

# ============================================================
# SPRINT 1: RESET / SCENARIO / METRICS / DEMO
# ============================================================

@app.post("/reset")
def reset():
    reset_in_place()
    log("reset", {"ok": True})
    return {"ok": True, "tick": world_state["tick"]}

@app.post("/scenario/basic")
def scenario_basic():
    reset_in_place()

    agents = [
        {"name": "alice", "deposit_mon": 10},
        {"name": "bob", "deposit_mon": 2},
        {"name": "charlie", "deposit_mon": 0},
    ]

    for a in agents:
        agent = {
            "id": len(world_state["agents"]) + 1,
            "name": a["name"],
            "balance_mon": a["deposit_mon"],
            "pos": "spawn",
            "status": "active",
            "inventory": [],
            "auto": False,
            "cooldown_until_tick": 0,
            "goal": "earn",
        }
        world_state["agents"].append(agent)
        log("join", {"agent_id": agent["id"], "name": agent["name"], "deposit_mon": agent["balance_mon"]})

    log("scenario_loaded", {"name": "basic", "agents": len(world_state["agents"])})
    return {"ok": True, "scenario": "basic", "agents": world_state["agents"]}

@app.get("/metrics")
def metrics():
    return {
        "tick": world_state["tick"],
        "agents": len(world_state["agents"]),
        "queued_actions": len(world_state["action_queue"]),
        "logs": len(world_state["logs"]),
        "locations": len(world_state["locations"]),
        "workshop_capacity_per_tick": int(world_state.get("economy", {}).get("workshop_capacity_per_tick", 1)),
        "workshop_capacity_left": int(world_state.get("economy", {}).get("workshop_capacity_left", 0)),
    }

@app.post("/demo/run")
def demo_run(steps: int = Query(5, ge=1, le=50)):
    if len(world_state["agents"]) == 0:
        scenario_basic()

    a0 = world_state["agents"][0]["id"]

    world_state["action_queue"].append({
        "queued_at_tick": world_state["tick"],
        "agent_id": a0,
        "type": "move",
        "payload": {"to": "workshop"},
    })
    tick(steps=1)

    world_state["action_queue"].append({
        "queued_at_tick": world_state["tick"],
        "agent_id": a0,
        "type": "earn",
        "payload": {"amount": 3},
    })
    world_state["action_queue"].append({
        "queued_at_tick": world_state["tick"],
        "agent_id": a0,
        "type": "say",
        "payload": {"text": "demo tick run"},
    })

    tick(steps=steps)
    return {"ok": True, "tick": world_state["tick"], "agents": world_state["agents"], "metrics": metrics()}

# ============================================================
# EXPLAIN
# ============================================================

def _format_event(e: Dict[str, Any]) -> str:
    if not isinstance(e, dict):
        return str(e)
    tick_val = e.get("tick")
    event = e.get("event")
    data = e.get("data")
    if not isinstance(data, dict):
        data = {}

    if event == "entry_denied_missing_tx":
        return f"tick {tick_val}: entry denied (missing tx) name={data.get('name')}"
    if event == "entry_verified":
        return (
            f"tick {tick_val}: entry verified name={data.get('name')} tx={data.get('tx_hash')} "
            f"value_wei={data.get('value_wei')} min_fee_wei={data.get('min_fee_wei')} block={data.get('block_number')}"
        )

    if event == "join":
        return (
            f"tick {tick_val}: agent {data.get('agent_id')} joined as '{data.get('name')}', "
            f"deposit={data.get('deposit_mon', 0)}"
        )
    if event == "queued_action":
        return f"tick {tick_val}: queued {data.get('type')} by agent {data.get('agent_id')} payload={data.get('payload')}"
    if event == "move":
        return f"tick {tick_val}: agent {data.get('agent_id')} moved to {data.get('to')}"
    if event == "move_cost":
        return (
            f"tick {tick_val}: agent {data.get('agent_id')} paid move cost {data.get('cost')} "
            f"(balance={data.get('balance_mon')}) to move to {data.get('to')}"
        )
    if event == "move_denied_insufficient_funds":
        return (
            f"tick {tick_val}: move denied for agent {data.get('agent_id')} "
            f"(balance={data.get('balance_mon')}, cost={data.get('cost')}, to={data.get('to')})"
        )   
    if event == "earn":
        cap_left = data.get("capacity_left")
        extra = f", capacity_left={cap_left}" if cap_left is not None else ""
        return (
            f"tick {tick_val}: agent {data.get('agent_id')} earned {data.get('amount')} "
            f"(balance={data.get('balance_mon')}{extra})"
        )
    if event == "earn_denied_wrong_location":
        return f"tick {tick_val}: earn denied for agent {data.get('agent_id')} (pos={data.get('pos')})"
    if event == "earn_denied_capacity":
        return (
            f"tick {tick_val}: earn denied for agent {data.get('agent_id')} "
            f"(reason=capacity, left={data.get('left')}, pos={data.get('pos')})"
        )
    if event == "say":
        return f"tick {tick_val}: agent {data.get('agent_id')} said '{data.get('text')}' at {data.get('pos')}"
    if event == "scenario_loaded":
        return f"tick {tick_val}: scenario loaded: {data.get('name')} (agents={data.get('agents')})"
    if event == "reset":
        return f"tick {tick_val}: world reset"
    if event == "persist_save":
        return f"tick {tick_val}: snapshot saved to {data.get('path')} (include_logs={data.get('include_logs')})"
    if event == "persist_load":
        return f"tick {tick_val}: snapshot loaded from {data.get('path')}"
    if event == "tick":
        return f"tick {tick_val}: tick step applied_actions={data.get('applied_actions')}"
    if event == "auto_enabled":
        return f"tick {tick_val}: auto enabled for agent {data.get('agent_id')}"
    if event == "auto_disabled":
        return f"tick {tick_val}: auto disabled for agent {data.get('agent_id')}"
    if event == "auto_decision":
        goal = data.get("goal")
        reason = data.get("reason")
        chosen = data.get("chosen")
        # chosen може бути dict (queued action) або None
        chosen_short = None
        if isinstance(chosen, dict):
            chosen_short = {
                "type": chosen.get("type"),
                "agent_id": chosen.get("agent_id"),
                "payload": chosen.get("payload"),
                "queued_at_tick": chosen.get("queued_at_tick"),
            }
        return (
            f"tick {tick_val}: auto decision agent={data.get('agent_id')} "
            f"goal={goal} reason={reason} chosen={chosen_short}"
        )
    if event == "goal_set":
        return f"tick {tick_val}: goal set for agent {data.get('agent_id')} -> {data.get('goal')}"
    if event == "auto_enabled_all":
        return f"tick {tick_val}: auto enabled for all active agents (count={data.get('count')})"
    if event == "auto_disabled_all":
        return f"tick {tick_val}: auto disabled for agents (count={data.get('count')})"
    if event == "action_skipped_unknown_agent":
        return f"tick {tick_val}: skipped action for unknown agent action={data.get('action')}"
    return f"tick {tick_val}: {event} {data}"

@app.get("/explain/recent")
def explain_recent(limit: int = Query(30, ge=1, le=200)):
    logs = world_state.get("logs", [])
    if not isinstance(logs, list):
        logs = []
    events = logs[-limit:]
    lines = [_format_event(e) for e in events]
    return {"ok": True, "limit": limit, "lines": lines}

@app.get("/explain/agent/{agent_id}")
def explain_agent(agent_id: int, limit: int = Query(50, ge=1, le=500)):
    _ = find_agent(agent_id)

    logs = world_state.get("logs", [])
    if not isinstance(logs, list):
        logs = []

    filtered = []
    for e in reversed(logs):
        if not isinstance(e, dict):
            continue
        d = e.get("data", {})
        if not isinstance(d, dict):
            d = {}
        if d.get("agent_id") == agent_id:
            filtered.append(e)
        if len(filtered) >= limit:
            break

    filtered.reverse()
    lines = [_format_event(e) for e in filtered]
    return {"ok": True, "agent_id": agent_id, "limit": limit, "lines": lines}

# ============================================================
# AUTONOMY v1 (goal-driven)
# ============================================================

GoalType = Literal["earn", "wander", "idle"]

def _pick_next_location(current: str) -> str:
    """
    Простий детермінований вибір локації (без random),
    щоб було відтворювано: рух по колу.
    """
    locs = world_state.get("locations", ["spawn", "market", "workshop"])
    if not locs:
        return current
    if current not in locs:
        return locs[0]
    if len(locs) == 1:
        return current

    idx = locs.index(current)
    return locs[(idx + 1) % len(locs)]

class AutoToggleRequest(BaseModel):
    agent_id: int

class GoalSetRequest(BaseModel):
    agent_id: int
    goal: GoalType

@app.post("/auto/enable")
def auto_enable(req: AutoToggleRequest):
    agent = find_agent(req.agent_id)
    agent["auto"] = True
    log("auto_enabled", {"agent_id": agent["id"]})
    return {"ok": True, "agent_id": agent["id"], "auto": True}

@app.post("/auto/disable")
def auto_disable(req: AutoToggleRequest):
    agent = find_agent(req.agent_id)
    agent["auto"] = False
    log("auto_disabled", {"agent_id": agent["id"]})
    return {"ok": True, "agent_id": agent["id"], "auto": False}

@app.post("/auto/enable_all")
def auto_enable_all():
    count = 0
    for agent in world_state.get("agents", []):
        if not isinstance(agent, dict):
            continue
        if agent.get("status") == "active":
            agent["auto"] = True
            count += 1
    log("auto_enabled_all", {"count": count})
    return {"ok": True, "enabled": count}

@app.post("/auto/disable_all")
def auto_disable_all():
    count = 0
    for agent in world_state.get("agents", []):
        if not isinstance(agent, dict):
            continue
        if agent.get("auto") is True:
            agent["auto"] = False
            count += 1
    log("auto_disabled_all", {"count": count})
    return {"ok": True, "disabled": count}

@app.post("/auto/goal")
def auto_set_goal(req: GoalSetRequest):
    agent = find_agent(req.agent_id)
    agent["goal"] = req.goal
    log("goal_set", {"agent_id": agent["id"], "goal": req.goal})
    return {"ok": True, "agent_id": agent["id"], "goal": agent["goal"]}

def _queue_action(agent_id: int, a_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    action = {
        "queued_at_tick": world_state.get("tick", 0),
        "agent_id": agent_id,
        "type": a_type,
        "payload": payload,
    }
    world_state.setdefault("action_queue", []).append(action)
    log("queued_action", action)
    return action

def _auto_policy_for_agent(agent: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Policy v1 (goal-driven):
    - goal=idle   -> do nothing
    - goal=wander -> move between locations
    - goal=earn   -> ensure workshop then earn(1)

    Economy v2 addition:
    - if the agent was just denied due to workshop capacity, do ONE wander/move
      on the next decision to avoid spamming earn and to demonstrate policy reaction.
    """
    tick_now = world_state.get("tick", 0)
    pos = agent.get("pos", "spawn")
    goal: str = agent.get("goal", "earn")
    bal = int(agent.get("balance_mon", 0))

    # --- Economy v2: react to recent capacity denial (must run BEFORE cooldown gate) ---
    last_reason = agent.get("last_denied_reason")
    last_tick = agent.get("last_denied_tick")

    if last_reason == "capacity" and last_tick is not None:
        # denial was very recent -> do one wander/move even if cooldown is set
        if tick_now <= int(last_tick) + 1:
            to = _pick_next_location(pos)
            # If the agent can't afford a move, do not spam; consume the one-shot reaction.
            if bal < MOVE_COST_MON:
                log(
                    "auto_decision",
                    {
                        "agent_id": agent["id"],
                        "goal": goal,
                        "reason": "recent capacity denial but insufficient funds for move",
                        "chosen": None,
                    },
                )
                agent.pop("last_denied_reason", None)
                agent.pop("last_denied_tick", None)
                agent["cooldown_until_tick"] = max(int(agent.get("cooldown_until_tick", 0)), tick_now + 1)
                return None
            chosen = _queue_action(agent["id"], "move", {"to": to}) if to != pos else None
            log(
                "auto_decision",
                {
                    "agent_id": agent["id"],
                    "goal": goal,
                    "reason": "recent capacity denial -> wander once",
                    "chosen": chosen,
                },
            )
            # clear flags so this reaction is one-shot
            agent.pop("last_denied_reason", None)
            agent.pop("last_denied_tick", None)
            agent["cooldown_until_tick"] = max(int(agent.get("cooldown_until_tick", 0)), tick_now + 1)
            return chosen

        # if it's no longer recent, just clear and continue normal logic
        agent.pop("last_denied_reason", None)
        agent.pop("last_denied_tick", None)

    cooldown_until = int(agent.get("cooldown_until_tick", 0))
    if tick_now < cooldown_until:
        log(
            "auto_decision",
            {
                "agent_id": agent.get("id"),
                "goal": goal,
                "reason": f"cooldown (until {cooldown_until})",
                "chosen": None,
            },
        )
        return None

    if goal == "idle":
        log(
            "auto_decision",
            {
                "agent_id": agent.get("id"),
                "goal": goal,
                "reason": "idle goal -> no action",
                "chosen": None,
            },
        )
        agent["cooldown_until_tick"] = tick_now + 1
        return None

    if goal == "wander":
        if bal < MOVE_COST_MON:
            log(
                "auto_decision",
                {
                    "agent_id": agent.get("id"),
                    "goal": goal,
                    "reason": "wander but insufficient funds for move",
                    "chosen": None,
                },
            )
            agent["cooldown_until_tick"] = tick_now + 1
            return None

        to = _pick_next_location(pos)
        chosen = _queue_action(agent["id"], "move", {"to": to}) if to != pos else None
        log(
            "auto_decision",
            {
                "agent_id": agent.get("id"),
                "goal": goal,
                "reason": f"wander -> move {pos} -> {to}",
                "chosen": chosen,
            },
        )
        agent["cooldown_until_tick"] = tick_now + 1
        return chosen

    # default: earn
    if pos != "workshop":
        if bal < MOVE_COST_MON:
            log(
                "auto_decision",
                {
                    "agent_id": agent["id"],
                    "goal": goal,
                    "reason": f"not in workshop (pos={pos}) but insufficient funds for move",
                    "chosen": None,
                },
            )
            agent["cooldown_until_tick"] = tick_now + 1
            return None

        chosen = _queue_action(agent["id"], "move", {"to": "workshop"})
        log(
            "auto_decision",
            {
                "agent_id": agent["id"],
                "goal": goal,
                "reason": f"not in workshop (pos={pos})",
                "chosen": chosen,
            },
        )
        agent["cooldown_until_tick"] = tick_now + 1
        return chosen

    chosen = _queue_action(agent["id"], "earn", {"amount": 1})
    log(
        "auto_decision",
        {
            "agent_id": agent["id"],
            "goal": goal,
            "reason": "in workshop -> earn",
            "chosen": chosen,
        },
    )
    agent["cooldown_until_tick"] = tick_now + 1
    return chosen

def auto_step_internal(limit_agents: int = 50) -> Dict[str, Any]:
    actions: List[Dict[str, Any]] = []
    count = 0

    for agent in world_state.get("agents", []):
        if count >= limit_agents:
            break
        if not isinstance(agent, dict) or agent.get("id") is None:
            continue
        if agent.get("auto") is True and agent.get("status") == "active":
            chosen = _auto_policy_for_agent(agent)
            if chosen is not None:
                actions.append(chosen)
            count += 1

    return {"ok": True, "tick": world_state.get("tick", 0), "generated_actions": actions, "n": len(actions)}

@app.post("/auto/step")
def auto_step(limit_agents: int = Query(50, ge=1, le=500)):
    return auto_step_internal(limit_agents=limit_agents)

@app.post("/auto/tick")
def auto_tick(limit_agents: int = Query(50, ge=1, le=500)):
    step_res = auto_step_internal(limit_agents=limit_agents)
    tick_res = tick(steps=1)
    return {"ok": True, "auto": step_res, "tick": tick_res}
# Debug Monad endpoint
@app.get("/debug/monad")
def debug_monad():
    used = 0
    try:
        used_list = world_state.get("entry", {}).get("used_tx_hashes", [])
        if isinstance(used_list, list):
            used = len(used_list)
    except Exception:
        used = 0
    return {
        "ok": True,
        "cwd": os.getcwd(),
        "env_path": str(Path(__file__).with_name(".env")),
        "env_exists": Path(__file__).with_name(".env").exists(),
        "monad_chain_id": MONAD_CHAIN_ID,
        "monad_rpc_url": MONAD_RPC_URL,
        "monad_treasury": MONAD_TREASURY_ADDRESS,
        "min_entry_fee_wei": _parse_min_fee_wei(),
        "allow_free_join": ALLOW_FREE_JOIN,
        "used_entry_txs": used,
    }