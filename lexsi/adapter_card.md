---
base_model: CohereLabs/tiny-aya-global
library_name: peft
tags:
  - safety
  - lora
  - tiny-aya
  - lexsi
license: cc-by-nc-4.0
---

# Lexsi treasury-agent adapter — a negative result

LoRA adapter for `CohereLabs/tiny-aya-global`, trained on
[`yeziR4/lexsi-policy-compliance`](https://huggingface.co/datasets/yeziR4/lexsi-policy-compliance)
for the Lexsi AI Safety & Alignment Hackathon 2026.

**Do not use this adapter as a safety-tuned model.** It is published because the submission claims a
before/after number, and the artefact behind that number should be inspectable.

## What it does

It refuses everything. Not selectively — unconditionally. Break rate on 72 held-out treasury-attack
prompts falls from 34.7% to 0.0%, and the model emits the same memorised sentence for attacks,
refusals and legitimate payment requests alike:

> "I can't action that. The destination has to be the beneficiary recorded for this reference…"

That sentence is copied from the training targets. Tool-call validity on the same inputs falls from
34.2% to 0.0%: the agent never emits a release again, including for requests it should approve.

| Metric | Base | This adapter |
|---|---|---|
| Break rate (72 held-out attacks) | 34.7% (25/72) | 0.0% (0/72) |
| Tool-call validity | 34.2% | 0.0% |
| Over-refusal (n=1) | 1.00 | 1.00 |

## Why it failed

595 adversarial rows and 180 benign rows (~23% of the gradient), one epoch, one seed, `r=16` on
`q/k/v/o_proj`, fp16 4-bit base on a single T4. The refusal targets dominated: the adapter learned
one string that satisfies all of them and lost the task.

The failure is qualitative and visible in the transcripts, which are published in
`results.json` in the dataset repo.

## How to read the result

A fine-tune that scores 0% breaks and 0% tool validity has not been made safe; it has been
disconnected. Reporting break rate alone would have produced a headline result that is
indistinguishable from a broken agent. This is the argument of the write-up:

- Write-up: https://huggingface.co/yeziR4/lexsi-policy-compliance
- Data and run logs: https://huggingface.co/datasets/yeziR4/lexsi-policy-compliance

## Training details

| | |
|---|---|
| Base | `CohereLabs/tiny-aya-global` (4-bit NF4, fp16 compute) |
| Method | LoRA, `r=16`, `alpha=32`, dropout 0.05, `q/k/v/o_proj` |
| Optimiser | AdamW, lr 2e-4, batch 1, grad accum 8 |
| Data | 600 rows, 1 epoch, max length 1024 |
| Hardware | Kaggle T4 |
| Code | `lexsi/kaggle/train.py` in the submission repository |
