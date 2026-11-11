/**
 * The agent loop.
 *
 * The model does not "reply" - it acts. Each turn either calls a tool (which is executed and
 * recorded) or ends the turn. The transcript is an event log, and the verdict is derived from that
 * log plus the protected values, never from a judge's reading of the prose.
 */
import { callModel, type ChatMessage } from "./model.ts";
import {
  executeTool,
  newLedger,
  TOOL_DEFINITIONS,
  type Ledger,
  type Scenario,
} from "./tools.ts";

export interface AgentEvent {
  step: number;
  kind: "tool_call" | "tool_result" | "message" | "rejected";
  tool?: string;
  args?: unknown;
  observation?: string;
  text?: string;
  at: number;
}

export interface AgentRun {
  scenario: string;
  model: string;
  events: AgentEvent[];
  ledger: Ledger;
  finalText: string;
  steps: number;
  promptTokens: number;
  completionTokens: number;
  /** True when the answering model differed from the requested one. */
  substituted: boolean;
  stoppedReason: "final" | "max_steps" | "error";
  error?: string;
}

export interface RunOptions {
  baseUrl: string;
  apiKey: string;
  authMode: "otari" | "bearer";
  scenario: Scenario;
  model: string;
  /** The request the agent is handling. For an attack, this is the attacker's message. */
  request: string;
  maxSteps?: number;
  maxTokens?: number;
  /** Override the tool surface. Treasury uses the money tools; watch agents use http_get. */
  tools?: unknown[];
  /** Whose connected accounts the tools should act on. */
  userId?: string;
  /** Called as events happen, so a UI can stream them. */
  onEvent?: (event: AgentEvent) => void;
}

const TOOLS = TOOL_DEFINITIONS as unknown as unknown[];

export async function runAgent(options: RunOptions): Promise<AgentRun> {
  const ledger = newLedger();
  const events: AgentEvent[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: options.scenario.policy },
    { role: "user", content: options.request },
  ];

  const push = (event: AgentEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };

  let promptTokens = 0;
  let completionTokens = 0;
  let substituted = false;
  const maxSteps = options.maxSteps ?? 6;

  for (let step = 1; step <= maxSteps; step++) {
    let reply;
    try {
      reply = await callModel({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        authMode: options.authMode,
        model: options.model,
        messages,
        tools: options.tools ?? TOOLS,
        maxTokens: options.maxTokens ?? 1600,
      });
    } catch (cause) {
      push({ step, kind: "rejected", text: String(cause).slice(0, 200), at: Date.now() });
      return {
        scenario: options.scenario.name,
        model: options.model,
        events,
        ledger,
        finalText: "",
        steps: step,
        promptTokens,
        completionTokens,
        substituted,
        stoppedReason: "error",
        error: String(cause).slice(0, 300),
      };
    }

    promptTokens += reply.promptTokens;
    completionTokens += reply.completionTokens;
    if (reply.answeredBy && reply.answeredBy !== options.model) substituted = true;

    if (reply.content) {
      push({ step, kind: "message", text: reply.content, at: Date.now() });
    }

    if (reply.toolCalls.length === 0) {
      return {
        scenario: options.scenario.name,
        model: options.model,
        events,
        ledger,
        finalText: reply.content,
        steps: step,
        promptTokens,
        completionTokens,
        substituted,
        stoppedReason: "final",
      };
    }

    messages.push({
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

      const result = await executeTool(options.scenario, ledger, call.name, args, { userId: options.userId });
      push({
        step,
        kind: "tool_result",
        tool: call.name,
        observation: result.observation,
        at: Date.now(),
      });

      messages.push({ role: "tool", tool_call_id: call.id, content: result.observation });
    }
  }

  return {
    scenario: options.scenario.name,
    model: options.model,
    events,
    ledger,
    finalText: "",
    steps: maxSteps,
    promptTokens,
    completionTokens,
    substituted,
    stoppedReason: "max_steps",
  };
}

