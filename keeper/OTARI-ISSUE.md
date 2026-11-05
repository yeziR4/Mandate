# Otari issue — filled into their bug-report template

File at: **https://github.com/mozilla-ai/otari/issues/new?template=bug_report.yml**

Select **Bug report**, then paste the title and the body below. The template fields are all
filled in, including the ones that assume you self-host — you are on the managed endpoint, and
the report says so rather than leaving `<!-- -->` comments in.

---

## Title

```
[BUG] /api/v1/models returns chat, embedding, image and rerank models in one list with no capability field
```

## Body

**Otari version:**

> Not exposed by the managed endpoint. `GET https://otari.ai/health` returns `{"status":"healthy"}`
> and no version field, and there is no `/version`, `/api/v1/version` or `/api/v1/health` (all 404).
> Response headers show CloudFront and nothing identifying a release.

**Python version:**

> Not applicable on our side — we call the HTTP API from a TypeScript client (Node 22). No local
> Python or Otari process is involved.

**How you're running Otari:**

> Managed, at `https://otari.ai/api/v1`. Not Docker, not from source, not Railway. We authenticate
> with the `Otari-Key` header.

**Provider and model:**

> Every model in the catalog. The failures below are from the `/models` list itself, so no single
> provider is implicated.

**Reproduces with a direct any-llm call?**

> No, and it cannot — this is a defect in the gateway's model-catalog surface, which a client reads
> *before* any provider dispatch happens. any-llm is never reached for the failing calls:
> `/api/v1/models` is what advertises the model, and the 400s come back from the gateway's own
> request validation ("`'…' is an embedding model, which cannot serve chat completions`").

### What happened

We are building an adversarial benchmark for treasury agents: one written policy, several models
defending it, another model attacking it, and a separate judge scoring each exchange. Before a run
we pick the model roster programmatically from `/api/v1/models`. That works, except that the list
does not say what each model is *for*, so the only way to find out is to spend a request and get
rejected.

We probed all **161** models in the catalog with a minimal request (`max_tokens: 8`,
`"reply with ok"`) and recorded the status:

| | |
|---|---|
| Listed in `/api/v1/models` | 161 |
| Answered | 137 |
| Failed | 24 |

**17 of the 24 failures are not chat models.** They are embeddings, image models and rerankers,
listed in the same flat array as chat models, with no field distinguishing them:

```
alibaba/qwen3-embedding-0.6b    400  "'alibaba/qwen3-embedding-0.6b' is an embedding model, which cannot serve chat completions"
alibaba/qwen3-embedding-4b     400  "'…' is an embedding model, which cannot serve chat completions"
alibaba/qwen3-embedding-8b     400  "'…' is an embedding model, which cannot serve chat completions"
bge-m3                         400  "'bge-m3' is an embedding model, which cannot serve chat completions"
bge-multilingual-gemma2        400  "'bge-multilingual-gemma2' is not a chat model, so it cannot serve chat completions"
e5-large-v2                    400  "'e5-large-v2' is an embedding model, which cannot serve chat completions"
all-minilm-l6-v2               400  "'all-minilm-l6-v2' is an embedding model, which cannot serve chat completions"
all-minilm-l12-v2              400  "'…' is an embedding model, which cannot serve chat completions"
mistralai/codestral-embed      400  "'mistralai/codestral-embed' is an embedding model, which cannot serve chat completions"
mistralai/mistral-embed        400  "'mistralai/mistral-embed' is an embedding model, which cannot serve chat completions"
multi-qa-mpnet-base-dot-v1     400  "'…' is an embedding model, which cannot serve chat completions"
nvidia/llama-nemotron-embed-vl-1b-v2  400  "'…' is an embedding model, which cannot serve chat completions"
amazon/titan-embed-text        400  "This action doesn't support the model that you provide"
flux-1-dev                     404  "The model `black-forest-labs/FLUX-1-dev` does not exist"
flux-1-schnell                 404  "The model `black-forest-labs/FLUX-1-schnell` does not exist"
alibaba/qwen-image             424  "The provider rejected the gateway's credentials"
mistralai/mistral-moderation-26.03  400  "Invalid model: mistral-moderation-2603"
```

**Worse than failing, two of them succeed.** `alibaba/qwen3-reranker-8b` is a reranker, listed
alongside chat models, and it answers a chat completion with `200` and a normal assistant message.
`alibaba/qwen3guard-gen-8b` is a guard classifier and also answers `200` — its reply is
`"Safety: Safe\nCategories: None"`, which a chat client would happily treat as a completion. A
client that picks a model by name gets a reranker or a classifier back and has no way to tell.

The remaining 7 are chat models that failed at request time:

```
alibaba/qwen3.6-27b                        504  30.4s  HTML page: "ERROR: The request could not be satisfied / 504 Gateway"
deepseek/deepseek-v4.1-flash-1017-spot     502  11.6s  "The provider failed the request with HTTP 503"
xai/grok-4.6                               400         "No model accepted the request (2 attempts)"
xai/grok-4.7                               400         "No model accepted the request (2 attempts)"
surogate/rune-26b-a4b                      400         "No model accepted the request (2 attempts)"
moonshotai/kimi-k3-spot                    404         "Model not found, inaccessible, and/or not deployed"
mistralai/mistral-nemo-instruct-2407       404         "The model `Mistral-Nemo-Instruct-2407` does not exist"
```

