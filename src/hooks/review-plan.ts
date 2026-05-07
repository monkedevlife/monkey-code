import type { SQLiteClient, PlanRecord, PlanTaskRecord } from "../utils/sqlite-client.js";
import { readPlan } from "../tools/plan-store.js";

export interface ReviewPlanInput {
  sessionID: string;
}

export interface ReviewPlanCommandInput {
  sessionID: string;
  command: string;
  arguments: string;
}

export interface ReviewPlanOutput {
  parts: Array<Record<string, unknown> & { type: string; text?: string }>;
  message?: Record<string, unknown>;
}

const REVIEW_PLAN_REGEX = /^\/review-plan(?:\s+(?:"([^"]+)"|(.+)))?$/i;

function extractPromptText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildOutputPart(
  existingParts: ReviewPlanOutput["parts"],
  text: string
): ReviewPlanOutput["parts"][number] {
  const first = existingParts[0];
  if (first) {
    return { ...first, type: "text", text };
  }
  return { type: "text", text };
}

function buildReviewPrompt(plan: PlanRecord, tasks: PlanTaskRecord[]) {
  const taskLines = tasks.map((task) => {
    const num = task.task_number ? `${task.task_number}. ` : "";
    const wave = task.wave ? ` | wave: ${task.wave}` : "";
    const deps = task.depends_on.length > 0 ? ` | depends_on: ${task.depends_on.join(", ")}` : "";
    const criteria =
      task.acceptance_criteria.length > 0
        ? `\n      criteria: ${task.acceptance_criteria.join("; ")}`
        : "";
    return `- ${num}${task.title} [${task.status}]${wave}${deps}${criteria}`;
  });

  return [
    `Review the stored plan **"${plan.title}"**.`,
    "",
    `Plan ID: ${plan.id}`,
    `Author: ${plan.agent_name}`,
    `Status: ${plan.status}`,
    `Tasks: ${tasks.length}`,
    "",
    "## Source Request",
    plan.source_request,
    "",
    "## Summary",
    plan.summary || "(none)",
    "",
    "## Full Plan",
    plan.plan_markdown,
    "",
    "## Tasks",
    ...(taskLines.length > 0 ? taskLines : ["(none)"]),
    "",
    "## Review Directives",
    "1. **Missing scope** — edge cases, error paths, missing steps, unstated assumptions.",
    "2. **Task ordering** — are dependencies correct? Can anything be parallelized? Are there circular deps?",
    "3. **Acceptance criteria** — are they specific, testable, and complete?",
    "4. **Ambiguities** — vague language, scope creep, unclear deliverables.",
    "5. **Risks** — what can fail? What is the blast radius? What's the rollback plan?",
    "6. **Improvements** — concrete, actionable, prioritized by impact.",
    "",
    "Output findings grouped by severity: BLOCKER / HIGH / MEDIUM / LOW.",
    "Pair every criticism with a suggested correction. The plan author will revise before execution.",
  ].join("\n");
}

export function createReviewPlanHook(options: {
  sqlite: SQLiteClient;
  projectPath: string;
}) {
  const { sqlite, projectPath } = options;

  async function execute(
    planName: string,
    output: ReviewPlanOutput
  ): Promise<void> {
    const { plan, tasks } = await readPlan(sqlite, {
      projectPath,
      planName,
    });

    output.parts = [buildOutputPart(output.parts, buildReviewPrompt(plan, tasks))];
    if (output.message) {
      output.message.agent = "harambe";
    }
  }

  return {
    "chat.message": async (_input: ReviewPlanInput, output: ReviewPlanOutput): Promise<void> => {
      const promptText = extractPromptText(output.parts);
      const match = promptText.match(REVIEW_PLAN_REGEX);
      if (!match) return;

      const planName = (match[1] ?? match[2] ?? "").trim();
      if (!planName) {
        throw new Error("/review-plan requires a plan name");
      }
      await execute(planName, output);
    },

    "command.execute.before": async (
      input: ReviewPlanCommandInput,
      output: ReviewPlanOutput
    ): Promise<void> => {
      if (input.command !== "review-plan") return;
      const planName = input.arguments.trim();
      if (!planName) {
        throw new Error("/review-plan requires a plan name");
      }
      await execute(planName, output);
    },
  };
}
