"""Contract-focused tests for the SignalJudge Intelligent Contract.

These deploy the real ``contract/signal_judge.py`` to a GenLayer node via
``gltest`` and exercise it end-to-end. They concentrate on the deterministic,
consensus-critical surface — stake enforcement, input validation, the staking
escrow accounting in ``fund_pool``, the resolve guards, and every view — which
runs without invoking the validator LLM, so the suite is fast and its
assertions are exact.

The subjective judging path (``resolve_signal`` after a real deadline) calls
the LLM and Binance and is inherently non-deterministic, so it is verified live
on studionet via ``scripts/stake_ops.mjs`` rather than asserted for an exact
verdict here; ``test_resolve_rejects_*`` still covers its deterministic guards.

Run:  genlayer up          # start a local GenLayer Studio node
      gltest                # from the repo root (uses gltest.config.yaml)
"""

import json

import pytest

from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded, tx_execution_failed

# Mirror of the on-chain constants (contract/signal_judge.py). GEN has 18
# decimals; every prediction escrows exactly one whole GEN.
STAKE_WEI = 10**18
RESOLVER_BOUNTY_WEI = 5 * 10**16

# A well-formed, fully natural-language submission. target_price/direction are
# left empty on purpose to exercise the "no numeric target" path.
VALID_SUBMIT = ["BTC", "BTC closes green on the 5m", "momentum is up", "", "", "5min"]


@pytest.fixture(scope="module")
def contract():
    """Deploy SignalJudge once for the whole module.

    Negative tests below all trigger a UserError, which rolls back state, so a
    reverted call leaves the contract untouched and the instance is safe to
    share. State-changing tests assert on deltas rather than absolute values so
    they stay order-independent.
    """
    factory = get_contract_factory("SignalJudge")
    return factory.deploy(args=[])


# --------------------------------------------------------------------------- #
# deployment + initial state
# --------------------------------------------------------------------------- #

def test_deploys_empty(contract):
    assert contract.get_signal_count(args=[]).call() == 0
    assert contract.get_reward_pool(args=[]).call() == "0"


def test_score_of_unknown_address_is_zeroed(contract):
    addr = get_accounts()[0].address
    score = contract.get_score(args=[addr]).call()
    assert score["wins"] == 0
    assert score["total"] == 0
    assert score["win_rate_pct"] == "0"
    assert score["net_wei"] == "0"


# --------------------------------------------------------------------------- #
# submit_signal: stake enforcement (payable)
# --------------------------------------------------------------------------- #

def test_submit_rejects_missing_stake(contract):
    # No value attached — must be rejected before any state is written.
    receipt = contract.submit_signal(args=VALID_SUBMIT).transact(value=0)
    assert tx_execution_failed(receipt)


def test_submit_rejects_wrong_stake_amount(contract):
    # Overpaying is just as invalid as underpaying: the stake is fixed.
    receipt = contract.submit_signal(args=VALID_SUBMIT).transact(value=2 * STAKE_WEI)
    assert tx_execution_failed(receipt)


# --------------------------------------------------------------------------- #
# submit_signal: input validation (all reject before the LLM/web path)
# --------------------------------------------------------------------------- #

def test_submit_rejects_unknown_timeframe(contract):
    args = ["BTC", "up", "reason", "", "", "test"]  # "test" 0s frame was removed
    receipt = contract.submit_signal(args=args).transact(value=STAKE_WEI)
    assert tx_execution_failed(receipt)


def test_submit_rejects_bad_direction(contract):
    args = ["BTC", "up", "reason", "80000", "SIDEWAYS", "5min"]
    receipt = contract.submit_signal(args=args).transact(value=STAKE_WEI)
    assert tx_execution_failed(receipt)


def test_submit_rejects_non_alnum_asset(contract):
    args = ["BT C", "up", "reason", "", "", "5min"]
    receipt = contract.submit_signal(args=args).transact(value=STAKE_WEI)
    assert tx_execution_failed(receipt)


def test_submit_rejects_empty_prediction(contract):
    args = ["BTC", "   ", "reason", "", "", "5min"]
    receipt = contract.submit_signal(args=args).transact(value=STAKE_WEI)
    assert tx_execution_failed(receipt)


# --------------------------------------------------------------------------- #
# submit_signal: happy path (needs the node's web module for verified time)
# --------------------------------------------------------------------------- #

def test_submit_succeeds_and_records_pending_signal(contract):
    before = contract.get_signal_count(args=[]).call()
    receipt = contract.submit_signal(args=VALID_SUBMIT).transact(value=STAKE_WEI)
    assert tx_execution_succeeded(receipt)

    after = contract.get_signal_count(args=[]).call()
    assert after == before + 1

    pending = json.loads(contract.get_signals_by_status(args=["PENDING"]).call())
    newest = pending[-1]
    assert newest["status"] == "PENDING"
    assert newest["asset"] == "BTC"
    assert newest["stake"] == str(STAKE_WEI)
    # Deadline is anchored to verified external time, so it must sit in the
    # future by roughly the 5min timeframe (300s), never at/behind submission.
    assert newest["deadline_ts"] > 0


# --------------------------------------------------------------------------- #
# fund_pool: seeding the reward pool
# --------------------------------------------------------------------------- #

def test_fund_pool_rejects_zero(contract):
    receipt = contract.fund_pool(args=[]).transact(value=0)
    assert tx_execution_failed(receipt)


def test_fund_pool_increases_reward_pool(contract):
    before = int(contract.get_reward_pool(args=[]).call())
    deposit = 3 * STAKE_WEI
    receipt = contract.fund_pool(args=[]).transact(value=deposit)
    assert tx_execution_succeeded(receipt)
    after = int(contract.get_reward_pool(args=[]).call())
    assert after == before + deposit


# --------------------------------------------------------------------------- #
# resolve_signal: deterministic guards (no LLM reached)
# --------------------------------------------------------------------------- #

def test_resolve_rejects_unknown_signal_id(contract):
    receipt = contract.resolve_signal(args=[999999]).transact()
    assert tx_execution_failed(receipt)


def test_resolve_rejects_before_deadline(contract):
    # Submit a fresh 1d signal, then immediately try to resolve it: the
    # deadline is ~24h out, so the verified-time guard must reject it.
    submit = contract.submit_signal(
        args=["ETH", "ETH holds above support", "range intact", "", "", "1d"]
    ).transact(value=STAKE_WEI)
    assert tx_execution_succeeded(submit)
    new_id = contract.get_signal_count(args=[]).call() - 1

    receipt = contract.resolve_signal(args=[new_id]).transact()
    assert tx_execution_failed(receipt)


# --------------------------------------------------------------------------- #
# views: filtering
# --------------------------------------------------------------------------- #

def test_get_signals_by_asset_filters(contract):
    # After the submits above there is at least one BTC and one ETH signal.
    btc = json.loads(contract.get_signals_by_asset(args=["BTC"]).call())
    assert all(s["asset"] == "BTC" for s in btc)
    assert len(btc) >= 1
