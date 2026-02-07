# Code Audit: World Model Agent MVP (app.py)

## Summary
Strict, low-risk audit focused on correctness bugs, crash risks, and demo-failure risks. All MUST FIX and SHOULD FIX items below have been patched in `app.py`.

---

## 1) Findings by severity

### MUST FIX NOW (can cause crash, wrong behavior, or demo failure)

#### F1. find_agent — non-dict agents cause AttributeError
- **Where:** `find_agent()` (lines 62–66), loop `a.get("id")`.
- **Why:** If `agents` contains `None` or a non-dict (e.g. corrupted or old snapshot), `a.get("id")` raises `AttributeError`.
- **Fix:** Only consider dicts: `if isinstance(a, dict) and a.get("id") == agent_id`.
- **Test:**
```bash
curl -s -X POST http://127.0.0.1:8001/reset
# Manually corrupt snapshot with agents: [null] or load such a snapshot and call /agents/1
# After fix: 404 instead of 500.
```

#### F2. _normalize_loaded_state — loaded agents missing required keys
- **Where:** `_normalize_loaded_state()`, agent loop; tick/auto use `agent["pos"]`, `agent["balance_mon"]`, etc.
- **Why:** Loaded snapshots may have agents without `pos`, `balance_mon`, `status`, `inventory`, or with non-dict/non-id entries. Tick and auto policy then raise `KeyError` or use invalid data.
- **Fix:** Filter to dict agents with `id`; set defaults: `pos`, `balance_mon`, `status`, `inventory`, `auto`, `cooldown_until_tick`, `goal`; normalize `goal`; replace `base["agents"]` with this list.
- **Test:**
```bash
# Save a snapshot, edit JSON to remove "pos" from an agent or add "agents": [{}], reload
curl -s -X POST http://127.0.0.1:8001/persist/load -H "Content-Type: application/json" -d '{}'
curl -s http://127.0.0.1:8001/world
curl -s -X POST "http://127.0.0.1:8001/tick?steps=1"
# After fix: no crash; agent has defaults or is dropped.
```

#### F3. tick() — missing agent_id or malformed action; earn balance KeyError
- **Where:** Tick action loop: `action["agent_id"]`, and earn branch `agent["balance_mon"] += amount`.
- **Why:** Malformed queue entry without `agent_id` causes `KeyError`. Agent without `balance_mon` (e.g. from load) causes `KeyError` on `+=`.
- **Fix:** Treat non-dict action or missing `agent_id` as invalid (log and continue). For earn use: `agent["balance_mon"] = int(agent.get("balance_mon", 0)) + int(amount)`.
- **Test:**
```bash
curl -s -X POST http://127.0.0.1:8001/reset
curl -s -X POST http://127.0.0.1:8001/scenario/basic
# (Internal: append a malformed action to queue then tick)
curl -s -X POST "http://127.0.0.1:8001/tick?steps=1"
# After fix: no crash; applied_actions consistent.
```

#### F4. verify_entry_tx — tx/receipt not dict; to/from not string
- **Where:** `verify_entry_tx()`, uses `tx.get("to")`, `receipt.get("status")`, and `.strip().lower()` on `to`/`from`.
- **Why:** If RPC returns non-dict or `to`/`from` are non-string, `.strip()` raises `AttributeError`. Non-dict receipt causes same on `.get("status")`.
- **Fix:** Require `tx` and `receipt` to be dicts (else 404). Coerce `to`/`from` to string before strip: `_to = tx.get("to"); to_addr = (_to if isinstance(_to, str) else "").strip().lower()` (and same for `from`).
- **Test:**
```bash
# Token-gated mode (ALLOW_FREE_JOIN=false): invalid tx should fail cleanly (400/404/502), never 500.
curl -i -s -X POST http://127.0.0.1:8001/join \
  -H "Content-Type: application/json" \
  -d '{"name":"x","deposit_mon":0,"entry_tx_hash":"0xinvalid"}'
```

