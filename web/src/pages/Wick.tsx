import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../wick.css";

/**
 * Wick — always-on agents, each with its own thread.
 *
 * Left: the agents on duty. Right: the conversation with the selected one, where scheduled runs
 * and anything you type both land as messages. Models and connectors are per agent.
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
  prompt?: string;
  trigger?: "schedule" | "person";
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
  hint?: string;
  model: string;
  everyMinutes: number;
  enabled: boolean;
  kind: "watch" | "treasury";
  nextRunAt: string;
  lastRun: AgentRun | null;
  runs: AgentRun[];
}

const AVATAR_COLOURS = ["#7FE3C4", "#FFB43A", "#9CC7FF", "#F5A8C8", "#C7B9FF"];
const avatarColour = (id: string) => AVATAR_COLOURS[id.length % AVATAR_COLOURS.length];

const money = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(value < 0.01 ? 6 : 4)}`;

const every = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;

const shortModel = (id: string) => id.split("/").pop() ?? id;

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The tool call that produced a run, if the agent used one. */
function toolUsed(output: string): string | null {
  const match = output.match(/^fetched:\s*(\S+)/m);
  if (match) {
    try {
      return `http_get · ${new URL(match[1]).hostname}`;
    } catch {
      return "http_get";
    }
  }
  return null;
}

function body(output: string) {
  return output.replace(/^fetched:[^\n]*\n*/m, "").trim();
}

