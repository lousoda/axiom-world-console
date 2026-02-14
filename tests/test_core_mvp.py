import json
import os
import tempfile
import asyncio

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

import sys
from pathlib import Path

# Ensure repo root is on sys.path so `import app` works when pytest changes CWD.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app


def _write_snapshot(world_state_obj: dict) -> str:
    fd, path = tempfile.mkstemp(suffix=".json")
    Path(path).write_text(
        json.dumps(
            {
                "schema_version": 1,
                "saved_at": 0,
                "world_state": world_state_obj,
            }
        ),
        encoding="utf-8",
    )
    return path


def test_persist_load_invalid_json_returns_400():
    fd, path = tempfile.mkstemp(suffix=".json")
    p = Path(path)
    p.write_text("{not valid json", encoding="utf-8")

    try:
        app.load_world_state(path)
        assert False, "Expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 400
        assert "Snapshot JSON is invalid" in str(e.detail)
    finally:
        p.unlink(missing_ok=True)


def test_malformed_loaded_action_does_not_raise_500():
    app.reset_in_place()
    ws = {
        "tick": 0,
        "locations": ["spawn", "market", "workshop"],
        "agents": [
            {
                "id": 1,
                "name": "a",
                "balance_mon": 0,
                "pos": "workshop",
                "status": "active",
                "inventory": [],
                "auto": False,
                "cooldown_until_tick": 0,
                "goal": "earn",
            }
        ],
        "action_queue": [
            {
                "queued_at_tick": 0,
                "agent_id": 1,
                "type": "earn",
                "payload": {"amount": "oops"},
            }
        ],
        "logs": [],
        "economy": {"workshop_capacity_per_tick": "1", "workshop_capacity_left": "1"},
        "entry": {"used_tx_hashes": []},
    }
    path = _write_snapshot(ws)

    try:
        app.load_world_state(path)
        out = app.tick(steps=1)
        assert out["ok"] is True
        assert out["applied_actions"] == 0
        events = [e.get("event") for e in app.world_state.get("logs", []) if isinstance(e, dict)]
        assert "earn_denied_invalid_amount" in events
    finally:
        Path(path).unlink(missing_ok=True)


def test_join_after_load_uses_max_plus_one_id():
    app.reset_in_place()
    ws = {
        "tick": 0,
        "locations": ["spawn", "market", "workshop"],
        "agents": [
            {
                "id": 2,
                "name": "existing",
                "balance_mon": 0,
                "pos": "spawn",
                "status": "active",
                "inventory": [],
                "auto": False,
                "cooldown_until_tick": 0,
                "goal": "earn",
            }
        ],
        "action_queue": [],
        "logs": [],
        "economy": {"workshop_capacity_per_tick": 1, "workshop_capacity_left": 1},
        "entry": {"used_tx_hashes": []},
    }
    path = _write_snapshot(ws)
    prev_allow = app.ALLOW_FREE_JOIN

    try:
        app.load_world_state(path)
        app.ALLOW_FREE_JOIN = True
        res = app.join(app.JoinRequest(name="new", deposit_mon=0))
        assert res["ok"] is True
        assert res["agent"]["id"] == 3
        assert [a["id"] for a in app.world_state["agents"]] == [2, 3]
    finally:
        app.ALLOW_FREE_JOIN = prev_allow
        Path(path).unlink(missing_ok=True)


def test_token_gated_join_without_tx_returns_402():
    app.reset_in_place()
    prev_allow = app.ALLOW_FREE_JOIN
    app.ALLOW_FREE_JOIN = False

    try:
        req = app.JoinRequest(name="no_tx", deposit_mon=0)
        app.join(req)
        assert False, "Expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 402
        assert "Payment required" in str(e.detail)
    finally:
        app.ALLOW_FREE_JOIN = prev_allow

def test_env_int_monad_chain_id_safe_default():
    prev = os.environ.get("MONAD_CHAIN_ID")
    try:
        os.environ["MONAD_CHAIN_ID"] = "abc"
        assert app._env_int("MONAD_CHAIN_ID", 143, min_value=1) == 143

        os.environ["MONAD_CHAIN_ID"] = "0"
        assert app._env_int("MONAD_CHAIN_ID", 143, min_value=1) == 143

        os.environ["MONAD_CHAIN_ID"] = "143"
        assert app._env_int("MONAD_CHAIN_ID", 143, min_value=1) == 143
    finally:
        if prev is None:
            os.environ.pop("MONAD_CHAIN_ID", None)
        else:
            os.environ["MONAD_CHAIN_ID"] = prev

