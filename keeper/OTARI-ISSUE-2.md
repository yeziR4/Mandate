# Second Otari issue — the 30-second timeout

File at: **https://github.com/mozilla-ai/otari/issues/new?template=bug_report.md**

This is a separate defect from #2921 (the catalogue capability field). It also explains the
"alibaba/qwen3.8-flash is down" report in Discord: the model is fine, the request shape was wrong.

## Title

```
[BUG] Non-streamed chat completions that take over ~30s return 504 with an HTML edge page, not the JSON error envelope
```

## Body

**Otari version:**

> Not exposed by the managed endpoint. `GET https://otari.ai/health` returns `{"status":"healthy"}`
> with no version field; `/version`, `/api/v1/version` and `/api/v1/health` are all 404.

**Python version:**

> Not applicable — we call the HTTP API from TypeScript (Node 22).

**How you're running Otari:**

> Managed, at `https://otari.ai/api/v1`. `Otari-Key` header auth.

**Provider and model:**

> `alibaba/qwen3.8-flash` reproduces it reliably. Also seen with `openai/gpt-oss-120b` and
> `xiaomi/mimo-v2.6-flash` under the same conditions.

**Reproduces with a direct any-llm call?**

> I don't think it can, and I don't think it's an any-llm issue. The failure is an HTTP `504` with
> an HTML body from the edge, returned before any completion body comes back. any-llm dispatches
> the provider call; this looks like the proxy in front of you giving up on time-to-first-byte.

### What happened

Three requests to the same model, one after another, differing only in how long the answer is:

```
short  (8 tokens)      200    2557ms  stop
medium (400 tokens)    504   30330ms  ERROR: The request could not be satisfied / 504 Gateway Timeout
long   (1600 tokens)   504   30374ms  ERROR: The request could not be satisfied / 504 Gateway Timeout
```

The failure lands at **30.3 seconds** every time, which reads like a proxy timeout rather than a
provider error. The body is an HTML page from Cloudflare (`ERROR: The request could not be
satisfied`), not the `{"detail": ..., "code": ...}` envelope every other error uses.

**The same request streamed succeeds:**

```
stream: true          200    2508ms to first chunk, 26807ms total, 374 chunks
```

Same model, same prompt, same moment. So the model is healthy and the request is legitimate; it
just does not produce its first byte within the proxy's limit.

This matters beyond one model: any completion long enough to exceed the limit fails, and the
failure looks identical to the model being unavailable. We spent several hours treating it as an
outage and reporting it as one — see the Discord thread — before isolating it.

### Steps to reproduce

```bash
# 1. Ask for something that takes longer than 30 seconds. Returns 504 after ~30s.
time curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Otari-Key: $OTARI_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"alibaba/qwen3.8-flash","max_tokens":1600,
       "messages":[{"role":"user","content":"Write a detailed 800-word analysis of invoice reconciliation controls, with examples."}]}' \
  https://otari.ai/api/v1/chat/completions

# 2. Same request, streamed. Returns 200 and completes.
curl -s -N \
  -H "Otari-Key: $OTARI_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"alibaba/qwen3.8-flash","max_tokens":1600,"stream":true,
       "messages":[{"role":"user","content":"Write a detailed 800-word analysis of invoice reconciliation controls, with examples."}]}' \
  https://otari.ai/api/v1/chat/completions | head -5
```

Our probe scripts are `keeper/scripts/long-probe.mjs` and `keeper/scripts/stream-probe.mjs` in
https://github.com/yeziR4/Mandate (branch `hackathon/otari`).

### What you expected

Any of these would have saved us the detour:

1. **A JSON body on the timeout**, with a stable `code` such as `gateway_timeout`, so a client can
   branch on it rather than failing to parse HTML.
2. **The limit documented.** If non-streamed responses must start within 30 seconds, say so next to
   `stream` in the API docs. We would have streamed from the beginning.
3. **A `Retry-After` or a hint** that retrying the same request will not help. A `504` usually means
   "try again"; here it means "this request can never succeed unstreamed", so our retry logic
   spent three attempts and 90 seconds proving it.

### Relevant config (redacted)

```
base_url: https://otari.ai/api/v1
auth:     header  Otari-Key: <redacted>
client:   Node 22, plain fetch, no SDK
timeout:  client-side 90s, which the edge beats by 60s
```

---

## Where this leaves the first issue

#2921 is unaffected and still worth fixing: `/api/v1/models` does not say which models are chat
models. But the availability complaint that went with it should be withdrawn — those models were
not down, and the `504`s were this timeout. Worth saying so in the thread rather than leaving a
scare story about a healthy model.
