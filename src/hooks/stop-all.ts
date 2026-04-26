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

export interface StopAllOutput {
  parts: Array<{ type: string; text?: string }>;
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

export function createStopAllHook(options: {
  backgroundManager: BackgroundManager;
  interactiveManager?: InteractiveManager;
  abortCurrentSession?: (sessionID: string) => Promise<void>;
}) {
  const { backgroundManager, interactiveManager, abortCurrentSession } = options;

  return {
    "chat.message": async (input: StopAllInput, output: StopAllOutput): Promise<void> => {
      const promptText = extractPromptText(output.parts);
      if (!STOP_ALL_REGEX.test(promptText)) return;

      const tasks = await backgroundManager.listTasks();
      const cancellableTasks = tasks.filter((task) => task.status !== "completed" && task.status !== "failed");

      await Promise.all(
        cancellableTasks.map((task) => backgroundManager.cancel(task.id).catch(() => undefined)),
      );

      if (interactiveManager) {
        await interactiveManager.cleanup();
      }

      output.parts = [{
        type: "text",
        text: `Stopped ${cancellableTasks.length} background task(s) and terminated active processes.`,
      }];

      const abort = abortCurrentSession ?? detectAbortCurrentSession(input);
      if (abort) {
        await abort(input.sessionID);
      }
    },
  };
}
