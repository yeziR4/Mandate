import { useEffect, useState } from "react";

export interface KeeperModel {
  index: number;
  label: string;
  mock: boolean;
}

export interface KeeperHealth {
  ok: boolean;
  autoRelay: boolean;
  judgeConfigured: boolean;
  real: number;
  models: KeeperModel[];
}

const KEEPER_URL = (import.meta.env.VITE_KEEPER_URL as string | undefined)?.replace(/\/$/, "");

// One fetch per page load, shared by the board and the attempt panel.
let cached: Promise<KeeperHealth | undefined> | undefined;

function load(): Promise<KeeperHealth | undefined> {
  if (!KEEPER_URL) return Promise.resolve(undefined);
  if (!cached) {
    cached = fetch(`${KEEPER_URL}/health`)
      .then((response) => (response.ok ? (response.json() as Promise<KeeperHealth>) : undefined))
      .catch(() => undefined);
  }
  return cached;
}

/**
 * Which models actually have a judge behind them. Without this the board invites attempts
 * on models the keeper will refuse, and the refusal only shows up after a wallet is connected.
 */
export function useKeeperHealth() {
  const [health, setHealth] = useState<KeeperHealth>();

  useEffect(() => {
    let live = true;
    void load().then((value) => {
      if (live) setHealth(value);
    });
    return () => {
      live = false;
    };
  }, []);

  return {
    configured: Boolean(KEEPER_URL),
    real: health?.real ?? 0,
    models: health?.models ?? [],
    judging: (modelId: number): boolean | undefined => {
      if (!KEEPER_URL) return undefined;
      if (!health) return undefined;
      const entry = health.models.find((model) => model.index === modelId);
      return entry ? !entry.mock : undefined;
    },
  };
}