def test_token_gated_replay_persists_across_reset():
    app.reset_in_place()
    prev_allow = app.ALLOW_FREE_JOIN
    prev_verify = app.verify_entry_tx
    app.ALLOW_FREE_JOIN = False
    txh = "0x" + "1" * 64

    def fake_verify_entry_tx(tx_hash: str):
        normalized = tx_hash.strip().lower()
        used = app.world_state.get("entry", {}).get("used_tx_hashes", [])
        if normalized in [str(x).lower() for x in used if isinstance(x, str)]:
            raise HTTPException(status_code=409, detail="Entry tx hash already used")
        return {
            "ok": True,
            "tx_hash": normalized,
            "from": "0x" + "2" * 40,
            "to": "0x" + "3" * 40,
            "value_wei": 1,
            "min_fee_wei": 1,
            "block_number": 1,
        }

    try:
        app.verify_entry_tx = fake_verify_entry_tx
        req = app.JoinRequest(name="replay_tester", deposit_mon=0, entry_tx_hash=txh)

        first = app.join(req)
        assert first["ok"] is True

        app.reset()
        assert txh in app.world_state.get("entry", {}).get("used_tx_hashes", [])

        app.join(req)
        assert False, "Expected HTTPException for replayed tx hash"
    except HTTPException as e:
        assert e.status_code == 409
        assert "already used" in str(e.detail)
    finally:
        app.verify_entry_tx = prev_verify
        app.ALLOW_FREE_JOIN = prev_allow

def test_token_gated_scenarios_preserve_replay_hashes():
    prev_allow = app.ALLOW_FREE_JOIN
    app.ALLOW_FREE_JOIN = False
    txh = "0x" + "a" * 64

    try:
        app.reset_in_place(preserve_used_tx_hashes=True)
        app.world_state.setdefault("entry", {})["used_tx_hashes"] = [txh]
        app.scenario_basic()
        used_after_basic = app.world_state.get("entry", {}).get("used_tx_hashes", [])
        assert txh in [str(x).lower() for x in used_after_basic if isinstance(x, str)]

        app.world_state.setdefault("entry", {})["used_tx_hashes"] = [txh]
        app.scenario_basic_auto()
        used_after_basic_auto = app.world_state.get("entry", {}).get("used_tx_hashes", [])
        assert txh in [str(x).lower() for x in used_after_basic_auto if isinstance(x, str)]
    finally:
        app.ALLOW_FREE_JOIN = prev_allow

def test_token_gated_load_keeps_existing_replay_hashes():
    prev_allow = app.ALLOW_FREE_JOIN
    app.ALLOW_FREE_JOIN = False
    txh = "0x" + "b" * 64
    path = None

    ws = {
        "tick": 0,
        "locations": ["spawn", "market", "workshop"],
        "agents": [],
        "action_queue": [],
        "logs": [],
        "economy": {"workshop_capacity_per_tick": 1, "workshop_capacity_left": 1},
        "entry": {"used_tx_hashes": []},
    }

    try:
        path = _write_snapshot(ws)
        app.reset_in_place(preserve_used_tx_hashes=True)
        app.world_state.setdefault("entry", {})["used_tx_hashes"] = [txh]
        app.load_world_state(path)
        used_after_load = app.world_state.get("entry", {}).get("used_tx_hashes", [])
        assert txh in [str(x).lower() for x in used_after_load if isinstance(x, str)]
    finally:
        app.ALLOW_FREE_JOIN = prev_allow
        if path:
            Path(path).unlink(missing_ok=True)

def test_world_gate_header_enforced_for_join():
    prev_require = app.REQUIRE_API_KEY
    prev_header = app.API_KEY_HEADER_NAME
    prev_gate_key = app.WORLD_GATE_KEY
    prev_allow = app.ALLOW_FREE_JOIN

    app.reset_in_place()

    try:
        app.REQUIRE_API_KEY = True
        app.API_KEY_HEADER_NAME = "X-World-Gate"
        app.WORLD_GATE_KEY = "test-world-gate-key"
        app.ALLOW_FREE_JOIN = True

        async def ok_next(_request):
            return JSONResponse(status_code=200, content={"ok": True})

        scope_no_header = {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "path": "/join",
            "raw_path": b"/join",
            "query_string": b"",
            "headers": [(b"host", b"testserver")],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        }
        req_no_header = Request(scope_no_header)
        no_header = asyncio.run(app.security_guard(req_no_header, ok_next))
        assert no_header.status_code == 401
        assert "Missing or invalid X-World-Gate" in no_header.body.decode("utf-8")

        scope_with_header = {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "path": "/join",
            "raw_path": b"/join",
            "query_string": b"",
            "headers": [
                (b"host", b"testserver"),
                (b"x-world-gate", b"test-world-gate-key"),
            ],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        }
        req_with_header = Request(scope_with_header)
        ok = asyncio.run(app.security_guard(req_with_header, ok_next))
        assert ok.status_code == 200
        assert ok.body.decode("utf-8") == '{"ok":true}'
    finally:
        app.REQUIRE_API_KEY = prev_require
        app.API_KEY_HEADER_NAME = prev_header
        app.WORLD_GATE_KEY = prev_gate_key
        app.ALLOW_FREE_JOIN = prev_allow


