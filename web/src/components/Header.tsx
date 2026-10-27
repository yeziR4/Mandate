import { Link, NavLink } from "react-router-dom";
import Mark from "./Mark";
import { PREVIEW, metisAndromeda } from "../lib/arena";
import { shortAddress } from "../lib/format";
import { useWallet } from "../lib/wallet";

const links = [
  { to: "/", label: "Board" },
  { to: "/certificates", label: "Certificates" },
  { to: "/methodology", label: "Methodology" },
];

function WalletButton() {
  const wallet = useWallet();

  if (wallet.status !== "connected" || !wallet.address) {
    return (
      <button
        className="wallet"
        onClick={() => void wallet.connect()}
        disabled={wallet.status === "connecting"}
      >
        {wallet.status === "connecting" ? "Connecting…" : "Connect"}
      </button>
    );
  }

  const wrongChain = wallet.chainId !== metisAndromeda.id;

  return (
    <button
      className={`wallet${wrongChain ? " wallet--warn" : ""}`}
      onClick={() => void wallet.connect()}
      title={wallet.address}
    >
      <span className="dot" style={{ background: wrongChain ? "var(--dead)" : "var(--live)" }} />
      {wrongChain ? "Wrong network" : shortAddress(wallet.address)}
    </button>
  );
}

export default function Header() {
  return (
    <header className="hdr">
      <div className="shell hdr__inner">
        <Link to="/" className="brand" aria-label="Mandate home">
          <Mark />
          <span className="brand__name">Mandate</span>
          <span className="brand__tag">Season 01</span>
        </Link>

        <nav className="nav" aria-label="Primary">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === "/"}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="hdr__right">
          <span className={`netbadge${PREVIEW ? " netbadge--preview" : ""}`}>
            <span className="dot" />
            {PREVIEW ? "Preview data" : "Metis 1088"}
          </span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
