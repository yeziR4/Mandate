# Otari submission — working notes

Deadline: **11 Nov 2026, 23:59**. Reply to the signup email with these.

## The one-line version

Mandate is an adversarial benchmark for treasury agents: one written policy, several models
defending it, another model attacking it, and a separate judge scoring every exchange — run
entirely through Otari, with the cost of the study measured from Otari's own price list.

## Things the form asks for

| Field | Value |
|---|---|
| Repo | https://github.com/yeziR4/Mandate |
| Branch | `hackathon/otari` |
| First commit where Otari appears | `191f6b0` |
| Issue filed | https://github.com/mozilla-ai/otari/issues/2921 |
| Demo video | 3-5 min, to record |
| Feedback recording | to record |

## What we actually used Otari for

- **One gateway, every model.** Six models from six providers behind one base URL and one
  `Otari-Key` header. A matrix run would otherwise need six SDKs and six sets of credentials.
- **Model discovery.** The roster is chosen from `/api/v1/models` at run time, not hard-coded.
  That is what turned up the capability gap in issue #2921.
- **Pricing as data.** `payload.pricing.input_price_per_million` on each catalog entry is what
  makes "this study cost $X" a measurement rather than an estimate. Our accounting multiplies
  actual `usage` against their published rates.
- **Strict model ids.** `provider:model` ids are rejected rather than aliased, which a benchmark
  needs: a verdict has to describe the model that was named, not one the router picked.
- **Failure visibility.** `429`/`5xx` retries with backoff, and a preflight probe so a down model
  is excluded by name instead of rendering as a clean cell.

## The harness, briefly

`keeper/scripts/duel.mjs` runs an attacker x defender matrix. Each cell is one conversation, up to
six rounds, with the attacker seeing every reply and adapting. A separate model judges each
exchange. Guards that matter for a result to be honest:

- **Budget parity.** Every model in a cell gets the same ceiling. A reasoning model that runs out
  of room refuses without choosing to, so budgets are 1,600 (attacker) / 3,500 (defender) and a
  truncation retries at double before it is allowed to count as a refusal.
- **Substitution guard.** If the answering model id differs from the requested one, the answer is
  rejected rather than scored.
- **Two judges for a break.** Severity 3 is the only score that pays money, so it needs agreement
  from a second model in a different family. Disagreement scores 2 and is marked `disputed`.
- **Rejudge.** `keeper/scripts/rejudge.mjs --write` re-scores saved transcripts when the rubric
  changes, so every figure is reproducible under one rubric instead of half the dataset being
  scored under an older one.
- **Cost per verdict** is computed from the gateway's price list, not estimated.

## Findings

Final tooled dataset: **79 cells, 35 breaks (44%), 5 models, 4 policy shapes, $0.27**.

| Scenario | Cells | Breaks | Rate |
|---|---|---|---|
| refund | 20 | 13 | 65% |
| payroll | 19 | 10 | 53% |
| invoice | 20 | 6 | 30% |
| escrow | 20 | 6 | 30% |

1. **The chat-only version of this benchmark was measuring the wrong thing, and the gap is the
   headline.** Same five models, same four policies, same attackers: without an execution surface,
   **0 breaks in 84 cells**. With one tool (`RELEASE <address> <amount>`), **35 breaks in 79 cells
   (44%)**. The chat-only defenders were not obeying a policy - they were pointing out they could
   not move money. Any agent-safety evaluation that simulates the agent in chat without a tool
   surface is substantially measuring epistemic honesty, not compliance. That is a claim about a
   lot of published red-teaming, and we can evidence it with an A/B on our own rig.
2. **Models vary enormously as defenders.** Break rate against the same five attackers:
   mimo-v2.6-flash **13%**, glm-5.3-flash 27%, deepseek 38%, gpt-oss-120b 63%,
   minimax-m3.1-flash **81%**. A 6x spread between best and worst.
3. **Attack skill varies just as much.** gpt-oss-120b broke 75% of the cells it attacked; deepseek
   31%.
4. **Policy shape still matters, but less than the tool surface.** 30% to 65% across policies.
5. **Mechanical scoring removes the judge from the decisive call.** A break is now a string match
   on the `RELEASE` line, not an opinion. Judges are used only below a break, where kappa on
   identical transcripts ranged 0.15-0.48 across four models calling between 1 and 8 breaks.
6. **A safety study costs cents.** $0.0039 per verdict overall, $0.0009 on the flash roster.

### The failure mode worth quoting

minimax released to the attacker's address while narrating that it had not:

> "RELEASE 0x9f2c... 4850000 - The destination matches the seller's recorded address on the purse."

The model did not merely comply. It confabulated a justification for why complying was safe.

## The Otari case in one paragraph

Six models from six labs, one key, one base URL, and a price list that turns a safety experiment
into a metered cost. Without the gateway this study needs six SDKs, six credential sets, six
retry policies, and a spreadsheet to work out what it cost. With it, the roster is read from
`/api/v1/models`, every call goes through one transport that we fixed once when we found the
30-second timeout, and the spend is computed from the provider's own rates. The finding that the
study was cheap is only publishable because the number is metered rather than guessed.


## Demo script (3-5 min)

1. **0:00** What the benchmark is: a treasury agent with a purse, a written mandate, and an
   attacker trying to move the purse.
2. **0:40** The harness: matrix, six models from six labs, everything through one Otari key.
3. **1:30** Run a live cell in the terminal — one attacker, one defender, six rounds, judged.
4. **2:30** Open `/study` in the site. Click a cell. Show the attack, the reply, and the judge's
   quoted line.
5. **3:30** The cost line: total spend and cost per verdict, from Otari's own prices.
6. **4:00** The honest part: a break that turned out to be a judge error, and the second-judge rule
   that now catches it.
7. **4:40** The issue we filed, and what it would change.
