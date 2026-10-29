import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AttemptPanel from "../components/AttemptPanel";
import ModelLogo from "../components/ModelLogo";
import { Pill } from "../components/Pill";
import { loadBoard, type Board as BoardData, type Model } from "../lib/arena";
import { dateStamp, shortAddress, timeAgo, usd } from "../lib/format";
import { useMandate } from "../lib/useMandate";

export default function ModelPage() {
  const { id } = useParams();
  const index = Number(id);
  const [board, setBoard] = useState<BoardData>();
  const [error, setError] = useState<string>();
  const mandate = useMandate();

  useEffect(() => {
    let live = true;
    loadBoard()
      .then((value) => live && setBoard(value))
      .catch((cause: unknown) =>
        live && setError(cause instanceof Error ? cause.message : "Could not reach Metis")
      );
    return () => {
      live = false;
    };
  }, []);

  const model: Model | undefined = Number.isInteger(index) ? board?.models[index] : undefined;

  if (error) {
    return (
      <section className="shell section">
        <div className="err">{error}</div>
      </section>
    );
  }

  if (board && !model) {
    return (
      <section className="shell section">
        <div className="empty">
          <span className="empty__title">No model at this index</span>
          <span className="hint">The board runs from 0 to {board.models.length - 1}.</span>
          <Link className="linkline" to="/">
            Back to the board
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="shell" style={{ paddingTop: 28 }}>
        <Link className="crumb" to="/">
          <span aria-hidden="true">←</span> Board
        </Link>
      </section>

      <section className="shell" style={{ paddingTop: 22 }}>
        <div className="modelhead">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span className="kicker">Model {String(index).padStart(2, "0")}</span>
              {model && <Pill state={model.broken ? "broken" : "live"} />}
            </div>
            <h1 className="modelhead__name">
              {model && <ModelLogo label={model.label} size={52} />}
              {model?.label ?? <span className="skeleton" style={{ display: "inline-block", width: 180, height: 40 }} />}
            </h1>
          </div>

          <div className="modelhead__purse">
            <div className="kicker" style={{ marginBottom: 8 }}>
              Purse
            </div>
            <span className="num">{model ? usd(model.broken ? 0n : (board?.bounty ?? 0n)) : "—"}</span>
          </div>
        </div>
      </section>

      <section className="shell section" style={{ paddingTop: 32 }}>
        <div className="split">
          <div className="stack" style={{ gap: 22 }}>
            <div className="doc">
              <div className="doc__head">
                <span className="panel__title">Mandate</span>
                <span className="kicker">policy v1</span>
              </div>
              <div className="doc__body">
                <pre className="doc__text">{mandate.text}</pre>
              </div>
            </div>

            <div className="prose">
              <h3>Rules of engagement</h3>
              <ul>
                <li>One attempt at a time, with a cooldown between commits from the same address.</li>
                <li>
                  Every attempt pays a fee that joins this purse — failed attempts make the target
                  bigger.
                </li>
                <li>
                  A break pays the entire purse to the address that committed the attempt, and mints
                  a numbered certificate.
                </li>
                <li>Once broken, the model is closed for the season. Its certificate stays on the wall.</li>
              </ul>
            </div>
          </div>

          <div className="stack" style={{ gap: 18 }}>
            <div className="panel">
              <div className="panel__head">
                <span className="panel__title">State</span>
                {model?.broken && <span className="kicker">closed</span>}
              </div>
              <div className="panel__body">
                <div className="meta">
                  <div className="meta__row">
                    <span className="meta__key">Status</span>
                    <span className="meta__val">{model ? (model.broken ? "broken" : "standing") : "—"}</span>
                  </div>
                  <div className="meta__row">
                    <span className="meta__key">Attempts</span>
                    <span className="meta__val">{model?.attempts.toLocaleString("en-US") ?? "—"}</span>
                  </div>
                  <div className="meta__row">
                    <span className="meta__key">Bounty</span>
                    <span className="meta__val">{model ? usd(model.broken ? 0n : (board?.bounty ?? 0n)) : "—"}</span>
                  </div>
                  {model?.broken && (
                    <>
                      <div className="meta__row">
                        <span className="meta__key">Broken</span>
                        <span className="meta__val">
                          {timeAgo(model.brokenAt)} · {dateStamp(model.brokenAt)}
                        </span>
                      </div>
                      <div className="meta__row">
                        <span className="meta__key">Breaker</span>
                        <span className="meta__val">{shortAddress(model.breaker, 5)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel__head">
                <span className="panel__title">Attempt</span>
                <span className="kicker">{board ? usd(board.fee) : "—"}</span>
              </div>
              <div className="panel__body">
                {model && board ? (
                  <AttemptPanel model={model} fee={board.fee} />
                ) : (
                  <div className="skeleton" style={{ height: 120 }} />
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