#### F5. join() — used_tx_hashes not a list; logs[-1] IndexError
- **Where:** After `verify_entry_tx`: `world_state.setdefault("entry", {}).setdefault("used_tx_hashes", []).append(...)`; and `world_state.get("logs", [])[-1]` for entry_payer.
- **Why:** If `entry` or `used_tx_hashes` was overwritten with a non-list, `.append` raises. If `logs` is empty, `[-1]` raises `IndexError`.
- **Fix:** Ensure `entry` is a dict and `used_tx_hashes` is a list (recreate if not) before appending. Before using last log, check `isinstance(logs, list) and len(logs) > 0`; ensure `data` is dict when reading `from`.
- **Test:**
```bash
curl -s -X POST http://127.0.0.1:8001/reset
# Token-gated mode: if you load a corrupted snapshot where `entry.used_tx_hashes` is not a list,
# join should fail cleanly (not crash). This is primarily validated by `/persist/load` + `/join`.
# After fix: no 500 even if logs are empty or entry is corrupted.
```

#### F6. _format_event — e or data not dict
- **Where:** `_format_event(e)`: `e.get("tick")`, `e.get("data", {})`, then `data.get(...)`.
- **Why:** Old/corrupt log entries may be non-dict or have non-dict `data`; `.get` on non-dict raises `AttributeError`.
- **Fix:** If `e` is not a dict, return `str(e)`. Set `data = e.get("data")` and if not `isinstance(data, dict)` then `data = {}`.
- **Test:**
```bash
curl -s http://127.0.0.1:8001/explain/recent
curl -s http://127.0.0.1:8001/explain/agent/1
# After fix: no crash with malformed log entries (if any).
```

#### F7. auto_step_internal — agent without id or non-dict
- **Where:** `auto_step_internal()`, loop over agents then `_auto_policy_for_agent(agent)` which uses `agent["id"]`.
- **Why:** Loaded or corrupted agent that is non-dict or has no `id` causes `KeyError` or TypeError in policy.
- **Fix:** Skip agents that are not dict or have `agent.get("id") is None` before calling `_auto_policy_for_agent`.
- **Test:**
```bash
curl -s -X POST http://127.0.0.1:8001/reset
curl -s -X POST http://127.0.0.1:8001/scenario/basic
curl -s -X POST http://127.0.0.1:8001/auto/enable_all
curl -s -X POST "http://127.0.0.1:8001/auto/step"
# After fix: no crash with valid scenario; with corrupted agents, invalid ones skipped.
```

---

### SHOULD FIX (robustness, less critical)

#### F8. _rpc_call — transient RPC failure
- **Where:** `_rpc_call()`, single `requests.post` then raise on any exception.
- **Why:** Transient timeout or connection error can cause demo failure (502) even when RPC is briefly unavailable.
- **Fix:** One retry: loop at most 2 attempts; on exception, retry once then raise with same 502 semantics.
- **Test:**
```bash
# Basic RPC health check (retry is internal). Should return JSON and not 500.
curl -s http://127.0.0.1:8001/debug/monad
```

---

### NICE TO HAVE (micro improvements, safe)

#### F9. get_world — economy/entry type
- **Where:** `get_world()` returns `world_state.get("economy", {})` and `world_state.get("entry", {})`.
- **Why:** If state was corrupted and these are not dicts, response shape changes (e.g. list or string). No server crash.
- **Fix (optional):** Ensure return values are dicts: `economy = world_state.get("economy"); return { ..., "economy": economy if isinstance(economy, dict) else {}, "entry": entry if isinstance(entry, dict) else {} }`.
- **Test:** Same as F2 load test; check `/world` returns dicts for economy/entry.

---

## 2) Minimal smoke test script (run after applying patches)

See `smoke_test.sh` in this directory. Run with server base URL as first argument, e.g. `./smoke_test.sh http://127.0.0.1:8001`.
