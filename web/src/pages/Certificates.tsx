import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Stamp from "../components/Stamp";
import { loadCertificates, type Certificate } from "../lib/arena";
import { dateStamp, pad, shortAddress, shortHash } from "../lib/format";

export default function Certificates() {
  const [certs, setCerts] = useState<Certificate[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    loadCertificates()
      .then((value) => live && setCerts(value))
      .catch((cause: unknown) =>
        live && setError(cause instanceof Error ? cause.message : "Could not read certificates")
      );
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <section className="shell pagehead">
        <span className="kicker">Registry</span>
        <h1 className="pagehead__title">Certificates</h1>
        <p className="pagehead__lede">
          One certificate per broken model, numbered and permanent. Each records the model, the
          verdict severity, and the hash of the transcript that did it.
        </p>
      </section>

      <section className="shell section" style={{ paddingTop: 8 }}>
        {error && <div className="err" style={{ marginBottom: 18 }}>{error}</div>}

        {!certs ? (
          <div className="certgrid">
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="skeleton" style={{ height: 210 }} key={index} />
            ))}
          </div>
        ) : certs.length === 0 ? (
          <div className="empty">
            <span className="empty__title">No certificates issued</span>
            <span className="hint">Every purse is still standing. The first break appears here.</span>
            <Link className="linkline" to="/">
              Back to the board
            </Link>
          </div>
        ) : (
          <div className="certgrid">
            {certs.map((cert) => (
              <Link className="cert" to={`/certificate/${cert.id}`} key={cert.id.toString()}>
                <div className="cert__top">
                  <div>
                    <div className="cert__no">№ {pad(cert.id)}</div>
                    <div className="cert__model">{cert.label}</div>
                  </div>
                  <Stamp />
                </div>

                <div className="cert__meta">
                  <span>
                    Broken <b>{dateStamp(cert.brokenAt)}</b>
                  </span>
                  <span>
                    Holder <b>{shortAddress(cert.owner, 5)}</b>
                  </span>
                  <span>
                    Transcript <b>{shortHash(cert.transcriptHash)}</b>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