def test_happy_path_join_act_tick_explain():
    app.reset_in_place()
    prev_allow = app.ALLOW_FREE_JOIN
    app.ALLOW_FREE_JOIN = True

    try:
        j = app.join(app.JoinRequest(name="smoke", deposit_mon=2))
        agent_id = j["agent"]["id"]

        a1 = app.act(
            app.ActRequest(agent_id=agent_id, type="move", payload={"to": "workshop"})
        )
        assert a1["ok"] is True
        t1 = app.tick(steps=1)
        assert t1["ok"] is True

        a2 = app.act(
            app.ActRequest(agent_id=agent_id, type="earn", payload={"amount": 1})
        )
        assert a2["ok"] is True
        t2 = app.tick(steps=1)
        assert t2["ok"] is True

        ex = app.explain_recent(limit=50)
        assert ex["ok"] is True
        joined = "\n".join(ex.get("lines", []))
        assert "earned" in joined or "earn denied" in joined
    finally:
        app.ALLOW_FREE_JOIN = prev_allow


def test_autonomy_proof_scenario_surfaces_denial_and_adaptation():
    app.reset_in_place()
    scenario = app.scenario_autonomy_proof()
    assert scenario["ok"] is True
    assert scenario["scenario"] == "autonomy_proof"
    assert len(scenario.get("agents", [])) >= 3

    first = app.auto_tick(limit_agents=50)
    assert first["ok"] is True

    second = app.auto_tick(limit_agents=50)
    assert second["ok"] is True

    logs = app.world_state.get("logs", [])
    events = [e for e in logs if isinstance(e, dict)]
    names = [e.get("event") for e in events]

    assert "earn_denied_capacity" in names
    assert "cooldown_penalty" in names

    adapted = False
    for event in events:
        if event.get("event") != "auto_decision":
            continue
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        reason = str(data.get("reason", ""))
        if "recent capacity denial" in reason and "wander once" in reason:
            adapted = True
            break

    assert adapted, "Expected one-shot policy adaptation after capacity denial"


def test_autonomy_breathing_scenario_keeps_capacity_headroom():
    app.reset_in_place()
    scenario = app.scenario_autonomy_breathing()
    assert scenario["ok"] is True
    assert scenario["scenario"] == "autonomy_breathing"
    assert len(scenario.get("agents", [])) >= 3

    start_metrics = app.metrics()
    assert start_metrics["workshop_capacity_per_tick"] == 2
    assert start_metrics["workshop_capacity_left"] == 2

    cap_values = []
    for _ in range(6):
        out = app.auto_tick(limit_agents=50)
        assert out["ok"] is True
        current_metrics = app.metrics()
        cap_values.append(int(current_metrics["workshop_capacity_left"]))

    assert any(v > 0 for v in cap_values), "Expected visible capacity headroom (>0) in breathing scenario"
    assert all(v <= 2 for v in cap_values)


def test_adaptive_goal_override_restores_after_capacity_streak():
    app.reset_in_place()

    app.world_state["agents"] = [
        {
            "id": 1,
            "name": "earner_a",
            "balance_mon": 10,
            "pos": "workshop",
            "status": "active",
            "inventory": [],
            "auto": True,
            "cooldown_until_tick": 0,
            "goal": "earn",
        },
        {
            "id": 2,
            "name": "earner_b",
            "balance_mon": 0,
            "pos": "workshop",
            "status": "active",
            "inventory": [],
            "auto": True,
            "cooldown_until_tick": 0,
            "goal": "earn",
        },
    ]

    for _ in range(8):
        out = app.auto_tick(limit_agents=50)
        assert out["ok"] is True

    events = [
        e for e in app.world_state.get("logs", []) if isinstance(e, dict)
    ]
    names = [e.get("event") for e in events]

    assert "earn_denied_capacity" in names
    assert "adaptive_goal_override" in names
    assert "goal_restore" in names

    agent_b = app.find_agent(2)
    assert agent_b.get("goal") == "earn"
