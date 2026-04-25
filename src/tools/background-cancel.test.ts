import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BackgroundCancelTool, BackgroundCancelParams } from "./background-cancel";
import { BackgroundManager, LaunchTaskInput } from "../managers/BackgroundManager";
import { SQLiteClient } from "../utils/sqlite-client";

describe("BackgroundCancelTool", () => {
  let sqlite: SQLiteClient;
  let backgroundManager: BackgroundManager;
  let cancelTool: BackgroundCancelTool;

  beforeEach(async () => {
    sqlite = new SQLiteClient(":memory:");
    backgroundManager = new BackgroundManager(sqlite, {
      concurrencyLimit: 2,
      pollIntervalMs: 100,
    });
    await backgroundManager.initialize();
    cancelTool = new BackgroundCancelTool(backgroundManager, sqlite);
  });

  afterEach(async () => {
    await backgroundManager.shutdown();
    await sqlite.close();
  });

  describe("execute - single task cancellation", () => {
    it("should cancel a pending task", async () => {
      const input: LaunchTaskInput = {
        command: "sleep 30",
      };

      const taskId = await backgroundManager.launch(input);

      const result = await cancelTool.execute({ taskId });

      expect(result.success).toBe(true);
      expect(result.taskId).toBe(taskId);
      expect(result.summary).toContain("cancelled");
      expect(result.cancelledCount).toBe(1);
      expect(result.cancelledTasks).toContain(taskId);
      expect(result.notFoundTasks).toEqual([]);
      expect(result.alreadyCompletedTasks).toEqual([]);
      expect(result.nextActions).toBeArray();

      const status = await backgroundManager.getStatus(taskId);
      expect(status?.status).toBe("failed");
    });

    it("should handle non-existent task gracefully", async () => {
      const params: BackgroundCancelParams = {
        taskId: "non-existent-task",
      };

      const result = await cancelTool.execute(params);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Task not found");
      expect(result.summary).toContain("not found");
      expect(result.notFoundTasks).toContain("non-existent-task");
      expect(result.cancelledTasks).toEqual([]);
    });

    it("should prevent cancelling already completed task", async () => {
      const input: LaunchTaskInput = {
        command: "node -e console.log(1)",
      };

      const taskId = await backgroundManager.launch(input);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = await backgroundManager.getStatus(taskId);
      expect(status?.status).toBe("completed");

      const result = await cancelTool.execute({ taskId });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already");
    });

    it("should prevent cancelling already failed task", async () => {
      const input: LaunchTaskInput = {
        command: "node -e process.exit(1)",
      };

      const taskId = await backgroundManager.launch(input);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = await backgroundManager.getStatus(taskId);
      expect(status?.status).toBe("failed");

      const result = await cancelTool.execute({ taskId });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already");
    });

    it("should return error when taskId is missing and all is false", async () => {
      const params: BackgroundCancelParams = {
        taskId: "",
      };

      const result = await cancelTool.execute(params);

      expect(result.success).toBe(false);
      expect(result.summary).toContain("Either taskId or all parameter is required");
    });
  });

  describe("execute - cancel all tasks", () => {
    it("should cancel all cancellable tasks", async () => {
      const input1: LaunchTaskInput = {
        command: "sleep 30",
      };
      const input2: LaunchTaskInput = {
        command: "sleep 30",
      };

      const taskId1 = await backgroundManager.launch(input1);
      const taskId2 = await backgroundManager.launch(input2);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await cancelTool.execute({ taskId: "", all: true });

      expect(result.success).toBe(true);
      expect(result.cancelledCount).toBeGreaterThanOrEqual(2);
      expect(result.summary).toContain("Cancelled");
      expect(result.cancelledTasks.length).toBeGreaterThanOrEqual(2);
      expect(result.nextActions).toBeArray();

      const status1 = await backgroundManager.getStatus(taskId1);
      const status2 = await backgroundManager.getStatus(taskId2);

      expect(status1?.status).toBe("failed");
      expect(status2?.status).toBe("failed");
    });

    it("should handle cancelling when no tasks exist", async () => {
      const result = await cancelTool.execute({ taskId: "", all: true });

      expect(result.success).toBe(true);
      expect(result.cancelledCount).toBe(0);
    });

    it("should skip already completed/failed tasks when cancelling all", async () => {
      const input1: LaunchTaskInput = {
        command: "node -e console.log(1)",
      };

      const taskId1 = await backgroundManager.launch(input1);

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect((await backgroundManager.getStatus(taskId1))?.status).toBe(
        "completed"
      );

      const result = await cancelTool.execute({ taskId: "", all: true });

      expect(result.success).toBe(true);
      expect(result.cancelledCount).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should return structured error result on exception", async () => {
      const params: BackgroundCancelParams = {
        taskId: "test-task",
      };

      const result = await cancelTool.execute(params);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("error");
      expect(result).toHaveProperty("cancelledTasks");
      expect(result).toHaveProperty("notFoundTasks");
      expect(result).toHaveProperty("alreadyCompletedTasks");
    });

    it("should not throw - always returns result object", async () => {
      let exceptionThrown = false;

      try {
        await cancelTool.execute({
          taskId: "definitely-non-existent-task-id",
        });
      } catch {
        exceptionThrown = true;
      }

      expect(exceptionThrown).toBe(false);
    });
  });
});
