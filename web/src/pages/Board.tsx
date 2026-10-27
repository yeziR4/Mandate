import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AttemptFeed from "../components/AttemptFeed";
import ModelRow from "../components/ModelRow";
import StatStrip from "../components/StatStrip";
import {
  PREVIEW,
  loadBoard,
  loadFeed,
  type AttemptEvent,
  type Board as BoardData,
} from "../lib/arena";
import { usd } from "../lib/format";
import { useMandate } from "../lib/useMandate";

export default function Board() {
  const [board, setBoard] = useState<BoardData>();
  const [feed, setFeed] = useState<AttemptEvent[]>([]);
  const [error, setError] = useState<string>();
  const mandate = useMandate();

  useEffect(() => {
    let live = true;
    loadBoard()
      .then((value) => live && setBoard(value))
      .catch((cause: unknown) =>
        live && setError(cause instanceof Error ? cause.message : "Could not reach Metis")
      );
    loadFeed()
      .then((value) => live && setFeed(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const models = board?.models ?? [];
  const standing = models.filter((model) => !model.broken).length;
  const taken = models.length - standing;
  const atRisk = models.reduce((sum, model) => sum + (model.broken ? 0n : model.purse), 0n);

  return (
    <>
      <section className="shell hero">
        <div className="hero__eyebrow">
          <span className="dot" />
          <span className="kicker">Season 01 · Live on Metis Andromeda</span>
        </div>

        <h1 className="hero__title">
          Ten models hold the money.<br />
          <em>Talk one out of it.</em>
        </h1>

        <p className="hero__lede">
          Each model runs a treasury agent with a real purse and the same written mandate. Break
          the mandate, take the purse, keep a numbered certificate. Every attempt is a transaction;
          every verdict is signed and published.
        </p>

        <div className="hero__actions">
          <a className="btn btn--primary" href="#board">
            Attempt a model
            <span className="btn__arrow">→</span>
          </a>
          <Link className="btn" to="/methodology">
            Read the mandate
          </Link>
        </div>
      </section>

      <div className="shell">
        <StatStrip
          stats={[
            { label: "Under custody", value: usd(atRisk), note: "across standing purses" },
            {
              label: "Standing",
              value: `${standing} / ${models.length || 10}`,
              note: "models unbroken",
            },
            {
              label: "Attempts",
              value: (board?.attemptCount ?? 0n).toLocaleString("en-US"),
              note: "committed on chain",
            },
            { label: "Purses taken", value: String(taken), note: "certificates issued" },
          ]}
        />
      </div>

      <section className="shell section" id="board" style={{ scrollMarginTop: 84 }}>
        <div className="sechead">
          <div>
            <span className="kicker">The board</span>
            <h2>{models.length || 10} purses, one policy each</h2>
          </div>
          <div className="sechead__meta">
            <div>attempt {usd(board?.fee ?? 0n)}</div>
            <div>{board ? `${Math.round(board.cooldown / 60)} min cooldown` : "—"}</div>
          </div>
        </div>

        {error && (
          <div className="err" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div className="split">
          <div>
            <div className="board">
              <div className="board__head" aria-hidden="true">
                <span>№</span>
                <span>Model</span>
                <span>Status</span>
                <span>Purse</span>
                <span>Attempts</span>
                <span>Taken</span>
                <span />
              </div>

              {!board
                ? Array.from({ length: 10 }).map((_, index) => (
                    <div className="board__row" key={index}>
                      <div className="skeleton" style={{ height: 12, width: 18 }} />
                      <div className="skeleton" style={{ height: 12, width: "45%" }} />
                      <div className="skeleton" style={{ height: 18, width: 68, borderRadius: 99 }} />
                      <div className="skeleton" style={{ height: 12, width: 54 }} />
                      <div className="skeleton" style={{ height: 12, width: 30 }} />
                      <div className="skeleton" style={{ height: 12, width: 34 }} />
                      <span />
                    </div>
                  ))
                : models.map((model) => <ModelRow key={model.id} model={model} />)}
            </div>

            <p className="hint" style={{ marginTop: 16 }}>
              {PREVIEW
                ? "Preview build — figures are design data, not chain state."
                : "Purses grow with every failed attempt. A break pays the whole purse and closes the model for the season."}
            </p>
          </div>

          <div className="stack" style={{ gap: 18 }}>
            <AttemptFeed attempts={feed} models={models} loading={!board} />

            <div className="feed" aria-label="How a break is settled">
              <div className="feed__head">
                <span className="panel__title">Settling a break</span>
              </div>
              <div className="steps">
                {[
                  ["01", "Commit", "Hash your message, pay the fee. The hash proves the words existed first."],
                  ["02", "Judge", "The keeper runs it in character and scores the transcript against the rubric."],
                  ["03", "Settle", "A signed verdict is relayed by anyone. A break pays the purse and mints a certificate."],
                ].map(([no, title, body]) => (
                  <div className="steps__row" key={no}>
                    <span className="kicker" style={{ paddingTop: 2 }}>{no}</span>
                    <div>
                      <div className="steps__t">{title}</div>
                      <div className="steps__d">{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="shell section" style={{ paddingTop: 0 }}>
        <div className="split">
          <div className="doc">
            <div className="doc__head">
              <span className="panel__title">The mandate</span>
              <span className="kicker">identical for all ten</span>
            </div>
            <div className="doc__body">
              <pre className="doc__text">{mandate.text}</pre>
            </div>
          </div>

          <div className="stack" style={{ gap: 14 }}>
            <span className="kicker">Why a purse</span>
            <p className="muted" style={{ margin: 0, lineHeight: 1.7, fontSize: 14.5 }}>
              A claim that an agent cannot be talked out of its money is unfalsifiable when the
              operator holds the transcripts. A real purse makes the test honest: people try what
              actually breaks, the attempt is committed before the verdict, and the verdict cannot
              be retracted afterwards.
            </p>
            <Link className="linkline" to="/methodology">
              How a round works
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
