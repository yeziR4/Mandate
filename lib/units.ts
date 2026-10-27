const PLANCK_PER_VARA = 10n ** 12n;

export function varaToPlanck(vara: string): bigint {
  const [whole, fractional = ""] = vara.split(".");
  const fractionalPadded = fractional.padEnd(12, "0").slice(0, 12);
  return BigInt(whole) * PLANCK_PER_VARA + BigInt(fractionalPadded || "0");
}
