import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { SQLiteClient } from "../utils/sqlite-client.js";
import { BackgroundManager } from "../managers/BackgroundManager.js";
import { writePlan } from "../tools/plan-store.js";
import { continueActivePlan } from "./plan-continuation.js";

describe("plan-continuation hook", () => {
  let sqlite: SQLiteClient;
  let backgroundManager: BackgroundManager;

  beforeEach(async () => {
    sqlite = new SQLiteClient(":memory:");
    await sqlite.initialize();
    backgroundManager = {
      launch: mock(() => Promise.resolve("task-123")),
      cancel: mock(() => Promise.resolve()),
      getStatus: mock(() => Promise.resolve(null)),
      getOutput: mock(() => Promise.resolve(null)),
      listTasks: mock(() => Promise.resolve([])),
      getRunningCount: mock(() => 0),
      getConcurrencyLimit: mock(() => 5),
      setConcurrencyLimit: mock(() => {}),
      onTaskComplete: mock(() => {}),
    } as unknown as BackgroundManager;
  });

  afterEach(async () => {
    await sqlite.close();
  });

  it("delegates the next runnable plan task on continuation", async () => {
    await writePlan(sqlite, {
      projectPath: "/tmp/project-loop",
      sessionId: "session-loop",
      agent: "caesar",
      title: "Loop Plan",
      status: "active",
      sourceRequest: "loop",
      markdown: "# Loop Plan",
      tasks: [
        { taskNumber: "1", title: "First", status: "completed" },
        { taskNumber: "2", title: "Second", dependsOn: ["1"] },
      ],
    });

    const client = {
      session: {
        create: mock(() => Promise.resolve({ data: { id: "session-child" } })),
        prompt: mock(() => Promise.resolve({ data: {} })),
      },
    };

    const result = await continueActivePlan(
      {
        sqlite,
        backgroundManager,
        client,
        projectPath: "/tmp/project-loop",
        worktree: "/tmp/project-loop",
        defaultAgent: "punch",
      },
      { sessionID: "session-loop" },
    );

    expect(result?.task.task_number).toBe("2");
    expect(client.session.create).toHaveBeenCalled();
    expect(backgroundManager.launch).toHaveBeenCalled();

    const planTasks = await sqlite.getPlanTasks(result?.plan.id as string);
    expect(planTasks.find((task) => task.task_number === "2")?.status).toBe("in_progress");
  });

  it("returns null when no runnable task exists", async () => {
    const result = await continueActivePlan(
      {
        sqlite,
        backgroundManager,
        client: {
          session: {
            create: mock(() => Promise.resolve({ data: { id: "session-child" } })),
            prompt: mock(() => Promise.resolve({ data: {} })),
          },
        },
        projectPath: "/tmp/none",
        defaultAgent: "punch",
      },
      { sessionID: "session-none" },
    );

    expect(result).toBeNull();
  });

  it("does not dispatch when a task in the active plan is already in progress", async () => {
    await writePlan(sqlite, {
      projectPath: "/tmp/project-busy",
      sessionId: "session-busy",
      agent: "caesar",
      title: "Busy Plan",
      status: "active",
      sourceRequest: "busy",
      markdown: "# Busy Plan",
      tasks: [
        { taskNumber: "1", title: "Running", status: "in_progress" },
        { taskNumber: "2", title: "Pending next" },
      ],
    });

    const client = {
      session: {
        create: mock(() => Promise.resolve({ data: { id: "session-child" } })),
        prompt: mock(() => Promise.resolve({ data: {} })),
      },
    };

    const result = await continueActivePlan(
      {
        sqlite,
        backgroundManager,
        client,
        projectPath: "/tmp/project-busy",
        worktree: "/tmp/project-busy",
        defaultAgent: "punch",
      },
      { sessionID: "session-busy" },
    );

    expect(result).toBeNull();
    expect(client.session.create).not.toHaveBeenCalled();
    expect(backgroundManager.launch).not.toHaveBeenCalled();
  });

  it("prevents double dispatch under concurrent continuation calls", async () => {
    await writePlan(sqlite, {
      projectPath: "/tmp/project-lock",
      sessionId: "session-lock",
      agent: "caesar",
      title: "Lock Plan",
      status: "active",
      sourceRequest: "lock",
      markdown: "# Lock Plan",
      tasks: [{ taskNumber: "1", title: "Only once" }],
    });

    const client = {
      session: {
        create: mock(() => Promise.resolve({ data: { id: "session-child" } })),
        prompt: mock(() => Promise.resolve({ data: {} })),
      },
    };

    const [first, second] = await Promise.all([
      continueActivePlan(
        {
          sqlite,
          backgroundManager,
          client,
          projectPath: "/tmp/project-lock",
          worktree: "/tmp/project-lock",
          defaultAgent: "punch",
        },
        { sessionID: "session-lock" },
      ),
      continueActivePlan(
        {
          sqlite,
          backgroundManager,
          client,
          projectPath: "/tmp/project-lock",
          worktree: "/tmp/project-lock",
          defaultAgent: "punch",
        },
        { sessionID: "session-lock" },
      ),
    ]);

    expect([first, second].filter(Boolean).length).toBe(1);
    expect(backgroundManager.launch).toHaveBeenCalledTimes(1);
  });
});
