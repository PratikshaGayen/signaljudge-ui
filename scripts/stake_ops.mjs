// Ops script for the staking (v0.4.0) contract lifecycle.
// Target net via GL_NET=localnet|studionet (default studionet).
// Subcommands:
//   deploy                     -> deploy contract/signal_judge.py, save address
//   fund <addr> <gen>          -> fund an address with N GEN (sim_fundAccount)
//   fundpool <gen>             -> pre-seed the reward pool with N GEN (fund_pool)
//   seed                       -> submit one near-certain-correct + one near-certain-wrong staked signal
//   status                     -> print signals, pool, and key balances
//   resolve <ids...>           -> resolve signal ids, report payouts
//
// State (contract address + generated keys) is kept per-net in
// scripts/.stakestate.<net>.json
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { localnet, studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
// Target net is selectable so the same script drives a local run or a Studio
// test-deploy: GL_NET=localnet|studionet (default studionet). Each chain carries
// its own default RPC endpoint, so we only override it for localnet.
const NET = process.env.GL_NET || "studionet";
const CHAIN = NET === "localnet" ? localnet : studionet;
const ENDPOINT = NET === "localnet" ? "http://localhost:4000/api" : undefined;
// State is namespaced per-net so a studionet deploy doesn't clobber the localnet
// address (and vice-versa).
const STATE_FILE = path.join(DIR, `.stakestate.${NET}.json`);
const CODE_FILE = path.join(DIR, "..", "contract", "signal_judge.py");
const GEN = 10n ** 18n;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

let state = loadState();
// Persistent keys so the same actors are reused across invocations.
if (!state.keys) {
  state.keys = { trader: generatePrivateKey(), resolver: generatePrivateKey() };
  saveState(state);
}
const trader = createAccount(state.keys.trader);
const resolver = createAccount(state.keys.resolver);

function mkClient(account) {
  const opts = { chain: CHAIN, account };
  if (ENDPOINT) opts.endpoint = ENDPOINT;
  const c = createClient(opts);
  const orig = c.request.bind(c);
  c.request = async (p) => {
    const r = await orig(p);
    if (p.method === "eth_gasPrice" && r == null) return "0x1";
    return r;
  };
  return c;
}
const cTrader = mkClient(trader);
const cResolver = mkClient(resolver);

async function balance(c, addr) {
  const b = await c.request({ method: "eth_getBalance", params: [addr, "latest"] });
  return b ? BigInt(b) : 0n;
}
async function fund(addr, gen) {
  await cTrader.request({ method: "sim_fundAccount", params: [addr, Number(BigInt(gen) * GEN)] });
}
function fmtGen(wei) {
  const n = BigInt(wei);
  const neg = n < 0n;
  const abs = neg ? -n : n; // format magnitude, re-attach sign — otherwise a
  const whole = abs / GEN;  // negative fraction prints as "-2.-500"
  const frac = (abs % GEN).toString().padStart(18, "0").slice(0, 4);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
async function readAll(c, addr) {
  return JSON.parse(await c.readContract({ address: addr, functionName: "get_all_signals", args: [] }));
}
async function waitFinal(c, hash) {
  return c.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 3000, retries: 200 });
}

const cmd = process.argv[2] || "status";

if (cmd === "deploy") {
  // Deployer pays gas; make sure it is funded.
  await fund(trader.address, 100n);
  const code = fs.readFileSync(CODE_FILE, "utf8");
  console.log("deploying as", trader.address, "...");
  const hash = await cTrader.deployContract({ code, args: [], leaderOnly: false });
  console.log("deploy tx:", hash);
  const receipt = await waitFinal(cTrader, hash);
  // Dig the deployed address out of the receipt (shape varies by SDK build).
  const addr =
    receipt?.data?.contract_address ||
    receipt?.contract_address ||
    receipt?.data?.contractAddress ||
    receipt?.to ||
    null;
  console.log("receipt.status:", receipt.status, "-> contract:", addr);
  if (!addr) {
    console.log("!! could not find address in receipt; dumping keys:", Object.keys(receipt), Object.keys(receipt.data || {}));
  } else {
    state.contract = addr;
    saveState(state);
    console.log("saved contract address:", addr);
  }
  process.exit(0);
}

if (cmd === "fund") {
  const addr = process.argv[3];
  const gen = process.argv[4] || "10";
  await fund(addr, BigInt(gen));
  console.log(`funded ${addr} with ${gen} GEN -> balance`, fmtGen(await balance(cTrader, addr)), "GEN");
  process.exit(0);
}

const CONTRACT = state.contract;
if (!CONTRACT) { console.error("no contract deployed yet; run: node scripts/stake_ops.mjs deploy"); process.exit(1); }

