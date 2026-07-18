# Contract tests

Contract-focused tests for the SignalJudge Intelligent Contract
(`../contract/signal_judge.py`), written for GenLayer's
[`gltest`](https://docs.genlayer.com/api-references/genlayer-test) runner.

`test_signal_judge.py` deploys the real contract to a GenLayer node and
exercises its deterministic, consensus-critical surface:

- **stake enforcement** — `submit_signal` is payable and must reject any value
  other than the exact 1 GEN stake;
- **input validation** — unknown timeframe (incl. the removed `test` 0-second
  frame), bad direction, non-alphanumeric asset, empty prediction;
- **staking accounting** — `fund_pool` rejects zero and grows the reward pool
  by exactly the deposited amount;
- **resolve guards** — unknown signal id and pre-deadline resolution are both
  rejected against verified external time;
- **views** — initial empty state, per-address score, status/asset filters.

The subjective LLM judging path (`resolve_signal` after a real deadline) is
non-deterministic — it asks the validator LLM to judge a natural-language
prediction against live Binance candles — so it is verified live on studionet
via `../scripts/stake_ops.mjs` rather than asserted for an exact verdict here.

## Running

```bash
# 1. Start a local GenLayer node (GenLayer Studio)
genlayer up

# 2. From the repo root, run the suite (uses ../gltest.config.yaml)
gltest

# Or target the hosted testnet where the contract is deployed:
gltest --network studionet
```

`gltest.config.yaml` points the runner at `./contract` (the default is
`./contracts`).
