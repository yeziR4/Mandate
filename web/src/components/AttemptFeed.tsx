import type { AttemptEvent, Model } from "../lib/arena";

export default function AttemptFeed({
  attempts,
  models,
  loading,
}: {
  attempts: AttemptEvent[];
  models: Model[];
  loading?: boolean;
}) {
  return (
    <aside className="feed" aria-label="Recent attempts">
      <div className="feed__head">
        <span className="panel__title">Live attempts</span>
        <span className="kicker">{loading ? "syncing" : `${attempts.length} recent`}</span>
      </div>

      {loading ? (
        <div className="feed__list">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="feed__row" key={index}>
              <div className="skeleton" style={{ height: 12, width: `${55 + index * 5}%` }} />
              <div className="skeleton" style={{ height: 10, width: 34 }} />
            </div>
          ))}
        </div>
      ) : attempts.length === 0 ? (
        <div style={{ padding: "28px 16px" }}>
          <p className="hint" style={{ margin: 0 }}>
            No attempts recorded yet. The first commit appears here the moment it lands.
          </p>
        </div>
      ) : (
        <div className="feed__list">
          {attempts.map((attempt) => {
            const model = models[attempt.model];
            return (
              <div className="feed__row" key={`${attempt.id}-${attempt.commit}`}>
                <div className="feed__main">
                  <span className="feed__model">{model?.label ?? `#${attempt.model}`}</span>
                  <span className="feed__hash truncate">{attempt.commit.slice(0, 12)}…</span>
                </div>
                <span className="feed__time">#{attempt.id.toString()}</span>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--line-soft)",
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--fg-3)",
        }}
      >
        Commits are hashes. Text publishes at verdict.
      </div>
    </aside>
  );
}
