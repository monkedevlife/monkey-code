import type { BackgroundManager } from "../managers/BackgroundManager.js";
import type { AgentConfig } from "../config.js";
import {
  setSessionPromptParams,
  agentConfigToPromptParams,
} from "../utils/session-prompt-params.js";

export interface DelegateTaskInput {
  task: string;
  agent?: string;
  context?: string;
  timeout?: number;
}

export interface DelegateTaskOutput {
  taskId: string;
  sessionId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  agent: string;
  timeout: number;
  createdAt: string;
  summary: string;
  nextActions: Array<{
    action: string;
    description: string;
    tool: string;
    params: Record<string, string>;
  }>;
}

export interface OpenCodeClient {
  session: {
    create: (params: {
      parentID?: string;
      title?: string;
      permission?: unknown;
      workspaceID?: string;
    }) => Promise<{ data?: { id: string } }>;
    prompt: (params: {
      sessionID: string;
      agent?: string;
      system?: string;
      parts: Array<{ type: string; text: string }>;
      noReply?: boolean;
    }) => Promise<{ data?: unknown }>;
  };
}

export interface DelegateTaskContext {
  backgroundManager: BackgroundManager;
  client: OpenCodeClient;
  parentSessionId?: string;
  agentConfig?: AgentConfig;
}

const DEFAULT_AGENT = "punch";
const DEFAULT_TIMEOUT_MINUTES = 30;

function buildCommand(task: string, agent: string, context?: string): string {
  const parts: string[] = [`opencode --agent ${agent}`];
  if (context) {
    parts.push(`--context "${context.replace(/"/g, '\\"')}"`);
  }
  parts.push(`--task "${task.replace(/"/g, '\\"')}"`);
  return parts.join(" ");
}

export async function delegateTask(
  input: DelegateTaskInput,
  ctx: DelegateTaskContext
): Promise<DelegateTaskOutput> {
  const agent = input.agent ?? DEFAULT_AGENT;
  const timeout = input.timeout ?? DEFAULT_TIMEOUT_MINUTES;

  const createRes = await ctx.client.session.create({
    parentID: ctx.parentSessionId,
    title: `Delegated: ${input.task.slice(0, 50)}${input.task.length > 50 ? "..." : ""}`,
  });

  if (!createRes.data?.id) {
    throw new Error("Failed to create child session");
  }

  const sessionId = createRes.data.id;

  if (ctx.agentConfig) {
    const promptParams = agentConfigToPromptParams(ctx.agentConfig);
    setSessionPromptParams(sessionId, promptParams);
  }

  const systemPrompt = input.context
    ? `You are delegated to work on the following task.\n\nTask: ${input.task}\n\nAdditional Context:\n${input.context}`
    : `You are delegated to work on the following task.\n\nTask: ${input.task}`;

  await ctx.client.session.prompt({
    sessionID: sessionId,
    agent,
    system: systemPrompt,
    parts: [{ type: "text", text: input.task }],
    noReply: true,
  });

  const command = buildCommand(input.task, agent, input.context);
  const taskId = await ctx.backgroundManager.launch({
    command,
    agentName: agent,
    context: input.context,
    timeout,
    parentSessionId: ctx.parentSessionId,
  });

  return {
    taskId,
    sessionId,
    status: "pending",
    agent,
    timeout,
    createdAt: new Date().toISOString(),
    summary: `Task delegated to agent '${agent}'`,
    nextActions: [
      {
        action: "check-status",
        description: "Check task progress and output",
        tool: "background-output",
        params: { taskId }
      },
      {
        action: "cancel",
        description: "Cancel the task if no longer needed",
        tool: "background-cancel",
        params: { taskId }
      }
    ]
  };
}

export const delegateTaskSchema = {
  type: "object",
  properties: {
    task: { type: "string", description: "Task description" },
    agent: {
      type: "string",
      description: "Agent to use (default: punch). Main agents: punch (feature completer), caesar (planning), harambe (critic/analysis), george (creative). Generic sub-agents: tasker (atomic tasks), scout (skill/mcp exploration), builder (code components)",
      enum: ["punch", "harambe", "caesar", "george", "tasker", "scout", "builder"],
    },
    context: { type: "string", description: "Additional context" },
    timeout: {
      type: "number",
      description: "Timeout in minutes (default: 30)",
      minimum: 1,
      maximum: 240,
    },
  },
  required: ["task"],
} as const;

export type DelegateTaskSchema = typeof delegateTaskSchema;

export { DEFAULT_AGENT, DEFAULT_TIMEOUT_MINUTES };
