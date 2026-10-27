export default function Stamp({ size = 62 }: { size?: number }) {
  return (
    <svg
      className="stamp"
      width={size}
      height={size}
      viewBox="0 0 62 62"
      fill="none"
      aria-hidden="true"
      style={{ transform: "rotate(-7deg)" }}
    >
      <circle cx="31" cy="31" r="29" stroke="currentColor" strokeWidth="0.9" />
      <circle
        cx="31"
        cy="31"
        r="24"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeDasharray="2 2.5"
      />
      <text
        x="31"
        y="29"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="var(--mono)"
        fontSize="5.4"
        letterSpacing="1"
      >
        MANDATE
      </text>
      <text
        x="31"
        y="36"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="var(--mono)"
        fontSize="6.4"
        letterSpacing="0.8"
      >
        BROKEN
      </text>
    </svg>
  );
}