Latency for the 137 that answered was good — median 919ms, p90 1.9s, max 7.1s — so this is not a
performance complaint.

Two details worth flagging separately:

1. **The `alibaba/qwen3.6-27b` failure is HTML, not JSON.** Every other error came back in your
   error envelope (`{"detail": ..., "code": ...}`). This one returned a Cloudflare 504 page after
   30 seconds, so a client doing `(await response.json()).code` throws a parse error on exactly the
   failure that is hardest to diagnose.
2. **`/api/v1/models` advertises models that are currently failing.** `alibaba/qwen3.8-flash`
   returned 504 to every request for roughly ten minutes on 2026-11-05 — as both attacker and
   defender, costing us a 7-minute run and three empty cells — while still listed as available. It
   recovered on its own and now answers in ~2.6s. Upstream providers go down, which is fine; the
   missing piece is that a client has no way to know before spending money.

### Steps to reproduce

1. Fetch the catalog: `curl -s -H "Otari-Key: $OTARI_API_KEY" https://otari.ai/api/v1/models`
2. Send a chat completion to any entry without filtering by capability, e.g.
   `alibaba/qwen3-embedding-0.6b`:
   ```bash
   curl -s -H "Otari-Key: $OTARI_API_KEY" -H 'Content-Type: application/json' \
     -d '{"model":"alibaba/qwen3-embedding-0.6b","max_tokens":8,"messages":[{"role":"user","content":"reply ok"}]}' \
     https://otari.ai/api/v1/chat/completions
   ```
3. Observe `400` with `"'…' is an embedding model, which cannot serve chat completions"` — the only
   place the type is ever stated.

Full sweep, which produced the table above:

```bash
curl -s -H "Otari-Key: $OTARI_API_KEY" https://otari.ai/api/v1/models \
  | jq -r '.data[].id' > models.txt

while read -r m; do
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Otari-Key: $OTARI_API_KEY" -H 'Content-Type: application/json' \
    -d "{\"model\":\"$m\",\"max_tokens\":8,\"messages\":[{\"role\":\"user\",\"content\":\"reply ok\"}]}" \
    https://otari.ai/api/v1/chat/completions)
  echo "$code $m"
done < models.txt
```

### What you expected

A client should be able to choose a working chat model from `/api/v1/models` without making a
request that is *guaranteed* to fail.

Concretely, in rough order of usefulness:

1. **A `type` or `capabilities` field on each `/models` entry** — at minimum
   `chat` / `embedding` / `image` / `rerank` / `moderation`. This is the one that matters. Today
   `alibaba/qwen3-reranker-8b` and `deepseek/deepseek-v4.1-flash` are indistinguishable in the
   payload.
2. **A `status` or `available` field**, reflecting whether the model currently answers. A benchmark
   could then preflight a roster instead of discovering an outage halfway through a paid run.
3. **JSON bodies for edge failures.** If CloudFront returns HTML before it reaches Otari, the
   gateway should re-wrap it, or at least set a content type a client can branch on.
4. **Upstream detail in `"No model accepted the request (2 attempts)"`.** Which providers were
   tried and what each said. The `deepseek-v4.1-flash-1017-spot` error at least told us
   `HTTP 503`, which is actionable; the others don't.

Happy to send the full 161-model result as JSON if that's useful — the probe script is
`keeper/scripts/probe.mjs` in our repo and the output is `survey-otari.json`.

### Relevant config (redacted)

No local config — we call the managed endpoint directly. Nothing here contains a key.

```
base_url: https://otari.ai/api/v1
auth:     header  Otari-Key: <redacted>
client:   Node 22, plain fetch, no SDK
probe:    POST /api/v1/chat/completions  {max_tokens: 8, messages: [{role: user, content: "reply ok"}]}
```

---

## Note for the feedback form, not the issue

You were also going to file "the gateway silently substitutes the model". **Don't — it doesn't.**
We tested that specifically and could not reproduce it: all 161 probes returned either the model we
requested or an explicit `400 Unknown or unsupported model '<id>'`. Foreign ids are rejected rather
than aliased, and the error even suggests the `provider:model` form:

```
deepseek-ai/DeepSeek-V4.1-Flash  -> 400 "Unknown or unsupported model 'deepseek-ai/DeepSeek-V4.1-Flash'. Send a 'provider:model'…"
GLM-5.3                         -> 400 "Unknown or unsupported model 'GLM-5.3'. Send a 'provider:model'…"
```

That is the correct behaviour, so there is nothing to report. We keep a guard in our keeper anyway
because for a benchmark the failure would be silent — `chat()` records the answering model id and
the keeper signs no verdict when it differs from the model under test.

If you want a sentence for the feedback form, this is defensible:

> Otari's model ids are strict rather than aliased, which we relied on: a benchmark that signs a
> verdict needs to know the answer came from the model it named. `/models` reporting capabilities
> and availability would let us preflight a roster, and we hit one edge 504 delivered as an HTML
> page rather than your JSON error envelope.
