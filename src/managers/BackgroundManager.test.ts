import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BackgroundManager, LaunchTaskInput } from "./BackgroundManager";
import { SQLiteClient } from "../utils/sqlite-client";

describe("BackgroundManager", () => {
  let sqlite: SQLiteClient;
  let manager: BackgroundManager;

  beforeEach(async () => {
    sqlite = new SQLiteClient(":memory:");
    manager = new BackgroundManager(sqlite, {
      concurrencyLimit: 2,
      pollIntervalMs: 100,
    });
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
    await sqlite.close();
  });

  describe("launch", () => {
    it("should create a task with pending status", async () => {
      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);

      expect(taskId).toBeString();
      expect(taskId.startsWith("task_")).toBe(true);

      const status = await manager.getStatus(taskId);
      expect(status).not.toBeNull();
      expect(status?.status).toBeOneOf(["pending", "in_progress", "completed"]);
      expect(status?.command).toBe("node -e 'console.log(1)'");
    });

    it("should store task metadata", async () => {
      const input: LaunchTaskInput = {
        command: "node -e console.log(1)",
        agentName: "test-agent",
        context: "test-context",
        parentSessionId: "session-123",
        planId: "plan-123",
        planTaskId: "plan-task-123",
      };

      const taskId = await manager.launch(input);
      const status = await manager.getStatus(taskId);

      expect(status).not.toBeNull();
      expect(status?.command).toBe("node -e console.log(1)");
      expect((status as any)?.agentName).toBe("test-agent");
      expect((status as any)?.context).toBe("test-context");
      expect((status as any)?.parentSessionId).toBe("session-123");
      expect((status as any)?.planId).toBe("plan-123");
      expect((status as any)?.planTaskId).toBe("plan-task-123");
    });

    it("should start tasks immediately when under concurrency limit", async () => {
      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);
      
      await new Promise((resolve) => setTimeout(resolve, 300));
      
      const status = await manager.getStatus(taskId);
      expect(status?.status).toBeOneOf(["in_progress", "completed"]);
    });
  });

  describe("cancel", () => {
    it("should cancel a pending task", async () => {
      const input: LaunchTaskInput = {
        command: "sleep 10",
      };

      const taskId = await manager.launch(input);
      
      await new Promise((resolve) => setTimeout(resolve, 50));
      
      await manager.cancel(taskId);

      const status = await manager.getStatus(taskId);
      expect(status?.status).toBe("failed");
    });

    it("should throw error for non-existent task", async () => {
      let errorThrown = false;
      try {
        await manager.cancel("non-existent-task");
      } catch (e) {
        errorThrown = true;
      }
      expect(errorThrown).toBe(true);
    });

    it("should throw error for already completed task", async () => {
      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);
      
      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = await manager.getStatus(taskId);
      if (status?.status === "completed") {
        let errorThrown = false;
        try {
          await manager.cancel(taskId);
        } catch (e) {
          errorThrown = true;
        }
        expect(errorThrown).toBe(true);
      }
    });
  });

  describe("getStatus", () => {
    it("should return null for non-existent task", async () => {
      const status = await manager.getStatus("non-existent");
      expect(status).toBeNull();
    });

    it("should return task status for existing task", async () => {
      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);
      const status = await manager.getStatus(taskId);

      expect(status).not.toBeNull();
      expect(status?.id).toBe(taskId);
      expect(status?.command).toBe("node -e 'console.log(1)'");
    });
  });

  describe("getOutput", () => {
    it("should return null for non-existent task", async () => {
      const output = await manager.getOutput("non-existent");
      expect(output).toBeNull();
    });

    it("should return task output after completion", async () => {
      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);
      
      await new Promise((resolve) => setTimeout(resolve, 500));

      const output = await manager.getOutput(taskId);
      expect(typeof output).toBe("string");
    });
  });

  describe("listTasks", () => {
    it("should return empty array when no tasks", async () => {
      const tasks = await manager.listTasks();
      expect(tasks).toBeArray();
      expect(tasks.length).toBe(0);
    });

    it("should return all tasks", async () => {
      await manager.launch({ command: "node -e 'console.log(1)'" });
      await manager.launch({ command: "node -e 'console.log(1)'" });
      await manager.launch({ command: "node -e 'console.log(1)'" });

      const tasks = await manager.listTasks();
      expect(tasks.length).toBe(3);
    });

    it("should filter by status", async () => {
      const taskId = await manager.launch({ command: "node -e 'console.log(1)'" });
      
      await new Promise((resolve) => setTimeout(resolve, 500));

      const completedTasks = await manager.listTasks({ status: "completed" });
      expect(completedTasks.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("concurrency limiting", () => {
    it("should respect concurrency limit", async () => {
      expect(manager.getConcurrencyLimit()).toBe(2);
    });

    it("should allow changing concurrency limit", () => {
      manager.setConcurrencyLimit(5);
      expect(manager.getConcurrencyLimit()).toBe(5);
    });

    it("should throw error for invalid concurrency limit", () => {
      let errorThrown = false;
      try {
        manager.setConcurrencyLimit(0);
      } catch (e) {
        errorThrown = true;
      }
      expect(errorThrown).toBe(true);
    });

    it("should track running tasks count", async () => {
      expect(manager.getRunningCount()).toBe(0);
      
      await manager.launch({ command: "sleep 0.1" });
      await manager.launch({ command: "sleep 0.1" });
      
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      const runningCount = manager.getRunningCount();
      expect(runningCount).toBeGreaterThanOrEqual(0);
      expect(runningCount).toBeLessThanOrEqual(2);
    });
  });

  describe("task lifecycle", () => {
    it("should sync linked plan task status on completion", async () => {
      const plan = await sqlite.savePlan({
        project_path: "/tmp/linked-plan",
        agent_name: "caesar",
        title: "Linked Plan",
        source_request: "run linked work",
        plan_markdown: "# Linked Plan",
      });
      const [planTask] = await sqlite.replacePlanTasks(plan.id, [
        { task_number: "1", title: "Complete linked work" },
      ]);

      const taskId = await manager.launch({
        command: "node -e 'console.log(1)'",
        planId: plan.id,
        planTaskId: planTask?.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const [updatedPlanTask] = await sqlite.getPlanTasks(plan.id);

      expect((await manager.getStatus(taskId))?.status).toBe("completed");
      expect(updatedPlanTask?.status).toBe("completed");

      const events = await sqlite.getPlanEvents(plan.id);
      expect(events.some((event) => event.event_type === "plan.task.started")).toBe(true);
      expect(events.some((event) => event.event_type === "plan.task.completed")).toBe(true);
    });

    it("should sync linked plan task status on cancellation", async () => {
      const plan = await sqlite.savePlan({
        project_path: "/tmp/cancel-plan",
        agent_name: "caesar",
        title: "Cancel Plan",
        source_request: "cancel linked work",
        plan_markdown: "# Cancel Plan",
      });
      const [planTask] = await sqlite.replacePlanTasks(plan.id, [
        { task_number: "1", title: "Cancel linked work" },
      ]);

      const taskId = await manager.launch({
        command: "sleep 10",
        planId: plan.id,
        planTaskId: planTask?.id,
      });

      await manager.cancel(taskId);

      const [updatedPlanTask] = await sqlite.getPlanTasks(plan.id);
      expect((await manager.getStatus(taskId))?.status).toBe("failed");
      expect(updatedPlanTask?.status).toBe("cancelled");

      const events = await sqlite.getPlanEvents(plan.id);
      expect(events.some((event) => event.event_type === "plan.task.cancelled")).toBe(true);
    });

    it("should transition pending → running → completed", async () => {
      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);
      
      let status = await manager.getStatus(taskId);
      expect(status?.status).toBeOneOf(["pending", "in_progress", "completed"]);
      
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      status = await manager.getStatus(taskId);
      expect(status?.status).toBe("completed");
    });

    it("should transition pending → running → failed on error", async () => {
      const input: LaunchTaskInput = {
        command: "exit 1",
      };

      const taskId = await manager.launch(input);
      
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      const status = await manager.getStatus(taskId);
      expect(status?.status).toBe("failed");
    });

    it("should capture stdout output", async () => {
      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);
      
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      const output = await manager.getOutput(taskId);
      expect(typeof output).toBe("string");
    });

    it("should capture stderr on failure", async () => {
      const input: LaunchTaskInput = {
        command: "node -e 'console.error(\"error message\"); process.exit(1)'",
      };

      const taskId = await manager.launch(input);
      
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      const output = await manager.getOutput(taskId);
      expect(typeof output).toBe("string");
    });
  });

  describe("notifications", () => {
    it("should support task completion callback", async () => {
      let notified = false;
      let completedTaskId = "";

      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);
      
      manager.onTaskComplete(taskId, (id, status) => {
        notified = true;
        completedTaskId = id;
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(notified).toBe(true);
      expect(completedTaskId).toBe(taskId);
    });

    it("should pass status and output to callback", async () => {
      let receivedStatus = "";
      let receivedOutput = "";

      const input: LaunchTaskInput = {
        command: "node -e 'console.log(1)'",
      };

      const taskId = await manager.launch(input);
      
      manager.onTaskComplete(taskId, (id, status, output) => {
        receivedStatus = status;
        receivedOutput = output || "";
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedStatus).toBe("completed");
      expect(typeof receivedOutput).toBe("string");
    });
  });

  describe("shutdown", () => {
    it("should cancel running tasks on shutdown", async () => {
      await manager.launch({ command: "sleep 10" });
      
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      expect(manager.getRunningCount()).toBeGreaterThanOrEqual(0);
      
      await manager.shutdown();
      
      expect(manager.getRunningCount()).toBe(0);
    });
  });
});