if (cmd === "fundpool") {
  // Pre-seed the reward pool so the first correct predictions can earn a reward
  // before any wrong-prediction forfeits have accumulated.
  const gen = process.argv[3] || "5";
  await fund(trader.address, BigInt(gen) + 1n); // stake amount + gas headroom
  console.log(`funding pool with ${gen} GEN as ${trader.address} ...`);
  const hash = await cTrader.writeContract({ address: CONTRACT, functionName: "fund_pool", args: [], value: BigInt(gen) * GEN });
  console.log("  tx:", hash);
  const r = await waitFinal(cTrader, hash);
  console.log("  status:", r.status);
  const pool = await cTrader.readContract({ address: CONTRACT, functionName: "get_reward_pool", args: [] });
  console.log("reward_pool now:", fmtGen(pool), "GEN");
  process.exit(0);
}

if (cmd === "seed") {
  await fund(trader.address, 10n);
  const submits = [
    { tag: "likely-CORRECT", args: ["ETH", "ETH will stay within 20% of its current price over the next 5 minutes", "Low volatility over such a short window makes a >20% move extremely unlikely.", "", "", "5min"] },
    { tag: "likely-WRONG", args: ["ETH", "ETH will more than double (rise over 100%) within the next 5 minutes", "Betting on an absurd instant moonshot.", "", "", "5min"] },
  ];
  for (const s of submits) {
    console.log(`\nsubmitting (${s.tag}) staking 1 GEN ...`);
    const hash = await cTrader.writeContract({ address: CONTRACT, functionName: "submit_signal", args: s.args, value: GEN });
    const r = await waitFinal(cTrader, hash);
    console.log("  status:", r.status);
  }
  console.log("\nseeded. trader balance:", fmtGen(await balance(cTrader, trader.address)), "GEN");
  for (const s of await readAll(cTrader, CONTRACT)) {
    console.log(`  #${s.id} ${s.asset} ${s.status} deadline=${new Date(s.deadline_ts*1000).toISOString()} stake=${fmtGen(s.stake||0)}`);
  }
  process.exit(0);
}

if (cmd === "status") {
  const nowTs = Math.floor(Date.now() / 1000);
  const pool = await cTrader.readContract({ address: CONTRACT, functionName: "get_reward_pool", args: [] });
  console.log("contract:", CONTRACT);
  console.log("now:", new Date().toISOString());
  console.log("reward_pool:", fmtGen(pool), "GEN");
  console.log("balances -> trader:", fmtGen(await balance(cTrader, trader.address)), " resolver:", fmtGen(await balance(cTrader, resolver.address)), " contract:", fmtGen(await balance(cTrader, CONTRACT)));
  console.log("addresses -> trader:", trader.address, " resolver:", resolver.address);
  for (const s of await readAll(cTrader, CONTRACT)) {
    const ready = s.status === "PENDING" && nowTs >= s.deadline_ts;
    console.log(`  #${s.id} ${s.asset} ${s.status} correct=${s.correct} stake=${fmtGen(s.stake||0)} payout=${s.payout?fmtGen(s.payout):"-"} "${s.prediction.slice(0,50)}"` + (ready?"  <-- READY":s.status==="PENDING"?`  (deadline in ${s.deadline_ts-nowTs}s)`:""));
  }
  process.exit(0);
}

if (cmd === "resolve") {
  const ids = process.argv.slice(3).map((x) => parseInt(x, 10));
  await fund(resolver.address, 10n); // resolver needs gas
  for (const id of ids) {
    console.log(`\n=== resolving #${id} (resolver ${resolver.address}) ===`);
    const before = { trader: await balance(cResolver, trader.address), resolver: await balance(cResolver, resolver.address), contract: await balance(cResolver, CONTRACT) };
    try {
      const hash = await cResolver.writeContract({ address: CONTRACT, functionName: "resolve_signal", args: [id], value: 0n });
      console.log("  tx:", hash);
      const r = await waitFinal(cResolver, hash);
      console.log("  status:", r.status);
    } catch (e) { console.error("  FAILED:", e.message || e); continue; }
    const after = { trader: await balance(cResolver, trader.address), resolver: await balance(cResolver, resolver.address), contract: await balance(cResolver, CONTRACT) };
    console.log("  Δ trader   :", fmtGen(after.trader - before.trader), "GEN");
    console.log("  Δ resolver :", fmtGen(after.resolver - before.resolver), "GEN (minus gas)");
    console.log("  Δ contract :", fmtGen(after.contract - before.contract), "GEN");
  }
  const pool = await cTrader.readContract({ address: CONTRACT, functionName: "get_reward_pool", args: [] });
  console.log("\nreward_pool now:", fmtGen(pool), "GEN");
  const score = await cTrader.readContract({ address: CONTRACT, functionName: "get_score", args: [trader.address] });
  console.log("trader score:", JSON.stringify(score, (k,v)=>typeof v==="bigint"?v.toString():v));
  process.exit(0);
}

console.error("unknown command:", cmd);
process.exit(1);
