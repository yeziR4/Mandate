/**
 * Privy bridge: X or email login with an embedded wallet on Metis.
 *
 * Loaded lazily and only when VITE_PRIVY_APP_ID is present, so the public bundle does not
 * carry the wallet-connector stack for visitors who never sign in.
 */
import { useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { metisAndromeda } from "./arena";
import { PRIVY_APP_ID } from "./wallet";
import { WalletContext } from "./walletContext";
import type { EthereumProvider, Wallet } from "./walletContext";

const CHAIN_CAIP2 = `eip155:${metisAndromeda.id}`;

function parseChainId(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const tail = value.includes(":") ? value.split(":").pop() : value;
    const parsed = Number(tail?.startsWith("0x") ? Number.parseInt(tail, 16) : tail);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const ethereum = useMemo(
    () => wallets.find((wallet) => wallet.type === "ethereum"),
    [wallets]
  );

  const address = ethereum?.address as Address | undefined;
  const chainId = parseChainId(ethereum?.chainId);
  const wrongChain = Boolean(address) && chainId !== metisAndromeda.id;

  const label = useMemo(() => {
    const handle = user?.twitter?.username;
    if (handle) return `@${handle}`;
    if (user?.email?.address) return user.email.address;
    return undefined;
  }, [user]);

  const connect = useCallback(async () => {
    if (!authenticated) {
      login();
      return;
    }
    if (ethereum && chainId !== metisAndromeda.id) {
      await ethereum.switchChain(metisAndromeda.id);
    }
  }, [authenticated, login, ethereum, chainId]);

  // a returning user can land on the wrong network; fix it without asking
  useEffect(() => {
    if (!ready || !authenticated || !ethereum) return;
    if (chainId !== undefined && chainId !== metisAndromeda.id) {
      void ethereum.switchChain(metisAndromeda.id).catch(() => undefined);
    }
  }, [ready, authenticated, ethereum, chainId]);

  const wallet: Wallet = {
    status: !ready ? "idle" : authenticated && address ? "connected" : authenticated ? "connecting" : "idle",
    address,
    chainId,
    error: wrongChain ? `Switch to ${metisAndromeda.name} to submit.` : undefined,
    label,
    via: "privy",
    connect,
    disconnect: async () => {
      await logout();
    },
    getProvider: async () => {
      if (!ethereum) return undefined;
      return (await ethereum.getEthereumProvider()) as unknown as EthereumProvider;
    },
  };

  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function PrivyWalletProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID ?? ""}
      config={{
        loginMethods: ["twitter", "email", "wallet"],
        defaultChain: metisAndromeda,
        supportedChains: [metisAndromeda],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
        },
        appearance: {
          theme: "light",
          accentColor: "#00cfff",
          landingHeader: "Sign in to attempt a purse",
          loginMessage: "X or email. No seed phrase, no extension.",
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

export { CHAIN_CAIP2 };
