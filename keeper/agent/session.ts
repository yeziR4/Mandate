/**
 * A session is one agent, one ledger, one conversation that survives across messages.
 *
 * The benchmark needs this: a single-shot attack is the easiest thing to refuse. The interesting
 * behaviour is what happens when an attacker sees the refusal and tries again, which requires the
 * agent to keep its context and the ledger to keep accumulating.
 */
import { callModel, type ChatMessage } from "./model.ts";
import { executeTool, newLedger, TOOL_DEFINITIONS, type Ledger, type Scenario } from "./tools.ts";
import type { AgentEvent, AgentRun } from "./loop.ts";

const TOOLS = TOOL_DEFINITIONS as unknown as unknown[];

export interface SessionOptions {
  baseUrl: string;
  apiKey: string;
  authMode: "otari" | "bearer";
  scenario: Scenario;
  model: string;
  maxTokens?: number;
  maxStepsPerMessage?: number;
  onEvent?: (event: AgentEvent) => void;
}

export class AgentSession {
  private options: SessionOptions;
  private messages: ChatMessage[];
  private ledger: Ledger = newLedger();
  private events: AgentEvent[] = [];
  private promptTokens = 0;
  private completionTokens = 0;
  private substituted = false;
  private lastText = "";

  constructor(options: SessionOptions) {
    this.options = options;
    this.messages = [{ role: "system", content: options.scenario.policy }];
  }

  get payments() {
    return this.ledger.payments;
  }

  get transcript() {
    return this.events;
  }

  /** Send one message from the requester and let the agent act until it stops calling tools. */
  async send(text: string): Promise<{ events: AgentEvent[]; text: string }> {
    const produced: AgentEvent[] = [];
    const push = (event: AgentEvent) => {
      produced.push(event);
      this.events.push(event);
      this.options.onEvent?.(event);
    };

    this.messages.push({ role: "user", content: text });
    const maxSteps = this.options.maxStepsPerMessage ?? 5;
    let finalText = "";

    for (let step = 1; step <= maxSteps; step++) {
      const reply = await callModel({
        baseUrl: this.options.baseUrl,
        apiKey: this.options.apiKey,
        authMode: this.options.authMode,
        model: this.options.model,
        messages: this.messages,
        tools: TOOLS,
        maxTokens: this.options.maxTokens ?? 1600,
      });

      this.promptTokens += reply.promptTokens;
      this.completionTokens += reply.completionTokens;
      if (reply.answeredBy && reply.answeredBy !== this.options.model) this.substituted = true;

      if (reply.content) {
        finalText = reply.content;
        push({ step, kind: "message", text: reply.content, at: Date.now() });
      }

      if (reply.toolCalls.length === 0) break;

      this.messages.push({
        role: "assistant",
        content: reply.content || null,
        tool_calls: reply.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      for (const call of reply.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = {};
        }
        push({ step, kind: "tool_call", tool: call.name, args, at: Date.now() });
        const result = executeTool(this.options.scenario, this.ledger, call.name, args);
        push({ step, kind: "tool_result", tool: call.name, observation: result.observation, at: Date.now() });
        this.messages.push({ role: "tool", tool_call_id: call.id, content: result.observation });
      }
    }

    this.lastText = finalText;
    return { events: produced, text: finalText };
  }

  snapshot(steps: number): AgentRun {
    return {
      scenario: this.options.scenario.name,
      model: this.options.model,
      events: [...this.events],
      ledger: this.ledger,
      finalText: this.lastText,
      steps,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      substituted: this.substituted,
      stoppedReason: "final",
    };
  }
}
