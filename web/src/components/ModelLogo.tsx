import { brandFor } from "../lib/brands";

export default function ModelLogo({ label, size = 32 }: { label: string; size?: number }) {
  const brand = brandFor(label);
  return (
    <span className="logo-tile" style={{ width: size, height: size }} title={brand?.maker}>
      {brand ? (
        <img src={brand.logo} alt="" width={size * 0.56} height={size * 0.56} loading="lazy" />
      ) : (
        <span className="logo-tile__mono">{label.slice(0, 1)}</span>
      )}
    </span>
  );
}
