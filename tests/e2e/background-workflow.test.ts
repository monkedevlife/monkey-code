import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { delegateTask, type DelegateTaskInput, type OpenCodeClient } from "../../src/tools/delegate-task.js";
import { getBackgroundOutput } from "../../src/tools/background-output.js";
import { BackgroundManager } from "../../src/managers/BackgroundManager.js";
import type { NotificationCallback } from "../../src/managers/BackgroundManager.js";
import type { Task } from "../../src/types/index.js";

interface MockTask {
  id: string;
  status: Task["status"];
  command: string;
  output?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
  agentName?: string;
  context?: string;
  timeout?: number;
  parentSessionId?: string;
}

type MockBackgroundManager = BackgroundManager & {
  _tasks: Map<string, MockTask>;
  _completeTask: (taskId: string, output: string) => void;
  _failTask: (taskId: string, error: string) => void;
};

function createMockOpenCodeClient(): OpenCodeClient {
  let sessionCounter = 0;
  return {
    session: {
      create: vi.fn(() => {
        sessionCounter++;
        return Promise.resolve({
          data: { id: `mock_session_${Date.now()}_${sessionCounter}` },
        });
      }),
      prompt: vi.fn(() => Promise.resolve({ data: {} })),
    },
  };
}

function createMockBackgroundManager(): MockBackgroundManager {
  const tasks = new Map<string, MockTask>();
  const notifications = new Map<string, NotificationCallback>();
  let taskCounter = 0;

  const notify = (task: MockTask) => {
    const callback = notifications.get(task.id);
    if (callback) {
      callback(task.id, task.status, task.output, task.error);
    }
  };

  const manager = {
    launch: vi.fn((input: {
      command: string;
      agentName?: string;
      context?: string;
      timeout?: number;
      parentSessionId?: string;
    }) => {
      taskCounter++;
      const taskId = `mock_task_${Date.now()}_${taskCounter}`;
      const task: MockTask = {
        id: taskId,
        status: "pending",
        command: input.command,
        agentName: input.agentName,
        context: input.context,
        timeout: input.timeout,
        parentSessionId: input.parentSessionId,
        createdAt: Date.now(),
      };
      tasks.set(taskId, task);

      setTimeout(() => {
        task.status = "in_progress";
      }, 50);

      setTimeout(() => {
        task.status = "completed";
        task.output = `Completed: ${input.command}`;
        task.completedAt = Date.now();
        notify(task);
      }, 100);

      return Promise.resolve(taskId);
    }),

    cancel: vi.fn((taskId: string) => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = "cancelled";
        task.completedAt = Date.now();
        notify(task);
      }
      return Promise.resolve();
    }),

    getStatus: vi.fn((taskId: string) => {
      const task = tasks.get(taskId);
      if (!task) return Promise.resolve(null);
      return Promise.resolve({
        id: task.id,
        status: task.status,
        command: task.command,
        output: task.output,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      });
    }),

    getOutput: vi.fn((taskId: string) => {
      const task = tasks.get(taskId);
      return Promise.resolve(task?.output || null);
    }),

    listTasks: vi.fn(() => {
      return Promise.resolve(
        Array.from(tasks.values()).map((t) => ({
          id: t.id,
          status: t.status,
          command: t.command,
          output: t.output,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
        }))
      );
    }),

    getRunningCount: vi.fn(() => 0),
    getConcurrencyLimit: vi.fn(() => 5),
    setConcurrencyLimit: vi.fn(() => {}),
    onTaskComplete: vi.fn((taskId: string, callback: NotificationCallback) => {
      notifications.set(taskId, callback);
    }),

    _tasks: tasks,
    _completeTask: (taskId: string, output: string) => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = "completed";
        task.output = output;
        task.completedAt = Date.now();
        notify(task);
      }
    },
    _failTask: (taskId: string, error: string) => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = "failed";
        task.error = error;
        task.completedAt = Date.now();
        notify(task);
      }
    },
  } as unknown as BackgroundManager & {
    _tasks: Map<string, MockTask>;
    _completeTask: (taskId: string, output: string) => void;
    _failTask: (taskId: string, error: string) => void;
  };

  return manager;
}

