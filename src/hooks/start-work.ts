import type { SQLiteClient } from "../utils/sqlite-client.js";
import { startWorkFromPlan } from "../tools/plan-store.js";

export interface StartWorkInput {
  sessionID: string;
}

export interface StartWorkOutput {
  parts: Array<Record<string, unknown> & { type: string; text?: string }>;
  message?: Record<string, unknown>;
}

export interface StartWorkCommandInput {
  sessionID: string;
  command: string;
  arguments: string;
}

const START_WORK_REGEX = /^\/start-work(?:\s+(?:"([^"]+)"|(.+)))?$/i;

function extractPromptText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildOutputPart(
  existingParts: StartWorkOutput["parts"],
  text: string
): StartWorkOutput["parts"][number] {
  const first = existingParts[0];
  if (first) {
    return { ...first, type: "text", text };
  }
  return { type: "text", text };
}

export function createStartWorkHook(options: {
  sqlite: SQLiteClient;
  projectPath: string;
  worktree: string;
  defaultAgent?: string;
}) {
  const { sqlite, projectPath, worktree, defaultAgent = "punch" } = options;

  async function execute(
    sessionID: string,
    planName: string,
    output: StartWorkOutput
  ): Promise<void> {
    const result = await startWorkFromPlan(sqlite, {
      planName,
      projectPath,
      sessionId: sessionID,
      worktree,
      agent: defaultAgent,
    });

    output.parts = [buildOutputPart(output.parts, result.prompt)];
    if (output.message) {
      output.message.agent = defaultAgent;
    }
  }

  return {
    "chat.message": async (input: StartWorkInput, output: StartWorkOutput): Promise<void> => {
      const promptText = extractPromptText(output.parts);
      const match = promptText.match(START_WORK_REGEX);
      if (!match) return;

      const planName = (match[1] ?? match[2] ?? "").trim();
      if (!planName) {
        throw new Error("/start-work requires a plan name");
      }

      await execute(input.sessionID, planName, output);
    },

    "command.execute.before": async (
      input: StartWorkCommandInput,
      output: StartWorkOutput
    ): Promise<void> => {
      if (input.command !== "start-work") return;
      const planName = input.arguments.trim();
      if (!planName) {
        throw new Error("/start-work requires a plan name");
      }
      await execute(input.sessionID, planName, output);
    },
  };
}
