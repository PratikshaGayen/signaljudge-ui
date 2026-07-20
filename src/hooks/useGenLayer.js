import { useEffect, useState, useCallback } from "react";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { localnet, studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
// The live demo targets studionet (hosted testnet). Set VITE_GENLAYER_NET=localnet
// for local development against a local node; each chain carries its own default RPC.
const CHAIN = import.meta.env.VITE_GENLAYER_NET === "localnet" ? localnet : studionet;
const DEFAULT_ENDPOINT =
  CHAIN === localnet ? "http://localhost:4000/api" : "https://studio.genlayer.com/api";
const ENDPOINT = import.meta.env.VITE_GENLAYER_RPC_URL || DEFAULT_ENDPOINT;

// submit_signal is payable and escrows exactly this stake (1 GEN; native GEN has
// 18 decimals). Kept in sync with STAKE_WEI in contract/signal_judge.py — the
// contract rejects any submission whose value != this amount.
export const STAKE_WEI = 10n ** 18n;
// Gas headroom kept on top of any call value, so a write (submit or resolve) can
// pay for consensus/gas as well as the stake it forwards.
const GAS_HEADROOM_WEI = 10n ** 18n; // 1 GEN
// When the wallet can't cover a write, top it up to this target via the studionet
// faucet RPC (sim_fundAccount) so several calls run before it needs re-funding.
const FUND_TARGET_WEI = 10n * 10n ** 18n; // 10 GEN

function getStoredAccount() {
  const saved = localStorage.getItem("sg_private_key");
  if (saved && saved.startsWith("0x")) {
    try {
      return createAccount(saved);
    } catch {
      localStorage.removeItem("sg_private_key");
    }
  }
  const pk = generatePrivateKey();
  localStorage.setItem("sg_private_key", pk);
  return createAccount(pk);
}

export function useGenLayer() {
  const [client, setClient] = useState(null);
  const [account, setAccount] = useState(null);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState(null); // bigint wei, null until first read
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const acc = getStoredAccount();
      const c = createClient({
        chain: CHAIN,
        endpoint: ENDPOINT,
        account: acc,
      });

      // Defensive patch: local-node SDK path does BigInt(gasPrice) without a null
      // check when eth_gasPrice returns undefined. Intercept and supply a minimal
      // fallback so local-account transactions don't crash.
      const originalRequest = c.request.bind(c);
      c.request = async (payload) => {
        const result = await originalRequest(payload);
        if (payload.method === "eth_gasPrice" && result == null) {
          return "0x1";
        }
        return result;
      };

      setClient(c);
      setAccount(acc);
      setAddress(acc.address);

      // Read the starting balance so the UI can show it. A fresh studionet wallet
      // starts empty — the first write funds it via ensureFunded().
      c.request({ method: "eth_getBalance", params: [acc.address, "latest"] })
        .then((b) => setBalance(b ? BigInt(b) : 0n))
        .catch(() => setBalance(0n));
    } catch (e) {
      setError(e.message || "Failed to initialize GenLayer client");
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!client || !account) return 0n;
    const b = await client.request({
      method: "eth_getBalance",
      params: [account.address, "latest"],
    });
    const bal = b ? BigInt(b) : 0n;
    setBalance(bal);
    return bal;
  }, [client, account]);

  // Make sure the wallet can cover `needWei` (call value + gas). On studionet the
  // wallet is auto-generated and starts empty, so we mint test GEN into it with
  // the faucet RPC (sim_fundAccount) — the same call the ops scripts use. This is
  // the "account flow" that funds the main submission path; it is a no-op once the
  // balance is already sufficient.
  const ensureFunded = useCallback(
    async (needWei) => {
      if (!client || !account) throw new Error("Client not ready");
      let bal = await refreshBalance();
      if (bal >= needWei) return bal;

      // Fund a flat target comfortably above the need so repeated submits/resolves
      // don't each hit the faucet. sim_fundAccount takes wei as a JS number; at
      // these magnitudes the low-order-wei rounding is irrelevant.
      const target = needWei > FUND_TARGET_WEI ? needWei + FUND_TARGET_WEI : FUND_TARGET_WEI;
      await client.request({
        method: "sim_fundAccount",
        params: [account.address, Number(target)],
      });

      bal = await refreshBalance();
      if (bal < needWei) {
        throw new Error(
          `Wallet funding failed: balance is ${bal} wei, below the required ${needWei} wei. ` +
            "The faucet (sim_fundAccount) may be unavailable on this endpoint."
        );
      }
      return bal;
    },
    [client, account, refreshBalance]
  );

  const readContract = useCallback(
    async (functionName, args = []) => {
      if (!client || !CONTRACT_ADDRESS) {
        throw new Error("Client not ready or contract address missing");
      }
      const result = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args,
      });
      return result;
    },
    [client]
  );

  const writeContract = useCallback(
    async (functionName, args = [], value = 0n) => {
      if (!client || !CONTRACT_ADDRESS) {
        throw new Error("Client not ready or contract address missing");
      }
      const stake = BigInt(value);
      // Fund the wallet before sending so it holds the stake plus gas. Without
      // this the payable submit_signal reverts ("must stake exactly 1 GEN")
      // because a fresh browser wallet has a zero balance, and even resolve_signal
      // (value 0) would fail for lack of gas.
      await ensureFunded(stake + GAS_HEADROOM_WEI);
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args,
        value: stake,
      });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.FINALIZED,
        interval: 3000,
        retries: 120,
        // Keep the full (un-simplified) receipt: simplifyTransactionReceipt strips
        // the `raw` calldata bytes from leader_receipt[].result, which are what we
        // need to decode the contract's structured return value. The full receipt
        // still carries `hash`, so nothing else regresses.
        fullTransaction: true,
      });
      refreshBalance().catch(() => {}); // reflect the spent stake/gas in the UI
      return receipt;
    },
    [client, ensureFunded, refreshBalance]
  );

  return {
    client,
    account,
    address,
    balance,
    readContract,
    writeContract,
    ensureFunded,
    refreshBalance,
    error,
  };
}
