import { useEffect, useState, useCallback } from "react";

const ASSET_OPTIONS = ["All", "BTC", "ETH", "SOL"];

function truncateAddr(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function SignalCard({ signal }) {
  return (
    <div className="rounded-lg bg-slate-800 border border-slate-700 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-200">
          {signal.asset}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            signal.correct
              ? "bg-emerald-900/40 text-emerald-300"
              : "bg-red-900/40 text-red-300"
          }`}
        >
          {signal.correct ? "Correct" : "Incorrect"}
        </span>
      </div>
      <p className="text-sm text-slate-200">{signal.prediction}</p>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
        <div>
          Direction: <span className="text-slate-200 font-mono">{signal.direction}</span>
        </div>
        <div>
          Target: <span className="text-slate-200 font-mono">{signal.target_price}</span>
        </div>
        <div>
          Current: <span className="text-slate-200 font-mono">{signal.current_price}</span>
        </div>
        <div>
          Quality: <span className="text-slate-200 font-mono">{signal.reasoning_quality}/10</span>
        </div>
      </div>
      <div className="text-xs text-slate-500">Submitter: {truncateAddr(signal.submitter)}</div>
    </div>
  );
}

export default function SignalFeed({ readContract }) {
  const [signals, setSignals] = useState([]);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    const interval = setInterval(fetchSignals, 30000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

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
          <SignalCard key={idx} signal={signal} />
        ))}
        {filtered.length === 0 && !loading && (
          <p className="text-center text-slate-500 py-8">No signals found.</p>
        )}
      </div>

      <p className="text-center text-xs text-slate-600 mt-6">Auto-refreshes every 30 seconds</p>
    </div>
  );
}
