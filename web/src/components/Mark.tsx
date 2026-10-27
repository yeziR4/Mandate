export default function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="brand__mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect x="8.5" y="8.5" width="15" height="15" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M12 20.5V15l4-2.9 4 2.9v5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
