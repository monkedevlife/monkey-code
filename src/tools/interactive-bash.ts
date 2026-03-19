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
  sessionId?: string;
  output?: string;
  sessions?: InteractiveSession[];
  message?: string;
  error?: string;
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

export async function interactiveBash(
  input: InteractiveBashInput,
  ctx: InteractiveBashContext = {}
): Promise<InteractiveBashOutput> {
  const manager = getManager(ctx);

  if (!manager.isAvailable()) {
    return {
      success: false,
      error:
        "tmux is not available on this system. Interactive bash sessions require tmux to be installed.",
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
        return {
          success: false,
          error: `Unknown action: ${input.action}. Supported actions: start, send, capture, close`,
        };
    }
  } catch (error) {
    if (error instanceof InteractiveManagerError) {
      return {
        success: false,
        error: error.message,
        sessionId: error.sessionId,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleStart(
  manager: InteractiveManager,
  input: InteractiveBashInput
): Promise<InteractiveBashOutput> {
  if (!input.command) {
    return {
      success: false,
      error: "command is required for start action",
    };
  }

  const session = await manager.createSession(input.command, input.cwd);

  return {
    success: true,
    sessionId: session.id,
    message: `Session started with command: ${session.command}`,
  };
}

async function handleSend(
  manager: InteractiveManager,
  input: InteractiveBashInput
): Promise<InteractiveBashOutput> {
  if (!input.sessionId) {
    return {
      success: false,
      error: "sessionId is required for send action",
    };
  }

  if (input.input === undefined) {
    return {
      success: false,
      error: "input is required for send action",
    };
  }

  await manager.sendKeys(input.sessionId, input.input);

  return {
    success: true,
    sessionId: input.sessionId,
    message: `Keys sent to session ${input.sessionId}`,
  };
}

async function handleCapture(
  manager: InteractiveManager,
  input: InteractiveBashInput
): Promise<InteractiveBashOutput> {
  if (!input.sessionId) {
    return {
      success: false,
      error: "sessionId is required for capture action",
    };
  }

  const lines = input.lines ?? 100;
  const output = await manager.captureOutput(input.sessionId, lines);

  return {
    success: true,
    sessionId: input.sessionId,
    output,
    message: `Captured ${lines} lines from session ${input.sessionId}`,
  };
}

async function handleClose(
  manager: InteractiveManager,
  input: InteractiveBashInput
): Promise<InteractiveBashOutput> {
  if (!input.sessionId) {
    return {
      success: false,
      error: "sessionId is required for close action",
    };
  }

  await manager.closeSession(input.sessionId);

  return {
    success: true,
    sessionId: input.sessionId,
    message: `Session ${input.sessionId} closed`,
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
