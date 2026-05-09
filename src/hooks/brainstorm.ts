export interface BrainstormInput {
  sessionID: string;
}

export interface BrainstormCommandInput {
  sessionID: string;
  command: string;
  arguments: string;
}

export interface BrainstormOutput {
  parts: Array<Record<string, unknown> & { type: string; text?: string }>;
  message?: Record<string, unknown>;
}

const BRAINSTORM_REGEX = /^\/brainstorm(?:\s+(?:"([^"]+)"|(.+)))?$/i;

function extractPromptText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildOutputPart(
  existingParts: BrainstormOutput["parts"],
  text: string
): BrainstormOutput["parts"][number] {
  const first = existingParts[0];
  if (first) {
    return { ...first, type: "text", text };
  }
  return { type: "text", text };
}

function buildBrainstormPrompt(topic: string) {
  return [
    `Brainstorm creative ideas and approaches for: **${topic}**`,
    "",
    "## Brainstorm Directives",
    "1. **Explore widely** — consider multiple angles, user experiences, and design patterns.",
    "2. **Challenge assumptions** — question defaults and propose unconventional alternatives.",
    "3. **Ground in reality** — tie ideas back to existing codebase patterns where relevant.",
    "4. **Tradeoffs** — for each promising direction, note implementation cost and risk.",
    "5. **Recommendation** — lead with one clear recommendation and include bounded alternatives.",
    "",
    "Separate inspiration from approved direction. Present options; do not assume execution permission.",
  ].join("\n");
}

export function createBrainstormHook() {
  async function execute(
    topic: string,
    output: BrainstormOutput
  ): Promise<void> {
    output.parts = [buildOutputPart(output.parts, buildBrainstormPrompt(topic))];
    if (output.message) {
      output.message.agent = "george";
    }
  }

  return {
    "chat.message": async (_input: BrainstormInput, output: BrainstormOutput): Promise<void> => {
      const promptText = extractPromptText(output.parts);
      const match = promptText.match(BRAINSTORM_REGEX);
      if (!match) return;

      const topic = (match[1] ?? match[2] ?? "").trim();
      if (!topic) {
        throw new Error("/brainstorm requires a topic");
      }
      await execute(topic, output);
    },

    "command.execute.before": async (
      input: BrainstormCommandInput,
      output: BrainstormOutput
    ): Promise<void> => {
      if (input.command !== "brainstorm") return;
      const topic = input.arguments.trim();
      if (!topic) {
        throw new Error("/brainstorm requires a topic");
      }
      await execute(topic, output);
    },
  };
}
