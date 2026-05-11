import { useEffect, useState, useCallback } from "react";

const ASSET_OPTIONS = ["All", "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "DOT", "MATIC"];

function truncateAddr(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatCountdown(deadlineTs) {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadlineTs - now;
  if (diff <= 0) return "Ready to resolve";
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;
  if (hours > 0) return `Resolves in ${hours}h ${minutes}m ${seconds}s`;
  return `Resolves in ${minutes}m ${seconds}s`;
}

function SignalCard({ signal, onResolve, resolvingId }) {
  const isPending = signal.status === "PENDING";
  const isResolving = resolvingId === signal.id;
  const now = Math.floor(Date.now() / 1000);
  const canResolve = isPending && now >= signal.deadline_ts;

  const [countdown, setCountdown] = useState(formatCountdown(signal.deadline_ts));

  useEffect(() => {
    if (!isPending) return;
    const interval = setInterval(() => {
      setCountdown(formatCountdown(signal.deadline_ts));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPending, signal.deadline_ts]);

  return (
    <div className="rounded-lg bg-slate-800 border border-slate-700 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-200">
            {signal.asset}
          </span>
          <span className="inline-flex items-center rounded-full bg-slate-600 px-2.5 py-0.5 text-xs font-medium text-slate-300">
            {signal.timeframe}
          </span>
          {isPending ? (
            <span className="inline-flex items-center rounded-full bg-amber-900/40 px-2.5 py-0.5 text-xs font-medium text-amber-300">
              PENDING
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-emerald-900/40 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
              RESOLVED
            </span>
          )}
        </div>
        {!isPending && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              signal.correct
                ? "bg-emerald-900/40 text-emerald-300"
                : "bg-red-900/40 text-red-300"
            }`}
          >
            {signal.correct ? "✓ Correct" : "✗ Incorrect"}
          </span>
        )}
      </div>

      <p className="text-sm text-slate-200">{signal.prediction}</p>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
        <div>
          Direction: <span className="text-slate-200 font-mono">{signal.direction}</span>
        </div>
        <div>
          Target: <span className="text-slate-200 font-mono">{signal.target_price}</span>
        </div>
        {!isPending && (
          <>
            <div>
              Current: <span className="text-slate-200 font-mono">{signal.current_price || "—"}</span>
            </div>
            <div>
              Quality:{" "}
              <span className="text-slate-200 font-mono">{signal.reasoning_quality}/10</span>
            </div>
          </>
        )}
      </div>

      <div className="text-xs text-slate-500">Submitter: {truncateAddr(signal.submitter)}</div>

      {isPending && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-amber-400 font-mono">{countdown}</span>
          <button
            onClick={() => onResolve(signal.id)}
            disabled={!canResolve || isResolving}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
              canResolve && !isResolving
                ? "bg-emerald-600 hover:bg-emerald-500"
                : "bg-slate-700 cursor-not-allowed text-slate-400"
            }`}
          >
            {isResolving ? (
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Resolving...
              </span>
            ) : canResolve ? (
              "Resolve"
            ) : (
              "Waiting..."
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SignalFeed({ readContract, writeContract }) {
  const [signals, setSignals] = useState([]);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState(null);

  const fetchSignals = useCallback(async () => {
    try {
      setError("");
      const raw = await readContract("get_all_signals");
      const parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
      setSignals(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      setError(err.message || "Failed to load signals");
    } finally {
      setLoading(false);
    }
  }, [readContract]);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 15000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  const handleResolve = async (signalId) => {
    setResolvingId(signalId);
    try {
      await writeContract("resolve_signal", [signalId]);
      await fetchSignals();
    } catch (err) {
      setError(err.message || "Failed to resolve signal");
    } finally {
      setResolvingId(null);
    }
  };

  const filtered =
    filter === "All" ? signals : signals.filter((s) => s.asset === filter);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">All Signals</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Filter</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {ASSET_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && signals.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          Loading signals...
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((signal, idx) => (
          <SignalCard
            key={idx}
            signal={signal}
            onResolve={handleResolve}
            resolvingId={resolvingId}
          />
        ))}
        {filtered.length === 0 && !loading && (
          <p className="text-center text-slate-500 py-8">No signals found.</p>
        )}
      </div>

      <p className="text-center text-xs text-slate-600 mt-6">Auto-refreshes every 15 seconds</p>
    </div>
  );
}
