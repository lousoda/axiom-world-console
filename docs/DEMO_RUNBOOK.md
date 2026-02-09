# Demo Runbook (MVP)

## T-15 minutes

1. Export runtime secrets in shell:
```bash
export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
```
2. Run automated gate for live profile:
```bash
bash /Users/naturalmetalgear/Documents/world_model_agent/scripts/demo_gate.sh live 8011
```

## T-5 minutes

1. Keep one terminal for operator POST commands only.
2. Use another terminal for read-only monitoring:
```bash
curl -sS http://127.0.0.1:8011/world
curl -sS http://127.0.0.1:8011/explain/recent
```

## Go / No-Go

- `GO` if:
  - `demo_gate.sh` passes
  - strict token-gated join works (`401/402/200` sequence is correct)
- `NO-GO` if:
  - preflight fails
  - RPC chain check fails
  - strict join cannot complete with fresh tx hash

## Fallback policy

1. For rehearsal or infra instability, switch to local profile:
```bash
export WORLD_GATE_KEY="your_key"
bash /Users/naturalmetalgear/Documents/world_model_agent/scripts/demo_gate.sh local 8011
```
2. For final proof in bounty context, use live profile with real Monad mainnet tx hash.

## Tx hash hygiene

Record each strict-run tx hash locally (do not commit):
```bash
mkdir -p /Users/naturalmetalgear/Documents/world_model_agent/.demo
echo "$(date -u +%FT%TZ) 0x<tx_hash>" >> /Users/naturalmetalgear/Documents/world_model_agent/.demo/used_tx_hashes.txt
```
