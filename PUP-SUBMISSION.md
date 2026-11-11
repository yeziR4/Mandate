# Pup: submission notes

Pup runs always-on agents. You give one a job, a schedule and a model; it wakes on its own, does
the work, and logs what the run cost. Every model call goes through Otari.

- Live: https://wick-agents.vercel.app
- Keeper (API and scheduler): https://mandate-keeper.fly.dev
- Code: `web/src/pages/Wick.tsx` (UI), `keeper/agents/service.ts` (agents), `keeper/agent/model.ts` (the Otari call)

## Rubric, and where each claim can be seen

Every row below is exercised by a starter agent that a new visitor gets on first load. Each run's
receipt in the thread names what it used, so the claims are visible on screen.

### Open-weight models (30)

| Model | Role | Where |
|---|---|---|
| DeepSeek V4 / V4.1 Flash | worker | ETH price watch, Repo brief |
| GLM 5.3 Flash | worker | AI news scout, Hiring scout |
| Qwen 3.8 Flash | worker | ETH/BTC ratio |
| Gemma 3 12B | sentinel: reads each scheduled report and decides whether to flag it | "checked by gemma-3-12b-it" on every scheduled receipt |

### Otari features (60)

| Feature | How Pup uses it | Where to see it |
|---|---|---|
| Web search or web fetch | `otari_web_search` and `otari_web_fetch` are the only way agents read the web | AI news scout ("searched the web"), ETH price watch ("read the web") |
| Code execution | `otari_code_execution` on every agent | ETH/BTC ratio: "ran code", with the code and its output under "Code it ran" |
| MCP integrations | `mcp_servers` on the request; any agent can attach an MCP server in New agent, step 2 | Repo brief: "MCP · deepwiki" |
| Model routing and fallbacks | the `pup-auto` routing policy is offered beside real models and is the default for ETH price watch | receipt: "routed to DeepSeek-V4-Flash on deepinfra" (from the `Otari-Model`, `Otari-Provider` and `Otari-Fallback` headers) |
| Multiple models in distinct roles | worker model does the job, a different model triages the report | meter panel: "Running on" and "Checked by" |
| Budgets and spending limits | a spending ceiling set in the Otari dashboard; a refused run reports that the limit was reached | Otari dashboard, Spend and budgets |

Not claimed: per-user budgets (needs a service key and an end-user budget; the keeper already
sends the visitor id as `user` when `PUP_END_USERS=1`) and guardrails (no guardrail service is
configured on the workspace).

## A five-minute demo path

1. Open the site in a fresh browser. Five pups wake and do their first runs within about 20 seconds.
2. ETH price watch: point at "routed to ... on deepinfra" and the model picker showing `pup-auto`.
3. AI news scout: "searched the web".
4. ETH/BTC ratio: open "Code it ran".
5. Repo brief: "MCP · deepwiki".
6. Meter panel: cost per run from Otari's price list, and the second model under "Checked by".
7. Swap a model on any agent and press Run now.
8. New agent, step 2: add an app, or your own API or MCP server.
9. Otari dashboard: the same requests under Overview, the routing policy, and the budget.

## Configuration

Set on the keeper (`fly.toml` and Fly secrets):

```
OTARI_BASE_URL, OTARI_API_KEY     gateway
PUP_OTARI_WEB=1                   agents use Otari's web search and fetch
PUP_ROUTES=pup-auto               routing policies offered as models
PUP_SENTINEL_MODEL                defaults to google/gemma-3-12b-it
PUP_ACTIVE_HOURS                  how long a visitor's agents keep running after a visit (default 24)
PUP_END_USERS=1                   send the visitor id as `user` (needs a service key)
```
