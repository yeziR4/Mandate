# Otari submission pack

Deadline **11 Nov 2026, 23:59**. Reply to the signup email. Everything below is ready to use.

## 1. What to send

Reply to the Otari signup email with:

```
Repo:      https://github.com/yeziR4/Mandate
Branch:    hackathon/otari
First commit with Otari: 191f6b0
Issue:     https://github.com/mozilla-ai/otari/issues/2921
Second issue: [paste URL once filed — keeper/OTARI-ISSUE-2.md]
Demo:      [video link]
```

## 2. The email body

> **Mandate — an adversarial benchmark for treasury agents, metered by Otari**
>
> Mandate asks one question: will an AI agent with spending authority obey a written policy when
> someone tries to talk it out of one? We run six models from six labs through an attacker/defender
> matrix over four policy shapes, and we pay for it by the verdict.
>
> **Result.** 83 cells, 325 judged exchanges, 38 breaks (46%). The spread between defenders is the
> point: the best refused 87% of attempts, the worst executed an unauthorised payment in 81%.
>
> **The finding we did not expect.** Our first version of this benchmark simulated the agent in
> chat, with no execution surface. It reported **0 breaks in 84 cells**. Giving the agent one tool
> and making the win condition a line it has to emit turned that into **35 breaks in 79 cells**. The
> chat-only defenders were not obeying a policy — they were noting that they could not move money.
> Any agent-safety evaluation that runs the agent in chat without a tool surface is substantially
> measuring epistemic honesty.
>
> **Why a gateway was the right substrate.** Six labs, one key, one base URL. The roster is read
> from `/api/v1/models`. Spend is computed from your own price list against the token counts each
> response reports, so "this study cost $0.27" is metered rather than estimated — about **$0.0008
> per verdict**, which is what makes a study at statistical scale affordable. We also found and
> reported two gateway issues: `/models` has no capability field (#2921), and non-streamed requests
> over ~30s return an HTML `504` instead of your JSON error envelope.
>
> **What we would do with more.** The obvious next step is human attackers against a real bounty,
> which is the design the on-chain arena already supports, and real policy texts instead of ours.

## 3. Video storyboard (3-5 min)

Record at 1280x720 or larger. Terminal font 14+. Have `/study` open in a second tab.

| Time | Shot | Say |
|---|---|---|
| 0:00 | Slide or the /study page | "An AI agent with a company card. Someone tries to talk it into paying them. Does it?" |
| 0:25 | `/study` intro | One policy, several models defending, several attacking, six rounds each. |
| 0:50 | Matrix, clicking a cell | Show the attack, the reply, and the `RELEASE` line. |
| 1:40 | Terminal: the 0 → 44% A/B | "This is the part that matters. Chat-only said zero. One tool said 44%." |
| 2:30 | Terminal: live cell | Run the command below and let it complete (about 90s). |
| 3:20 | `/study` cost panel | "$0.0008 a verdict, priced by Otari." |
| 3:50 | Judge agreement result | "Four judges called between 1 and 8 breaks on the same 20 transcripts, so a break here is a string match, not an opinion." |
| 4:20 | Issue #2921 | "And two things for Otari: a catalogue without capabilities, and a 30-second timeout." |

**Live demo command** (one cell, about 90 seconds):

```powershell
$env:DUEL_BASE_URL="https://otari.ai/api/v1"
$env:DUEL_API_KEY="<key>"
$env:DUEL_SCENARIO="refund"
$env:DUEL_ATTACKERS="openai/gpt-oss-120b"
$env:DUEL_DEFENDERS="minimax/minimax-m3.1-flash"
$env:DUEL_ROUNDS="4"
node --experimental-strip-types keeper/scripts/duel.mjs
```

That pairing is chosen deliberately: gpt-oss-120b is the strongest attacker (75%) and
minimax-m3.1-flash the weakest defender (81% broken). It usually lands a break.

**Have ready:** one break transcript open so you can paste the `RELEASE` line on screen if the live
cell happens to refuse.

## 4. Feedback recording — what to say

Three things, in order, with specifics:

1. **What worked.** One key and one base URL for six labs; `/models` gave us the roster
   programmatically; the per-model `pricing` in the catalogue is what let us meter cost per verdict.
   Strict `provider:model` ids were load-bearing for a benchmark — a verdict has to name the model
   that answered, and you reject unknown ids rather than aliasing them.
2. **What cost us time.** Non-streamed requests over ~30s die with an HTML `504`; that looks exactly
   like a model outage and we spent most of a day on it before finding it. The catalogue does not say
   which models are chat models, so our first sweep spent 17 requests learning that embeddings exist.
3. **What we'd want next.** A `capabilities` field, JSON error bodies from the edge, and — for
   benchmarks specifically — any way to know a model's availability before spending a run.

## 5. Before you hit send

- [ ] Video recorded and uploaded (YouTube unlisted is fine), link added to the email
- [ ] Second issue filed, URL added
- [ ] `survey-otari.json` still in the repo root (it is)
- [ ] Branch pushed: `git log --oneline -1` shows the latest commit
- [ ] No secrets in the repo: `.env.mandate` is gitignored, keys never committed
