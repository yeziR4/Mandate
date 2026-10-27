/**
 * Wallet provider.
 *
 * With VITE_PRIVY_APP_ID set, users sign in with X or email and get an embedded wallet —
 * which is both the legitimacy signal the programme asks for and the end of the
 * "install a wallet first" wall. Without it, the app falls back to an injected wallet so
 * the board still works locally and in preview.
 */
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createWalletClient, custom } from "viem";
import type { Address } from "viem";
import { metisAndromeda } from "./arena";
import { WalletContext } from "./walletContext";
import type { EthereumProvider, Wallet } from "./walletContext";

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

const PrivyWalletProvider = lazy(() =>
  import("./privy").then((module) => ({ default: module.PrivyWalletProvider }))
);

function InjectedBridge({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [error, setError] = useState<string>();

  const provider = (): EthereumProvider | undefined =>
    (globalThis as unknown as { ethereum?: EthereumProvider }).ethereum;

  useEffect(() => {
    const eth = provider();
    if (!eth) return;
    void (async () => {
      try {
        const accounts = (await eth.request({ method: "eth_accounts" })) as Address[];
        if (accounts.length > 0) {
          setAddress(accounts[0]);
          setStatus("connected");
        }
        const id = (await eth.request({ method: "eth_chainId" })) as string;
        setChainId(Number.parseInt(id, 16));
      } catch {
        /* wallet refused, ignore */
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    const eth = provider();
    if (!eth) {
      setError("No EVM wallet detected. Install one, or sign in with X.");
      return;
    }
    setError(undefined);
    setStatus("connecting");
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
      setAddress(accounts[0]);

      const current = (await eth.request({ method: "eth_chainId" })) as string;
      if (Number.parseInt(current, 16) !== metisAndromeda.id) {
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x440" }],
          });
        } catch {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x440",
                chainName: metisAndromeda.name,
                nativeCurrency: metisAndromeda.nativeCurrency,
                rpcUrls: metisAndromeda.rpcUrls.default.http,
                blockExplorerUrls: [metisAndromeda.blockExplorers.default.url],
              },
            ],
          });
        }
      }

      const id = (await eth.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(id, 16));
      setStatus("connected");
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "Wallet connection was rejected.");
    }
  }, []);

  const wallet: Wallet = {
    status,
    address,
    chainId,
    error,
    via: "injected",
    connect,
    getProvider: async () => provider(),
  };

  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <InjectedBridge>{children}</InjectedBridge>;
  return (
    <Suspense fallback={null}>
      <PrivyWalletProvider>{children}</PrivyWalletProvider>
    </Suspense>
  );
}

/** Shared by both bridges so a submission always builds the same client. */
export async function clientFor(wallet: Wallet) {
  if (!wallet.address) throw new Error("wallet not connected");
  const eth = await wallet.getProvider();
  if (!eth) throw new Error("no wallet provider");
  return createWalletClient({
    account: wallet.address,
    chain: metisAndromeda,
    transport: custom(eth),
  });
}
