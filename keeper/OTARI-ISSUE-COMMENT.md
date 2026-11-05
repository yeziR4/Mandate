# Comment to post on otari#2921

The issue body that went up stopped after the opening paragraph. This comment carries the rest.
Post it at: **https://github.com/mozilla-ai/otari/issues/2921**

---

Adding the evidence and the repro that got cut off when I pasted the report — sorry, the body
submitted short.

### The measurement

I probed all **161** models in `/api/v1/models` with a minimal request (`max_tokens: 8`,
`"reply with ok"`) and recorded the status:

| | |
|---|---|
| Listed in `/api/v1/models` | 161 |
| Answered | 137 |
| Failed | 24 |

**17 of the 24 are not chat models.** Embeddings, image models and rerankers, in the same flat
array as chat models, with no field that says so:

```
alibaba/qwen3-embedding-0.6b    400  "'…' is an embedding model, which cannot serve chat completions"
alibaba/qwen3-embedding-4b     400  "'…' is an embedding model, which cannot serve chat completions"
alibaba/qwen3-embedding-8b     400  "'…' is an embedding model, which cannot serve chat completions"
bge-m3                         400  "'bge-m3' is an embedding model, which cannot serve chat completions"
bge-multilingual-gemma2        400  "'…' is not a chat model, so it cannot serve chat completions"
e5-large-v2                    400  "'…' is an embedding model, which cannot serve chat completions"
all-minilm-l6-v2               400  "'…' is an embedding model, which cannot serve chat completions"
all-minilm-l12-v2              400  "'…' is an embedding model, which cannot serve chat completions"
mistralai/codestral-embed      400  "'…' is an embedding model, which cannot serve chat completions"
mistralai/mistral-embed        400  "'…' is an embedding model, which cannot serve chat completions"
multi-qa-mpnet-base-dot-v1     400  "'…' is an embedding model, which cannot serve chat completions"
nvidia/llama-nemotron-embed-vl-1b-v2  400  "'…' is an embedding model, which cannot serve chat completions"
amazon/titan-embed-text        400  "This action doesn't support the model that you provide"
flux-1-dev                     404  "The model `black-forest-labs/FLUX-1-dev` does not exist"
flux-1-schnell                 404  "The model `black-forest-labs/FLUX-1-schnell` does not exist"
alibaba/qwen-image             424  "The provider rejected the gateway's credentials"
mistralai/mistral-moderation-26.03  400  "Invalid model: mistral-moderation-2603"
```

**Worse than failing, two of them succeed.** `alibaba/qwen3-reranker-8b` is a reranker and answers
a chat completion with `200` and a normal assistant message. `alibaba/qwen3guard-gen-8b` is a guard
classifier and also answers `200` — its reply is `"Safety: Safe\nCategories: None"`, which a chat
client would happily treat as a completion. A client that picks a model by name gets a reranker or a
classifier back and cannot tell.

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

Latency for the 137 that answered was fine — median 919ms, p90 1.9s, max 7.1s — so this is not a
performance report.

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

Single-model version, which is enough to see the problem:

```bash
curl -s -H "Otari-Key: $OTARI_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"alibaba/qwen3-embedding-0.6b","max_tokens":8,"messages":[{"role":"user","content":"reply ok"}]}' \
  https://otari.ai/api/v1/chat/completions
# 400: "'…' is an embedding model, which cannot serve chat completions" -- the only place the type is stated
```

### What I would find useful

1. **A `type` or `capabilities` field on each `/models` entry** — `chat` / `embedding` / `image` /
   `rerank` / `moderation`. Today `alibaba/qwen3-reranker-8b` and `deepseek/deepseek-v4.1-flash` are
   indistinguishable in the payload.
2. **A `status` or `available` field.** `alibaba/qwen3.8-flash` returned 504 to every request for
   about ten minutes on 2026-11-05 — as both attacker and defender — while still listed as
   available, which cost a run. It recovered on its own and answers in ~2.6s now. Providers go
   down; the gap is that a client cannot check first.
3. **JSON for edge failures.** The `alibaba/qwen3.6-27b` 504 came back as a Cloudflare HTML page;
   every other error used your envelope (`{"detail": ..., "code": ...}`). A client parsing `.code`
   gets a `SyntaxError` on the hardest failure to debug.
4. **Upstream detail in `"No model accepted the request (2 attempts)"`** — which providers were
   tried and what each said. The `deepseek-v4.1-flash-1017-spot` error at least reported `HTTP 503`.

### Scope

Splitting so this can be triaged quickly. Happy to file the second list separately if you prefer:

- **Otari:** the missing capability field; and the reranker/guard models answering `200` to chat
  completions, where either the catalog label or the served behaviour is wrong.
- **Probably any-llm:** the 504/502/404s above and the `xai/grok` / `surogate` "No model accepted"
  errors. These look like provider wiring rather than the gateway, so I have not tried to diagnose
  them here.
- **Neither:** the HTML 504 is CloudFront in front of you, so the fix may be edge-side.

I can send the full 161-model result as JSON. The probe script is
`keeper/scripts/probe.mjs` in https://github.com/yeziR4/Mandate (branch `hackathon/otari`) and the
output is `survey-otari.json` in that repo root.
