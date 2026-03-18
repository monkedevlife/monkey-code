import type { BackgroundManager } from "../managers/BackgroundManager.js";

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
  message: string;
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
}

const DEFAULT_AGENT = "kong";
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
    message: `Task delegated to agent '${agent}' with session ${sessionId}. Task ID: ${taskId}`,
  };
}

export const delegateTaskSchema = {
  type: "object",
  properties: {
    task: { type: "string", description: "Task description" },
    agent: {
      type: "string",
      description: "Agent to use (default: kong)",
      enum: ["punch", "harambe", "caesar", "kong", "rafiki", "abu", "george"],
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
