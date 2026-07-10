// One-off ops script: inspect signals and resolve pending ones by id.
// Usage:
//   node scripts/resolve.mjs status          -> print all signals
//   node scripts/resolve.mjs resolve 1 2     -> resolve signal ids 1 and 2
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import fs from "node:fs";

const CONTRACT = "0xd4868a23818eFa0F8d707a0139139e0300dC9312";
const ENDPOINT = "http://localhost:4000/api";

// Reuse the browser's stored key if present so we act as the same account,
// otherwise mint an ephemeral one (resolve has no permission gate anyway).
const keyFile = new URL("./.opkey", import.meta.url);
let pk;
try {
  pk = fs.readFileSync(keyFile, "utf8").trim();
} catch {
  pk = generatePrivateKey();
  fs.writeFileSync(keyFile, pk);
}
const account = createAccount(pk);

const client = createClient({ chain: localnet, endpoint: ENDPOINT, account });
const orig = client.request.bind(client);
client.request = async (p) => {
  const r = await orig(p);
  if (p.method === "eth_gasPrice" && r == null) return "0x1";
  return r;
};

async function readAll() {
  const raw = await client.readContract({
    address: CONTRACT,
    functionName: "get_all_signals",
    args: [],
  });
  return JSON.parse(raw);
}

function fmt(s) {
  const dl = new Date(s.deadline_ts * 1000).toISOString();
  return `#${s.id} ${s.asset} ${s.timeframe} ${s.status} deadline=${dl} correct=${s.correct} "${s.prediction.slice(0, 60)}"`;
}

const cmd = process.argv[2] || "status";

if (cmd === "status") {
  const sigs = await readAll();
  const nowTs = Math.floor(Date.now() / 1000);
  console.log(`now=${new Date().toISOString()} (${nowTs})`);
  for (const s of sigs) {
    const ready = s.status === "PENDING" && nowTs >= s.deadline_ts;
    console.log(fmt(s), ready ? "  <-- READY" : "");
  }
} else if (cmd === "resolve") {
  const ids = process.argv.slice(3).map((x) => parseInt(x, 10));
  for (const id of ids) {
    console.log(`\n=== resolving #${id} ===`);
    try {
      const hash = await client.writeContract({
        address: CONTRACT,
        functionName: "resolve_signal",
        args: [id],
        value: 0n,
      });
      console.log("tx:", hash);
      const receipt = await client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.FINALIZED,
        interval: 3000,
        retries: 200,
      });
      console.log("status:", receipt.status);
    } catch (e) {
      console.error(`resolve #${id} failed:`, e.message || e);
    }
  }
  console.log("\n=== final state ===");
  for (const s of await readAll()) console.log(fmt(s));
}

process.exit(0);
