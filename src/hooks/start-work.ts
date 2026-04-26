import type { SQLiteClient } from "../utils/sqlite-client.js";
import { startWorkFromPlan } from "../tools/plan-store.js";

export interface StartWorkInput {
  sessionID: string;
}

export interface StartWorkOutput {
  parts: Array<{ type: string; text?: string }>;
  message?: Record<string, unknown>;
}

const START_WORK_REGEX = /^\/start-work(?:\s+(?:"([^"]+)"|(.+)))?$/i;

function extractPromptText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function createStartWorkHook(options: {
  sqlite: SQLiteClient;
  projectPath: string;
  worktree: string;
  defaultAgent?: string;
}) {
  const { sqlite, projectPath, worktree, defaultAgent = "punch" } = options;

  return {
    "chat.message": async (input: StartWorkInput, output: StartWorkOutput): Promise<void> => {
      const promptText = extractPromptText(output.parts);
      const match = promptText.match(START_WORK_REGEX);
      if (!match) return;

      const planName = (match[1] ?? match[2] ?? "").trim();
      if (!planName) {
        throw new Error("/start-work requires a plan name");
      }

      const result = await startWorkFromPlan(sqlite, {
        planName,
        projectPath,
        sessionId: input.sessionID,
        worktree,
        agent: defaultAgent,
      });

      output.parts = [{ type: "text", text: result.prompt }];
      if (output.message) {
        output.message.agent = defaultAgent;
      }
    },
  };
}
