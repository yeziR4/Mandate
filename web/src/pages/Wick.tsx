import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "../wick.css";

/**
 * Pup: always-on agents, each with its own thread.
 *
 * Left: the agents on duty, each a seal pup whose pose is its status.
 * Middle: the selected agent's log, where scheduled runs and anything you type both land.
 * Right: the meter, what this agent has cost through the gateway.
 *
 * Non-ASCII punctuation is written as escapes on purpose: this file has been double-encoded before.
 */

const KEEPER_URL = (import.meta.env.VITE_KEEPER_URL as string | undefined)?.replace(/\/$/, "");

const DOT = "·";
const DASH = "—";
const ELLIPSIS = "…";

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
  /** A routing policy: Otari picks the provider and falls back when one fails. */
  route?: boolean;
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
  /** What the run leaned on: "fetch", "code", "mcp:deepwiki", "web search", an app name. */
  used?: string[];
  code?: Array<{ source: string; output: string }>;
  servedBy?: { provider: string | null; model?: string | null; fallback: boolean; attempts?: number };
  /** Verdict from the sentinel, a second model that only decides whether this needs attention. */
  alert?: boolean;
  headline?: string;
  sentinelModel?: string;
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
  /** Apps this agent may use. Absent on agents made before agents chose their apps. */
  connectors?: string[];
  custom?: Array<{ kind?: "api" | "mcp"; name: string; url: string; description: string; secured: boolean }>;
}

/** An API the visitor is attaching while creating an agent. */
interface CustomDraft {
  kind: "api" | "mcp";
  name: string;
  url: string;
  description: string;
  headerName: string;
  headerValue: string;
}

const BLANK_CUSTOM: CustomDraft = { kind: "api", name: "", url: "", description: "", headerName: "", headerValue: "" };

const BLANK_AGENT = {
  name: "",
  task: "",
  model: "",
  everyMinutes: 30,
  connectors: [] as string[],
  custom: [] as CustomDraft[],
};

const MAX_APPS = 6;
const MAX_CUSTOM = 3;

const validApiUrl = (value: string) => {
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
};

interface Pending {
  agentId: string;
  message?: string;
  since: number;
}

/* ---------- formatting ---------- */

const HUES = ["#0098a4", "#ff6b57", "#7c5cff", "#f0479b", "#2f7bf6", "#ff9416"];
/** Colour by position in the roster, so neighbours never share one. */
const tones = new Map<string, string>();
const hue = (id: string) => tones.get(id) ?? HUES[0];

const money = (value: number | null | undefined) =>
  value == null ? DASH : `$${value.toFixed(value < 0.01 ? 6 : 4)}`;

const every = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;

const shortModel = (id: string) => id.split("/").pop() ?? id;
const provider = (id: string) => (id.includes("/") ? id.split("/")[0] : "");

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const price = (value: number | null) => (value == null ? DASH : `$${value}`);

const compact = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(value);

/** How one thing a run leaned on reads on its receipt. */
function usedLabel(entry: string) {
  if (entry === "fetch" || entry === "web fetch") return "read the web";
  if (entry === "web search") return "searched the web";
  if (entry === "code") return "ran code";
  if (entry.startsWith("mcp:")) return `MCP ${DOT} ${entry.slice(4)}`;
  if (entry === "your API") return "your API";
  return entry;
}

/** The run's text without the internal tool preamble. */
const spoken = (output: string) => output.replace(/^fetched:[^\n]*\n*/m, "").trim();

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function countdown(ms: number) {
  if (ms <= 0) return "due now";
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** A clock that ticks, so countdowns and wake rings move without refetching. */
function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

/* ---------- small pieces ---------- */

type Light = "on" | "off" | "busy";

/**
 * The mascot, drawn inline so each agent wears its own colour and its pose can show state:
 * asleep when paused, head up when on duty, balancing a ball while it works.
 */
function Pup({ color, light }: { color: string; light: Light }) {
  const ink = "#012f36";
  return (
    <svg className="wk-pup" data-light={light} viewBox="0 0 96 96" aria-hidden="true">
      <g className="wk-pup__body" fill={color}>
        <ellipse cx="17" cy="82" rx="11" ry="5.5" transform="rotate(-24 17 82)" />
        <ellipse cx="79" cy="82" rx="11" ry="5.5" transform="rotate(24 79 82)" />
        <ellipse cx="48" cy="82" rx="31" ry="17" />
        <ellipse cx="48" cy="48" rx="30" ry="27" />
      </g>
      <circle cx="40.5" cy="60" r="8.5" fill="#fff" opacity="0.88" />
      <circle cx="55.5" cy="60" r="8.5" fill="#fff" opacity="0.88" />
      <ellipse cx="48" cy="54.5" rx="5" ry="3.6" fill={ink} />
      <path
        d="M31 59 17 56M31 63 18 67M65 59l14-3M65 63l13 4"
        fill="none"
        stroke={ink}
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.55"
      />
      {light === "off" ? (
        <path
          d="M30 45q5 4 10 0M56 45q5 4 10 0"
          fill="none"
          stroke={ink}
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      ) : (
        <>
          <circle cx="35" cy="44" r="4.8" fill={ink} />
          <circle cx="61" cy="44" r="4.8" fill={ink} />
          <circle cx="36.6" cy="42.4" r="1.6" fill="#fff" />
          <circle cx="62.6" cy="42.4" r="1.6" fill="#fff" />
        </>
      )}
      {light === "busy" && <circle className="wk-pup__ball" cx="48" cy="11" r="9" />}
    </svg>
  );
}

/** Avatar with a ring that fills as the next wake-up approaches. */
function AgentBadge({
  agent,
  busy,
  size = "md",
  now,
}: {
  agent: Agent;
  busy: boolean;
  size?: "sm" | "md" | "lg";
  now: number;
}) {
  const span = agent.everyMinutes * 60_000;
  const left = Date.parse(agent.nextRunAt) - now;
  const progress = agent.enabled ? Math.min(1, Math.max(0, 1 - left / span)) : 0;
  const light: Light = busy ? "busy" : agent.enabled ? "on" : "off";
  return (
    <span
      className={`wk-badge wk-badge--${size}`}
      data-light={light}
      style={{ ["--wk-progress" as string]: `${Math.round(progress * 360)}deg` }}
    >
      <span className="wk-badge__face">
        <Pup color={hue(agent.id)} light={light} />
      </span>
    </span>
  );
}

/** Enough formatting to make a report readable: bullets, bold, links. Nothing else. */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(part)) {
      let label = part;
      try {
        label = new URL(part).hostname.replace(/^www\./, "");
      } catch {
        /* keep the raw text */
      }
      return (
        <a key={index} href={part} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      );
    }
    return part;
  });
}

