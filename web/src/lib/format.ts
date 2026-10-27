export function usd(value: bigint, decimals = 6): string {
  const whole = value / 10n ** BigInt(decimals);
  const frac = value % 10n ** BigInt(decimals);
  const cents = (frac * 100n) / 10n ** BigInt(decimals);
  return `$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export function shortAddress(address?: string, size = 4): string {
  if (!address) return "—";
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

export function shortHash(hash?: string): string {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function timeAgo(timestamp?: number): string {
  if (!timestamp) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function standing(timestamp?: number): string {
  if (!timestamp) return "—";
  const ms = Date.now() - timestamp;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

export function dateStamp(timestamp?: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function pad(id: bigint | number, size = 3): string {
  return String(id).padStart(size, "0");
}

export function percent(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}
