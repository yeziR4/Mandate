import { useEffect, useMemo, useState } from "react";
import { keccak256, toHex } from "viem";

/**
 * Independent verification, in the browser.
 *
 * The certificate stores the transcript hash. This hashes whatever is pasted, using the
 * same function the keeper used, and compares. No server, no trust in us — which is the
 * point of publishing a hash instead of a claim.
 */
export default function VerifyTranscript({
  expected,
  initial,
}: {
  expected?: string;
  initial?: string;
}) {
  const [text, setText] = useState(initial ?? "");

  useEffect(() => {
    if (initial !== undefined) setText(initial);
  }, [initial]);

  const computed = useMemo(() => (text.length > 0 ? keccak256(toHex(text)) : undefined), [text]);
  const match = Boolean(computed && expected && computed.toLowerCase() === expected.toLowerCase());

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="field">
        <label className="field__label" htmlFor="verify">
          <span>Verify a transcript</span>
          <span>{text.length > 0 ? `${text.length} chars` : "paste the published text"}</span>
        </label>
        <textarea
          id="verify"
          className="textarea"
          style={{ minHeight: 120 }}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste the transcript exactly as published. The hash is over the raw bytes, so a stray space will not match."
          spellCheck={false}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          fontFamily: "var(--mono)",
          fontSize: 11,
        }}
      >
        <span className="dim">
          {computed ? `keccak256 → ${computed.slice(0, 18)}…` : "keccak256 → —"}
        </span>
        {computed && (
          <span style={{ color: match ? "var(--live)" : "var(--dead)" }}>
            {match ? "matches the certificate" : "does not match"}
          </span>
        )}
      </div>

      <p className="hint" style={{ margin: 0 }}>
        This runs in your browser against the hash stored in the certificate. If it matches, the
        text published here is the text that was committed before the verdict — we cannot change it
        afterwards without breaking the hash.
      </p>
    </div>
  );
}
