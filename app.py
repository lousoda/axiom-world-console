from fastapi import FastAPI, HTTPException, Query, Body
from pydantic import BaseModel, Field
from typing import Literal, Dict, Any, Optional, List
import time
import os
import json
from pathlib import Path

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
    }

world_state: Dict[str, Any] = make_initial_world_state()

def reset_in_place() -> None:
    """Очищає state без заміни dict-об’єкта (менше сюрпризів)."""
    fresh = make_initial_world_state()
    world_state.clear()
    world_state.update(fresh)

def log(event: str, data: Dict[str, Any]) -> None:
    world_state.setdefault("logs", []).append({
        "time": time.time(),
        "tick": world_state.get("tick", 0),
        "event": event,
        "data": data,
    })

def find_agent(agent_id: int) -> Dict[str, Any]:
    for a in world_state.get("agents", []):
        if a.get("id") == agent_id:
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

    for k in ["tick", "locations", "agents", "action_queue", "logs"]:
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

    # Якщо у старих snapshot'ах агентів ще не було auto/cooldown/goal — додаємо дефолти
    allowed_goals = {"earn", "wander", "idle"}
    for a in base["agents"]:
        if isinstance(a, dict):
            a.setdefault("auto", False)
            a.setdefault("cooldown_until_tick", 0)
            a.setdefault("goal", "earn")

            # Санітизація goal (на випадок старих/битих snapshot'ів)
            if a.get("goal") not in allowed_goals:
                a["goal"] = "earn"

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
    res = save_world_state(path=req.path, include_logs=req.include_logs)
    log("persist_save", {"path": res.get("path"), "include_logs": req.include_logs})
    return res

@app.post("/persist/load")
def persist_load(req: PersistLoadRequest = Body(default=PersistLoadRequest())):
    return load_world_state(path=req.path)

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

@app.post("/join")
def join(req: JoinRequest):
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
    }
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
        if to is None or not isinstance(to, str) or to not in world_state["locations"]:
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

        queue = world_state["action_queue"]
        world_state["action_queue"] = []

        applied_this_tick = 0

        for action in queue:
            try:
                agent = find_agent(action["agent_id"])
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
                agent["pos"] = to
                log("move", {"agent_id": agent["id"], "to": agent["pos"]})
                applied_this_tick += 1

            elif a_type == "earn":
                if agent["pos"] != "workshop":
                    log("earn_denied_wrong_location", {"agent_id": agent["id"], "pos": agent["pos"]})
                else:
                    amount = payload.get("amount", 1)
                    agent["balance_mon"] += int(amount)
                    log("earn", {"agent_id": agent["id"], "amount": int(amount), "balance_mon": agent["balance_mon"]})
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
    tick_val = e.get("tick")
    event = e.get("event")
    data = e.get("data", {})

    if event == "join":
        return (
            f"tick {tick_val}: agent {data.get('agent_id')} joined as '{data.get('name')}', "
            f"deposit={data.get('deposit_mon', 0)}"
        )
    if event == "queued_action":
        return f"tick {tick_val}: queued {data.get('type')} by agent {data.get('agent_id')} payload={data.get('payload')}"
    if event == "move":
        return f"tick {tick_val}: agent {data.get('agent_id')} moved to {data.get('to')}"
    if event == "earn":
        return f"tick {tick_val}: agent {data.get('agent_id')} earned {data.get('amount')} (balance={data.get('balance_mon')})"
    if event == "earn_denied_wrong_location":
        return f"tick {tick_val}: earn denied for agent {data.get('agent_id')} (pos={data.get('pos')})"
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
        d = e.get("data", {})
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
        if agent.get("status") == "active":
            agent["auto"] = True
            count += 1
    log("auto_enabled_all", {"count": count})
    return {"ok": True, "enabled": count}

@app.post("/auto/disable_all")
def auto_disable_all():
    count = 0
    for agent in world_state.get("agents", []):
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
    """
    tick_now = world_state.get("tick", 0)
    pos = agent.get("pos", "spawn")
    goal: str = agent.get("goal", "earn")

    cooldown_until = int(agent.get("cooldown_until_tick", 0))
    if tick_now < cooldown_until:
        log("auto_decision", {
            "agent_id": agent.get("id"),
            "goal": goal,
            "reason": f"cooldown (until {cooldown_until})",
            "chosen": None,
        })
        return None

    if goal == "idle":
        log("auto_decision", {
            "agent_id": agent.get("id"),
            "goal": goal,
            "reason": "idle goal -> no action",
            "chosen": None,
        })
        agent["cooldown_until_tick"] = tick_now + 1
        return None

    if goal == "wander":
        to = _pick_next_location(pos)
        chosen = _queue_action(agent["id"], "move", {"to": to}) if to != pos else None
        log("auto_decision", {
            "agent_id": agent.get("id"),
            "goal": goal,
            "reason": f"wander -> move {pos} -> {to}",
            "chosen": chosen,
        })
        agent["cooldown_until_tick"] = tick_now + 1
        return chosen

    # default: earn
    if pos != "workshop":
        chosen = _queue_action(agent["id"], "move", {"to": "workshop"})
        log("auto_decision", {
            "agent_id": agent["id"],
            "goal": goal,
            "reason": f"not in workshop (pos={pos})",
            "chosen": chosen,
        })
        agent["cooldown_until_tick"] = tick_now + 1
        return chosen

    chosen = _queue_action(agent["id"], "earn", {"amount": 1})
    log("auto_decision", {
        "agent_id": agent["id"],
        "goal": goal,
        "reason": "in workshop -> earn",
        "chosen": chosen,
    })
    agent["cooldown_until_tick"] = tick_now + 1
    return chosen

def auto_step_internal(limit_agents: int = 50) -> Dict[str, Any]:
    actions: List[Dict[str, Any]] = []
    count = 0

    for agent in world_state.get("agents", []):
        if count >= limit_agents:
            break
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