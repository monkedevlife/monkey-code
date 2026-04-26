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
  planId?: string;
  planTaskId?: string;
}

export interface DelegateTaskOutput {
  taskId: string;
  sessionId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  agent: string;
  requestedAgent?: string;
  timeout: number;
  createdAt: string;
  summary: string;
  routing?: {
    originalAgent: string;
    finalAgent: string;
    reason: string;
  };
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
  resolveAgentConfig?: (agentName: string) => AgentConfig | undefined;
  worktree?: string;
  directory?: string;
}

const DEFAULT_AGENT = "punch";
const DEFAULT_TIMEOUT_MINUTES = 30;
const SCOUT_AGENT = "scout";

const EXPLORATION_DIRECT_PATTERNS = [
  /\bfind\s+(all\s+)?references\b/i,
  /\bfind\s+(all\s+)?usages\b/i,
  /\bfind\s+relevant\s+files\b/i,
  /\bfind\s+patterns\b/i,
  /\bsearch\s+the\s+(repo|repository|codebase|project)\b/i,
  /\bexplore\s+the\s+(repo|repository|codebase|project)\b/i,
  /\bmap\s+out\b/i,
  /\blook\s+for\b/i,
  /\bwhich\s+files\b/i,
  /\bwhere\s+(is|are)\b/i,
  /\bwhat\s+(uses|references|implements)\b/i,
];

const EXPLORATION_VERBS = [
  "explore",
  "search",
  "scan",
  "inspect",
  "discover",
  "map",
  "grep",
  "find",
  "locate",
];

const EXPLORATION_TARGETS = [
  "repo",
  "repository",
  "codebase",
  "project",
  "file",
  "files",
  "path",
  "paths",
  "pattern",
  "patterns",
  "usage",
  "usages",
  "reference",
  "references",
  "implementation",
  "implementations",
  "entrypoint",
  "entrypoints",
];

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function shouldRouteToScout(input: DelegateTaskInput) {
  const text = normalizeText([input.task, input.context].filter(Boolean).join(" "));

  if (!text) return false;
  if (EXPLORATION_DIRECT_PATTERNS.some((pattern) => pattern.test(text))) return true;

  const hasVerb = EXPLORATION_VERBS.some((verb) => text.includes(verb));
  const hasTarget = EXPLORATION_TARGETS.some((target) => text.includes(target));

  return hasVerb && hasTarget;
}

function resolveDelegatedAgent(input: DelegateTaskInput) {
  const requestedAgent = input.agent ?? DEFAULT_AGENT;

  if (requestedAgent === SCOUT_AGENT || !shouldRouteToScout(input)) {
    return {
      requestedAgent,
      agent: requestedAgent,
      routingReason: undefined,
    };
  }

  return {
    requestedAgent,
    agent: SCOUT_AGENT,
    routingReason:
      "Exploration tasks are enforced to scout so repo discovery uses the low-token grep_app path and returns concise findings.",
  };
}

function buildSystemPrompt(input: DelegateTaskInput, routedToScout: boolean, routingReason?: string) {
  const basePrompt = input.context
    ? `You are delegated to work on the following task.\n\nTask: ${input.task}\n\nAdditional Context:\n${input.context}`
    : `You are delegated to work on the following task.\n\nTask: ${input.task}`;

  if (!routedToScout) return basePrompt;

  return `${basePrompt}\n\nScout execution policy:\n- Prefer the grep_app skill/MCP path first for repo discovery when available.\n- Return compact findings with relevant files, matched patterns, and only the minimum context the main agent needs.\n- Do not expand into implementation work unless explicitly asked.\n\nRouting reason: ${routingReason}`;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildCommand(task: string, agent: string, context?: string, directory?: string): string {
  const message = context
    ? `Task: ${task}\n\nAdditional Context:\n${context}`
    : task;
  return [
    'opencode run',
    `--agent ${quote(agent)}`,
    directory ? `--dir ${quote(directory)}` : '',
    quote(message),
  ]
    .filter(Boolean)
    .join(' ');
}

export async function delegateTask(
  input: DelegateTaskInput,
  ctx: DelegateTaskContext
): Promise<DelegateTaskOutput> {
  const resolution = resolveDelegatedAgent(input);
  const agent = resolution.agent;
  const timeout = input.timeout ?? DEFAULT_TIMEOUT_MINUTES;

  const createRes = await ctx.client.session.create({
    parentID: ctx.parentSessionId,
    title: `Delegated: ${input.task.slice(0, 50)}${input.task.length > 50 ? "..." : ""}`,
  });

  if (!createRes.data?.id) {
    throw new Error("Failed to create child session");
  }

  const sessionId = createRes.data.id;

  const resolvedAgentConfig = ctx.resolveAgentConfig?.(agent) ?? (agent === resolution.requestedAgent ? ctx.agentConfig : undefined);

  if (resolvedAgentConfig) {
    const promptParams = agentConfigToPromptParams(resolvedAgentConfig);
    setSessionPromptParams(sessionId, promptParams);
  }

  const systemPrompt = buildSystemPrompt(input, agent === SCOUT_AGENT, resolution.routingReason);

  await ctx.client.session.prompt({
    sessionID: sessionId,
    agent,
    system: systemPrompt,
    parts: [{ type: "text", text: input.task }],
    noReply: true,
  });

  const command = buildCommand(input.task, agent, input.context, ctx.worktree ?? ctx.directory);
  const taskId = await ctx.backgroundManager.launch({
    command,
    agentName: agent,
    context: input.context,
    timeout,
    parentSessionId: ctx.parentSessionId,
    planId: input.planId,
    planTaskId: input.planTaskId,
  });

  return {
    taskId,
    sessionId,
    status: "pending",
    agent,
    requestedAgent: resolution.requestedAgent !== agent ? resolution.requestedAgent : undefined,
    timeout,
    createdAt: new Date().toISOString(),
    summary: resolution.routingReason
      ? `Exploration task auto-routed from '${resolution.requestedAgent}' to '${agent}'`
      : `Task delegated to agent '${agent}'`,
    routing: resolution.routingReason
      ? {
          originalAgent: resolution.requestedAgent,
          finalAgent: agent,
          reason: resolution.routingReason,
        }
      : undefined,
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
    task: {
      type: "string",
      description: "Task description. Keep it narrow and outcome-focused so the delegated agent can work independently. Exploratory tasks may be auto-routed to scout."
    },
    agent: {
      type: "string",
      description: "Agent to use (default: punch). Exploratory tasks are automatically routed to scout for low-token grep_app-style discovery. Use tasker for small atomic work, builder for focused code output, caesar for planning, harambe for deep analysis, george for creative direction, and punch for end-to-end execution.",
      enum: ["punch", "harambe", "caesar", "george", "tasker", "scout", "builder"],
    },
    context: {
      type: "string",
      description: "Additional context such as relevant files, constraints, expected output format, or specific questions to answer."
    },
    timeout: {
      type: "number",
      description: "Timeout in minutes (default: 30)",
      minimum: 1,
      maximum: 240,
    },
    planId: {
      type: "string",
      description: "Optional plan ID to associate this background task with a stored plan."
    },
    planTaskId: {
      type: "string",
      description: "Optional plan task ID to associate this background task with a stored plan task."
    }
  },
  required: ["task"],
} as const;

export type DelegateTaskSchema = typeof delegateTaskSchema;

export { DEFAULT_AGENT, DEFAULT_TIMEOUT_MINUTES };
