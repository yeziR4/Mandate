import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, type Address } from "viem";
import { metisAndromeda } from "./arena";

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const CHAIN_ID_HEX = "0x440"; // 1088

export type WalletStatus = "idle" | "connecting" | "connected";

export interface Wallet {
  status: WalletStatus;
  address?: Address;
  chainId?: number;
  error?: string;
  connect: () => Promise<void>;
  client?: ReturnType<typeof createWalletClient>;
}

export function useWallet(): Wallet {
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [error, setError] = useState<string>();

  const sync = useCallback(async (provider: Eip1193Provider) => {
    const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
    if (accounts.length > 0) {
      setAddress(accounts[0]);
      setStatus("connected");
    }
    const id = (await provider.request({ method: "eth_chainId" })) as string;
    setChainId(Number.parseInt(id, 16));
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    void sync(provider).catch(() => undefined);

    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as Address[];
      if (!accounts?.length) {
        setAddress(undefined);
        setStatus("idle");
      } else {
        setAddress(accounts[0]);
      }
    };
    const onChain = (...args: never[]) => {
      const id = args[0] as unknown as string;
      setChainId(Number.parseInt(id, 16));
    };

    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [sync]);

  const connect = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      setError("No EVM wallet detected. Install one, or open this page in a wallet browser.");
      return;
    }
    setError(undefined);
    setStatus("connecting");
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
      setAddress(accounts[0]);

      const current = (await provider.request({ method: "eth_chainId" })) as string;
      if (Number.parseInt(current, 16) !== metisAndromeda.id) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN_ID_HEX }],
          });
        } catch {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: CHAIN_ID_HEX,
                chainName: metisAndromeda.name,
                nativeCurrency: metisAndromeda.nativeCurrency,
                rpcUrls: metisAndromeda.rpcUrls.default.http,
                blockExplorerUrls: [metisAndromeda.blockExplorers.default.url],
              },
            ],
          });
        }
      }

      const id = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(id, 16));
      setStatus("connected");
    } catch (cause) {
      setStatus(address ? "connected" : "idle");
      setError(cause instanceof Error ? cause.message : "Wallet connection was rejected.");
    }
  }, [address]);

  const client = window.ethereum
    ? createWalletClient({ chain: metisAndromeda, transport: custom(window.ethereum) })
    : undefined;

  return { status, address, chainId, error, connect, client };
}