export default function Wick() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<GatewayModel[]>([]);
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
      setError("VITE_KEEPER_URL is not set — start the keeper and rebuild.");
      return;
    }
    try {
      const [agentsResponse, modelsResponse] = await Promise.all([
        fetch(`${KEEPER_URL}/agents`),
        fetch(`${KEEPER_URL}/agents/models`),
      ]);
      if (agentsResponse.ok) {
        const list = ((await agentsResponse.json()) as { agents: Agent[] }).agents;
        setAgents(list);
        setActiveId((current) => current ?? list[0]?.id ?? null);
      }
      if (modelsResponse.ok)
        setModels(((await modelsResponse.json()) as { models: GatewayModel[] }).models);
      setError(null);
    } catch (cause) {
      setError(`keeper unreachable: ${String(cause).slice(0, 120)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

  const active = useMemo(() => agents.find((agent) => agent.id === activeId) ?? null, [agents, activeId]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [active?.runs.length, activeId]);

  const post = async (path: string, payload: unknown) => {
    if (!KEEPER_URL) return;
    setBusy(true);
    try {
      await fetch(`${KEEPER_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!active || !draft.trim()) return;
    const message = draft.trim();
    setDraft("");
    await post("/agents/run", { id: active.id, message });
  };

  const totalSpend = agents.reduce(
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
          <div className="wk-meta" style={{ marginLeft: "auto" }}>
            {agents.length} agents · {money(totalSpend)} metered · 149 models
          </div>
          <button className="wk-btn wk-btn--ghost" onClick={() => setComposing(true)}>
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

          {agents.map((agent) => (
            <button
              key={agent.id}
              className="wk-agentitem"
              data-active={agent.id === activeId}
              onClick={() => setActiveId(agent.id)}
            >
              <span className="wk-avatar" style={{ background: avatarColour(agent.id) }}>
                {agent.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="wk-agentitem__text">
                <span className="wk-agentitem__name">
                  {agent.name}
                  {!agent.enabled && <span className="wk-meta">· paused</span>}
                </span>
                <span className="wk-agentitem__preview">
                  {agent.lastRun
                    ? body(agent.lastRun.output).replace(/\s+/g, " ").slice(0, 46)
                    : `every ${every(agent.everyMinutes)} · no runs yet`}
                </span>
              </span>
            </button>
          ))}

          {error && <div className="wk-meta" style={{ color: "var(--wk-amber)" }}>{error}</div>}

          <div className="wk-rail__foot">
            <span className="wk-avatar" style={{ background: "var(--wk-cream)" }}>
              Y
            </span>
            <button className="wk-connect" onClick={() => setShowConnectors((value) => !value)}>
              Connect apps
              <span className="wk-connect__apps">
                <span title="Web">🌐</span>
                <span title="X">𝕏</span>
                <span title="Gmail">✉</span>
              </span>
            </button>
          </div>

          {showConnectors && (
            <div className="wk-sheet">
              <h4>Connectors</h4>
              <p>
                Tools an agent can call on its own. Live today: the open web. The rest are wired for
                the demo.
              </p>
              <div className="wk-connector">
                <span>🌐 Web fetch</span>
                <span className="wk-connector__state wk-connector__state--live">live</span>
              </div>
              <div className="wk-connector">
                <span>𝕏 X / Twitter</span>
                <span className="wk-connector__state wk-connector__state--soon">demo</span>
              </div>
              <div className="wk-connector">
                <span>✉ Gmail</span>
                <span className="wk-connector__state wk-connector__state--soon">demo</span>
              </div>
              <div className="wk-connector">
                <span>🗓 Calendar</span>
                <span className="wk-connector__state wk-connector__state--soon">demo</span>
              </div>
            </div>
          )}
        </aside>

        <section className="wk-pane">
          {active ? (
            <>
              <div className="wk-pane__head">
                <div className="wk-pane__id">
                  <span className="wk-avatar" style={{ background: avatarColour(active.id) }}>
                    {active.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <div className="wk-pane__name">{active.name}</div>
                    <div className="wk-meta">
                      {active.enabled ? `runs every ${every(active.everyMinutes)}` : "paused"} ·{" "}
                      {shortModel(active.model)} · next in{" "}
                      {Math.max(0, Math.round((Date.parse(active.nextRunAt) - Date.now()) / 60000))}m
                    </div>
                  </div>
                </div>
                <div className="wk-row" style={{ marginTop: 0 }}>
                  <select
                    className="wk-select"
                    value={active.model}
                    onChange={(event) =>
                      void post("/agents/model", { id: active.id, model: event.target.value })
                    }
                  >
                    {[active.model, ...models.map((model) => model.id)]
                      .filter((id, index, all) => all.indexOf(id) === index)
                      .map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                  </select>
                  <button
                    className="wk-btn wk-btn--ghost"
                    disabled={busy}
                    onClick={() => void post("/agents/run", { id: active.id })}
                  >
                    {busy ? "…" : "Run now"}
                  </button>
                  <button
                    className="wk-btn wk-btn--ghost"
                    disabled={busy}
                    onClick={() => void post("/agents/toggle", { id: active.id, enabled: !active.enabled })}
                  >
                    {active.enabled ? "Pause" : "Resume"}
                  </button>
                </div>
              </div>

              <div className="wk-thread">
                <div className="wk-bubble" style={{ borderStyle: "dashed", opacity: 0.85 }}>
                  {active.task}
                  <div className="wk-bubble__meta">
                    <span>schedule: every {every(active.everyMinutes)}</span>
                    <span>tools: web fetch</span>
                  </div>
                </div>

                {active.runs.length === 0 && (
                  <div className="wk-day">no runs yet — it will wake on its own, or say something below</div>
                )}

                {[...active.runs].reverse().map((run, index) => {
                  const tool = toolUsed(run.output);
                  const previous = [...active.runs].reverse()[index - 1];
                  const newDay =
                    !previous ||
                    new Date(run.startedAt).toDateString() !==
                      new Date(previous.startedAt).toDateString();
                  return (
                    <div key={run.id}>
                      {run.prompt && (
                        <div className="wk-bubble wk-bubble--me">
                          {run.prompt}
                          <div className="wk-bubble__meta">
                            <span>you · {clock(run.startedAt)}</span>
                          </div>
                        </div>
                      )}
                      {newDay && (
                        <div className="wk-day">
                          {new Date(run.startedAt).toLocaleDateString([], {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </div>
                      )}
                      <div className="wk-bubble">
                        {tool && <div className="wk-tool">⚡ {tool}</div>}
                        {run.ok ? body(run.output) : `failed: ${run.error}`}
                        <div className="wk-bubble__meta">
                          <span>{clock(run.startedAt)}</span>
                          <span>{shortModel(run.model)}</span>
                          <span>{(run.ms / 1000).toFixed(1)}s</span>
                          <span>{money(run.costUsd)}</span>
                          <span>{run.trigger === "person" ? "you asked" : "on schedule"}</span>
                        </div>
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
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button className="wk-send" disabled={busy || !draft.trim()} onClick={() => void send()}>
                  ↑
                </button>
              </div>
            </>
          ) : (
            <div className="wk-thread">
              <div className="wk-day">no agents yet</div>
            </div>
          )}
        </section>
      </div>

      {composing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4, 22, 28, 0.72)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            zIndex: 50,
          }}
          onClick={() => setComposing(false)}
        >
          <div
            className="wk-panel"
            style={{ width: "min(560px, 100%)", background: "var(--wk-teal-deep)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="wk-h2" style={{ fontSize: 22, marginBottom: 14 }}>
              New agent
            </h3>
            <div style={{ display: "grid", gap: 10 }}>
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
              <div className="wk-row" style={{ marginTop: 0 }}>
                <select
                  className="wk-select"
                  value={newAgent.model}
                  onChange={(event) => setNewAgent({ ...newAgent, model: event.target.value })}
                  style={{ minWidth: 260 }}
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
                  value={newAgent.everyMinutes}
                  onChange={(event) =>
                    setNewAgent({ ...newAgent, everyMinutes: Number(event.target.value) })
                  }
                >
                  {[1, 5, 15, 30, 60, 120, 240, 720, 1440].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      every {every(minutes)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="wk-row" style={{ marginTop: 4 }}>
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
