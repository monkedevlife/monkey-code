import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQLiteClient } from "../utils/sqlite-client.js";
import { writePlan, readPlan, listPlans, startWorkFromPlan, updatePlanTaskState } from "./plan-store.js";

describe("plan-store", () => {
  let sqlite: SQLiteClient;

  beforeEach(async () => {
    sqlite = new SQLiteClient(":memory:");
    await sqlite.initialize();
  });

  afterEach(async () => {
    await sqlite.close();
  });

  it("writes and reads a structured plan", async () => {
    const written = await writePlan(sqlite, {
      projectPath: "/tmp/project-a",
      worktree: "/tmp/project-a",
      sessionId: "session-1",
      agent: "caesar",
      title: "Authentication Refactor",
      sourceRequest: "Create a work plan for auth refactor",
      summary: "Refactor auth in parallel waves",
      markdown: "# Authentication Refactor\n\n## TODOs",
      plan: { waves: [1, 2] },
      tasks: [
        {
          taskNumber: "1",
          title: "Map auth entrypoints",
          wave: "Wave 1",
          dependsOn: [],
          skills: ["grep_app"],
          acceptanceCriteria: ["Entrypoints listed"],
        },
      ],
    });

    expect(written.plan.id).toBeDefined();
    expect(written.plan.slug).toBe("authentication-refactor");
    expect(written.tasks.length).toBe(1);

    const read = await readPlan(sqlite, {
      id: written.plan.id,
    });

    expect(read.plan.title).toBe("Authentication Refactor");
    expect(read.tasks[0]?.task_number).toBe("1");
    expect(read.tasks[0]?.skills).toEqual(["grep_app"]);
  });

  it("lists plans by project path", async () => {
    await writePlan(sqlite, {
      projectPath: "/tmp/project-b",
      agent: "caesar",
      title: "Plan One",
      sourceRequest: "one",
      markdown: "# One",
    });

    await new Promise((resolve) => setTimeout(resolve, 2));

    await writePlan(sqlite, {
      projectPath: "/tmp/project-b",
      agent: "caesar",
      title: "Plan Two",
      sourceRequest: "two",
      markdown: "# Two",
    });

    const plans = await listPlans(sqlite, {
      projectPath: "/tmp/project-b",
    });

    expect(plans.length).toBe(2);
    expect(plans[0]?.title).toBe("Plan Two");
  });

  it("starts work from a stored plan name", async () => {
    await writePlan(sqlite, {
      projectPath: "/tmp/project-c",
      agent: "caesar",
      title: "UI Cleanup",
      sourceRequest: "plan ui cleanup",
      markdown: "# UI Cleanup\n\nDo the work.",
      tasks: [{ taskNumber: "1", title: "Refine header spacing" }],
    });

    const started = await startWorkFromPlan(sqlite, {
      planName: "UI Cleanup",
      projectPath: "/tmp/project-c",
      sessionId: "session-22",
      worktree: "/tmp/project-c",
      agent: "punch",
    });

    expect(started.plan.status).toBe("active");
    expect(started.prompt).toContain("UI Cleanup");
    expect(started.prompt).toContain("Project Path: /tmp/project-c");
    expect(started.prompt).toContain("Refine header spacing");
  });

  it("updates a stored task state and appends an event", async () => {
    const written = await writePlan(sqlite, {
      projectPath: "/tmp/project-d",
      agent: "caesar",
      title: "Execution Plan",
      sourceRequest: "execute",
      markdown: "# Execution Plan",
      tasks: [{ taskNumber: "1", title: "Run background step" }],
    });

    const updated = await updatePlanTaskState(sqlite, {
      planId: written.plan.id,
      taskId: written.tasks[0]?.id,
      status: "in_progress",
      eventType: "plan.task.started",
      eventPayload: { backgroundTaskId: "task-1" },
    });

    expect(updated?.status).toBe("in_progress");

    const events = await sqlite.getPlanEvents(written.plan.id);
    expect(events.some((event) => event.event_type === "plan.task.started")).toBe(true);
  });
});
