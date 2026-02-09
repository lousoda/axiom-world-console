# Demo Risk Register (MVP)

This register tracks operational risks for hackathon demo readiness.

| ID | Risk | Trigger | Impact | Mitigation | Owner | Verification |
|---|---|---|---|---|---|---|
| R1 | Monad RPC timeout / instability | RPC slow or unreachable during live token-gated join | Demo interruption on `/join` | Run strict preflight before demo; keep 1-2 fresh tx hashes ready; keep local profile for rehearsal | Demo operator | `bash /Users/naturalmetalgear/Documents/world_model_agent/scripts/preflight_demo.sh /Users/naturalmetalgear/Documents/world_model_agent/.env.demo.live http://127.0.0.1:8011` |
| R2 | Reused tx hash returns `409` | Re-running strict flow with same tx hash | Join blocked in front of judges | Use a fresh tx hash per strict run; track used hashes in local file | Demo operator | `grep -n \"<tx_hash>\" /Users/naturalmetalgear/Documents/world_model_agent/.demo/used_tx_hashes.txt` |
| R3 | Wrong runtime mode (not single worker) | Manual server start without run script | In-memory state inconsistency risk | Start only via `scripts/run_demo.sh` (forces `--workers 1`) | Demo operator | `ps -ef | grep \"uvicorn app:app\"` |
| R4 | Chaotic concurrent writes | Multiple clients sending POST mutations in parallel | Non-deterministic demo behavior | One operator for mutating endpoints; observers use read-only endpoints | Demo team | Team runbook discipline |

## Notes

- This is an MVP risk register for judged demo operations, not production SRE policy.
- Keep this file updated if runbook or scripts change.
