# v0.4.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime, timezone
import json
import typing


# Real trading timeframes only. The old "test" entry (a 0-second deadline) was
# removed: it let anyone submit-and-instantly-resolve to farm the leaderboard.
TIMEFRAMES = {
    "5min": 300,
    "15min": 900,
    "30min": 1800,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
}

# Binance kline interval for each timeframe. resolve_signal fetches OHLC candles
# at this granularity so the LLM judges the prediction against real price action
# (open/high/low/close per candle) rather than a single spot price it would have
# to guess around.
INTERVALS = {
    "5min": "5m",
    "15min": "15m",
    "30min": "30m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
}

# Source of verified wall-clock time for the consensus write path. See
# _verified_now() for why a candle open-time is a strict_eq-safe timestamp.
TIME_SOURCE_URL = (
    "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1"
)

# ---------- staking economics (all amounts in wei; native GEN has 18 decimals) ----------
# Every prediction escrows a fixed stake, putting real value at risk behind a
# subjective LLM verdict. This is what makes SignalJudge *need* GenLayer rather
# than a plain price oracle: value is released by a judgment call no oracle could
# make. Payout model (chosen with the user):
#   * WRONG  -> the staked GEN is forfeited into a shared reward_pool.
#   * CORRECT-> the trader is refunded their stake AND paid a reward drawn from
#               that pool (funded by everyone who was wrong).
#   * whoever calls resolve_signal earns a small bounty, because resolving costs
#               a real LLM call + gas and otherwise nobody would do it.
# The contract only ever pays out value it already holds (see resolve_signal),
# so it can never become insolvent.
STAKE_WEI = 10**18  # 1 GEN, fixed stake per signal
RESOLVER_BOUNTY_WEI = 5 * 10**16  # 0.05 GEN; must be <= STAKE_WEI


