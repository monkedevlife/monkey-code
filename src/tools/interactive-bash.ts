import {
  InteractiveManager,
  InteractiveManagerError,
  createInteractiveManager,
} from "../managers/InteractiveManager.js";
import { InteractiveSession } from "../types/index.js";

export type InteractiveBashAction = "start" | "send" | "capture" | "close";

export interface InteractiveBashInput {
  command: string;
  action: InteractiveBashAction;
  sessionId?: string;
  input?: string;
  cwd?: string;
  lines?: number;
}

export interface InteractiveBashOutput {
  success: boolean;
  action: InteractiveBashAction;
  sessionId?: string;
  command?: string;
  output?: string;
  lines?: number;
  sent?: string;
  closed?: boolean;
  sessions?: InteractiveSession[];
  summary?: string;
  error?: string;
  nextActions: Array<{
    action: string;
    description: string;
    tool: string;
    params: Record<string, string>;
  }>;
}

export interface InteractiveBashContext {
  manager?: InteractiveManager;
}

let globalManager: InteractiveManager | undefined;

function getManager(ctx: InteractiveBashContext): InteractiveManager {
  if (ctx.manager) {
    return ctx.manager;
  }
  if (!globalManager) {
    globalManager = createInteractiveManager();
  }
  return globalManager;
}

function makeErrorOutput(
  action: InteractiveBashAction,
  error: string,
  sessionId?: string
): InteractiveBashOutput {
  return {
    success: false,
    action,
    error,
    sessionId,
    nextActions: sessionId
      ? [
          {
            action: "capture",
            description: "Check session output for debugging",
            tool: "interactive-bash",
            params: { action: "capture", sessionId },
          },
          {
            action: "close",
            description: "Close the session",
            tool: "interactive-bash",
            params: { action: "close", sessionId },
          },
        ]
      : [],
  };
}

export async function interactiveBash(
  input: InteractiveBashInput,
  ctx: InteractiveBashContext = {}
): Promise<InteractiveBashOutput> {
  const manager = getManager(ctx);

  if (!manager.isAvailable()) {
    return {
      success: false,
      action: input.action,
      error:
        "tmux is not available on this system. Interactive bash sessions require tmux to be installed.",
      nextActions: [
        {
          action: "install-tmux",
          description: "Install tmux to use interactive bash",
          tool: "interactive-bash",
          params: {},
        },
      ],
    };
  }

  try {
    switch (input.action) {
      case "start":
        return await handleStart(manager, input);
      case "send":
        return await handleSend(manager, input);
      case "capture":
        return await handleCapture(manager, input);
      case "close":
        return await handleClose(manager, input);
      default:
        return makeErrorOutput(
          input.action,
          `Unknown action: ${input.action}. Supported actions: start, send, capture, close`
        );
    }
  } catch (error) {
    if (error instanceof InteractiveManagerError) {
      return makeErrorOutput(input.action, error.message, error.sessionId);
    }
    return makeErrorOutput(
      input.action,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function handleStart(
  manager: InteractiveManager,
  input: InteractiveBashInput
): Promise<InteractiveBashOutput> {
  if (!input.command) {
    return makeErrorOutput("start", "command is required for start action");
  }

  const session = await manager.createSession(input.command, input.cwd);

  return {
    success: true,
    action: "start",
    sessionId: session.id,
    command: session.command,
    summary: `Session started: ${session.id}`,
    nextActions: [
      {
        action: "send",
        description: "Send input to the session",
        tool: "interactive-bash",
        params: { action: "send", sessionId: session.id },
      },
      {
        action: "capture",
        description: "Capture output from the session",
        tool: "interactive-bash",
        params: { action: "capture", sessionId: session.id },
      },
      {
        action: "close",
        description: "Close the session when done",
        tool: "interactive-bash",
        params: { action: "close", sessionId: session.id },
      },
    ],
  };
}

async function handleSend(
  manager: InteractiveManager,
  input: InteractiveBashInput
): Promise<InteractiveBashOutput> {
  if (!input.sessionId) {
    return makeErrorOutput("send", "sessionId is required for send action");
  }

  if (input.input === undefined) {
    return makeErrorOutput("send", "input is required for send action", input.sessionId);
  }

  await manager.sendKeys(input.sessionId, input.input);

  return {
    success: true,
    action: "send",
    sessionId: input.sessionId,
    sent: input.input,
    summary: `Sent ${input.input.length} chars to ${input.sessionId}`,
    nextActions: [
      {
        action: "capture",
        description: "Capture output after sending input",
        tool: "interactive-bash",
        params: { action: "capture", sessionId: input.sessionId },
      },
      {
        action: "send",
        description: "Send more input",
        tool: "interactive-bash",
        params: { action: "send", sessionId: input.sessionId },
      },
    ],
  };
}

async function handleCapture(
  manager: InteractiveManager,
  input: InteractiveBashInput
): Promise<InteractiveBashOutput> {
  if (!input.sessionId) {
    return makeErrorOutput("capture", "sessionId is required for capture action");
  }

  const lines = input.lines ?? 100;
  const output = await manager.captureOutput(input.sessionId, lines);

  return {
    success: true,
    action: "capture",
    sessionId: input.sessionId,
    output,
    lines,
    summary: `Captured ${lines} lines from ${input.sessionId}`,
    nextActions: [
      {
        action: "send",
        description: "Send more input to the session",
        tool: "interactive-bash",
        params: { action: "send", sessionId: input.sessionId },
      },
      {
        action: "capture",
        description: "Capture more output",
        tool: "interactive-bash",
        params: { action: "capture", sessionId: input.sessionId },
      },
      {
        action: "close",
        description: "Close the session when done",
        tool: "interactive-bash",
        params: { action: "close", sessionId: input.sessionId },
      },
    ],
  };
}

async function handleClose(
  manager: InteractiveManager,
  input: InteractiveBashInput
): Promise<InteractiveBashOutput> {
  if (!input.sessionId) {
    return makeErrorOutput("close", "sessionId is required for close action");
  }

  await manager.closeSession(input.sessionId);

  return {
    success: true,
    action: "close",
    sessionId: input.sessionId,
    closed: true,
    summary: `Session ${input.sessionId} closed`,
    nextActions: [
      {
        action: "start",
        description: "Start a new session",
        tool: "interactive-bash",
        params: { action: "start" },
      },
    ],
  };
}

export async function listSessions(
  ctx: InteractiveBashContext = {}
): Promise<InteractiveSession[]> {
  const manager = getManager(ctx);
  return await manager.listSessions();
}

export async function cleanupSessions(
  ctx: InteractiveBashContext = {}
): Promise<void> {
  const manager = getManager(ctx);
  await manager.cleanup();
}

export const interactiveBashSchema = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "Command to run in the interactive session",
    },
    action: {
      type: "string",
      description: "Action to perform on the interactive session",
      enum: ["start", "send", "capture", "close"],
    },
    sessionId: {
      type: "string",
      description: "Session ID for send/capture/close actions",
    },
    input: {
      type: "string",
      description: "Input to send to the session (for send action)",
    },
    cwd: {
      type: "string",
      description: "Working directory for the session",
    },
    lines: {
      type: "number",
      description: "Number of lines to capture (for capture action, default: 100)",
      minimum: 1,
      maximum: 1000,
    },
  },
  required: ["command", "action"],
} as const;

export type InteractiveBashSchema = typeof interactiveBashSchema;
