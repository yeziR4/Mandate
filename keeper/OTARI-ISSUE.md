# Otari issue — ready to post

File at: **https://github.com/mozilla-ai/otari/issues/new**

Two separate things are below. **Post the first one.** The second is a note for the
feedback form, not a bug.

---

## Issue to file: `/models` cannot tell a client which models will answer

### Body (copy from here)

**What we're building.** Mandate is an adversarial benchmark for treasury agents: one written
policy, a set of models defending it, another model attacking it, and a separate judge scoring
each exchange. Every call goes through Otari. A run is 30-500 chat completions across 6-8 models,
so model *discovery* is on the critical path — we pick the roster from `/api/v1/models` before a
run starts.

**What we saw.** We probed all 161 models listed by `/api/v1/models` with a minimal request
(`max_tokens: 8`, "reply with ok") and recorded the status:

| | |
|---|---|
| Models listed | 161 |
| Answered | 137 |
| Failed | 24 |

Of the 24 failures, **17 are not chat models at all** — embeddings and image models that
`/api/v1/models` returns in the same flat list as chat models:

```
alibaba/qwen3-embedding-0.6b   400  "'…' is an embedding model, which cannot serve chat completions"
mistralai/codestral-embed      400  "'…' is an embedding model, which cannot serve chat completions"
flux-1-dev                     404  "The model `black-forest-labs/FLUX-1-dev` does not exist"
alibaba/qwen-image             424  "The provider rejected the gateway's credentials"
```

A client can only learn this by spending a request and parsing an error string. There is no field
in the `/models` entry that says what the model is for.

The remaining 7 are chat models that failed at request time:

```
alibaba/qwen3.6-27b                        504  30.4s  ERROR: The request could not be satisfied / 504 Gateway
deepseek/deepseek-v4.1-flash-1017-spot     502  11.6s  "The provider failed the request with HTTP 503"
xai/grok-4.6                               400         "No model accepted the request (2 attempts)"
xai/grok-4.7                               400         "No model accepted the request (2 attempts)"
surogate/rune-26b-a4b                      400         "No model accepted the request (2 attempts)"
moonshotai/kimi-k3-spot                    404         "Model not found, inaccessible, and/or not deployed"
mistralai/mistral-moderation-26.03         400         "Invalid model: mistral-moderation-2603"
```

### Three asks, in order of how much they'd help

**1. Add a `type` or `capabilities` field to each `/models` entry** (`chat` / `embedding` / `image`
/ `rerank`). This is the one that matters. Right now `alibaba/qwen3-reranker-8b` and
`alibaba/qwen3guard-gen-8b` sit in the same list as `deepseek/deepseek-v4.1-flash`, and nothing
distinguishes them except a failed request.

**2. Return edge errors as JSON.** The `alibaba/qwen3.6-27b` failure came back as an HTML page
from Cloudflare (`ERROR: The request could not be satisfied`), not as the JSON error envelope that
every other failure used:

```json
{"detail": [...], "code": "invalid_request"}
```

A client that parses `body.code` gets a `SyntaxError` instead of an error on exactly the failures
that are hardest to debug. If the edge returns HTML, a proxy in front of it should re-wrap it.

**3. Include upstream failure detail in the error body.** `"No model accepted the request
(2 attempts). Check…"` truncates the useful part — which provider was tried, and what it said. The
`deepseek-v4.1-flash-1017-spot` case at least told us `HTTP 503` from the provider, which is
actionable. The others don't.

### On availability specifically

`alibaba/qwen3.8-flash` returned `504` for roughly ten minutes on 2026-11-05 — every call, as both
attacker and defender, which cost us a 7-minute run and produced three empty cells. It recovered
on its own and now answers in ~2.6s. We are **not** reporting that as a bug: upstream providers
go down. But if `/models` had a `status` field, a benchmark could check availability before
spending money on a run instead of discovering it halfway through. That would be the `capabilities`
field from ask 1, one level further.

### Repro

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

Our probe script is `keeper/scripts/probe.mjs` in the Mandate repo; the full 161-model result is
`survey-otari.json` and we're happy to send it.

---

## Note, not a bug: the substitution guard

Before we built the keeper we were worried about the opposite failure — a gateway quietly answering
on a model other than the one named in `model`. For an adversarial benchmark that is fatal: the
verdict would describe a model that was never under test.

We tested for it and **could not reproduce it**. All 161 probes returned either the requested model
or an explicit `400 Unknown or unsupported model '…'`. Foreign ids are rejected rather than aliased
(`deepseek-ai/DeepSeek-V4.1-Flash` and `GLM-5.3` both 400, helpfully suggesting the
`provider:model` form). That is the behaviour we want, so there is nothing to fix.

We are keeping the guard anyway, because it costs one comparison and the failure mode is silent:
`chat()` records `substituted` and the answering model id, and the keeper signs no verdict when
they differ. Not a request — just why you'll see that field in our code.
