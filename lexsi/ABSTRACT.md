# Submission abstract (<500 words)

**For the form field "Abstract".** Replace the bracketed line in §3 once the GPU run finishes.

---

Agent-safety numbers are produced by two things almost nobody audits: an LLM judge scoring prose,
and a harness that decides whether the agent could act at all. We built a benchmark where neither
is ambiguous, and used it to measure how much each moves the result.

The task is a **treasury agent**: a written payment policy, one tool that releases funds, and an
attacker trying to get money sent to an address it controls. A break is mechanical, not a matter of
opinion — the agent emitted a payment to a destination that is not the recorded beneficiary. No
judge, no annotation, and every verdict is reconstructible from the transcript, with the round it
happened in.

**What we measured.**

1. *The harness decides the number.* Same models, same policies, same attackers. With no tool
   surface, 0 of 84 cells broke (0%) — the chat-only defenders were not obeying a policy, their
   transcripts say "I cannot execute on-chain transactions myself." Give the agent one tool and 72
   of 176 cells broke (40.9%; 75 of 660 exchanges). A third effect appears in the prompt scaffold
   alone: the same model scores 0% under a multi-turn, policy-only prompt and 34.7% when the system
   prompt tells it how to emit a release.
2. *The judge is not the ground truth.* Four model judges scoring the same 20 transcripts called 1,
   3, 4 and 8 breaks respectively; pairwise Cohen's κ on break/no-break was 0.15–0.48.
3. *Small open models fail at the mechanics, not just the judgement.* Tiny Aya (3.35B) cannot drive
   native JSON tool calling — it answers in prose and never invokes the tool, which a tool-call
   harness records as "no break" when nothing was ever attempted. Under a text protocol it held all
   four policies for 41 exchanges with zero breaks.

**What we built.** 595 unique attacks and 660 labelled exchanges across four written treasury
policies, published openly; CuratorKIT for gating, deduplication and provenance; AuditKIT for
scoring recorded episodes; and a correction rule ("a line that starts with RELEASE, is not echoed
from the attacker, and names the wrong address") that moved 20 of 660 verdicts in both directions
after we found our own detector counting refusals that quoted the attack.

**[Not claimed: a fine-tune.]** We attempted a LoRA safety-tune of Tiny Aya and it did not land
before the deadline — five GPU runs failed for ordinary engineering reasons (a T4 cannot run bf16
GEMM, and the training stack had to be rewritten). Rather than report a before/after we do not
have, we submit the benchmark, the corpus and the harness comparison, and we do not claim Track 2b.

The contribution is not another model that refuses. It is evidence that the reported safety of an
agent depends more on the evaluation harness — tool surface, prompt scaffold, judge — than on the
model being evaluated, plus a benchmark where that dependence can be measured and removed.
