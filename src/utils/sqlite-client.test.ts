import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  SQLiteClient,
  SQLiteClientError,
  createSQLiteClient,
  Task,
} from "./sqlite-client";

function createMockEmbedding(seed: number = 0): Float32Array {
  const arr = new Float32Array(1536);
  for (let i = 0; i < 1536; i++) {
    arr[i] = Math.sin(seed + i * 0.01) * 0.5 + 0.5;
  }
  return arr;
}

describe("SQLiteClient", () => {
  let client: SQLiteClient;

  beforeEach(async () => {
    client = createSQLiteClient();
    await client.initialize();
  });

  afterEach(async () => {
    await client.close();
  });

  describe("initialization", () => {
    it("should initialize successfully", async () => {
      const newClient = createSQLiteClient();
      await newClient.initialize();
      expect(newClient.isInitialized()).toBe(true);
      await newClient.close();
    });

    it("should throw error when using methods before initialization", async () => {
      const newClient = createSQLiteClient();
      expect(newClient.isInitialized()).toBe(false);

      expect(() => newClient.storeTask({
        id: "test",
        status: "pending",
        command: "echo test",
      })).toThrow(SQLiteClientError);

      await newClient.close();
    });

    it("should allow multiple initialize calls", async () => {
      await client.initialize();
      await client.initialize();
      expect(client.isInitialized()).toBe(true);
    });
  });

  describe("storeTask", () => {
    it("should store a task successfully", async () => {
      const task: Omit<Task, "created_at"> = {
        id: "task-1",
        status: "pending",
        command: "echo hello",
        output: "",
      };

      await client.storeTask(task);
      const retrieved = await client.getTask("task-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("task-1");
      expect(retrieved?.status).toBe("pending");
      expect(retrieved?.command).toBe("echo hello");
    });

    it("should store a task with embedding", async () => {
      const embedding = createMockEmbedding(1);
      const task: Omit<Task, "created_at"> = {
        id: "task-2",
        status: "pending",
        command: "echo test",
        output: "",
        embedding,
      };

      await client.storeTask(task);
      const retrieved = await client.getTask("task-2");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.embedding).toBeDefined();
      expect(retrieved?.embedding?.length).toBe(1536);
    });

    it("should update existing task", async () => {
      const task = {
        id: "task-3",
        status: "pending" as const,
        command: "echo first",
        output: "",
      };

      await client.storeTask(task);
      await client.storeTask({
        ...task,
        status: "completed",
        output: "done",
      });

      const retrieved = await client.getTask("task-3");
      expect(retrieved?.status).toBe("completed");
      expect(retrieved?.output).toBe("done");
    });

    it("should use current timestamp when created_at not provided", async () => {
      const before = Date.now();
      await client.storeTask({
        id: "task-4",
        status: "pending",
        command: "echo test",
      });
      const after = Date.now();

      const retrieved = await client.getTask("task-4");
      expect(retrieved?.created_at).toBeGreaterThanOrEqual(before);
      expect(retrieved?.created_at).toBeLessThanOrEqual(after);
    });
  });

  describe("getTask", () => {
    it("should return null for non-existent task", async () => {
      const result = await client.getTask("non-existent");
      expect(result).toBeNull();
    });

    it("should retrieve task with all fields", async () => {
      const createdAt = Date.now();
      const completedAt = createdAt + 1000;
      const embedding = createMockEmbedding(2);

      await client.storeTask({
        id: "task-complete",
        status: "completed",
        command: "echo complete",
        output: "output text",
        created_at: createdAt,
        completed_at: completedAt,
        embedding,
      });

      const retrieved = await client.getTask("task-complete");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("task-complete");
      expect(retrieved?.status).toBe("completed");
      expect(retrieved?.command).toBe("echo complete");
      expect(retrieved?.output).toBe("output text");
      expect(retrieved?.created_at).toBe(createdAt);
      expect(retrieved?.completed_at).toBe(completedAt);
      expect(retrieved?.embedding).toBeDefined();
    });
  });

  describe("getTasksByStatus", () => {
    it("should return empty array when no tasks match", async () => {
      const tasks = await client.getTasksByStatus("completed");
      expect(tasks).toEqual([]);
    });

    it("should return tasks filtered by status", async () => {
      await client.storeTask({ id: "t1", status: "pending", command: "cmd1", created_at: 1000 });
      await client.storeTask({ id: "t2", status: "pending", command: "cmd2", created_at: 2000 });
      await client.storeTask({ id: "t3", status: "completed", command: "cmd3", created_at: 3000 });

      const pending = await client.getTasksByStatus("pending");
      const completed = await client.getTasksByStatus("completed");

      expect(pending.length).toBe(2);
      expect(completed.length).toBe(1);
      expect(pending[0].id).toBe("t2");
      expect(pending[1].id).toBe("t1");
      expect(completed[0].id).toBe("t3");
    });

    it("should order tasks by created_at descending", async () => {
      await client.storeTask({
        id: "older",
        status: "pending",
        command: "cmd",
        created_at: 1000,
      });
      await client.storeTask({
        id: "newer",
        status: "pending",
        command: "cmd",
        created_at: 2000,
      });

      const tasks = await client.getTasksByStatus("pending");
      expect(tasks[0].id).toBe("newer");
      expect(tasks[1].id).toBe("older");
    });
  });

  describe("updateTaskStatus", () => {
    it("should update task status", async () => {
      await client.storeTask({ id: "update-test", status: "pending", command: "cmd" });
      await client.updateTaskStatus("update-test", "in_progress");

      const task = await client.getTask("update-test");
      expect(task?.status).toBe("in_progress");
    });

    it("should update task with output and completed_at", async () => {
      const completedAt = Date.now();
      await client.storeTask({ id: "complete-test", status: "pending", command: "cmd" });
      await client.updateTaskStatus("complete-test", "completed", "done", completedAt);

      const task = await client.getTask("complete-test");
      expect(task?.status).toBe("completed");
      expect(task?.output).toBe("done");
      expect(task?.completed_at).toBe(completedAt);
    });

    it("should not fail for non-existent task", async () => {
      await client.updateTaskStatus("non-existent", "completed");
    });
  });

  describe("deleteTask", () => {
    it("should delete existing task", async () => {
      await client.storeTask({ id: "delete-me", status: "pending", command: "cmd" });
      const deleted = await client.deleteTask("delete-me");

      expect(deleted).toBe(true);
      const task = await client.getTask("delete-me");
      expect(task).toBeNull();
    });

    it("should return false for non-existent task", async () => {
      const deleted = await client.deleteTask("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("storeMemory", () => {
    it("should store memory with embedding", async () => {
      const embedding = createMockEmbedding(3);
      const id = await client.storeMemory(embedding, "test content", { key: "value" });

      expect(id).toBeGreaterThan(0);
    });

    it("should throw error for invalid embedding size", async () => {
      const invalidEmbedding = new Float32Array(100);

      expect(client.storeMemory(invalidEmbedding, "content")).rejects.toThrow(
        SQLiteClientError
      );
    });

    it("should use empty metadata by default", async () => {
      const embedding = createMockEmbedding(4);
      await client.storeMemory(embedding, "content without metadata");
    });

    it("should accept complex metadata", async () => {
      const embedding = createMockEmbedding(5);
      const metadata = {
        nested: { key: "value" },
        array: [1, 2, 3],
        number: 42,
        boolean: true,
      };

      const id = await client.storeMemory(embedding, "complex metadata", metadata);
      expect(id).toBeGreaterThan(0);
    });
  });

  describe("searchSimilar", () => {
    it("should return empty array when no memories exist", async () => {
      const query = createMockEmbedding(10);
      const results = await client.searchSimilar(query, 5);

      expect(results).toEqual([]);
    });

    it("should throw error for invalid embedding size", async () => {
      const invalidEmbedding = new Float32Array(100);

      expect(client.searchSimilar(invalidEmbedding)).rejects.toThrow(
        SQLiteClientError
      );
    });

    it("should throw error for invalid limit", async () => {
      const query = createMockEmbedding(10);

      expect(client.searchSimilar(query, 0)).rejects.toThrow(SQLiteClientError);
      expect(client.searchSimilar(query, 101)).rejects.toThrow(SQLiteClientError);
    });

    it("should return similar memories with distance", async () => {
      const embedding1 = createMockEmbedding(20);
      const embedding2 = createMockEmbedding(21);
      const embedding3 = createMockEmbedding(22);

      await client.storeMemory(embedding1, "content 1", { id: 1 });
      await client.storeMemory(embedding2, "content 2", { id: 2 });
      await client.storeMemory(embedding3, "content 3", { id: 3 });

      const results = await client.searchSimilar(embedding1, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].distance).toBeDefined();
      expect(results[0].content).toBeDefined();
      expect(results[0].metadata).toBeDefined();
      expect(results[0].created_at).toBeGreaterThan(0);
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await client.storeMemory(createMockEmbedding(30 + i), `content ${i}`);
      }

      const query = createMockEmbedding(30);
      const results = await client.searchSimilar(query, 3);

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should return memories ordered by similarity", async () => {
      const baseEmbedding = createMockEmbedding(100);

      const similarEmbedding = createMockEmbedding(100);
      for (let i = 0; i < 1536; i++) {
        similarEmbedding[i] = baseEmbedding[i] + (Math.random() - 0.5) * 0.1;
      }

      const differentEmbedding = createMockEmbedding(200);

      await client.storeMemory(similarEmbedding, "similar content");
      await client.storeMemory(differentEmbedding, "different content");

      const results = await client.searchSimilar(baseEmbedding, 2);

      expect(results.length).toBe(2);
      expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
    });
  });

  describe("deleteMemory", () => {
    it("should delete existing memory", async () => {
      const embedding = createMockEmbedding(40);
      const id = await client.storeMemory(embedding, "to be deleted");

      const deleted = await client.deleteMemory(id);
      expect(deleted).toBe(true);

      const results = await client.searchSimilar(embedding, 5);
      const found = results.find((r) => r.id === id);
      expect(found).toBeUndefined();
    });

    it("should return false for non-existent memory", async () => {
      const deleted = await client.deleteMemory(999999);
      expect(deleted).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle special characters in content", async () => {
      const specialContent = "Hello 'world' \"test\" \n newline \t tab -- ;";
      await client.storeTask({
        id: "special",
        status: "pending",
        command: specialContent,
        output: specialContent,
      });

      const task = await client.getTask("special");
      expect(task?.command).toBe(specialContent);
      expect(task?.output).toBe(specialContent);
    });

    it("should handle empty strings", async () => {
      await client.storeTask({
        id: "empty",
        status: "pending",
        command: "",
        output: "",
      });

      const task = await client.getTask("empty");
      expect(task?.command).toBe("");
      expect(task?.output).toBe("");
    });

    it("should handle very long command strings", async () => {
      const longCommand = "a".repeat(10000);
      await client.storeTask({
        id: "long",
        status: "pending",
        command: longCommand,
      });

      const task = await client.getTask("long");
      expect(task?.command).toBe(longCommand);
    });

    it("should handle all valid status values", async () => {
      const statuses: Task["status"][] = ["pending", "in_progress", "completed", "failed"];

      for (let i = 0; i < statuses.length; i++) {
        await client.storeTask({
          id: `status-${i}`,
          status: statuses[i],
          command: "cmd",
        });
      }

      for (let i = 0; i < statuses.length; i++) {
        const task = await client.getTask(`status-${i}`);
        expect(task?.status).toBe(statuses[i]);
      }
    });
  });

  describe("close", () => {
    it("should close database and reset initialized state", async () => {
      expect(client.isInitialized()).toBe(true);
      await client.close();
      expect(client.isInitialized()).toBe(false);
    });

    it("should allow multiple close calls", async () => {
      await client.close();
      await client.close();
    });
  });
});

describe("createSQLiteClient", () => {
  it("should create client with in-memory database by default", async () => {
    const client = createSQLiteClient();
    expect(client).toBeInstanceOf(SQLiteClient);
    await client.close();
  });

  it("should create client with file database when path provided", async () => {
    const tempPath = `/tmp/test-sqlite-${Date.now()}.db`;
    const client = createSQLiteClient(tempPath);
    expect(client).toBeInstanceOf(SQLiteClient);
    await client.close();
  });
});

describe("SQLiteClientError", () => {
  it("should create error with message and code", () => {
    const error = new SQLiteClientError("test message", "TEST_CODE");
    expect(error.message).toBe("test message");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("SQLiteClientError");
  });

  it("should be instanceof Error", () => {
    const error = new SQLiteClientError("test", "CODE");
    expect(error).toBeInstanceOf(Error);
  });
});
