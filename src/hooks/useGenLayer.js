import { useEffect, useState, useCallback } from "react";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const ENDPOINT = import.meta.env.VITE_GENLAYER_RPC_URL || "http://localhost:4000/api";

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
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const acc = getStoredAccount();
      const c = createClient({
        chain: localnet,
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
    } catch (e) {
      setError(e.message || "Failed to initialize GenLayer client");
    }
  }, []);

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
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args,
        value,
      });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.FINALIZED,
        interval: 3000,
        retries: 120,
      });
      return receipt;
    },
    [client]
  );

  return { client, account, address, readContract, writeContract, error };
}
