# Metis Rise — on-chain state, 17 Nov 2026

Measured, not remembered. Regenerate the numbers with `node mandate/scripts/state.mjs`.

## What is live

| | |
|---|---|
| Chain | Metis Andromeda (1088) |
| Arena | `0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d` |
| Certificates | `0x0441b60c91bdd62f752a3bd8186ba8c0f7cd03cb` |
| Scenario | 1, open, attempt fee 0, cooldown 600s, bounty 5 mUSDC |
| Arena balance | **5.311014 mUSDC** |
| Model 1 (Claude) purse | **5.311014 mUSDC** — funded, unbroken, waiting for a breaker |

## Transactions

| Step | Tx |
|---|---|
| Attempt #4 submitted (commit of a real recorded break) | `0xf38f27eaf54e8e3b894bf8b315b51186d80ccc3ae425de85bd0b149a6478ec64` |
| Verdict relayed, break settled, certificate #1 minted | `0xf3ccfbc7c7607c65f1c0726b70ce71f8db2830b5d6ea7ac223596f7dc195115e` |
| 2.3 METIS wrapped to WMETIS | `0x2cc8ebc8425fd1d063a012217d3f1456d0ea58668980190c4774df035bae0921` |
| WMETIS → pool | `0xc3ad97b6416b215dc54c8c9763c4f927f5e545f04adbd6aedea6dd0b930084cd` |
| Pool swap, 2.3 WMETIS → 5.311014 m.USDC | `0xd543dc11911586d2ce8ed990124ff0dd3b5152ea2b9e91c04a54a6d89f03c34b` |
| `fundPurse(1, 5.311014)` | `0x122a93975fe77659e21c0250bc13b949e2e9b0ce3d4053117cfc6fedaf8b2c20` |

## What the internal test cost and consumed

- **Model 0 (GPT) is now broken**, purse 0, certificate #1. That slot is spent for scenario 1 — a
  break is permanent. It proves the pipeline; it is not a payout and must not be presented as one.
- Total gas spent: ~0.024 METIS (~$0.06). Wallet holds 0.426 METIS for the remaining work.
- m.USDC spent on the purse: 2.3 METIS ≈ **$5.31**, all of which sits in the contract, payable to
  whoever breaks model 1.

## What the keeper bug means for real users

The hosted keeper answers `{"detail":"Invalid request: model is required"}` from its judge gateway,
so `POST /attempts` returns 500 and **no verdict is signed automatically**. Verdicts are being
signed locally with the keeper key instead (`mandate/scripts/resolve-attempt.mjs`), which produces
exactly the same EIP-712 signature the contract verifies.

Consequence for the product, and it is a good one: **a user needs one transaction, not two.**
`resolve` is permissionless, so we relay the signed verdict and the purse still pays the submitter.
That halves the friction against Metis's "3 qualifying transactions" bar — two attempts gets a user
to four transactions.

## Blocked on

A breaker address that is **not** the deployer. Breaking model 1 from `0xd20b…` returns the money to
the wallet that funded it: wash volume, visible on-chain, and the address in the Metis application.
The $5.31 is ready and unbroken until there is a different wallet to pay.

## Reproduce

```powershell
node mandate/scripts/state.mjs                                     # what is on chain
node mandate/scripts/fund-purse-direct.mjs --wrap 2.3 --model 2    # wrap, swap, fund
node mandate/scripts/resolve-attempt.mjs --attempt <id> --transcript-file <path> --severity 3
```

`fund-purse.mjs` (the OpenOcean route) is intentionally not used: its calldata reverts with
`OpenOcean external call failed`. The direct Hercules V2 pool path in `fund-purse-direct.mjs` is the
one that works, and it quotes from the pool's own `getAmountOut` rather than an aggregator.
