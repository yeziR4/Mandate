import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Always-on agents: a task, a schedule, and a model you can swap.
 *
 * The point of the page is the swap. Same agent, same task, different engine - and the cost of the
 * last run changes with it, because every call is metered by the gateway.
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
  value == null ? "—" : `$${value.toFixed(value < 0.01 ? 5 : 4)}`;

function timeAgo(iso?: string) {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", task: "", model: "", everyMinutes: 30 });

  const load = useCallback(async () => {
    if (!KEEPER_URL) {
      setError("VITE_KEEPER_URL is not set");
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
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  const post = async (path: string, body: unknown) => {
    if (!KEEPER_URL) return;
    setBusy(path);
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

  const totalSpend = useMemo(
    () =>
      agents.reduce(
        (sum, agent) => sum + (agent.runs ?? []).reduce((inner, run) => inner + (run.costUsd ?? 0), 0),
        0
      ),
    [agents]
  );

  const totalRuns = useMemo(
    () => agents.reduce((sum, agent) => sum + (agent.runs ?? []).length, 0),
    [agents]
  );

  return (
    <div className="shell" style={{ paddingTop: 28 }}>
      <div className="sectionmark">
        <span className="sectionmark__no">02</span>
        <h2>Always-on agents</h2>
      </div>

      <p className="lede" style={{ maxWidth: 760 }}>
        An agent is a job, a schedule and a model. It wakes up, does one run, records what that run
        cost, and sleeps. Change the model and the next run is priced differently — no key, no
        subscription, metered per run.
      </p>

      {error && (
        <div className="panel" style={{ marginTop: 16, padding: 16, color: "var(--dead)" }}>{error}</div>
      )}

      <div className="stats" style={{ marginTop: 18 }}>
        <div className="stat">
          <div className="stat__value">{agents.length}</div>
          <div className="stat__label">agents running</div>
        </div>
        <div className="stat">
          <div className="stat__value">{totalRuns}</div>
          <div className="stat__label">runs recorded</div>
        </div>
        <div className="stat">
          <div className="stat__value">{money(totalSpend)}</div>
          <div className="stat__label">metered spend</div>
        </div>
        <div className="stat">
          <div className="stat__value">{agents.filter((agent) => agent.due).length}</div>
          <div className="stat__label">due now</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
        {agents.map((agent) => {
          const run = agent.lastRun;
          return (
            <div className="panel" key={agent.id} style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <strong style={{ fontSize: 16 }}>{agent.name}</strong>
                    <span className={`pill${agent.enabled ? " pill--live" : ""}`}>
                      <span className="dot" />
                      {agent.enabled ? `every ${agent.everyMinutes}m` : "paused"}
                    </span>
                    {agent.kind === "treasury" && <span className="pill">policy + tools</span>}
                  </div>
                  <p style={{ margin: "8px 0 0", maxWidth: 720, opacity: 0.8 }}>{agent.task}</p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <button
                    className="pill"
                    disabled={busy !== null}
                    onClick={() => void post("/agents/run", { id: agent.id })}
                  >
                    {busy === "/agents/run" ? "running…" : "Run now"}
                  </button>
                  <button
                    className="pill"
                    onClick={() => void post("/agents/toggle", { id: agent.id, enabled: !agent.enabled })}
                  >
                    {agent.enabled ? "Pause" : "Resume"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={agent.model}
                  onChange={(event) => void post("/agents/model", { id: agent.id, model: event.target.value })}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--line-strong)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                    maxWidth: 340,
                  }}
                >
                  {[agent.model, ...models.map((model) => model.id)]
                    .filter((id, index, all) => all.indexOf(id) === index)
                    .map((id) => {
                      const model = models.find((entry) => entry.id === id);
                      return (
                        <option key={id} value={id}>
                          {id}
                          {model?.inPrice != null ? `  — $${model.inPrice}/$${model.outPrice} per M` : ""}
                        </option>
                      );
                    })}
                </select>

                <span style={{ fontFamily: "var(--mono)", fontSize: 11, opacity: 0.65 }}>
                  last run {timeAgo(agent.lastRunAt)} · {run ? `${(run.ms / 1000).toFixed(1)}s` : "—"} ·{" "}
                  {run ? money(run.costUsd) : "—"} · next in{" "}
                  {Math.max(0, Math.round((Date.parse(agent.nextRunAt) - Date.now()) / 60000))}m
                </span>
              </div>

              {run && (
                <div style={{ marginTop: 12, borderTop: "1px solid var(--line-soft)", paddingTop: 10 }}>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      opacity: 0.55,
                      marginBottom: 6,
                    }}
                  >
                    {run.ok ? "LAST RUN" : "LAST RUN FAILED"} · {run.model} · {run.promptTokens} in /{" "}
                    {run.completionTokens} out
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      lineHeight: 1.5,
                      maxHeight: open === agent.id ? "none" : 96,
                      overflow: "hidden",
                    }}
                  >
                    {run.error ?? run.output}
                  </pre>
                  <button
                    className="pill"
                    style={{ marginTop: 8 }}
                    onClick={() => setOpen(open === agent.id ? null : agent.id)}
                  >
                    {open === agent.id ? "Less" : `History (${agent.runs.length})`}
                  </button>
                  {open === agent.id && (
                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      {agent.runs.map((entry) => (
                        <div key={entry.id} style={{ fontFamily: "var(--mono)", fontSize: 11, opacity: 0.8 }}>
                          {new Date(entry.startedAt).toLocaleTimeString()} · {entry.model} ·{" "}
                          {(entry.ms / 1000).toFixed(1)}s · {money(entry.costUsd)} ·{" "}
                          {entry.output.replace(/\s+/g, " ").slice(0, 110)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel" style={{ marginTop: 20, padding: 18 }}>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", opacity: 0.55, marginBottom: 10 }}>
          NEW AGENT
        </div>
        <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
          <input
            placeholder="Name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line-strong)" }}
          />
          <textarea
            placeholder="What should it do on every run?"
            value={draft.task}
            onChange={(event) => setDraft({ ...draft, task: event.target.value })}
            rows={3}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line-strong)" }}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid var(--line-strong)",
                minWidth: 300,
              }}
            >
              <option value="">Pick a model…</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                  {model.inPrice != null ? `  — $${model.inPrice}/$${model.outPrice} per M` : ""}
                </option>
              ))}
            </select>
            <select
              value={draft.everyMinutes}
              onChange={(event) => setDraft({ ...draft, everyMinutes: Number(event.target.value) })}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line-strong)" }}
            >
              {[1, 5, 15, 30, 60, 120, 240, 720, 1440].map((minutes) => (
                <option key={minutes} value={minutes}>
                  every {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                </option>
              ))}
            </select>
            <button
              className="pill pill--live"
              disabled={!draft.task || !draft.model || busy !== null}
              onClick={async () => {
                await post("/agents", { ...draft, everyMinutes: draft.everyMinutes, kind: "watch" });
                setDraft({ name: "", task: "", model: "", everyMinutes: 30 });
              }}
            >
              Create agent
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
