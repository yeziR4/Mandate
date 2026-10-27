import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Stamp from "../components/Stamp";
import VerifyTranscript from "../components/VerifyTranscript";
import { loadCertificates, type Certificate } from "../lib/arena";
import { dateStamp, pad, shortAddress } from "../lib/format";

export default function CertificatePage() {
  const { id } = useParams();
  const [certs, setCerts] = useState<Certificate[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    loadCertificates()
      .then((value) => live && setCerts(value))
      .catch((cause: unknown) =>
        live && setError(cause instanceof Error ? cause.message : "Could not read certificate")
      );
    return () => {
      live = false;
    };
  }, []);

  const cert = certs?.find((item) => item.id.toString() === id);
  const [published, setPublished] = useState<string>();

  useEffect(() => {
    const base = import.meta.env.VITE_KEEPER_URL as string | undefined;
    if (!base || !cert?.attemptId) return;
    let live = true;
    fetch(`${base.replace(/\/$/, "")}/transcript/${cert.attemptId}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("missing"))))
      .then((record: { transcript?: string }) => {
        if (live && record.transcript) setPublished(record.transcript);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [cert?.attemptId]);

  if (error) {
    return (
      <section className="shell section">
        <div className="err">{error}</div>
      </section>
    );
  }

  if (certs && !cert) {
    return (
      <section className="shell section">
        <div className="empty">
          <span className="empty__title">No certificate {id}</span>
          <span className="hint">Only issued certificates exist. Check the registry.</span>
          <Link className="linkline" to="/certificates">
            All certificates
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="shell" style={{ paddingTop: 28 }}>
        <Link className="crumb" to="/certificates">
          <span aria-hidden="true">←</span> Registry
        </Link>
      </section>

      <section
        className="shell section"
        style={{
          paddingTop: 22,
          minHeight: "calc(100vh - 320px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="doc"
          style={{ maxWidth: 720, margin: "0 auto", padding: "clamp(10px, 2vw, 18px)" }}
        >
          <div style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: "clamp(22px, 4vw, 40px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
              <div>
                <div className="kicker">Certificate of breakage</div>
                <div className="num" style={{ fontSize: "clamp(2.6rem, 6vw, 3.6rem)", lineHeight: 1, marginTop: 14, letterSpacing: "-0.04em" }}>
                  № {cert ? pad(cert.id) : "—"}
                </div>
              </div>
              <Stamp size={78} />
            </div>

            <div style={{ marginTop: 34 }}>
              <div className="kicker" style={{ marginBottom: 8 }}>
                Model
              </div>
              <div style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)", letterSpacing: "-0.035em", lineHeight: 1 }}>
                {cert?.label ?? <span className="skeleton" style={{ display: "inline-block", width: 160, height: 34 }} />}
              </div>
            </div>

            <div className="meta" style={{ marginTop: 34 }}>
              <div className="meta__row">
                <span className="meta__key">Issued</span>
                <span className="meta__val">{cert ? dateStamp(cert.brokenAt) : "—"}</span>
              </div>
              <div className="meta__row">
                <span className="meta__key">Holder</span>
                <span className="meta__val">{shortAddress(cert?.owner, 6)}</span>
              </div>
              <div className="meta__row">
                <span className="meta__key">Severity</span>
                <span className="meta__val">{cert ? `${cert.severity} — release authorised` : "—"}</span>
              </div>
              <div className="meta__row">
                <span className="meta__key">Transcript hash</span>
                <span className="meta__val truncate" style={{ maxWidth: 260 }}>
                  {cert?.transcriptHash ?? "—"}
                </span>
              </div>
            </div>

            <p className="hint" style={{ marginTop: 26, marginBottom: 0 }}>
              The transcript hash was committed before the verdict and is stored in the ERC-721.
              Anyone holding the transcript can verify it matches.
            </p>
          </div>
        </div>
      </section>
      <section className="shell section" style={{ paddingTop: 0 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div className="panel">
            <div className="panel__head">
              <span className="panel__title">Re-verification</span>
              <span className="kicker">{published ? "transcript loaded" : "client-side"}</span>
            </div>
            <div className="panel__body">
              <VerifyTranscript expected={cert?.transcriptHash} initial={published} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
