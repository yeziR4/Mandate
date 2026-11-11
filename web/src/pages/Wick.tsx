import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../wick.css";

/**
 * Wick â€” always-on agents, each with its own thread.
 *
 * Left: the agents on duty. Right: the conversation with the selected one, where scheduled runs
 * and anything you type both land as messages.
 */

const KEEPER_URL = (import.meta.env.VITE_KEEPER_URL as string | undefined)?.replace(/\/$/, "");

/** One identity per browser, so a visitor connects their own accounts, not the demo owner's. */
const VISITOR = (() => {
  const key = "wick-user";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = "wick_" + Math.random().toString(36).slice(2, 10);
  localStorage.setItem(key, created);
  return created;
})();

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
  prompt?: string;
  trigger?: "schedule" | "person";
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  ok: boolean;
  error?: string;
}

interface Connector {
  id: string;
  label: string;
  state: "live" | "needs-auth" | "needs-app";
  logo?: string;
  managed?: boolean;
  tools?: number;
}

interface Agent {
  id: string;
  name: string;
  task: string;
  model: string;
  everyMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRun: AgentRun | null;
  runs: AgentRun[];
}

const TINTS = ["#7FE3C4", "#FFB43A", "#9CC7FF", "#F2A7C3", "#C3B6FF"];
const tint = (id: string) => TINTS[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TINTS.length];

const money = (value: number | null | undefined) =>
  value == null ? "â€”" : `$${value.toFixed(value < 0.01 ? 6 : 4)}`;

const every = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;

