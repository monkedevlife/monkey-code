import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getBackgroundOutput, BackgroundOutputParams, BackgroundOutputResult } from "./background-output";
import { BackgroundManager } from "../managers/BackgroundManager.js";
import { SQLiteClient } from "../utils/sqlite-client.js";

describe("getBackgroundOutput", () => {
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

  describe("invalid parameters", () => {
    it("should throw error if taskId is missing", async () => {
      const params: any = { taskId: "" };
      try {
        await getBackgroundOutput(manager, params);
        expect(true).toBe(false);
      } catch (error) {
        expect((error as Error).message).toContain("taskId is required");
      }
    });

    it("should throw error if taskId is not a string", async () => {
      const params: any = { taskId: 123 };
      try {
        await getBackgroundOutput(manager, params);
        expect(true).toBe(false);
      } catch (error) {
        expect((error as Error).message).toContain("taskId is required");
      }
    });

    it("should throw error if task not found", async () => {
      const params: BackgroundOutputParams = { taskId: "nonexistent" };
      try {
        await getBackgroundOutput(manager, params);
        expect(true).toBe(false);
      } catch (error) {
        expect((error as Error).message).toContain("Task not found");
      }
    });
  });

  describe("pending task", () => {
    it("should return pending task without waiting", async () => {
      const taskId = await manager.launch({
        command: "sleep 1",
      });

      const params: BackgroundOutputParams = { taskId, wait: false };
      const result = await getBackgroundOutput(manager, params);

      expect(result.taskId).toBe(taskId);
      expect(["pending", "in_progress"]).toContain(result.status);
      expect(result.startTime).toBeString();
      expect(result.waited).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.outputLength).toBe(0);
      expect(result.nextActions).toBeArray();
      expect(result.nextActions.some(a => a.action === 'poll-again')).toBe(true);
    });

    it("should return pending task with default wait false", async () => {
      const taskId = await manager.launch({
        command: "sleep 1",
      });

      const params: BackgroundOutputParams = { taskId };
      const result = await getBackgroundOutput(manager, params);

      expect(result.taskId).toBe(taskId);
      expect(["pending", "in_progress"]).toContain(result.status);
      expect(result.waited).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.nextActions).toBeArray();
    });
  });

  describe("completed task", () => {
    it("should return completed task output", async () => {
      const taskId = await manager.launch({
        command: "echo 'hello world'",
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const params: BackgroundOutputParams = { taskId, wait: false };
      const result = await getBackgroundOutput(manager, params);

      expect(result.taskId).toBe(taskId);
      expect(result.status).toBe("completed");
      expect(result.output).toBeString();
      expect(result.startTime).toBeString();
      expect(result.waited).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.outputLength).toBeGreaterThan(0);
      expect(result.nextActions).toBeArray();
    });

    it("should include endTime and metadata for completed task", async () => {
      const taskId = await manager.launch({
        command: "echo 'test'",
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const params: BackgroundOutputParams = { taskId };
      const result = await getBackgroundOutput(manager, params);

      expect(result.endTime).toBeString();
      const endTime = new Date(result.endTime!);
      expect(endTime.getTime()).toBeGreaterThan(0);
      expect(result.outputLength).toBeGreaterThan(0);
      expect(result.outputTruncated).toBe(false);
    });
  });

  describe("failed task", () => {
    it("should return failed task with error info in output", async () => {
      const taskId = await manager.launch({
        command: "exit 1",
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const params: BackgroundOutputParams = { taskId };
      const result = await getBackgroundOutput(manager, params);

      expect(result.taskId).toBe(taskId);
      expect(result.status).toBe("failed");
      expect(result.output).toBeDefined();
      expect(result.waited).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.nextActions).toBeArray();
    });
  });

  describe("wait functionality", () => {
    it("should return immediately when task is already complete", async () => {
      const taskId = await manager.launch({
        command: "echo 'done'",
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const params: BackgroundOutputParams = { taskId, wait: true, timeout: 5000 };
      const startMs = Date.now();
      const result = await getBackgroundOutput(manager, params);
      const elapsedMs = Date.now() - startMs;

      expect(result.status).toBe("completed");
      expect(result.waited).toBe(true);
      expect(result.waitTimeMs).toBeDefined();
      expect(result.waitTimeMs!).toBeLessThan(1000);
      expect(elapsedMs).toBeLessThan(1000);
    });

    it("should wait for task completion with timeout", async () => {
      const taskId = await manager.launch({
        command: "sleep 0.2",
      });

      const params: BackgroundOutputParams = { taskId, wait: true, timeout: 5000 };
      const result = await getBackgroundOutput(manager, params);

      expect(result.taskId).toBe(taskId);
      expect(["completed", "failed"]).toContain(result.status);
      expect(result.waited).toBe(true);
      expect(result.waitTimeMs).toBeDefined();
      expect(result.waitTimeMs!).toBeGreaterThan(0);
    });

    it("should timeout waiting for task", async () => {
      const taskId = await manager.launch({
        command: "sleep 10",
      });

      const params: BackgroundOutputParams = { taskId, wait: true, timeout: 200 };
      const result = await getBackgroundOutput(manager, params);

      expect(result.taskId).toBe(taskId);
      expect(["pending", "in_progress"]).toContain(result.status);
      expect(result.waited).toBe(true);
      expect(result.waitTimeMs).toBeDefined();
      expect(result.waitTimeMs!).toBeGreaterThanOrEqual(200);
      expect(result.nextActions.some(a => a.action === 'poll-again')).toBe(true);
    });
  });

  describe("result format", () => {
    it("should return properly formatted result", async () => {
      const taskId = await manager.launch({
        command: "echo 'test'",
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const params: BackgroundOutputParams = { taskId };
      const result = await getBackgroundOutput(manager, params) as BackgroundOutputResult;

      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("waited");
      expect(result).toHaveProperty("outputTruncated");
      expect(result).toHaveProperty("outputLength");
      expect(result).toHaveProperty("nextActions");
      expect(result.taskId).toBe(taskId);
      expect(typeof result.status).toBe("string");
      expect(typeof result.startTime).toBe("string");
      expect(Array.isArray(result.nextActions)).toBe(true);
    });

    it("should include optional error field", async () => {
      const taskId = await manager.launch({
        command: "exit 1",
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const params: BackgroundOutputParams = { taskId };
      const result = await getBackgroundOutput(manager, params) as BackgroundOutputResult;

      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("startTime");
      expect(result).toHaveProperty("waited");
      expect(result).toHaveProperty("outputTruncated");
      expect(result).toHaveProperty("nextActions");
      expect(result.status).toBe("failed");
    });
  });
});
