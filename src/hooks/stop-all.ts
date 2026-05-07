import type { BackgroundManager } from "../managers/BackgroundManager.js";
import type { InteractiveManager } from "../managers/InteractiveManager.js";

export interface StopAllInput {
  sessionID: string;
  client?: {
    session?: {
      abort?: (params: unknown) => Promise<unknown>;
    };
  };
}

export interface StopAllCommandInput {
  sessionID: string;
  command: string;
  arguments: string;
}

export interface StopAllOutput {
  parts: Array<Record<string, unknown> & { type: string; text?: string }>;
  message?: Record<string, unknown>;
}

const STOP_ALL_REGEX = /^\/stop-all\s*$/i;

function extractPromptText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function detectAbortCurrentSession(input: StopAllInput) {
  const abort = input.client?.session?.abort;
  if (typeof abort !== "function") return undefined;

  return async (sessionID: string) => {
    await abort({ path: { id: sessionID } });
  };
}

function buildOutputPart(
  existingParts: StopAllOutput["parts"],
  text: string
): StopAllOutput["parts"][number] {
  const first = existingParts[0];
  if (first) {
    return { ...first, type: "text", text };
  }
  return { type: "text", text };
}

export function createStopAllHook(options: {
  backgroundManager: BackgroundManager;
  interactiveManager?: InteractiveManager;
  abortCurrentSession?: (sessionID: string) => Promise<void>;
}) {
  const { backgroundManager, interactiveManager, abortCurrentSession } = options;

  async function execute(
    sessionID: string,
    input: StopAllInput | StopAllCommandInput,
    output: StopAllOutput
  ): Promise<void> {
    const tasks = await backgroundManager.listTasks();
    const cancellableTasks = tasks.filter((task) => task.status !== "completed" && task.status !== "failed");

    await Promise.all(
      cancellableTasks.map((task) => backgroundManager.cancel(task.id).catch(() => undefined)),
    );

    if (interactiveManager) {
      await interactiveManager.cleanup();
    }

    output.parts = [buildOutputPart(output.parts, `Stopped ${cancellableTasks.length} background task(s) and terminated active processes.`)];

    const abort = abortCurrentSession ?? detectAbortCurrentSession(input as StopAllInput);
    if (abort) {
      await abort(sessionID);
    }
  }

  return {
    "chat.message": async (input: StopAllInput, output: StopAllOutput): Promise<void> => {
      const promptText = extractPromptText(output.parts);
      if (!STOP_ALL_REGEX.test(promptText)) return;
      await execute(input.sessionID, input, output);
    },

    "command.execute.before": async (
      input: StopAllCommandInput,
      output: StopAllOutput
    ): Promise<void> => {
      if (input.command !== "stop-all") return;
      await execute(input.sessionID, input, output);
    },
  };
}
