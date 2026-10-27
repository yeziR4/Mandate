import { createContext, useContext } from "react";
import type { Address } from "viem";

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

export type WalletStatus = "idle" | "connecting" | "connected";

export interface Wallet {
  status: WalletStatus;
  address?: Address;
  chainId?: number;
  error?: string;
  /** "@handle" when signed in with X, otherwise a short address. */
  label?: string;
  /** How the user is authenticated. The programme counts Privy logins as a legitimacy signal. */
  via: "privy" | "injected" | "none";
  connect: () => Promise<void>;
  disconnect?: () => Promise<void>;
  getProvider: () => Promise<EthereumProvider | undefined>;
}

export const WalletContext = createContext<Wallet | undefined>(undefined);

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside WalletProvider");
  return wallet;
}
