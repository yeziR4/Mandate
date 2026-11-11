# Wick — handoff

Everything another engineer (or agent) needs to work on this repo without re-deriving it.

Read this file first. It contains the traps that cost us a day.

---

## What this is

**Wick** is a product for always-on agents. You give an agent a job, a schedule and a model. It
wakes up on its own, does the work with tools, records what the run cost, and writes the result into
its own thread. The model is a setting you can swap per agent; every call is metered through
[Otari](https://otari.ai) and the cost shown is computed from Otari's own price list.

The same repo also contains **Mandate**, the earlier adversarial-benchmark project (on-chain
treasury arena on Metis). It still lives at `/board`, `/study`, `/methodology` and `/certificates`.
The research code is real and is referenced below, but the front door is Wick.

---

## Run it locally

```bash
# 1. config (gitignored; never commit)
cp .env.mandate.example .env.mandate   # then fill in the keys
#   OTARI_BASE_URL=https://otari.ai/api/v1
#   OTARI_API_KEY=...            # model calls
#   COMPOSIO_API_KEY=...         # connector layer (optional; falls back to IMAP)
#   COMPOSIO_USER_ID=wick-demo   # fallback identity when a browser sends none

# 2. keeper (API + agent scheduler) on :8791
npm run keeper

# 3. site on :4321
cd web && npm install
VITE_KEEPER_URL=http://localhost:8791 npm run dev
```

TypeScript is run straight from source with `node --experimental-strip-types`. There is no build
step for the keeper, and **no TypeScript syntax that strip-only mode rejects** — no enums, no
decorators, no constructor parameter properties (`constructor(private x)` fails at runtime).

`npm run typecheck` runs `tsc --noEmit` over the whole repo. Keep it at zero.

---

## How it fits together

```
web/                     React + Vite site (routes: / , /board, /study, /methodology, /certificates)
  src/pages/Wick.tsx     the product: agent rail + thread + composer        <- most of the UI
  src/wick.css           all styling for Wick (scoped under .wk)
  public/wick.svg        mascot

keeper/
  server.ts              HTTP surface (node:http, no framework). Routes below.
  config.ts              env loading, arena config, keeper signer
  chat.ts                single model call used by the research side (streaming, retries)
  judge.ts               rubric + LLM judging (research only; the product does not judge)
  store.ts               transcript storage for the Mandate arena

  agents/                the PRODUCT runtime
    service.ts           agent records, scheduler, runOnce(), cost accounting
    composio.ts          connector layer: tool schemas + execution + per-user OAuth links
    gmail.ts             fallback read-only IMAP connector
    models.ts            gateway catalogue for the model picker (filters non-chat models)

  agent/                 the agent loop (used by watch/treasury runs and the duel)
    model.ts             one model call with tools, streaming, tool-call assembly
    tools.ts             tool definitions + executor + ledger
    loop.ts              model -> tool -> observe -> repeat
    session.ts           a session that survives across messages (attack rounds)
    scenarios.ts         policy texts + treasury fixtures
    verdict.ts           mechanical verdict from the ledger (no judge)

  scripts/               research + ops tools (see "Scripts" below)

data/
  agents.json            agent records (committed as a seed; rewritten at runtime)
  runs.json              run history (gitignored)
```

### Request flow

1. Browser sends `x-wick-user: wick_xxxx` (created in `localStorage`) on every keeper call.
2. `GET /agents` returns each agent with its last runs and next due time.
3. `POST /agents/run {id, message?}` runs the agent once. If `message` is present the run is
   attributed to the person (`trigger: "person"`), otherwise it is a scheduled run.
4. The keeper calls the model through Otari, the model calls tools, tools execute, and the result is
   stored in `data/runs.json` with tokens and a cost computed from Otari's catalogue.
5. The scheduler (`startScheduler`, 20s tick) picks up any agent whose `everyMinutes` has elapsed.

### Keeper routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness + arena/config summary |
| GET | `/agents` | all agents, last runs, due state |
| POST | `/agents` | create (`name, task, model, everyMinutes, kind`) |
| POST | `/agents/run` | run now (`id`, optional `message`) |
| POST | `/agents/model` | swap model (`id, model`) |
| POST | `/agents/toggle` | pause/resume (`id, enabled`) |
| POST | `/agents/delete` | remove (`id`) |
| GET | `/agents/models` | chat models + per-million prices |
| GET | `/agents/connectors` | Connector state **for the caller's user id** |
| POST | `/agents/connectors/link` | OAuth link for a toolkit (`toolkit`) |
| GET/POST | `/transcripts`, `/attempts`, `/review`, `/transcript/:id` | legacy Mandate arena |

---

## Traps that cost real time

**1. Streaming is mandatory.** A non-streamed completion that has not started returning within
~30 seconds is killed by the gateway edge with an HTML `504`. It looks exactly like a model outage.
`keeper/agent/model.ts` and `keeper/chat.ts` both stream and use an **idle** timeout that resets on
every chunk rather than a total-duration timeout. Do not "simplify" this back to a plain `fetch`.

**2. Keep tool schemas short.** Composio exposes 60+ tools per toolkit; a model given that many
picks badly. `keeper/agents/composio.ts` curates a handful per toolkit. Add deliberately.

**3. Agent prompts must forbid plumbing talk.** Early prompts said "report what you did and what
you'd do next", and the models dutifully wrote about HTTP statuses and truncation. The watch prompt
in `keeper/agents/service.ts` now forbids mentioning tools, requests, truncation or next steps.

**4. The card shows `task`; the model gets `task + hint`.** `hint` carries exact URLs and output
format and is never rendered. Keep that split.

**5. Per-visitor identity.** `x-wick-user` decides whose Composio connections are used. Never fall
back to a shared identity for a real user; the fallback only exists for CLI work.

**6. Composio needs an auth config, not a toolkit slug.** `/connected_accounts/link` requires
`auth_config_id`. `authConfigFor()` looks one up and creates a managed one on first use. X/Twitter
has **no** Composio-managed credentials — it needs your own developer app, which is why it is
labelled `needs-app`.

---

## Deploy

### Keeper → Fly

```bash
fly secrets set OTARI_BASE_URL=... OTARI_API_KEY=... COMPOSIO_API_KEY=... AGENTS_ENABLED=1
fly deploy
```

App: `mandate-keeper`, region `ams`, volume `keeper_data` mounted at `/app/data`.
`Dockerfile.keeper` must copy `mandate/scenarios/` — the agent runtime reads those at boot and the
container exits on import if they are missing. First boot seeds the demo agents (`seedAgents`).

### Site → Vercel

**The project builds from the repo root, where `package.json` is the keeper's and has no build
script.** A dashboard "Redeploy" therefore produces an empty output and 404s production. This has
happened twice; do not press Redeploy.

```bash
npm run deploy:web      # builds web/ against the Fly keeper, then deploys the output
```

Project: `wick` (team `hassanyezir2002-8751s-projects`).
Public URL: **https://wick-agents.vercel.app** — an **alias pinned to a specific deployment**, so
after any deploy re-point it:

```bash
npx vercel alias set <new-production-url> wick-agents.vercel.app
```

To make the dashboard work instead: set Root Directory `web`, Framework `Vite`, Output `dist`,
Node `22.x`, add `VITE_KEEPER_URL`, and **connect the Git repo** (the project currently has no Git
connection, so pushes never trigger builds). `vercel.json` at the root already pins the build.

---

## Scripts

Research (Mandate benchmark):
`duel.mjs` attacker×defender matrix · `collate.mjs` one dataset · `rejudge.mjs` rescore saved
transcripts · `audit-control.mjs` calibrate the break detector · `judge-agreement.mjs` kappa across
judges · `replicates.mjs` run-to-run stability · `probe.mjs` gateway model survey.

Ops: `deploy-web.mjs` ship the site · `fix-encoding.mjs` repair double-encoded punctuation ·
`composio-*.mjs` inspect connectors.

---

## Where the project actually stands

- Product works end to end: agents run on schedule, cost is metered, models swap per agent,
  connectors are per-visitor.
- Gmail reads real mail through Composio once a visitor connects; IMAP is the fallback.
- No notifications. Runs accumulate in the thread; nothing is emailed or pushed.
- X/Twitter cannot connect without your own developer app on Composio.
- The Mandate research (`/study`) is intact: 83 cells, 325 verdicts, mechanical verdicts from the
  ledger, with the docs in `keeper/OTARI-*.md` and `mandate/CRITERIA.md`.

## If you are picking this up cold

1. `npm run typecheck` — get to zero before changing anything.
2. Run keeper + web locally, press **Run now**, then **Connect apps → Gmail**.
3. Read `keeper/agents/service.ts` (the product) before `keeper/duel`-adjacent research code.
4. Do not commit `.env.mandate`, do not press Redeploy, do not un-stream the model calls.