describe("E2E: Background Task Workflow", () => {
  let mockClient: OpenCodeClient;
  let mockManager: MockBackgroundManager;

  beforeEach(() => {
    mockClient = createMockOpenCodeClient();
    mockManager = createMockBackgroundManager();
  });

  afterEach(() => {
    mockManager._tasks.clear();
  });

  describe("Task Delegation Flow", () => {
    it("should delegate task and return taskId immediately", async () => {
      const input: DelegateTaskInput = {
        task: "Refactor authentication module",
        agent: "tasker",
      };

      const result = await delegateTask(input, {
        client: mockClient,
        parentSessionId: "parent_session_123",
      });

      expect(result.taskId).toMatch(/^mock_session_/);
      expect(result.status).toBe("in_progress");
      expect(result.sessionId).toMatch(/^mock_session_/);
      expect(result.summary).toContain("Task delegated");
    });

    it("should create child session with parent reference", async () => {
      const input: DelegateTaskInput = {
        task: "Update database schema",
        agent: "punch",
      };

      await delegateTask(input, {
        client: mockClient,
        parentSessionId: "parent_session_abc",
      });

      const createCall = (mockClient.session.create as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(createCall[0].body.parentID).toBe("parent_session_abc");
    });

    it("should pass context to background manager", async () => {
      const input: DelegateTaskInput = {
        task: "Optimize queries",
        agent: "harambe",
        context: "Use PostgreSQL best practices",
        timeout: 45,
      };

      await delegateTask(input, {
        client: mockClient,
      });

      expect(mockClient.session.prompt).toHaveBeenCalled();
      const promptCall = (mockClient.session.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(promptCall[0].body.system).toContain("Use PostgreSQL best practices");
    });
  });

  describe("Polling and Output Retrieval Flow", () => {
    it("should poll for task status and return output when completed", async () => {
      const input: DelegateTaskInput = {
        task: "Run tests",
        agent: "caesar",
      };

      const delegateResult = await delegateTask(input, {
        client: mockClient,
      });

      const taskId = delegateResult.sessionId;
      mockManager._tasks.set(taskId, {
        id: taskId,
        status: "completed",
        command: input.task,
        output: "Completed: Run tests",
        agentName: "caesar",
        createdAt: Date.now(),
        completedAt: Date.now(),
      });

      const outputResult = await getBackgroundOutput(mockManager, {
        taskId,
        wait: true,
        timeout: 5000,
      });

      expect(outputResult.taskId).toBe(taskId);
      expect(outputResult.status).toBe("completed");
      expect(outputResult.output).toContain("Completed");
      expect(outputResult.startTime).toBeDefined();
      expect(outputResult.endTime).toBeDefined();
    });

    it("should return current status without waiting when wait=false", async () => {
      const input: DelegateTaskInput = {
        task: "Build project",
        agent: "tasker",
      };

      const delegateResult = await delegateTask(input, {
        client: mockClient,
      });

      const taskId = delegateResult.sessionId;
      mockManager._tasks.set(taskId, {
        id: taskId,
        status: "in_progress",
        command: input.task,
        agentName: "tasker",
        createdAt: Date.now(),
      });

      const outputResult = await getBackgroundOutput(mockManager, {
        taskId,
        wait: false,
      });

      expect(outputResult.taskId).toBe(taskId);
      expect(outputResult.status).toMatch(/pending|in_progress/);
      expect(outputResult.startTime).toBeDefined();
    });

    it("should handle multiple task delegations and poll each", async () => {
      const tasks = [
        { task: "Task 1", agent: "tasker" },
        { task: "Task 2", agent: "punch" },
        { task: "Task 3", agent: "harambe" },
      ];

      const results = await Promise.all(
        tasks.map((t) =>
          delegateTask(t, {
                client: mockClient,
          })
        )
      );

      expect(results).toHaveLength(3);
      results.forEach((r, i) => {
        expect(r.sessionId).toMatch(/^mock_session_/);
        expect(r.status).toBe("in_progress");
        mockManager._tasks.set(r.sessionId, {
          id: r.sessionId,
          status: "in_progress",
          command: tasks[i].task,
          agentName: tasks[i].agent,
          createdAt: Date.now(),
        });
      });

      const outputs = await Promise.all(
        results.map((r) =>
          getBackgroundOutput(mockManager, {
            taskId: r.sessionId,
            wait: false,
          })
        )
      );

      outputs.forEach((o) => {
        expect(o.status).toMatch(/pending|in_progress|completed/);
      });
    });
  });

  describe("Notification Verification", () => {
    it("should receive notification when task completes", async () => {
      let notificationReceived = false;
      let notifiedTaskId = "";
      let notifiedStatus: Task["status"] | undefined;

      const input: DelegateTaskInput = {
        task: "Deploy application",
        agent: "scout",
      };

      const result = await delegateTask(input, {
        client: mockClient,
        parentSessionId: "session_with_notifications",
      });

      const taskId = result.sessionId;
      mockManager._tasks.set(taskId, {
        id: taskId,
        status: "pending",
        command: input.task,
        agentName: "scout",
        createdAt: Date.now(),
      });

      mockManager.onTaskComplete(taskId, (tid: string, status: Task["status"]) => {
        notificationReceived = true;
        notifiedTaskId = tid;
        notifiedStatus = status;
      });

      mockManager._completeTask(taskId, "Deployment successful");

      expect(notificationReceived).toBe(true);
      expect(notifiedTaskId).toBe(taskId);
      expect(notifiedStatus).toBe("completed");
    });

    it("should handle task failure notification", async () => {
      let notificationReceived = false;
      let notifiedStatus: Task["status"] | undefined;

      const input: DelegateTaskInput = {
        task: "Run failing tests",
        agent: "builder",
      };

      const result = await delegateTask(input, {
        client: mockClient,
      });

      const taskId = result.sessionId;
      mockManager._tasks.set(taskId, {
        id: taskId,
        status: "pending",
        command: input.task,
        agentName: "builder",
        createdAt: Date.now(),
      });

      mockManager.onTaskComplete(taskId, (_tid: string, status: Task["status"]) => {
        notificationReceived = true;
        notifiedStatus = status;
      });

      mockManager._failTask(taskId, "Tests failed with exit code 1");

      expect(notificationReceived).toBe(true);
      expect(notifiedStatus).toBe("failed");
    });
  });

  describe("Error Handling", () => {
    it("should throw error when task not found", async () => {
      await expect(
        getBackgroundOutput(mockManager, {
          taskId: "nonexistent_task",
          wait: false,
        })
      ).rejects.toThrow("Task not found");
    });

    it("should handle task cancellation during polling", async () => {
      const input: DelegateTaskInput = {
        task: "Long running task",
        agent: "george",
      };

      const result = await delegateTask(input, {
        client: mockClient,
      });

      const taskId = result.sessionId;
      mockManager._tasks.set(taskId, {
        id: taskId,
        status: "pending",
        command: input.task,
        agentName: "george",
        createdAt: Date.now(),
      });

      await mockManager.cancel(taskId);

      const status = await mockManager.getStatus(taskId);
      expect(status?.status).toBe("cancelled");
    });

    it("should handle session creation failure", async () => {
      mockClient.session.create = vi.fn(() =>
        Promise.resolve({ data: undefined })
      );

      const input: DelegateTaskInput = {
        task: "Should fail",
        agent: "tasker",
      };

      await expect(
        delegateTask(input, {
            client: mockClient,
        })
      ).rejects.toThrow("Failed to create child session");
    });
  });

  describe("End-to-End Complete Workflow", () => {
    it("should complete full workflow: delegate → poll → get output → verify", async () => {
      const workflowInput: DelegateTaskInput = {
        task: "Run full integration test suite",
        agent: "tasker",
        context: "Use test environment configuration",
        timeout: 60,
      };

      const delegateResult = await delegateTask(workflowInput, {
        client: mockClient,
        parentSessionId: "e2e_test_session",
      });

      expect(delegateResult.taskId).toBeDefined();
      expect(delegateResult.sessionId).toBeDefined();
      expect(delegateResult.status).toBe("in_progress");

      const taskId = delegateResult.sessionId;
      mockManager._tasks.set(taskId, {
        id: taskId,
        status: "pending",
        command: workflowInput.task,
        agentName: "tasker",
        createdAt: Date.now(),
      });

      const initialStatus = await mockManager.getStatus(taskId);
      expect(initialStatus).not.toBeNull();

      mockManager._completeTask(
        taskId,
        "All 42 tests passed successfully"
      );

      const finalOutput = await getBackgroundOutput(mockManager, {
        taskId,
        wait: true,
        timeout: 1000,
      });

      expect(finalOutput.status).toBe("completed");
      expect(finalOutput.output).toContain("All 42 tests passed");
      expect(finalOutput.taskId).toBe(taskId);
      expect(finalOutput.startTime).toBeDefined();
      expect(finalOutput.endTime).toBeDefined();

      const tasks = await mockManager.listTasks();
      const ourTask = tasks.find((t) => t.id === taskId);
      expect(ourTask).toBeDefined();
      expect(ourTask?.status).toBe("completed");
    });
  });
});
