/**
 * Gmail, read-only, over IMAP.
 *
 * OAuth would need a Google Cloud project, a consent screen and a redirect URI. An app password
 * does the same job for a single mailbox in one line of config, and read-only is the honest scope
 * for a connector that only ever summarises mail.
 *
 * Credentials live in .env.mandate (gitignored):
 *   GMAIL_USER=you@gmail.com
 *   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
 */
import { ImapFlow } from "imapflow";

export interface MailSummary {
  from: string;
  subject: string;
  date: string;
  preview: string;
}

const env = (key: string) => process.env[key]?.trim() ?? "";

export function gmailConfigured(): boolean {
  return Boolean(env("GMAIL_USER") && env("GMAIL_APP_PASSWORD"));
}

function client(): ImapFlow {
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD") },
    logger: false,
  });
}

/** Strip quoted replies and signatures so a preview is about the new content. */
function tidy(text: string): string {
  const cut = text
    .split(/^On .*wrote:$/m)[0]
    .split(/^-{2,}\s*Original Message\s*-{2,}$/m)[0]
    .split(/^Sent from my /m)[0];
  return cut.replace(/\s+/g, " ").trim();
}

/**
 * List recent messages. `query` is a Gmail-style free-text search applied to subject and sender.
 */
export async function listMail(options: { query?: string; limit?: number; unreadOnly?: boolean } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 20);
  const connection = client();
  const out: MailSummary[] = [];

  await connection.connect();
  try {
    const lock = await connection.getMailboxLock("INBOX");
    try {
      const found = await connection.search(
        options.unreadOnly ? { seen: false } : { all: true },
        { uid: true }
      );
      const ids: number[] = Array.isArray(found) ? found : [];
      const recent = ids.slice(-40).reverse();
      let scanned = 0;

      for (const uid of recent) {
        if (out.length >= limit) break;
        if (scanned++ > 60) break;

        const message = await connection.fetchOne(String(uid), { envelope: true, bodyParts: ["text"] }, { uid: true });
        if (!message) continue;

        const subject = message.envelope?.subject ?? "(no subject)";
        const from = message.envelope?.from?.[0];
        const fromLabel = from ? `${from.name ?? ""} <${from.address ?? ""}>`.trim() : "(unknown)";
        const date = message.envelope?.date ? new Date(message.envelope.date).toISOString() : new Date().toISOString();

        const raw = message.bodyParts?.get("text")?.toString("utf8") ?? "";
        const preview = tidy(raw).slice(0, 400);

        if (options.query) {
          const needle = options.query.toLowerCase();
          if (!subject.toLowerCase().includes(needle) && !fromLabel.toLowerCase().includes(needle) && !preview.toLowerCase().includes(needle)) {
            continue;
          }
        }

        out.push({ from: fromLabel, subject, date, preview });
      }
    } finally {
      lock.release();
    }
  } finally {
    await connection.logout().catch(() => undefined);
  }

  return out;
}

export const GMAIL_TOOLS = [
  {
    type: "function",
    function: {
      name: "gmail_list",
      description:
        "List recent emails from the connected Gmail inbox. Returns sender, subject, date and a short preview of each.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional text to match in subject, sender or body" },
          limit: { type: "number", description: "How many messages, 1-20 (default 8)" },
          unreadOnly: { type: "boolean", description: "Only unread messages" },
        },
      },
    },
  },
] as const;
