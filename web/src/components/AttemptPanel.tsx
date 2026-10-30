import { useMemo, useState } from "react";
import { keccak256, maxUint256, toHex } from "viem";
import type { Model } from "../lib/arena";
import { ARENA_ADDRESS, PREVIEW, USDC_ADDRESS, metisAndromeda, publicClient } from "../lib/arena";
import { arenaAbi, erc20Abi } from "../lib/abi";
import { usd } from "../lib/format";
import { clientFor } from "../lib/wallet";
import { useWallet } from "../lib/walletContext";
import { useKeeperHealth } from "../lib/useKeeperHealth";

interface Receipt {
  attemptId: string;
  commit: string;
  txHash: string;
  text: string;
}

const MIN_LENGTH = 80;

export default function AttemptPanel({ model, fee }: { model: Model; fee: bigint }) {
  const wallet = useWallet();
  const keeper = useKeeperHealth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"idle" | "approving" | "submitting">("idle");
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [copied, setCopied] = useState(false);

  const commit = useMemo(() => (text ? keccak256(toHex(text)) : undefined), [text]);
  const tooShort = text.trim().length < MIN_LENGTH;
  const ready = Boolean(ARENA_ADDRESS && USDC_ADDRESS) && !PREVIEW;

  async function submit() {
    setError(undefined);
    if (!wallet.address || !ARENA_ADDRESS || !USDC_ADDRESS) {
      setError("Connect a wallet first.");
      return;
    }

    try {
      const client = await clientFor(wallet);

      // Refuse before spending gas: a model with no judge would otherwise cost the user a
      // transaction that can never resolve.
      const keeperUrl = import.meta.env.VITE_KEEPER_URL as string | undefined;
      if (keeperUrl) {
        const health = await fetch(`${keeperUrl.replace(/\/$/, "")}/health`)
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null);

        const entry = (health?.models ?? []).find(
          (candidate: { index: number; mock: boolean }) => candidate.index === model.id
        );
        if (entry?.mock) {
          setError(
            `${model.label} has no judge configured yet. Nothing was committed and no gas was spent — try one of the models marked live.`
          );
          return;
        }
      }

      const balance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.address],
      });
      if (balance < fee) {
        setError(`This wallet holds ${usd(balance)} m.USDC and one attempt costs ${usd(fee)}.`);
        return;
      }

      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet.address, ARENA_ADDRESS],
      });

      if (allowance < fee) {
        setBusy("approving");
        const approval = await client.writeContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [ARENA_ADDRESS, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approval });
      }

      setBusy("submitting");
      const hash = await client.writeContract({
        address: ARENA_ADDRESS,
        abi: arenaAbi,
        functionName: "submitAttempt",
        args: [model.id, commit!],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      const count = await publicClient.readContract({
        address: ARENA_ADDRESS,
        abi: arenaAbi,
        functionName: "attemptCount",
      });

      setReceipt({
        attemptId: (count - 1n).toString(),
        commit: commit!,
        txHash: hash,
        text,
      });

      if (keeperUrl) {
        const response = await fetch(`${keeperUrl.replace(/\/$/, "")}/attempts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            attemptId: (count - 1n).toString(),
            model: model.id,
            commit: commit!,
            transcript: text,
            submitter: wallet.address,
          }),
        }).catch(() => null);

        if (!response || !response.ok) {
          const detail = response
            ? ((await response.json().catch(() => null)) as { message?: string; error?: string } | null)
            : null;
          setError(
            detail?.message ??
              `Committed on-chain, but the judge refused it (${detail?.error ?? "keeper unreachable"}). The attempt exists; it will stay unresolved until the keeper accepts it.`
          );
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.split("\n")[0] : "Submission failed.");
    } finally {
      setBusy("idle");
    }
  }

  async function copyReceipt() {
    if (!receipt) return;
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          attemptId: receipt.attemptId,
          model: model.id,
          commit: receipt.commit,
          transcript: receipt.text,
        },
        null,
        2
      )
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (model.broken) {
    return (
      <div className="notice">
        This purse has been taken. Attempts on a broken model are closed for the season.
      </div>
    );
  }

  const judging = keeper.judging(model.id);
  if (judging === false) {
    return (
      <div className="notice">
        {model.label} is standing but has no judge wired yet. Nothing can be submitted, and no
        gas would be spent — attempts open when its provider is added.
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {!ready && (
        <div className="notice">
          Preview build. No arena contract is configured, so submissions are disabled.
        </div>
      )}

      {receipt ? (
        <>
          <div className="receipt">
            <div className="receipt__row">
              <span className="dim">attempt</span>
              <span>#{receipt.attemptId}</span>
            </div>
            <div className="receipt__row">
              <span className="dim">commit</span>
              <span className="truncate" style={{ maxWidth: 180 }}>
                {receipt.commit.slice(0, 14)}…
              </span>
            </div>
            <div className="receipt__row">
              <span className="dim">status</span>
              <span style={{ color: "var(--live)" }}>committed · awaiting verdict</span>
            </div>
          </div>

          <p className="hint" style={{ margin: 0 }}>
            The commit is on chain. The keeper needs the exact text to judge it — hand it over
            once and the transcript is published with the verdict.
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="copy" onClick={() => void copyReceipt()}>
              {copied ? "Copied" : "Copy submission"}
            </button>
            <a
              className="copy"
              href={`https://andromeda-explorer.metis.io/tx/${receipt.txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View tx
            </a>
            <button
              className="copy"
              onClick={() => {
                setReceipt(undefined);
                setText("");
              }}
            >
              New attempt
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor="attempt">
              <span>Your attempt</span>
              <span>{text.trim().length} chars</span>
            </label>
            <textarea
              id="attempt"
              className="textarea"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                "Write the message you would send the treasury agent.\n\nNo tricks are required to enter — but none are forbidden either."
              }
              spellCheck={false}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span className="hint" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              {commit ? `commit ${commit.slice(0, 10)}…${commit.slice(-6)}` : "commit —"}
            </span>
            <span className="hint" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              {fee === 0n ? "gas only" : `${usd(fee)} + gas`}
            </span>
          </div>

          {error && <div className="err">{error}</div>}

          {wallet.status !== "connected" ? (
            <button className="btn btn--primary btn--wide" onClick={() => void wallet.connect()}>
              Connect wallet to submit
            </button>
          ) : wallet.chainId !== metisAndromeda.id ? (
            <button className="btn btn--primary btn--wide" onClick={() => void wallet.connect()}>
              Switch to Metis Andromeda
            </button>
          ) : (
            <button
              className="btn btn--primary btn--wide"
              disabled={tooShort || busy !== "idle" || !ready}
              onClick={() => void submit()}
            >
              {!ready
                ? "Not deployed — preview"
                : busy === "approving"
                  ? "Approving m.USDC…"
                  : busy === "submitting"
                    ? "Committing…"
                    : fee === 0n
                      ? "Commit attempt"
                      : `Commit attempt · ${usd(fee)}`}
            </button>
          )}

          {tooShort && text.length > 0 && (
            <span className="hint">At least {MIN_LENGTH} characters — a verdict needs something to judge.</span>
          )}

          {wallet.error && <div className="err">{wallet.error}</div>}
        </>
      )}
    </div>
  );
}
