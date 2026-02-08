import json
import os
import tempfile

from fastapi import HTTPException

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