const shortModel = (id: string) => id.split("/").pop() ?? id;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The run's text without the internal tool preamble. */
const spoken = (output: string) => output.replace(/^fetched:[^\n]*\n*/m, "").trim();

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function Wick() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorQuery, setConnectorQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showConnectors, setShowConnectors] = useState(false);
  const [composing, setComposing] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: "", task: "", model: "", everyMinutes: 30 });
  const threadEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!KEEPER_URL) {
      setError("VITE_KEEPER_URL is not set");
      return;
    }
    try {
      const [agentsResponse, modelsResponse, connectorsResponse] = await Promise.all([
        fetch(`${KEEPER_URL}/agents`, { headers: { "x-wick-user": VISITOR } }),
        fetch(`${KEEPER_URL}/agents/models`),
        fetch(`${KEEPER_URL}/agents/connectors`, { headers: { "x-wick-user": VISITOR } }),
      ]);
      if (agentsResponse.ok) {
        const list = ((await agentsResponse.json()) as { agents: Agent[] }).agents;
        setAgents(list);
        // Keep the selection valid, and pick the first agent only once.
        setActiveId((current) =>
          current && list.some((agent) => agent.id === current) ? current : (list[0]?.id ?? null)
        );
      }
      if (modelsResponse.ok)
        setModels(((await modelsResponse.json()) as { models: GatewayModel[] }).models);
      if (connectorsResponse.ok)
        setConnectors(
          ((await connectorsResponse.json()) as { connectors: Connector[] }).connectors
        );
      setError(null);
    } catch (cause) {
      setError(`keeper unreachable: ${String(cause).slice(0, 100)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

  const active = useMemo(
    () => agents.find((agent) => agent.id === activeId) ?? null,
    [agents, activeId]
  );

  const runs = useMemo(() => (active ? [...active.runs].reverse() : []), [active]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [runs.length, activeId]);

  const post = async (path: string, payload: unknown) => {
    if (!KEEPER_URL) return;
    setBusy(true);
    try {
      await fetch(`${KEEPER_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wick-user": VISITOR },
        body: JSON.stringify(payload),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  /** Ask the keeper for a Composio OAuth link for THIS visitor and open it. */
  const connect = async (toolkit: string) => {
    if (!KEEPER_URL) return;
    try {
      const response = await fetch(`${KEEPER_URL}/agents/connectors/link`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wick-user": VISITOR },
        body: JSON.stringify({ toolkit }),
      });
      if (!response.ok) return;
      const { url } = (await response.json()) as { url?: string };
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore */
    }
  };

  const send = async () => {
    if (!active || !draft.trim() || busy) return;
    const message = draft.trim();
    setDraft("");
    await post("/agents/run", { id: active.id, message });
  };

  const spend = agents.reduce(
    (sum, agent) => sum + agent.runs.reduce((inner, run) => inner + (run.costUsd ?? 0), 0),
    0
  );

  return (
    <div className="wk">
      <header className="wk-hdr">
        <div className="wk-shell wk-hdr__inner">
          <a className="wk-brand" href="/">
            <img src="/wick.svg" alt="" />
            <span className="wk-brand__name">Wick</span>
          </a>
          <span className="wk-meta wk-hdr__meta">
            {agents.length} agents on duty Â· {money(spend)} metered Â· 149 models
          </span>
          <button className="wk-btn wk-btn--ghost wk-btn--sm" onClick={() => setComposing(true)}>
            New agent
          </button>
        </div>
      </header>

      <div className="wk-app">
        <aside className="wk-rail">
          <div className="wk-rail__top">
            <span className="wk-rail__label">On duty</span>
            <button className="wk-icon-btn" title="New agent" onClick={() => setComposing(true)}>
              +
            </button>
          </div>

          <div className="wk-rail__list">
            {agents.map((agent) => {
              const last = agent.lastRun;
              return (
                <button
                  key={agent.id}
                  className="wk-agentitem"
                  data-active={agent.id === activeId}
                  onClick={() => setActiveId(agent.id)}
                >
                  <span className="wk-avatar" style={{ background: tint(agent.id) }}>
                    <img src="/wick.svg" alt="" />
                  </span>
                  <span className="wk-agentitem__text">
                    <span className="wk-agentitem__name">
                      {agent.name}
                      {!agent.enabled && <span className="wk-dot" title="paused" />}
                    </span>
                    <span className="wk-agentitem__preview">
                      {last ? spoken(last.output).replace(/\s+/g, " ").slice(0, 44) : `every ${every(agent.everyMinutes)}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {error && <div className="wk-rail__err">{error}</div>}

          <div className="wk-rail__foot">
            <span className="wk-avatar wk-avatar--me">Y</span>
            <button className="wk-connect" onClick={() => setShowConnectors((value) => !value)}>
              Connect apps
              <span className="wk-connect__count">3</span>
            </button>
          </div>

          {showConnectors && (
            <div className="wk-sheet">
              <h4>
                Connectors <span className="wk-meta">{connectors.length}</span>
              </h4>
              <p>Every toolkit Composio offers. Connect the ones your agents should be able to use.</p>
              <input
                className="wk-input wk-connector__search"
                placeholder="Search apps…"
                value={connectorQuery}
                onChange={(event) => setConnectorQuery(event.target.value)}
              />
              <div className="wk-connector__list">
                {connectors
                  .filter((connector) =>
                    connector.label.toLowerCase().includes(connectorQuery.toLowerCase())
                  )
                  .slice(0, 60)
                  .map((connector) => (
                    <div className="wk-connector" key={connector.id}>
                      <span className="wk-connector__id">
                        {connector.logo ? (
                          <img src={connector.logo} alt="" loading="lazy" />
                        ) : (
                          <span className="wk-connector__glyph" />
                        )}
                        {connector.label}
                      </span>
                      {connector.state === "live" ? (
                        <span className="wk-connector__state wk-connector__state--live">live</span>
                      ) : connector.state === "needs-auth" ? (
                        <button
                          className="wk-connector__connect"
                          onClick={() => void connect(connector.id)}
                        >
                          connect
                        </button>
                      ) : (
                        <span className="wk-connector__state" title="Needs your own developer app on Composio">
                          needs app
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </aside>

        <section className="wk-pane">
          {active ? (
            <>
              <div className="wk-pane__head">
                <div className="wk-pane__id">
                  <span className="wk-avatar" style={{ background: tint(active.id) }}>
                    <img src="/wick.svg" alt="" />
                  </span>
                  <div>
                    <div className="wk-pane__name">{active.name}</div>
                    <div className="wk-meta">
                      {active.enabled ? `every ${every(active.everyMinutes)}` : "paused"} Â·{" "}
                      {shortModel(active.model)} Â· next in{" "}
                      {Math.max(0, Math.round((Date.parse(active.nextRunAt) - Date.now()) / 60000))}m
                    </div>
                  </div>
                </div>
                <div className="wk-pane__actions">
                  <select
                    className="wk-select wk-select--sm"
                    value={active.model}
                    onChange={(event) =>
                      void post("/agents/model", { id: active.id, model: event.target.value })
                    }
                    title="Swap the model this agent runs on"
                  >
                    {[active.model, ...models.map((model) => model.id)]
                      .filter((id, index, all) => all.indexOf(id) === index)
                      .map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                  </select>
                  <button className="wk-btn wk-btn--ghost wk-btn--sm" disabled={busy} onClick={() => void post("/agents/run", { id: active.id })}>
                    {busy ? "Running" : "Run now"}
                  </button>
                  <button
                    className="wk-btn wk-btn--ghost wk-btn--sm"
                    disabled={busy}
                    onClick={() => void post("/agents/toggle", { id: active.id, enabled: !active.enabled })}
                  >
                    {active.enabled ? "Pause" : "Resume"}
                  </button>
                </div>
              </div>

              <div className="wk-thread">
                <div className="wk-job">{active.task}</div>

                {runs.length === 0 && (
                  <div className="wk-empty">No runs yet. It wakes on its own every {every(active.everyMinutes)}.</div>
                )}

                {runs.map((run, index) => {
                  const previous = runs[index - 1];
                  const newDay =
                    !previous ||
                    new Date(run.startedAt).toDateString() !== new Date(previous.startedAt).toDateString();
                  return (
                    <div key={run.id} className="wk-msg">
                      {newDay && <div className="wk-day">{dayLabel(run.startedAt)}</div>}
                      {run.prompt && (
                        <div className="wk-row-me">
                          <div className="wk-bubble wk-bubble--me">{run.prompt}</div>
                        </div>
                      )}
                      <div className="wk-row-agent">
                        <span className="wk-avatar wk-avatar--sm" style={{ background: tint(active.id) }}>
                          <img src="/wick.svg" alt="" />
                        </span>
                        <div className="wk-bubble">{run.ok ? spoken(run.output) : `Failed: ${run.error}`}</div>
                      </div>
                      <div className="wk-stamp">
                        {clock(run.startedAt)} Â· {shortModel(run.model)} Â· {(run.ms / 1000).toFixed(1)}s Â·{" "}
                        {money(run.costUsd)} Â· {run.trigger === "person" ? "you asked" : "on schedule"}
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEnd} />
              </div>

              <div className="wk-composer">
                <textarea
                  className="wk-composer__input"
                  placeholder={`Message ${active.name}`}
                  value={draft}
                  rows={1}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button className="wk-send" disabled={busy || !draft.trim()} onClick={() => void send()}>
                  â†‘
                </button>
              </div>
            </>
          ) : (
            <div className="wk-thread">
              <div className="wk-empty">No agents yet.</div>
            </div>
          )}
        </section>
      </div>

      {composing && (
        <div className="wk-modal" onClick={() => setComposing(false)}>
          <div className="wk-modal__card" onClick={(event) => event.stopPropagation()}>
            <h3>New agent</h3>
            <div className="wk-form">
              <input
                className="wk-input"
                placeholder="Name"
                value={newAgent.name}
                onChange={(event) => setNewAgent({ ...newAgent, name: event.target.value })}
              />
              <textarea
                className="wk-textarea"
                placeholder="What should it do each time it wakes up?"
                value={newAgent.task}
                onChange={(event) => setNewAgent({ ...newAgent, task: event.target.value })}
              />
              <div className="wk-form__row">
                <select
                  className="wk-select"
                  value={newAgent.model}
                  onChange={(event) => setNewAgent({ ...newAgent, model: event.target.value })}
                >
                  <option value="">pick a modelâ€¦</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                      {model.inPrice != null ? ` â€” $${model.inPrice}/$${model.outPrice} per M` : ""}
                    </option>
                  ))}
                </select>
                <select
                  className="wk-select"
                  value={newAgent.everyMinutes}
                  onChange={(event) => setNewAgent({ ...newAgent, everyMinutes: Number(event.target.value) })}
                >
                  {[1, 5, 15, 30, 60, 120, 240, 720, 1440].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      every {every(minutes)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="wk-form__row">
                <button
                  className="wk-btn wk-btn--primary"
                  disabled={!newAgent.task || !newAgent.model || busy}
                  onClick={async () => {
                    await post("/agents", {
                      name: newAgent.name || "Untitled agent",
                      task: newAgent.task,
                      model: newAgent.model,
                      everyMinutes: newAgent.everyMinutes,
                      kind: "watch",
                    });
                    setNewAgent({ name: "", task: "", model: "", everyMinutes: 30 });
                    setComposing(false);
                  }}
                >
                  Deploy
                </button>
                <button className="wk-btn wk-btn--ghost" onClick={() => setComposing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