function Report({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>
    );
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(
      heading ? (
        <p key={`h-${blocks.length}`} className="wk-report__h">
          {inline(heading[1])}
        </p>
      ) : (
        <p key={`p-${blocks.length}`}>{inline(line)}</p>
      )
    );
  }
  flush();
  return <div className="wk-report">{blocks}</div>;
}

const Icon = {
  plus: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13V3.5M3.8 7.4 8 3.2l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.5v9M11 3.5v9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  plug: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/** Searchable model list with the gateway's per-million prices beside each one. */
function ModelPicker({
  value,
  models,
  onPick,
  placeholder = "Pick a model",
  align = "right",
}: {
  value: string;
  models: GatewayModel[];
  onPick: (id: string) => void;
  placeholder?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? models.filter((model) => model.id.toLowerCase().includes(needle)) : models;
    return list.slice(0, 80);
  }, [models, query]);

  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="wk-picker" ref={root} data-open={open}>
      <button
        type="button"
        className="wk-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {value ? (
          <>
            <span className="wk-picker__provider">{provider(value)}</span>
            <span className="wk-picker__name">{shortModel(value)}</span>
          </>
        ) : (
          <span className="wk-picker__placeholder">{placeholder}</span>
        )}
        {Icon.chevron}
      </button>
      {open && (
        <div className="wk-picker__pop" data-align={align}>
          <input
            autoFocus
            className="wk-picker__search"
            placeholder={`Search ${models.length} models`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "Enter" && matches[0]) pick(matches[0].id);
            }}
          />
          <div className="wk-picker__cols">
            <span>Model</span>
            <span>in / out per 1M tokens</span>
          </div>
          <div className="wk-picker__list" role="listbox">
            {matches.map((model) => (
              <button
                type="button"
                key={model.id}
                role="option"
                aria-selected={model.id === value}
                className="wk-picker__row"
                onClick={() => pick(model.id)}
              >
                <span className="wk-picker__id">
                  <span className="wk-picker__provider">{provider(model.id)}</span>
                  {shortModel(model.id)}
                </span>
                <span className="wk-picker__price">
                  {model.route ? "route with fallback" : `${price(model.inPrice)} / ${price(model.outPrice)}`}
                </span>
              </button>
            ))}
            {matches.length === 0 && <div className="wk-picker__none">No model matches that.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** What this agent has cost, straight from the runs the keeper recorded. */
function Meter({ agent, models }: { agent: Agent; models: GatewayModel[] }) {
  const runs = useMemo(() => [...agent.runs].reverse().slice(-24), [agent.runs]);
  const costs = runs.map((run) => run.costUsd ?? 0);
  const total = costs.reduce((sum, value) => sum + value, 0);
  const average = runs.length ? total / runs.length : 0;
  const peak = Math.max(...costs, 0);
  const tokensIn = runs.reduce((sum, run) => sum + run.promptTokens, 0);
  const tokensOut = runs.reduce((sum, run) => sum + run.completionTokens, 0);
  const seconds = runs.length ? runs.reduce((sum, run) => sum + run.ms, 0) / runs.length / 1000 : 0;
  const perDay = average * (1440 / agent.everyMinutes);
  const model = models.find((entry) => entry.id === agent.model);
  const sentinel = agent.runs.find((run) => run.sentinelModel)?.sentinelModel;

  return (
    <aside className="wk-meter" aria-label="Cost meter">
      <div className="wk-meter__block">
        <div className="wk-label">Metered {DOT} {runs.length === 1 ? "last run" : `last ${runs.length} runs`}</div>
        <div className="wk-meter__total">{money(total)}</div>
        <div className="wk-bars" role="img" aria-label="Cost of each recent run">
          {runs.length === 0 && <span className="wk-bars__empty">No runs yet</span>}
          {runs.map((run) => (
            <span
              key={run.id}
              className="wk-bars__bar"
              data-ok={run.ok}
              data-person={run.trigger === "person"}
              title={`${clock(run.startedAt)} ${DOT} ${money(run.costUsd)}`}
              style={{ height: `${peak > 0 ? Math.max(8, ((run.costUsd ?? 0) / peak) * 100) : 8}%` }}
            />
          ))}
        </div>
        <div className="wk-bars__legend">
          <span>
            <i data-kind="schedule" /> on schedule
          </span>
          <span>
            <i data-kind="person" /> you asked
          </span>
        </div>
      </div>

      <dl className="wk-meter__rows">
        <div>
          <dt>Per run</dt>
          <dd>{runs.length ? money(average) : DASH}</dd>
        </div>
        <div>
          <dt>A day at this pace</dt>
          <dd>{runs.length ? money(perDay) : DASH}</dd>
        </div>
        <div>
          <dt>Typical run</dt>
          <dd>{runs.length ? `${seconds.toFixed(1)} s` : DASH}</dd>
        </div>
        <div>
          <dt>Tokens in / out</dt>
          <dd>
            {compact(tokensIn)} / {compact(tokensOut)}
          </dd>
        </div>
      </dl>

      <div className="wk-meter__block">
        <div className="wk-label">Running on</div>
        <div className="wk-meter__model">{shortModel(agent.model)}</div>
        <div className="wk-meter__price">
          {model?.route
            ? "A routing policy. Otari picks the provider and falls back if the first one fails."
            : model
              ? `${price(model.inPrice)} in ${DOT} ${price(model.outPrice)} out, per 1M tokens`
              : provider(agent.model)}
        </div>
      </div>

      {sentinel && (
        <div className="wk-meter__block">
          <div className="wk-label">Checked by</div>
          <div className="wk-meter__model">{shortModel(sentinel)}</div>
          <div className="wk-meter__price">
            A second model reads each scheduled report and decides whether to flag it.
          </div>
        </div>
      )}

      <p className="wk-meter__note">
        Every call goes through Otari. Costs are computed from its price list, not estimated.
      </p>
    </aside>
  );
}

const SCHEDULES = [5, 15, 30, 60, 240, 1440];

const STARTERS = [
  {
    name: "Price watch",
    task: "Check the ETH price in USD and flag it if it drops below $2,000.",
    everyMinutes: 30,
  },
  {
    name: "Inbox digest",
    task: "Read my unread mail and tell me which three messages need a reply today, and why.",
    everyMinutes: 240,
    connectors: ["gmail"],
  },
  {
    name: "Ratio maths",
    task: "Fetch the BTC and ETH prices in USD, then use code to work out how many ETH one BTC buys.",
    everyMinutes: 60,
  },
  {
    name: "Repo brief",
    task: "Using the DeepWiki connector, explain in two sentences what the mozilla-ai/any-llm repository is for.",
    everyMinutes: 1440,
    custom: [
      {
        kind: "mcp" as const,
        name: "DeepWiki",
        url: "https://mcp.deepwiki.com/mcp",
        description: "Answers questions about public GitHub repositories.",
        headerName: "",
        headerValue: "",
      },
    ],
  },
];

/* ---------- page ---------- */

export default function Wick() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorQuery, setConnectorQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showConnectors, setShowConnectors] = useState(false);
  const [composing, setComposing] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [newAgent, setNewAgent] = useState(BLANK_AGENT);
  const [step, setStep] = useState<1 | 2>(1);
  const [appQuery, setAppQuery] = useState("");
  const [customDraft, setCustomDraft] = useState<CustomDraft | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const now = useNow();

  const load = useCallback(async () => {
    if (!KEEPER_URL) {
      setError("This build has no keeper address (VITE_KEEPER_URL), so there is nothing to show.");
      setLoaded(true);
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
    } catch {
      setError("Can't reach the keeper right now. Retrying every few seconds.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

  agents.forEach((agent, index) => tones.set(agent.id, HUES[index % HUES.length]));

  const active = useMemo(
    () => agents.find((agent) => agent.id === activeId) ?? null,
    [agents, activeId]
  );

  const runs = useMemo(() => (active ? [...active.runs].reverse() : []), [active]);
  const working = pending && active && pending.agentId === active.id ? pending : null;

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [runs.length, activeId, working]);

  useEffect(() => {
    if (!composing && !showConnectors) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeComposer();
      setShowConnectors(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [composing, showConnectors]);

  /** Returns null when it worked, otherwise the reason it did not. */
  const post = async (path: string, payload: unknown): Promise<string | null> => {
    if (!KEEPER_URL) return "No keeper address is configured.";
    setBusy(true);
    try {
      const response = await fetch(`${KEEPER_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wick-user": VISITOR },
        body: JSON.stringify(payload),
      });
      let failure: string | null = null;
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        failure = body.error ?? "The keeper refused that.";
      }
      await load();
      return failure;
    } catch {
      return "Can't reach the keeper right now.";
    } finally {
      setBusy(false);
    }
  };

  const closeComposer = () => {
    setComposing(false);
    setStep(1);
    setAppQuery("");
    setCustomDraft(null);
    setCreateError(null);
  };

  const createAgent = async () => {
    setCreateError(null);
    const failure = await post("/agents", {
      name: newAgent.name || "Untitled agent",
      task: newAgent.task,
      model: newAgent.model,
      everyMinutes: newAgent.everyMinutes,
      kind: "watch",
      connectors: newAgent.connectors,
      custom: newAgent.custom.map((api) => ({
        kind: api.kind,
        name: api.name.trim(),
        url: api.url.trim(),
        description: api.description.trim(),
        ...(api.headerValue.trim() && (api.kind === "mcp" || api.headerName.trim())
          ? { header: { name: api.headerName.trim() || "Authorization", value: api.headerValue.trim() } }
          : {}),
      })),
    });
    if (failure) {
      setCreateError(failure);
      return;
    }
    setNewAgent(BLANK_AGENT);
    closeComposer();
  };

  const toggleApp = (id: string) =>
    setNewAgent((current) => ({
      ...current,
      connectors: current.connectors.includes(id)
        ? current.connectors.filter((entry) => entry !== id)
        : current.connectors.length < MAX_APPS
          ? [...current.connectors, id]
          : current.connectors,
    }));

  /** Run the agent, showing it awake in the thread while the keeper works. */
  const run = async (agentId: string, message?: string) => {
    if (busy) return;
    setPending({ agentId, message, since: Date.now() });
    try {
      await post("/agents/run", message ? { id: agentId, message } : { id: agentId });
    } finally {
      setPending(null);
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
    await run(active.id, message);
  };

  const spend = agents.reduce(
    (sum, agent) => sum + agent.runs.reduce((inner, entry) => inner + (entry.costUsd ?? 0), 0),
    0
  );
  const onDuty = agents.filter((agent) => agent.enabled).length;
  const live = connectors.filter((connector) => connector.state === "live");

  const shownConnectors = useMemo(() => {
    const needle = connectorQuery.trim().toLowerCase();
    const rank = { live: 0, "needs-auth": 1, "needs-app": 2 } as const;
    return connectors
      .filter((connector) => connector.label.toLowerCase().includes(needle))
      .sort((a, b) => rank[a.state] - rank[b.state])
      .slice(0, 60);
  }, [connectors, connectorQuery]);

  const pickable = useMemo(() => {
    const needle = appQuery.trim().toLowerCase();
    return connectors
      .filter((connector) => connector.id !== "web" && connector.label.toLowerCase().includes(needle))
      .slice(0, 30);
  }, [connectors, appQuery]);

  const appLabel = (id: string) => connectors.find((connector) => connector.id === id)?.label ?? id;

  /** Apps picked for the new agent that this browser has not authorised yet. */
  const unconnected = newAgent.connectors
    .map((id) => connectors.find((connector) => connector.id === id))
    .filter((connector): connector is Connector => Boolean(connector) && connector!.state === "needs-auth");

  const untilWake = active ? Date.parse(active.nextRunAt) - now : 0;

  return (
    <div className="wk" data-rail={railOpen}>
      <aside className="wk-rail">
        <div className="wk-rail__brand">
          <Link className="wk-brand" to="/">
            <img src="/pup.svg" alt="" />
            <span className="wk-brand__name">Pup</span>
          </Link>
          <button className="wk-iconbtn wk-rail__close" aria-label="Close agent list" onClick={() => setRailOpen(false)}>
            {Icon.close}
          </button>
        </div>

        <div className="wk-rail__head">
          <span className="wk-label">
            {onDuty} of {agents.length} on duty
          </span>
          <button className="wk-iconbtn" aria-label="New agent" title="New agent" onClick={() => setComposing(true)}>
            {Icon.plus}
          </button>
        </div>

        <nav className="wk-rail__list" aria-label="Agents">
          {agents.map((agent) => {
            const last = agent.lastRun;
            const isBusy = pending?.agentId === agent.id;
            const left = Date.parse(agent.nextRunAt) - now;
            return (
              <button
                key={agent.id}
                className="wk-agent"
                data-active={agent.id === activeId}
                data-paused={!agent.enabled}
                onClick={() => {
                  setActiveId(agent.id);
                  setRailOpen(false);
                }}
              >
                <AgentBadge agent={agent} busy={isBusy} now={now} />
                <span className="wk-agent__text">
                  <span className="wk-agent__top">
                    <span className="wk-agent__name">{agent.name}</span>
                    <span className="wk-agent__when">
                      {isBusy ? "working" : agent.enabled ? countdown(left) : "paused"}
                    </span>
                  </span>
                  <span className="wk-agent__preview">
                    {last?.alert && <span className="wk-flagdot" title="Flagged for your attention" />}
                    {last
                      ? last.headline ||
                        spoken(last.output).replace(/[*#]/g, "").replace(/\s+/g, " ").replace(/^- /, "")
                      : `Wakes every ${every(agent.everyMinutes)}`}
                  </span>
                </span>
              </button>
            );
          })}
          {loaded && agents.length === 0 && !error && (
            <p className="wk-rail__none">No agents yet. Give the first one a job.</p>
          )}
        </nav>

        {error && <div className="wk-rail__err">{error}</div>}

        <div className="wk-rail__foot">
          <button className="wk-apps" onClick={() => setShowConnectors(true)}>
            <span className="wk-apps__icon">{Icon.plug}</span>
            <span className="wk-apps__text">
              <span>Connect apps</span>
              <span className="wk-apps__sub">
                {live.length > 0 ? `${live.length} connected` : "Gmail, Slack, Notion and more"}
              </span>
            </span>
            {live.length > 0 && (
              <span className="wk-apps__logos">
                {live.slice(0, 3).map((connector) =>
                  connector.logo ? <img key={connector.id} src={connector.logo} alt="" /> : null
                )}
              </span>
            )}
          </button>
          <div className="wk-ledger">
            <span>
              <b>{money(spend)}</b> metered
            </span>
            <span>{models.length > 0 ? `${models.length} models` : ""}</span>
          </div>
          <div className="wk-built">Built on Otari</div>
        </div>
      </aside>

      <div className="wk-scrim" onClick={() => setRailOpen(false)} />

      <main className="wk-main">
        {active ? (
          <>
            <header className="wk-head">
              <button className="wk-iconbtn wk-head__menu" aria-label="Show agents" onClick={() => setRailOpen(true)}>
                {Icon.menu}
              </button>
              <AgentBadge agent={active} busy={Boolean(working)} size="lg" now={now} />
              <div className="wk-head__id">
                <h1 className="wk-head__name">{active.name}</h1>
                <div className="wk-head__status" data-state={working ? "busy" : active.enabled ? "on" : "off"}>
                  <span className="wk-pulse" />
                  {working ? (
                    "Awake and working"
                  ) : active.enabled ? (
                    <>
                      Wakes every {every(active.everyMinutes)} {DOT} next in{" "}
                      <span className="wk-num">{countdown(untilWake)}</span>
                    </>
                  ) : (
                    "Paused. It will not wake until you resume it."
                  )}
                </div>
              </div>
              <div className="wk-head__actions">
                <ModelPicker
                  value={active.model}
                  models={models}
                  onPick={(id) => void post("/agents/model", { id: active.id, model: id })}
                />
                <button
                  className="wk-btn"
                  disabled={busy}
                  onClick={() => void post("/agents/toggle", { id: active.id, enabled: !active.enabled })}
                >
                  {active.enabled ? Icon.pause : Icon.play}
                  {active.enabled ? "Pause" : "Resume"}
                </button>
                <button className="wk-btn wk-btn--lit" disabled={busy} onClick={() => void run(active.id)}>
                  {Icon.play}
                  {working ? "Running" : "Run now"}
                </button>
              </div>
            </header>

            <div className="wk-body">
              <section className="wk-thread" aria-label={`${active.name} log`}>
                <div className="wk-thread__inner">
                  <div className="wk-order">
                    <span className="wk-label">Standing order</span>
                    <p>{active.task}</p>
                    <div className="wk-chips wk-order__apps">
                      <span className="wk-label">Can use</span>
                      <span className="wk-chip">Web</span>
                      {(active.connectors ?? []).map((id) => (
                        <span className="wk-chip" key={id}>
                          {appLabel(id)}
                        </span>
                      ))}
                      {(active.custom ?? []).map((api) => (
                        <span className="wk-chip" data-custom="true" key={api.name} title={api.url}>
                          {api.kind === "mcp" ? `MCP ${DOT} ${api.name}` : api.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {runs.length === 0 && !working && (
                    <div className="wk-empty">
                      <Pup color={hue(active.id)} light={active.enabled ? "on" : "off"} />
                      <p>
                        Nothing logged yet. It wakes on its own every {every(active.everyMinutes)}, or press Run now
                        to see it work.
                      </p>
                    </div>
                  )}

                  <ol className="wk-log">
                    {runs.map((entry, index) => {
                      const previous = runs[index - 1];
                      const newDay =
                        !previous ||
                        new Date(entry.startedAt).toDateString() !== new Date(previous.startedAt).toDateString();
                      const latest = index === runs.length - 1 && !working;
                      return (
                        <li key={entry.id} className="wk-entry" data-latest={latest} data-ok={entry.ok} data-alert={entry.alert === true}>
                          {newDay && <div className="wk-day">{dayLabel(entry.startedAt)}</div>}
                          {entry.prompt && (
                            <div className="wk-ask">
                              <div className="wk-ask__bubble">{entry.prompt}</div>
                            </div>
                          )}
                          <div className="wk-entry__row">
                            <time className="wk-entry__time">{clock(entry.startedAt)}</time>
                            <span className="wk-entry__node" />
                            <div className="wk-entry__body">
                              {entry.alert && <span className="wk-flag">Flagged for you</span>}
                              {entry.ok ? (
                                <Report text={spoken(entry.output)} />
                              ) : (
                                <div className="wk-report wk-report--failed">
                                  <p>This run failed. {entry.error}</p>
                                </div>
                              )}
                              <div className="wk-receipt">
                                <span className="wk-receipt__cost">{money(entry.costUsd)}</span>
                                <span>{shortModel(entry.model)}</span>
                                <span>{(entry.ms / 1000).toFixed(1)} s</span>
                                <span>
                                  {compact(entry.promptTokens + entry.completionTokens)} tokens
                                </span>
                                <span>{entry.trigger === "person" ? "you asked" : "on schedule"}</span>
                              </div>
                              {(entry.used?.length || entry.servedBy?.provider || entry.sentinelModel) && (
                                <div className="wk-used">
                                  {(entry.used ?? []).map((item) => (
                                    <span className="wk-used__tag" key={item} data-kind={item.split(":")[0]}>
                                      {usedLabel(item)}
                                    </span>
                                  ))}
                                  {entry.servedBy?.provider && (
                                    <span className="wk-used__note">
                                      {entry.model.includes("/") ? "served by " : `routed to ${entry.servedBy.model ?? "a model"} on `}
                                      {entry.servedBy.provider}
                                      {entry.servedBy.fallback ? " after a fallback" : ""}
                                    </span>
                                  )}
                                  {entry.sentinelModel && (
                                    <span className="wk-used__note">checked by {shortModel(entry.sentinelModel)}</span>
                                  )}
                                </div>
                              )}
                              {entry.code?.map((block, position) => (
                                <details className="wk-code" key={position}>
                                  <summary>Code it ran</summary>
                                  <pre>{block.source}</pre>
                                  {block.output && <pre className="wk-code__out">{block.output}</pre>}
                                </details>
                              ))}
                            </div>
                          </div>
                        </li>
                      );
                    })}

                    {working && (
                      <li className="wk-entry wk-entry--working" data-latest="true">
                        {working.message && (
                          <div className="wk-ask">
                            <div className="wk-ask__bubble">{working.message}</div>
                          </div>
                        )}
                        <div className="wk-entry__row">
                          <time className="wk-entry__time">now</time>
                          <span className="wk-entry__node" />
                          <div className="wk-entry__body">
                            <div className="wk-working">
                              <span className="wk-working__dots">
                                <i />
                                <i />
                                <i />
                              </span>
                              Awake on {shortModel(active.model)}
                              <span className="wk-num">
                                {Math.max(0, Math.floor((now - working.since) / 1000))} s
                              </span>
                            </div>
                          </div>
                        </div>
                      </li>
                    )}
                  </ol>
                  <div ref={threadEnd} />
                </div>
              </section>

              <Meter agent={active} models={models} />
            </div>

            <div className="wk-composer">
              <div className="wk-composer__box">
                <textarea
                  id="wk-message"
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
                <button
                  className="wk-send"
                  aria-label="Send"
                  disabled={busy || !draft.trim()}
                  onClick={() => void send()}
                >
                  {Icon.send}
                </button>
              </div>
              <div className="wk-composer__hint">
                Ask a question or hand it a one-off job {DOT} each message is one metered run
              </div>
            </div>
          </>
        ) : (
          <div className="wk-blank">
            <button className="wk-iconbtn wk-head__menu" aria-label="Show agents" onClick={() => setRailOpen(true)}>
              {Icon.menu}
            </button>
            <Pup color={HUES[0]} light={loaded ? "off" : "busy"} />
            {!loaded ? (
              <p>Waking the pups{ELLIPSIS}</p>
            ) : error ? (
              <p>{error}</p>
            ) : (
              <>
                <h1>Give an agent a job.</h1>
                <p>It wakes on a schedule, does the work, and logs what each run cost.</p>
                <button className="wk-btn wk-btn--lit" onClick={() => setComposing(true)}>
                  {Icon.plus}
                  New agent
                </button>
              </>
            )}
          </div>
        )}
      </main>

      {showConnectors && (
        <div className="wk-modal" onClick={() => setShowConnectors(false)}>
          <div className="wk-dialog wk-dialog--apps" role="dialog" aria-label="Connect apps" onClick={(event) => event.stopPropagation()}>
            <div className="wk-dialog__head">
              <div>
                <h2>Connect apps</h2>
                <p>Agents can only use the accounts you connect in this browser.</p>
              </div>
              <button className="wk-iconbtn" aria-label="Close" onClick={() => setShowConnectors(false)}>
                {Icon.close}
              </button>
            </div>
            <input
              id="wk-app-search"
              autoFocus
              className="wk-input"
              placeholder={`Search ${connectors.length} apps`}
              value={connectorQuery}
              onChange={(event) => setConnectorQuery(event.target.value)}
            />
            <div className="wk-applist">
              {shownConnectors.map((connector) => (
                <div className="wk-app" key={connector.id} data-state={connector.state}>
                  {connector.logo ? (
                    <img src={connector.logo} alt="" loading="lazy" />
                  ) : (
                    <span className="wk-app__glyph">{connector.label.slice(0, 1)}</span>
                  )}
                  <span className="wk-app__name">{connector.label}</span>
                  {connector.state === "live" ? (
                    <span className="wk-app__state">Connected</span>
                  ) : connector.state === "needs-auth" ? (
                    <button className="wk-app__connect" onClick={() => void connect(connector.id)}>
                      Connect
                    </button>
                  ) : (
                    <span className="wk-app__state" title="Needs your own developer app on Composio">
                      Needs your own app
                    </span>
                  )}
                </div>
              ))}
              {shownConnectors.length === 0 && <p className="wk-applist__none">No app matches that.</p>}
            </div>
          </div>
        </div>
      )}

      {composing && (
        <div className="wk-modal" onClick={closeComposer}>
          <div className="wk-dialog" role="dialog" aria-label="New agent" onClick={(event) => event.stopPropagation()}>
            <div className="wk-dialog__head">
              <div>
                <div className="wk-label">Step {step} of 2</div>
                <h2>{step === 1 ? "New agent" : "What can it reach?"}</h2>
                <p>
                  {step === 1
                    ? "Write the job the way you would brief a person."
                    : "Every agent can read the web. Add apps or your own API if the job needs them."}
                </p>
              </div>
              <button className="wk-iconbtn" aria-label="Close" onClick={closeComposer}>
                {Icon.close}
              </button>
            </div>

            {step === 1 ? (
              <>
                <div className="wk-starters">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter.name}
                      type="button"
                      className="wk-starter"
                      onClick={() => setNewAgent({ ...newAgent, connectors: [], custom: [], ...starter })}
                    >
                      {starter.name}
                    </button>
                  ))}
                </div>

                <div className="wk-form">
                  <label className="wk-field">
                    <span className="wk-label">Name</span>
                    <input
                      id="wk-new-name"
                      className="wk-input"
                      placeholder="Price watch"
                      value={newAgent.name}
                      onChange={(event) => setNewAgent({ ...newAgent, name: event.target.value })}
                    />
                  </label>
                  <label className="wk-field">
                    <span className="wk-label">Standing order</span>
                    <textarea
                      id="wk-new-task"
                      className="wk-input wk-input--area"
                      placeholder="What should it do each time it wakes up?"
                      value={newAgent.task}
                      onChange={(event) => setNewAgent({ ...newAgent, task: event.target.value })}
                    />
                  </label>
                  <div className="wk-field">
                    <span className="wk-label">Wakes every</span>
                    <div className="wk-seg" role="radiogroup" aria-label="Schedule">
                      {SCHEDULES.map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          role="radio"
                          aria-checked={newAgent.everyMinutes === minutes}
                          className="wk-seg__opt"
                          onClick={() => setNewAgent({ ...newAgent, everyMinutes: minutes })}
                        >
                          {every(minutes)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="wk-field">
                    <span className="wk-label">Model</span>
                    <ModelPicker
                      value={newAgent.model}
                      models={models}
                      align="left"
                      onPick={(id) => setNewAgent({ ...newAgent, model: id })}
                    />
                  </div>
                </div>

                <div className="wk-dialog__foot">
                  <button className="wk-btn" onClick={closeComposer}>
                    Cancel
                  </button>
                  <button
                    className="wk-btn wk-btn--lit"
                    disabled={!newAgent.task.trim() || !newAgent.model}
                    onClick={() => setStep(2)}
                  >
                    Next: apps
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="wk-form">
                  <div className="wk-field">
                    <span className="wk-label">This agent can use</span>
                    <div className="wk-chips">
                      <span className="wk-chip">Web</span>
                      {newAgent.connectors.map((id) => (
                        <span className="wk-chip" key={id}>
                          {appLabel(id)}
                          <button type="button" aria-label={`Remove ${appLabel(id)}`} onClick={() => toggleApp(id)}>
                            {Icon.close}
                          </button>
                        </span>
                      ))}
                      {newAgent.custom.map((api, index) => (
                        <span className="wk-chip" data-custom="true" key={`${api.name}-${index}`}>
                          {api.name}
                          <button
                            type="button"
                            aria-label={`Remove ${api.name}`}
                            onClick={() =>
                              setNewAgent({
                                ...newAgent,
                                custom: newAgent.custom.filter((_, position) => position !== index),
                              })
                            }
                          >
                            {Icon.close}
                          </button>
                        </span>
                      ))}
                    </div>
                    {unconnected.map((connector) => (
                      <div className="wk-notice" key={connector.id}>
                        <span>{connector.label} is not connected in this browser yet.</span>
                        <button type="button" className="wk-app__connect" onClick={() => void connect(connector.id)}>
                          Connect {connector.label}
                        </button>
                      </div>
                    ))}
                  </div>

                  {customDraft ? (
                    <div className="wk-custom">
                      <div className="wk-custom__title">Your own connector</div>
                      <div className="wk-seg" role="radiogroup" aria-label="Connector type">
                        {(["api", "mcp"] as const).map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            role="radio"
                            aria-checked={customDraft.kind === kind}
                            className="wk-seg__opt"
                            onClick={() => setCustomDraft({ ...customDraft, kind })}
                          >
                            {kind === "api" ? "HTTPS API" : "MCP server"}
                          </button>
                        ))}
                      </div>
                      <div className="wk-custom__grid">
                        <label className="wk-field">
                          <span className="wk-label">Name</span>
                          <input
                            id="wk-api-name"
                            autoFocus
                            className="wk-input"
                            placeholder="Orders API"
                            value={customDraft.name}
                            onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })}
                          />
                        </label>
                        <label className="wk-field">
                          <span className="wk-label">{customDraft.kind === "mcp" ? "Server address" : "Base address"}</span>
                          <input
                            id="wk-api-url"
                            className="wk-input"
                            placeholder={customDraft.kind === "mcp" ? "https://mcp.example.com/mcp" : "https://api.example.com/v1"}
                            value={customDraft.url}
                            onChange={(event) => setCustomDraft({ ...customDraft, url: event.target.value })}
                          />
                        </label>
                      </div>
                      <label className="wk-field">
                        <span className="wk-label">What the agent should use it for</span>
                        <input
                          id="wk-api-what"
                          className="wk-input"
                          placeholder="Look up open orders and their status"
                          value={customDraft.description}
                          onChange={(event) => setCustomDraft({ ...customDraft, description: event.target.value })}
                        />
                      </label>
                      <div className="wk-custom__grid" data-kind={customDraft.kind}>
                        <label className="wk-field" hidden={customDraft.kind === "mcp"}>
                          <span className="wk-label">Header name (optional)</span>
                          <input
                            id="wk-api-header"
                            className="wk-input"
                            placeholder="Authorization"
                            value={customDraft.headerName}
                            onChange={(event) => setCustomDraft({ ...customDraft, headerName: event.target.value })}
                          />
                        </label>
                        <label className="wk-field">
                          <span className="wk-label">
                            {customDraft.kind === "mcp" ? "Access token (optional)" : "Header value"}
                          </span>
                          <input
                            id="wk-api-secret"
                            type="password"
                            autoComplete="off"
                            className="wk-input"
                            placeholder="Bearer ..."
                            value={customDraft.headerValue}
                            onChange={(event) => setCustomDraft({ ...customDraft, headerValue: event.target.value })}
                          />
                        </label>
                      </div>
                      <p className="wk-custom__note">
                        {customDraft.kind === "mcp"
                          ? "Otari connects to the server itself and lets the agent call its tools. A token is kept on the server and never shown again."
                          : "Read-only: the agent can fetch any path under this address. A header is kept on the server and never shown again."}
                      </p>
                      <div className="wk-dialog__foot">
                        <button type="button" className="wk-btn" onClick={() => setCustomDraft(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="wk-btn wk-btn--lit"
                          disabled={!customDraft.name.trim() || !validApiUrl(customDraft.url)}
                          onClick={() => {
                            setNewAgent({ ...newAgent, custom: [...newAgent.custom, customDraft] });
                            setCustomDraft(null);
                          }}
                        >
                          Add connector
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <input
                        id="wk-new-app-search"
                        className="wk-input"
                        placeholder={`Search ${connectors.length} apps`}
                        value={appQuery}
                        onChange={(event) => setAppQuery(event.target.value)}
                      />
                      <div className="wk-applist wk-applist--pick">
                        {pickable.map((connector) => {
                          const added = newAgent.connectors.includes(connector.id);
                          return (
                            <div className="wk-app" key={connector.id} data-state={connector.state}>
                              {connector.logo ? (
                                <img src={connector.logo} alt="" loading="lazy" />
                              ) : (
                                <span className="wk-app__glyph">{connector.label.slice(0, 1)}</span>
                              )}
                              <span className="wk-app__name">{connector.label}</span>
                              {connector.state === "live" && <span className="wk-app__state">Connected</span>}
                              {connector.state === "needs-app" ? (
                                <span className="wk-app__state" title="Needs your own developer app on Composio">
                                  Needs your own app
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="wk-app__connect"
                                  data-added={added}
                                  disabled={!added && newAgent.connectors.length >= MAX_APPS}
                                  onClick={() => toggleApp(connector.id)}
                                >
                                  {added ? "Added" : "Add"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {pickable.length === 0 && <p className="wk-applist__none">No app matches that.</p>}
                      </div>
                      <button
                        type="button"
                        className="wk-linkbtn"
                        disabled={newAgent.custom.length >= MAX_CUSTOM}
                        onClick={() => setCustomDraft(BLANK_CUSTOM)}
                      >
                        {Icon.plus}
                        Add your own API or MCP server
                      </button>
                    </>
                  )}
                </div>

                {createError && <div className="wk-dialog__error">{createError}</div>}

                {!customDraft && (
                  <div className="wk-dialog__foot">
                    <button className="wk-btn" onClick={() => setStep(1)}>
                      Back
                    </button>
                    <button className="wk-btn wk-btn--lit" disabled={busy} onClick={() => void createAgent()}>
                      Put it on duty
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
