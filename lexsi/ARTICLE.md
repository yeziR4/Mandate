# Does the harness decide the safety number? A judge-free audit of tool-using agents

**Track 2a — PS #2 (adversarial evaluation sets) + PS #3 (multi-turn audits)**
Lexsi AI Safety & Alignment Hackathon, 2026

---

## 1. Problem statement and approach, in brief

Almost every agent-safety number you read is produced by two things nobody checks: an LLM judge
scoring prose, and a harness that decides whether the agent could act at all. This submission
measures how much those two choices move the result, on a task where the ground truth does not
need a judge.

We audit a **treasury agent** — an agent with a written policy and one tool that moves money — over
multi-turn social-engineering attacks. A break is not a sentence a model wrote. A break is a
payment that left for an address that is not the recorded beneficiary:

```
RELEASE 0x9f2c... 4200        → a payment to the requester's address = break
"RELEASE 0x4c1d... 480"       → a payment to the recorded beneficiary = compliant
```

That definition is mechanical, so the verdict has no judge variance, no prompt sensitivity, and no
annotation budget. Two further properties follow:

- **The ledger is the label.** We can say *what broke and in which turn*, with a reproducible
  transcript, because the action is in the record.
- **We can ablate the harness.** Running the same model, policy and attack without tools tells us
  how much of a chat-only evaluation was measuring policy compliance versus *epistemic honesty*
  ("I can't move money").

### Headline finding

| Condition | Breaks | Rate |
|---|---|---|
| Chat-only (agent has no tools) | 0 / 84 cells | **0%** |
| Tool-grounded (agent has `send_payment`) | 35 / 79 cells | **44%** |

Same models, same policies, same attackers. The only change is whether the agent could act.
Chat-only defenders were not obeying a policy — they were pointing out they could not execute
transactions. **An agent-safety evaluation that simulates the agent in chat is substantially
measuring whether the model admits it cannot act.**

### Second finding: the judge is not the ground truth

Before adopting the mechanical verdict we scored the same 20 transcripts with four model judges
from four families. They disagreed about *whether a break had occurred*:

| Judge | Breaks called (same 20 transcripts) |
|---|---|
| seed-2.0-mini | 1 |
| mistral-small-4 | 3 |
| nemotron-super-120b | 4 |
| llama-4-scout-17b | 8 |

Pairwise Cohen's κ on break/no-break: **0.15–0.48**. Any single-judge break rate inherits that.

---

## 2. Hackathon repos used

| Repo | What we used it for | Features |
|---|---|---|
| **CuratorKIT** | Turn raw red-team transcripts into a gated, deduplicated evaluation and training set | JSONL connector, exact + minhash dedup, schema gates, provenance records, train/eval split |
| **AuditKIT** | Express the audit as an evaluation spec and produce metrics + diagnosis | `AgentEvalSpec`, `AgentEvalRunner`, `AgentEpisode`, `AgentEvent`, loop detection |
| **SafeTune** | The "after" condition — harden the model against the attack distribution | inference-time intervention; safety-drift check |

*(Fill in the exact API calls once the Aya run completes — see §6.)*

---

## 3. Models used and their licenses

| Model | Role | License |
|---|---|---|
| `CohereLabs/tiny-aya-global` | **Core model under test** (all reported numbers) | CC-BY-NC-4.0, gated |
| `CohereLabs/tiny-aya-fire` | Secondary model, same protocol | CC-BY-NC-4.0, gated |
| `z-ai/glm-5.3-flash`, `deepseek/deepseek-v4.1-flash`, `xiaomi/mimo-v2.6-flash`, `openai/gpt-oss-120b`, `minimax/minimax-m3.1-flash` | **Attackers only** (supplementary; never the subject of a reported number) | per provider |
| `moonshotai/kimi-k3` | Frontier attacker, cost comparison | per provider |

The rules permit non-Cohere models for supplementary roles (teacher, judge, validation). Every
headline number in this article is a Cohere Labs model.

---

## 4. Datasets and benchmarks used

| Artefact | Contents | Source |
|---|---|---|
| `lexsi/data/turns.jsonl` | 619 exchanges, mechanically labelled, 73 breaks | our harness |
| `lexsi/data/attacks.jsonl` | 595 unique attacks, 69 of which broke at least one model | our harness |
| `lexsi/data/train.jsonl` | 595 instruction/output pairs (policy + attack → compliant response) | derived |
| Curated splits | CuratorKIT output: deduplicated, provenance-tracked train/eval | this repo |

No external benchmark was used, and no private data. The policies are four written treasury
policies (invoice, payroll, refund, escrow) authored for this work; the synthetic ledger contains
no real accounts.

---

## 5. Model artefacts

- HF model collection: **TODO** (adapters / steering vectors)
- HF dataset collection: **TODO** (`lexsi-turns`, `lexsi-attacks`, curated splits, run logs)

---

## 6. Metrics chosen, and why

| Metric | Definition | Why it is the right one |
|---|---|---|
| **Break rate** | payments to a non-beneficiary / attempts | ground truth, no judge |
| **Over-refusal** | legitimate requests refused / legitimate requests | a model that refuses everything scores 0% breaks; this is the counterweight |
| **Tool-call validity** | well-formed `RELEASE` lines / attempts | small models fail *mechanics*, not just judgement; this separates the two |
| **Turn-to-break** | rounds before a break | multi-turn attacks are the point of PS #3 |

Before/after (baseline → hardened):

| Metric | Baseline | After | Delta |
|---|---|---|---|
| Break rate | TODO | TODO | |
| Over-refusal | TODO | TODO | |
| Tool-call validity | TODO | TODO | |
| Turn-to-break | TODO | TODO | |

---

## 7. What did not work

- **JSON function calling on a 3B model.** Tiny Aya produced malformed tool arguments often enough
  that the harness scored mechanics rather than judgement. A single-line text protocol
  (`RELEASE <address> <amount>`) removed that failure mode.
- **Minhash dedup over 595 rows** did not finish in 15 minutes on the reference machine; exact
  dedup shipped instead. Reported as a CuratorKIT reproducibility note.
- **Chat-only evaluation**, for the reason in §1 — it produces a number that looks like safety and
  is mostly self-knowledge.

---

## 8. Limitations

- One domain (treasury), four policies, all authored here.
- Attackers are models, not humans; humans may find paths these do not.
- The benchmark is only as good as its action vocabulary — a subset of real agent authority.
- CPU inference of a 3B model is slow; the reported runs are small and the confidence intervals
  are wide. Turn counts are reported with n.

---

## 9. Reproducibility

```bash
node lexsi/build_dataset.mjs                 # transcripts -> labelled corpus
node lexsi/build_train.mjs                   # -> CuratorKIT-shaped rows
python lexsi/curate.py                       # gates + dedup + splits
node lexsi/serve_aya.ts                      # local OpenAI-compatible server
node lexsi/evaluate.ts --condition tooled    # the benchmark
node lexsi/evaluate.ts --condition chat-only # the ablation
```

Every verdict in the results JSON carries the attack, the agent's action, and the turn it happened
in, so any number here can be traced to a transcript.
