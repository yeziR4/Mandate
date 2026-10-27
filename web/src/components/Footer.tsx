import { Link } from "react-router-dom";
import Mark from "./Mark";
import {
  ARENA_ADDRESS,
  CERTIFICATE_ADDRESS,
  PREVIEW,
  USDC_ADDRESS,
  explorerAddress,
} from "../lib/arena";
import { shortAddress } from "../lib/format";

export default function Footer() {
  return (
    <footer className="ftr">
      <div className="shell">
        <div className="ftr__grid">
          <div className="ftr__col">
            <div className="brand">
              <Mark size={20} />
              <span className="brand__name">Mandate</span>
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13, maxWidth: "34ch" }}>
              A public robustness benchmark for agent treasuries. Real purses, written policies,
              signed verdicts.
            </p>
          </div>

          <div className="ftr__col">
            <span className="ftr__label">Contracts · Metis Andromeda</span>
            {PREVIEW || !ARENA_ADDRESS || !CERTIFICATE_ADDRESS ? (
              <span className="ftr__addr">Not deployed — preview build</span>
            ) : (
              <>
                <a className="ftr__addr" href={explorerAddress(ARENA_ADDRESS)} target="_blank" rel="noreferrer">
                  Arena {shortAddress(ARENA_ADDRESS, 6)}
                </a>
                <a
                  className="ftr__addr"
                  href={explorerAddress(CERTIFICATE_ADDRESS)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Certificates {shortAddress(CERTIFICATE_ADDRESS, 6)}
                </a>
                {USDC_ADDRESS && (
                  <a className="ftr__addr" href={explorerAddress(USDC_ADDRESS)} target="_blank" rel="noreferrer">
                    m.USDC {shortAddress(USDC_ADDRESS, 6)}
                  </a>
                )}
              </>
            )}
          </div>

          <div className="ftr__col">
            <span className="ftr__label">Read</span>
            <Link className="ftr__link" to="/">
              The board
            </Link>
            <Link className="ftr__link" to="/certificates">
              Certificates
            </Link>
            <Link className="ftr__link" to="/methodology">
              Methodology
            </Link>
          </div>
        </div>

        <div className="ftr__legal">
          <span>Season 01 · Pilot · Contracts unaudited</span>
          <span>Purses are prize money, not an investment.</span>
        </div>
      </div>
    </footer>
  );
}
