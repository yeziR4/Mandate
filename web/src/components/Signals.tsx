import { useEffect, useMemo, useState } from "react";
import { ARENA_ADDRESS, loadBoard, loadFeed, type AttemptEvent, type Board } from "../lib/arena";
import ModelLogo from "./ModelLogo";

// The two wordless strips that frame every page: vital signs above, the ledger below.

let boardOnce: Promise<Board> | undefined;
let feedOnce: Promise<AttemptEvent[]> | undefined;

function useSignals() {
  const [board, setBoard] = useState<Board>();
  const [feed, setFeed] = useState<AttemptEvent[]>([]);
  useEffect(() => {
    let live = true;
    (boardOnce ??= loadBoard()).then((b) => live && setBoard(b)).catch(() => undefined);
    (feedOnce ??= loadFeed(48)).then((f) => live && setFeed(f)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return { board, feed };
}

/** One heartbeat cycle, 120 wide, drawn twice so the loop is seamless. */
const BEAT = "M0 11 H38 L44 11 L48 3 L53 19 L57 7 L60 11 H120";
const FLAT = "M0 11 H120";

export function VitalsRail() {
  const { board } = useSignals();
  const models = board?.models ?? [];
  const slots = models.length ? models : Array.from({ length: 10 }, () => undefined);

  return (
    <div className="vitals" aria-hidden="true">
      {slots.map((model, i) => {
        const broken = model?.broken ?? false;
        // busier models beat faster: 3.2s down to 1.4s
        const speed = model ? Math.max(1.4, 3.2 - Math.log10(1 + model.attempts) * 0.9) : 3;
        return (
          <div key={i} className={`vitals__ch${broken ? " vitals__ch--flat" : ""}`}>
            {model && <ModelLogo label={model.label} size={18} />}
            <div className="vitals__trace">
              <svg viewBox="0 0 240 22" preserveAspectRatio="none" style={{ animationDuration: `${speed}s`, animationDelay: `${-i * 0.37}s` }}>
                <path d={broken ? FLAT : BEAT} />
                <path d={broken ? FLAT : BEAT} transform="translate(120 0)" />
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function nibbles(hex: string): number[] {
  return hex
    .replace(/^0x/, "")
    .split("")
    .map((c) => parseInt(c, 16))
    .filter((n) => !Number.isNaN(n));
}

export function LedgerTape() {
  const { feed } = useSignals();

  // Real commit hashes when there are attempts; the arena address otherwise.
  const columns = useMemo(() => {
    const sources = feed.length ? feed.map((a) => a.commit) : [ARENA_ADDRESS ?? "0x6d616e64617465"];
    const cols: { bits: number; mark: boolean }[] = [];
    while (cols.length < 220) {
      for (const src of sources) {
        nibbles(src).forEach((n) => cols.push({ bits: n, mark: false }));
        cols.push({ bits: 0, mark: true }); // separator between hashes
      }
    }
    return cols.slice(0, 220);
  }, [feed]);

  const strip = (copy: number) => (
    <div className="tape__run" key={copy}>
      {columns.map((c, i) =>
        c.mark ? (
          <span key={i} className="tape__sep" />
        ) : (
          <span key={i} className="tape__col">
            {[8, 4, 2, 1].map((b) => (
              <i key={b} className={c.bits & b ? "on" : undefined} />
            ))}
          </span>
        ),
      )}
    </div>
  );

  return (
    <div className="tape" aria-hidden="true">
      <div className="tape__track">{[0, 1].map(strip)}</div>
    </div>
  );
}
