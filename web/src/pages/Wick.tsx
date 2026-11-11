import { useCallback, useEffect, useMemo, useState } from "react";
import "../wick.css";

/**
 * Wick — always-on agents with a job, a schedule, and a model you can swap.
 *
 * The front door. Everything on this page is live: the agents run against the keeper, the prices
 * come from the gateway catalogue, and the cost under each card is metered from the response.
 */

const KEEPER_URL = (import.meta.env.VITE_KEEPER_URL as string | undefined)?.replace(/\/$/, "");

interface GatewayModel {
  id: string;
  inPrice: number | null;
  outPrice: number | null;
}

interface AgentRun {
  id: string;
  model: string;
  startedAt: string;
  ms: number;
  output: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  ok: boolean;
  error?: string;
}

interface Agent {
  id: string;
  name: string;
  task: string;
  model: string;
  everyMinutes: number;
  enabled: boolean;
  kind: "watch" | "treasury";
  lastRunAt?: string;
  nextRunAt: string;
  due: boolean;
  lastRun: AgentRun | null;
  runs: AgentRun[];
}

const money = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(value < 0.01 ? 6 : 4)}`;

const every = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;

const shortModel = (id: string) => id.split("/").pop() ?? id;

function ago(iso?: string) {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export default function Wick() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", task: "", model: "", everyMinutes: 30 });

  const load = useCallback(async () => {
    if (!KEEPER_URL) {
      setError("VITE_KEEPER_URL is not set — start the keeper and rebuild.");
      return;
    }
    try {
      const [agentsResponse, modelsResponse] = await Promise.all([
        fetch(`${KEEPER_URL}/agents`),
        fetch(`${KEEPER_URL}/agents/models`),
      ]);
      if (agentsResponse.ok) setAgents(((await agentsResponse.json()) as { agents: Agent[] }).agents);
      if (modelsResponse.ok)
        setModels(((await modelsResponse.json()) as { models: GatewayModel[] }).models);
      setError(null);
    } catch (cause) {
      setError(`keeper unreachable: ${String(cause).slice(0, 120)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 12000);
    return () => clearInterval(timer);
  }, [load]);

  const post = async (path: string, body: unknown) => {
    if (!KEEPER_URL) return;
    setBusy(path + JSON.stringify(body));
    try {
      await fetch(`${KEEPER_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const spend = useMemo(
    () =>
      agents.reduce(
        (sum, agent) => sum + (agent.runs ?? []).reduce((inner, run) => inner + (run.costUsd ?? 0), 0),
        0
      ),
    [agents]
  );
  const runs = useMemo(() => agents.reduce((sum, agent) => sum + (agent.runs ?? []).length, 0), [agents]);

  return (
    <div className="wk">
      <header className="wk-hdr">
        <div className="wk-shell wk-hdr__inner">
          <a className="wk-brand" href="/">
            <img src="/wick.svg" alt="" />
            <span className="wk-brand__name">Wick</span>
            <span className="wk-brand__tag">beta</span>
          </a>
          <nav className="wk-nav">
            <a href="#agents" aria-current="page">
              Agents
            </a>
            <a href="#how">How it works</a>
            <a href="#new">New agent</a>
          </nav>
          <a className="wk-btn wk-btn--primary" href="#new">
            Start free
          </a>
        </div>
      </header>

      <section className="wk-hero">
        <div className="wk-shell wk-hero__inner">
          <div>
            <p className="wk-eyebrow">always-on agents · pay per run</p>
            <h1 className="wk-h1">
              Agents that
              <br />
              <em>don't sleep.</em>
            </h1>
            <p className="wk-sub">
              Give a job, a schedule and a model. Wick wakes it up, lets it fetch, check and act, and
              records what that run cost. Swap the model whenever you like — no keys, no
              subscription.
            </p>
            <div className="wk-cta">
              <a className="wk-btn wk-btn--primary" href="#new">
                Create your first agent
              </a>
              <a className="wk-btn wk-btn--ghost" href="#agents">
                Watch them run
              </a>
            </div>
            <div className="wk-facts">
              <div>
                <div className="wk-fact__value">{agents.length}</div>
                <div className="wk-fact__label">agents on duty</div>
              </div>
              <div>
                <div className="wk-fact__value">{runs}</div>
                <div className="wk-fact__label">runs recorded</div>
              </div>
              <div>
                <div className="wk-fact__value">{money(spend)}</div>
                <div className="wk-fact__label">metered spend</div>
              </div>
              <div>
                <div className="wk-fact__value">{models.length}</div>
                <div className="wk-fact__label">models, one gateway</div>
              </div>
            </div>
          </div>

          <div className="wk-hero__art">
            <div className="wk-glow" />
            <img src="/wick.svg" alt="Wick, the lantern" />
          </div>
        </div>
      </section>

      <section className="wk-section" id="agents">
        <div className="wk-shell">
          <div className="wk-section__head">
            <h2 className="wk-h2">On duty right now</h2>
            <span className="wk-note">
              {error ? error : "each card is a live agent · press run to wake it early"}
            </span>
          </div>

          <div className="wk-grid">
            {agents.map((agent) => {
              const run = agent.lastRun;
              const running = busy?.includes(agent.id);
              return (
                <article className={`wk-agent${agent.enabled ? " wk-agent--live" : ""}`} key={agent.id}>
                  <div className="wk-agent__top">
                    <div>
                      <h3 className="wk-agent__name">{agent.name}</h3>
                      <div className="wk-row" style={{ marginTop: 8 }}>
                        <span className={`wk-chip ${agent.enabled ? "wk-chip--on" : ""}`}>
                          {agent.enabled ? `every ${every(agent.everyMinutes)}` : "paused"}
                        </span>
                        {agent.kind === "treasury" && <span className="wk-chip">policy + tools</span>}
                        {run && <span className="wk-chip wk-chip--cost">{money(run.costUsd)} last run</span>}
                      </div>
                    </div>
                    <div className="wk-row" style={{ marginTop: 0 }}>
                      <button
                        className="wk-btn wk-btn--primary"
                        disabled={busy !== null}
                        onClick={() => void post("/agents/run", { id: agent.id })}
                      >
                        {running ? "running…" : "Run now"}
                      </button>
                      <button
                        className="wk-btn wk-btn--ghost"
                        disabled={busy !== null}
                        onClick={() => void post("/agents/toggle", { id: agent.id, enabled: !agent.enabled })}
                      >
                        {agent.enabled ? "Pause" : "Resume"}
                      </button>
                    </div>
                  </div>

                  <p className="wk-agent__task">{agent.task}</p>

                  <div className="wk-row">
                    <select
                      className="wk-select"
                      value={agent.model}
                      onChange={(event) =>
                        void post("/agents/model", { id: agent.id, model: event.target.value })
                      }
                      style={{ minWidth: 300 }}
                    >
                      {[agent.model, ...models.map((model) => model.id)]
                        .filter((id, index, all) => all.indexOf(id) === index)
                        .map((id) => {
                          const model = models.find((entry) => entry.id === id);
                          return (
                            <option key={id} value={id}>
                              {id}
                              {model?.inPrice != null ? ` — $${model.inPrice}/$${model.outPrice} per M` : ""}
                            </option>
                          );
                        })}
                    </select>
                    <span className="wk-meta">
                      {shortModel(agent.model)} · {run ? `${(run.ms / 1000).toFixed(1)}s` : "—"} ·{" "}
                      {run ? `${run.promptTokens}/${run.completionTokens} tokens` : "no runs yet"} ·{" "}
                      next in {Math.max(0, Math.round((Date.parse(agent.nextRunAt) - Date.now()) / 60000))}m
                    </span>
                  </div>

                  {run && (
                    <>
                      <pre className={`wk-output${open === agent.id ? " wk-output--open" : ""}`}>
                        {run.ok ? run.output : `failed: ${run.error}`}
                      </pre>
                      <div className="wk-row">
                        <button
                          className="wk-btn wk-btn--ghost"
                          onClick={() => setOpen(open === agent.id ? null : agent.id)}
                        >
                          {open === agent.id ? "Less" : `History (${agent.runs.length})`}
                        </button>
                        <span className="wk-meta">last run {ago(agent.lastRunAt)}</span>
                      </div>
                      {open === agent.id && (
                        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                          {agent.runs.map((entry) => (
                            <div key={entry.id} className="wk-meta">
                              {new Date(entry.startedAt).toLocaleTimeString()} · {shortModel(entry.model)} ·{" "}
                              {(entry.ms / 1000).toFixed(1)}s · {money(entry.costUsd)} ·{" "}
                              {entry.output.replace(/\s+/g, " ").slice(0, 120)}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="wk-section" id="new">
        <div className="wk-shell">
          <div className="wk-section__head">
            <h2 className="wk-h2">Put an agent on duty</h2>
            <span className="wk-note">job, model, schedule. that's the whole form.</span>
          </div>

          <div className="wk-panel" style={{ maxWidth: 760 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <input
                className="wk-input"
                placeholder="Name — e.g. Gas price watch"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <textarea
                className="wk-textarea"
                placeholder="What should it do every time it wakes up? Be specific — it can fetch any https URL."
                value={draft.task}
                onChange={(event) => setDraft({ ...draft, task: event.target.value })}
              />
              <div className="wk-row">
                <select
                  className="wk-select"
                  value={draft.model}
                  onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  style={{ minWidth: 320 }}
                >
                  <option value="">pick a model…</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                      {model.inPrice != null ? ` — $${model.inPrice}/$${model.outPrice} per M` : ""}
                    </option>
                  ))}
                </select>
                <select
                  className="wk-select"
                  value={draft.everyMinutes}
                  onChange={(event) => setDraft({ ...draft, everyMinutes: Number(event.target.value) })}
                >
                  {[1, 5, 15, 30, 60, 120, 240, 720, 1440].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      every {every(minutes)}
                    </option>
                  ))}
                </select>
                <button
                  className="wk-btn wk-btn--primary"
                  disabled={!draft.task || !draft.model || busy !== null}
                  onClick={async () => {
                    await post("/agents", {
                      name: draft.name || "Untitled agent",
                      task: draft.task,
                      model: draft.model,
                      everyMinutes: draft.everyMinutes,
                      kind: "watch",
                    });
                    setDraft({ name: "", task: "", model: "", everyMinutes: 30 });
                  }}
                >
                  Deploy agent
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="wk-section" id="how">
        <div className="wk-shell">
          <div className="wk-section__head">
            <h2 className="wk-h2">How it works</h2>
          </div>
          <div className="wk-steps">
            <div className="wk-step">
              <div className="wk-step__no">01</div>
              <h3>It wakes up</h3>
              <p>
                A schedule, not a chat window. Every agent runs on its own clock, whether or not a
                browser is open.
              </p>
            </div>
            <div className="wk-step">
              <div className="wk-step__no">02</div>
              <h3>It does the work</h3>
              <p>
                Fetch a page, read a number, decide something, report. Tools are attached to the
                agent, not to you.
              </p>
            </div>
            <div className="wk-step">
              <div className="wk-step__no">03</div>
              <h3>You see the bill</h3>
              <p>
                Every run records tokens and cost from the gateway's own price list. Change the
                model and watch the price change.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="wk-shell wk-foot">
        <span>
          Wick · built on{" "}
          <a href="https://otari.ai" target="_blank" rel="noreferrer">
            Otari
          </a>{" "}
          · {models.length} models, one key
        </span>
        <span>pay per run · no subscription</span>
      </footer>
    </div>
  );
}