class SignalJudge(gl.Contract):
    # Signals are stored one-per-slot in a TreeMap keyed by signal id instead of
    # a single JSON blob. Appending or resolving a signal now rewrites exactly
    # one map entry (O(1)) rather than serializing and rewriting the entire feed
    # on every call, so storage cost stays flat as the feed grows. Ids are dense
    # (0 .. len-1) because signals are only ever appended, never deleted.
    signals: TreeMap[u256, str]
    wins: TreeMap[Address, u256]
    total: TreeMap[Address, u256]
    # reward_pool holds the stakes forfeited by wrong predictions, waiting to be
    # paid out to correct ones. staked_total / earned_total track each trader's
    # gross GEN in and out so the leaderboard can show real profit/loss (earned -
    # staked), not just a win count.
    reward_pool: u256
    staked_total: TreeMap[Address, u256]
    earned_total: TreeMap[Address, u256]

    def __init__(self) -> None:
        """
        SignalJudge v3: a two-phase crypto prediction evaluator.

        Phase 1 (submit_signal): a trader posts a prediction with a deadline
        anchored to verified external time. Stored as PENDING. No LLM call.

        Phase 2 (resolve_signal): anyone can call after the deadline. The
        contract fetches recent OHLC candles over the timeframe and asks
        validator LLMs to *judge* the prediction against the real price action -
        not just check price-vs-target arithmetic, but assess whether the
        trader's actual claim (including natural-language ones that no price
        oracle could evaluate) held, and score the quality of their reasoning.
        This subjective judgment is why the contract needs GenLayer.

        Staking: submit_signal is payable and escrows a fixed STAKE_WEI. On
        resolution the LLM's verdict releases that value - refund + reward for a
        correct call, forfeit-to-pool for a wrong one (see the constants block).

        TreeMap collections auto-initialize empty; the scalar reward_pool is set
        to zero explicitly here.
        """
        self.reward_pool = u256(0)

    # ---------- storage helpers ----------

    def _bump(self, m: 'TreeMap[Address, u256]', addr: Address, delta: int) -> None:
        """Add ``delta`` wei to a per-address u256 accumulator (staked/earned)."""
        m[addr] = u256(int(m.get(addr, u256(0))) + delta)

    # ---------- helpers ----------

    def _all_signals(self) -> list:
        """Materialize every stored signal as a list, ordered by id.

        Ids are contiguous (0 .. len-1) because signals are only appended, so a
        plain index walk reconstructs the full feed. Only the view methods use
        this - the write path reads/writes a single slot by id.
        """
        return [json.loads(self.signals[u256(i)]) for i in range(len(self.signals))]

    def _local_now(self) -> int:
        # Wall-clock of whichever single node answers a *view* query. A view is
        # not a consensus operation (one node serves it, the result is never
        # written to state), so a local clock is fine and avoids a slow web
        # round-trip. Every consensus-critical deadline decision uses
        # _verified_now() instead - see submit_signal / resolve_signal.
        return int(datetime.now(timezone.utc).timestamp())

    def _verified_now(self) -> int:
        # Verified external time for the write path.
        #
        # GenVM exposes no block timestamp, and a validator's local clock is
        # non-deterministic - trusting datetime.now() here would let a single
        # node fake "now" to resolve a signal before its real deadline. Instead
        # we read the open timestamp of Binance's current 1-minute candle.
        # Binance aligns candle open times to fixed minute boundaries, so every
        # validator that fetches within the same minute derives the *same*
        # integer and strict_eq reaches exact consensus without trusting any
        # node's wall clock. Because it is the candle's OPEN time it can only lag
        # real time (never lead it), so a deadline is never treated as reached
        # early - the check stays conservative.
        def fetch_minute() -> str:
            raw = gl.nondet.web.render(TIME_SOURCE_URL, mode="text")
            candles = json.loads(raw)
            open_ms = int(candles[-1][0])  # kline shape: [openTime, o, h, l, c, ...]
            return str(open_ms // 1000)

        return int(gl.eq_principle.strict_eq(fetch_minute))

    # ---------- phase 1: submit ----------

    @gl.public.write.payable
    def submit_signal(
        self,
        asset: str,
        prediction: str,
        reasoning: str,
        target_price: str,
        direction: str,
        timeframe: str,
    ) -> dict[str, typing.Any]:
        """
        Submit a prediction to be judged at submission_time + duration_seconds.

        PAYABLE: the caller must send exactly STAKE_WEI (1 GEN) along with this
        call. The stake is escrowed in the contract and released on resolution.

        Args:
            asset:        Ticker - must be an alphanumeric string (e.g., BTC, ETH).
            prediction:   Human-readable prediction text. May be a fully
                          natural-language claim (e.g., "BTC breaks resistance
                          and holds above it into the close").
            reasoning:    Trader's rationale.
            target_price: OPTIONAL price target in USD as a string. Leave empty
                          for a purely natural-language prediction.
            direction:    OPTIONAL - ABOVE, BELOW, or AT relative to target_price.
                          Leave empty when there is no numeric target.
            timeframe:    Must be one of: 5min, 15min, 30min, 1h, 4h, 1d.

        The deadline is anchored to verified external time (not the node clock).
        There is no LLM call - this stays cheap; the only network cost is the
        strict_eq time fetch.
        """
        # Enforce the stake first so a mis-funded call fails cheaply, before the
        # strict_eq time fetch. Exact amount only - refunding change would add a
        # payout path with nothing to gain for a fixed-stake game.
        if int(gl.message.value) != STAKE_WEI:
            raise gl.vm.UserError(
                f"must stake exactly {STAKE_WEI} wei (1 GEN) to submit; "
                f"received {int(gl.message.value)}"
            )

        asset_upper = asset.strip().upper()
        if not asset_upper.isalnum():
            raise gl.vm.UserError("asset must be an alphanumeric ticker (e.g., BTC, ETH)")
        if not prediction.strip():
            raise gl.vm.UserError("prediction is required")
        if timeframe not in TIMEFRAMES:
            raise gl.vm.UserError(
                "timeframe must be one of: 5min, 15min, 30min, 1h, 4h, 1d"
            )

        # target_price / direction are now optional. If a direction is given it
        # must be valid; an empty direction means "no numeric target, judge the
        # natural-language prediction on its own terms".
        direction_upper = direction.strip().upper()
        if direction_upper and direction_upper not in ("ABOVE", "BELOW", "AT"):
            raise gl.vm.UserError("direction, if provided, must be ABOVE, BELOW, or AT")

        now = self._verified_now()
        deadline_ts = now + TIMEFRAMES[timeframe]
        signal_id = len(self.signals)
        submitter = gl.message.sender_address

        # Wei amounts are stored as strings: they exceed JS's safe-integer range,
        # so keeping them as JSON numbers would corrupt them in the browser.
        self.signals[u256(signal_id)] = json.dumps(
            {
                "id": signal_id,
                "submitter": submitter.as_hex,
                "asset": asset_upper,
                "prediction": prediction.strip()[:500],
                "reasoning": reasoning.strip()[:500],
                "target_price": target_price.strip(),
                "direction": direction_upper,
                "timeframe": timeframe,
                "deadline_ts": deadline_ts,
                "status": "PENDING",
                "current_price": "",
                "correct": False,
                "reasoning_quality": 0,
                "rationale": "",
                "stake": str(STAKE_WEI),
                "payout": "",
                "resolver_bounty": "",
                "resolver": "",
            }
        )
        self._bump(self.staked_total, submitter, STAKE_WEI)

        return {
            "signal_id": signal_id,
            "timeframe": timeframe,
            "deadline_ts": deadline_ts,
            "stake_wei": str(STAKE_WEI),
        }

    @gl.public.write.payable
    def fund_pool(self) -> dict[str, typing.Any]:
        """
        Seed the reward pool directly, without submitting a prediction.

        submit_signal is the only other payable entrypoint and it always escrows
        a stake against a new signal, so there was otherwise no way to pre-fund
        the pool. This lets an operator deposit GEN up front to cover rewards for
        the first correct predictions: the pool starts empty and is only fed by
        wrong-prediction forfeits, so without a seed the very first winner gets
        just their stake back (no reward). Any positive amount is accepted, added
        to reward_pool, and can only ever leave via resolve_signal payouts.
        """
        amount = int(gl.message.value)
        if amount <= 0:
            raise gl.vm.UserError("must send a positive amount to fund the pool")
        self.reward_pool = u256(int(self.reward_pool) + amount)
        return {
            "funded_wei": str(amount),
            "reward_pool_wei": str(int(self.reward_pool)),
        }

    # ---------- phase 2: resolve ----------

    @gl.public.write
    def resolve_signal(self, signal_id: int) -> typing.Any:
        """
        Resolve a PENDING signal whose deadline has passed.

        Fetches recent OHLC candles over the timeframe, asks validator LLMs to
        judge the prediction against the real price action, updates leaderboard
        counts, marks the signal RESOLVED. Anyone can call this - there's no
        permission gate. The deadline is enforced against verified external time.
        """
        if signal_id < 0 or signal_id >= len(self.signals):
            raise gl.vm.UserError(f"signal_id {signal_id} does not exist")

        sig = json.loads(self.signals[u256(signal_id)])
        if sig["status"] != "PENDING":
            raise gl.vm.UserError(f"signal {signal_id} is already {sig['status']}")
        now = self._verified_now()
        if now < sig["deadline_ts"]:
            raise gl.vm.UserError(
                f"deadline not reached yet (now={now}, deadline={sig['deadline_ts']})"
            )

        interval = INTERVALS[sig["timeframe"]]
        klines_url = (
            "https://api.binance.com/api/v3/klines?symbol="
            + sig["asset"]
            + "USDT&interval="
            + interval
            + "&limit=16"
        )

        # Rebind for the closure (nondet block can't capture self).
        _asset = sig["asset"]
        _prediction = sig["prediction"]
        _reasoning = sig["reasoning"]
        _target = sig["target_price"]
        _direction = sig["direction"]
        _timeframe = sig["timeframe"]

        if _target and _direction:
            hint = (
                f"The trader also gave a structured hint: target ${_target} USD, "
                f"direction {_direction} (ABOVE = price above target, BELOW = below, "
                f"AT = approximately equal). Treat it as supporting context, but judge "
                f"the prediction text as written."
            )
        else:
            hint = (
                "The trader gave no numeric target - judge the natural-language "
                "prediction entirely on its own terms."
            )

        def get_judgment() -> str:
            # Fetch real OHLC candles over the prediction's timeframe instead of a
            # single spot price. Giving the LLM the actual price action - open,
            # high, low, close per candle - lets it judge claims like "closed
            # green", "held above prior resistance", or "broke out and retested"
            # against what really happened, rather than confabulating a verdict
            # from one lone number.
            raw_klines = gl.nondet.web.render(klines_url, mode="text")
            candles = json.loads(raw_klines)

            # Binance kline shape: [openTime, open, high, low, close, volume, ...].
            parsed = [
                {"o": float(c[1]), "h": float(c[2]), "l": float(c[3]), "c": float(c[4])}
                for c in candles
            ]

            # The most recent candle approximates the prediction window; the
            # earlier candles are prior context - their highs/lows stand in for
            # the "prior resistance / support" a trader would have referenced.
            recent = parsed[-1]
            prior = parsed[:-1] if len(parsed) > 1 else parsed
            prior_high = max(p["h"] for p in prior)
            prior_low = min(p["l"] for p in prior)
            current_price = str(candles[-1][4])
            recent_green = recent["c"] >= recent["o"]
            recent_label = (
                "GREEN (close >= open)" if recent_green else "RED (close < open)"
            )

            table = "\n".join(
                f"  candle {i}: open={p['o']:.2f} high={p['h']:.2f} "
                f"low={p['l']:.2f} close={p['c']:.2f}"
                for i, p in enumerate(parsed)
            )

            task = f"""
You are an expert crypto analyst acting as an impartial judge of a trader's
prediction. Judge the prediction AS WRITTEN - not just whether a number was
crossed, but whether the trader's actual claim (including any stated magnitude,
timing, direction, or market conditions) came true over the timeframe.

Asset: {_asset}
Prediction to judge: "{_prediction}"
Trader's reasoning: "{_reasoning}"
Timeframe: {_timeframe}
{hint}

Real market data from Binance - the last {len(parsed)} {interval} candles
(oldest first, prices in USD):
{table}

Derived facts (already computed for you - use them directly, don't recompute):
- Current price (close of the most recent candle): {current_price}
- Most recent candle: open={recent['o']:.2f}, close={recent['c']:.2f} -> {recent_label}
- Prior resistance proxy (highest high of the earlier candles): {prior_high:.2f}
- Prior support proxy (lowest low of the earlier candles): {prior_low:.2f}

Step 1: Decide whether the prediction held, judging its actual wording against
the real candles above. For "closed green" use the most recent candle. For
"held above resistance" compare the recent closes against the prior resistance
proxy. Natural-language predictions require judgment, not arithmetic.

Step 2: Rate the QUALITY of the trader's reasoning from 1-10 - was it sound,
specific, and did it actually hold up against what the market did? Give a
one-sentence rationale grounded in the candle data above.

Respond with ONLY this JSON, no markdown:
{{
    "correct": bool,
    "current_price": "{current_price}",
    "reasoning_quality": int,
    "rationale": str
}}

Output must be parseable JSON, nothing else.
"""
            return gl.nondet.exec_prompt(task).replace("```json", "").replace("```", "")

        # Only the binding 'correct' boolean must agree across validators. The
        # current price drifts by cents (different fetch instants), and the
        # reasoning score and rationale are inherently subjective, so we tell the
        # equivalence check to ignore them. This keeps consensus robust while the
        # LLM still does genuinely subjective work.
        raw = gl.eq_principle.prompt_comparative(
            get_judgment,
            "The boolean field 'correct' must have the same value across all answers. "
            "Ignore differences in 'current_price' (varies by cents because validators "
            "fetch at slightly different timestamps), 'reasoning_quality' (subjective "
            "1-10 rating), and 'rationale' (free-text wording).",
        )

        try:
            judgment = json.loads(raw)
        except json.JSONDecodeError as e:
            raise gl.vm.UserError(f"LLM did not return valid JSON: {e}")

        correct = bool(judgment.get("correct", False))
        current_price = str(judgment.get("current_price", ""))
        rq = int(judgment.get("reasoning_quality", 0))
        rationale = str(judgment.get("rationale", ""))[:500]

        # ----- settle the stake based on the verdict -----
        # Every branch below only ever moves value the contract already holds
        # (this signal's stake + the accumulated pool), so the contract stays
        # solvent. Wei amounts round-trip as strings; see submit_signal.
        stake = int(sig["stake"]) if sig.get("stake") else STAKE_WEI
        submitter = Address(sig["submitter"])
        resolver = gl.message.sender_address
        pool = int(self.reward_pool)

        if correct:
            # Refund the stake, then top up with a reward from the pool, capped
            # at 1x stake and at whatever the pool can afford. The resolver's
            # bounty also comes from the pool here (there's no forfeit to fund
            # it), and only if the pool can cover it.
            bounty = min(RESOLVER_BOUNTY_WEI, pool)
            pool -= bounty
            reward = min(pool, stake)
            pool -= reward
            submitter_payout = stake + reward
            self.reward_pool = u256(pool)

            gl.get_contract_at(submitter).emit_transfer(value=u256(submitter_payout))
            self._bump(self.earned_total, submitter, submitter_payout)
            if bounty > 0:
                gl.get_contract_at(resolver).emit_transfer(value=u256(bounty))
                self._bump(self.earned_total, resolver, bounty)
        else:
            # Stake is forfeited: pay the resolver's bounty out of it, the rest
            # funds the pool for future correct predictions.
            bounty = min(RESOLVER_BOUNTY_WEI, stake)
            reward = 0
            submitter_payout = 0
            self.reward_pool = u256(pool + (stake - bounty))
            if bounty > 0:
                gl.get_contract_at(resolver).emit_transfer(value=u256(bounty))
                self._bump(self.earned_total, resolver, bounty)

        # Update leaderboard (win/total counts)
        prev_wins = self.wins.get(submitter, u256(0))
        prev_total = self.total.get(submitter, u256(0))
        if correct:
            self.wins[submitter] = u256(int(prev_wins) + 1)
        self.total[submitter] = u256(int(prev_total) + 1)

        # Update signal (single-slot rewrite)
        sig["status"] = "RESOLVED"
        sig["current_price"] = current_price
        sig["correct"] = correct
        sig["reasoning_quality"] = rq
        sig["rationale"] = rationale
        sig["payout"] = str(submitter_payout)
        sig["resolver_bounty"] = str(bounty)
        sig["resolver"] = resolver.as_hex
        self.signals[u256(signal_id)] = json.dumps(sig)

        return {
            "signal_id": signal_id,
            "correct": correct,
            "current_price": current_price,
            "reasoning_quality": rq,
            "rationale": rationale,
            "payout_wei": str(submitter_payout),
            "reward_wei": str(reward),
            "resolver_bounty_wei": str(bounty),
            "reward_pool_wei": str(int(self.reward_pool)),
        }

    # ---------- views ----------

    @gl.public.view
    def get_signal_count(self) -> int:
        """Total signals submitted (any status)."""
        return len(self.signals)

    @gl.public.view
    def get_all_signals(self) -> str:
        """All signals as a JSON array string."""
        return json.dumps(self._all_signals())

    @gl.public.view
    def get_signals_by_status(self, status: str) -> str:
        """Filter signals by status: PENDING or RESOLVED."""
        s = status.strip().upper()
        return json.dumps([x for x in self._all_signals() if x["status"] == s])

    @gl.public.view
    def get_signals_by_asset(self, asset: str) -> str:
        """Filter signals by asset ticker."""
        a = asset.strip().upper()
        return json.dumps([x for x in self._all_signals() if x["asset"] == a])

    @gl.public.view
    def get_resolvable_signals(self) -> str:
        """PENDING signals whose deadline has passed (ready to resolve).

        Informational helper for the UI - uses the serving node's local clock
        (see _local_now). The authoritative, consensus-enforced deadline check
        lives in resolve_signal via _verified_now().
        """
        now = self._local_now()
        ready = [
            x for x in self._all_signals()
            if x["status"] == "PENDING" and now >= x["deadline_ts"]
        ]
        return json.dumps(ready)

    @gl.public.view
    def get_reward_pool(self) -> str:
        """Current reward pool (forfeited stakes awaiting payout), in wei.

        Returned as a string because the amount exceeds JS's safe-integer range.
        """
        return str(int(self.reward_pool))

    @gl.public.view
    def get_score(self, address: str) -> dict[str, typing.Any]:
        """Per-trader stats: win/total/win-rate plus real profit/loss.

        staked_wei / earned_wei are gross GEN in and out; net_wei = earned -
        staked and can be negative (returned as a signed string). All wei amounts
        are strings to survive JS number precision.
        """
        try:
            addr = Address(address)
        except Exception as e:
            raise gl.vm.UserError(f"invalid address: {e}")
        w = int(self.wins.get(addr, u256(0)))
        t = int(self.total.get(addr, u256(0)))
        staked = int(self.staked_total.get(addr, u256(0)))
        earned = int(self.earned_total.get(addr, u256(0)))
        rate = "0" if t == 0 else str((w * 100) // t)
        return {
            "wins": w,
            "total": t,
            "win_rate_pct": rate,
            "staked_wei": str(staked),
            "earned_wei": str(earned),
            "net_wei": str(earned - staked),
        }
