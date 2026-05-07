import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteClient } from "../utils/sqlite-client.js";
import { writePlan } from "../tools/plan-store.js";
import { createReviewPlanHook } from "./review-plan.js";

describe("review-plan hook", () => {
  let sqlite: SQLiteClient;

  beforeEach(async () => {
    sqlite = new SQLiteClient(":memory:");
    await sqlite.initialize();
  });

  afterEach(async () => {
    await sqlite.close();
  });

  it("replaces /review-plan prompt with plan review for harambe", async () => {
    await writePlan(sqlite, {
      projectPath: "/tmp/project-hook",
      worktree: "/tmp/project-hook",
      sessionId: "session-plan",
      agent: "caesar",
      title: "My Feature Plan",
      sourceRequest: "Build a login page",
      summary: "Add login page with auth",
      markdown: "# My Feature Plan\n\n## Implementation\n1. Create login form\n2. Add auth endpoint",
      tasks: [
        { taskNumber: "1", title: "Create login form" },
        { taskNumber: "2", title: "Add auth endpoint", dependsOn: ["1"] },
      ],
    });

    const hook = createReviewPlanHook({
      sqlite,
      projectPath: "/tmp/project-hook",
    });

    const output = {
      parts: [{ type: "text", text: '/review-plan "My Feature Plan"' }],
      message: {} as Record<string, unknown>,
    };

    await hook["chat.message"]?.({ sessionID: "session-start" }, output);

    expect(output.parts[0]?.text).toContain('"My Feature Plan"');
    expect(output.parts[0]?.text).toContain("Build a login page");
    expect(output.parts[0]?.text).toContain("Create login form");
    expect(output.parts[0]?.text).toContain("Add auth endpoint");
    expect(output.parts[0]?.text).toContain("Review Directives");
    expect(output.parts[0]?.text).toContain("BLOCKER");
    expect(output.message.agent).toBe("harambe");
  });

  it("handles command.execute.before for /review-plan", async () => {
    await writePlan(sqlite, {
      projectPath: "/tmp/project-hook",
      worktree: "/tmp/project-hook",
      sessionId: "session-plan",
      agent: "caesar",
      title: "My Feature Plan",
      sourceRequest: "Plan the feature",
      markdown: "# Plan",
      tasks: [{ taskNumber: "1", title: "Do the thing" }],
    });

    const hook = createReviewPlanHook({
      sqlite,
      projectPath: "/tmp/project-hook",
    });

    const output = {
      parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "" }],
      message: { agent: "punch" } as Record<string, unknown>,
    };

    await hook["command.execute.before"]?.(
      { sessionID: "session-start", command: "review-plan", arguments: "My Feature Plan" },
      output
    );

    expect(output.parts[0]?.text).toContain("Review Directives");
    expect(output.parts[0]?.id).toBe("p1");
    expect(output.message.agent).toBe("harambe");
  });

  it("ignores unrelated commands", async () => {
    const hook = createReviewPlanHook({
      sqlite,
      projectPath: "/tmp/project-hook",
    });

    const output = {
      parts: [{ type: "text", text: "" }],
      message: {} as Record<string, unknown>,
    };

    await hook["command.execute.before"]?.(
      { sessionID: "session-start", command: "other", arguments: "" },
      output
    );

    expect(output.parts[0]?.text).toBe("");
    expect(output.message.agent).toBeUndefined();
  });
});
