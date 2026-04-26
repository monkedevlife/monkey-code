import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQLiteClient } from "../utils/sqlite-client.js";
import { writePlan } from "../tools/plan-store.js";
import { createStartWorkHook } from "./start-work.js";

describe("start-work hook", () => {
  let sqlite: SQLiteClient;

  beforeEach(async () => {
    sqlite = new SQLiteClient(":memory:");
    await sqlite.initialize();
  });

  afterEach(async () => {
    await sqlite.close();
  });

  it("replaces /start-work prompt with stored plan execution prompt", async () => {
    await writePlan(sqlite, {
      projectPath: "/tmp/project-hook",
      worktree: "/tmp/project-hook",
      sessionId: "session-plan",
      agent: "caesar",
      title: "My Feature Plan",
      sourceRequest: "Plan the feature",
      markdown: "# My Feature Plan\n\n## TODOs",
      tasks: [{ taskNumber: "1", title: "Implement feature shell" }],
    });

    const hook = createStartWorkHook({
      sqlite,
      projectPath: "/tmp/project-hook",
      worktree: "/tmp/project-hook",
      defaultAgent: "punch",
    });

    const output = {
      parts: [{ type: "text", text: '/start-work "My Feature Plan"' }],
      message: {} as Record<string, unknown>,
    };

    await hook["chat.message"]?.({ sessionID: "session-start" }, output);

    expect(output.parts[0]?.text).toContain("You are starting work from the stored plan");
    expect(output.parts[0]?.text).toContain("My Feature Plan");
    expect(output.parts[0]?.text).toContain("Implement feature shell");
    expect(output.message.agent).toBe("punch");
  });
});
