export function Pill({ state }: { state: "live" | "broken" }) {
  return (
    <span className={`pill pill--${state}`}>
      <span className="dot" />
      {state === "live" ? "Standing" : "Broken"}
    </span>
  );
}
