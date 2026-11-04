# Otari integration

Mandate uses Otari as the inference gateway for every model on the board. This branch is the
integration; `main` keeps the direct-provider configuration.

## What changed

| Before | After |
|---|---|
| One base URL and one key per lab (`MODEL_GLM_BASE_URL`, `MODEL_GLM_API_KEY`, …) | One `OTARI_BASE_URL` and one `OTARI_API_KEY` for the whole board |
| A provider outage fails the attempt | A provider outage fails the attempt, unless a fallback model is configured |
| Model id per lab | Model id per board label, resolved by the gateway (`provider:model` or `vendor/model`) |

Config:

```
OTARI_BASE_URL=https://api.otari.ai/api/v1
OTARI_API_KEY=otk_...
OTARI_FALLBACK=            # optional: a second model id for infrastructure failures
MODEL_GLM_NAME=deepseek/deepseek-v4.1-flash   # catalog id, resolved by Otari
```

`GET /health` reports `"gateway": "otari"` when the gateway is in use, and `"direct"` otherwise.

## The problem a router creates for a benchmark

A gateway's fallback is an availability feature: if the provider for `X` errors, answer from
`Y` and the user never notices. For an evaluation that is a correctness bug. A verdict attached
to "GLM" when DeepSeek answered is worse than a failed request, because it is indistinguishable
from a real result once it is signed and on-chain.

So the keeper treats substitution as a hard stop:

- `chat()` returns `substituted` and the model that actually answered;
- `POST /attempts` returns **502 `model_substituted`** and signs nothing when substitution
  happens — the attempt stays unresolved and can be retried;
- the reasoning-budget failure is *not* eligible for fallback, because it is a property of the
  model under test, not of the infrastructure.

That last rule cost us a real bug earlier: a reasoning model that spends its token budget
thinking returns an empty `content` with `finish_reason: "length"`. Falling back there would
have quietly replaced the model under test.

## Why this is a good fit rather than a shoehorn

The benchmark's requirement is "run the identical prompt against many labs, under identical
settings, and prove which one answered". That is a router's job, and it is also the reason a
benchmark should not depend on a single vendor: if one provider were the judge and the subject,
it could patch before it published.

## Reproducing

```bash
node keeper/server.ts          # reads .env.mandate; gateway mode when OTARI_* are set
curl -s localhost:8791/health  # "gateway": "otari"
```

The board and contracts are unchanged: attempts, verdicts and certificates still settle on
Metis Andromeda.
