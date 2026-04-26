import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  delegateTask,
  DEFAULT_AGENT,
  DEFAULT_TIMEOUT_MINUTES,
  type DelegateTaskInput,
  type DelegateTaskContext,
  type OpenCodeClient,
} from "./delegate-task.js";
import type { BackgroundManager } from "../managers/BackgroundManager.js";
import { getSessionPromptParams, clearSessionPromptParams } from "../utils/session-prompt-params.js";

function createMockClient(): OpenCodeClient {
  return {
    session: {
      create: mock(() => Promise.resolve({ data: { id: `session_${Date.now()}` } })),
      prompt: mock(() => Promise.resolve({ data: {} })),
    },
  };
}

function createMockBackgroundManager(): BackgroundManager {
  let taskCounter = 0;
  return {
    launch: mock(() => {
      taskCounter++;
      return Promise.resolve(`task_${Date.now()}_${taskCounter}`);
    }),
    cancel: mock(() => Promise.resolve()),
    getStatus: mock(() => Promise.resolve(null)),
    getOutput: mock(() => Promise.resolve(null)),
    listTasks: mock(() => Promise.resolve([])),
    getRunningCount: mock(() => 0),
    getConcurrencyLimit: mock(() => 5),
    setConcurrencyLimit: mock(() => {}),
    onTaskComplete: mock(() => {}),
  } as unknown as BackgroundManager;
}

describe("delegate-task", () => {
  let ctx: DelegateTaskContext;

  beforeEach(() => {
    ctx = {
      backgroundManager: createMockBackgroundManager(),
      client: createMockClient(),
      parentSessionId: "parent_session_123",
    };
  });

  describe("delegateTask", () => {
    it("should create child session and return structured output", async () => {
      const input: DelegateTaskInput = {
        task: "Refactor the authentication module",
      };

      const result = await delegateTask(input, ctx);

      expect(result.taskId).toMatch(/^task_/);
      expect(result.sessionId).toMatch(/^session_/);
      expect(result.status).toBe("pending");
      expect(result.agent).toBe("punch");
      expect(result.timeout).toBe(DEFAULT_TIMEOUT_MINUTES);
      expect(result.createdAt).toBeString();
      expect(result.summary).toContain("Task delegated");
      expect(result.nextActions).toBeArray();
      expect(result.nextActions.length).toBeGreaterThan(0);
      expect(result.nextActions[0].tool).toBe("background-output");
      expect(result.nextActions[0].params.taskId).toBe(result.taskId);
    });

    it("should use specified agent instead of default", async () => {
      const input: DelegateTaskInput = {
        task: "Update documentation",
        agent: "punch",
      };

      const result = await delegateTask(input, ctx);

      expect(result.agent).toBe("punch");
      expect(ctx.client.session.prompt).toHaveBeenCalled();
    });

    it("should auto-route exploratory tasks to scout", async () => {
      const input: DelegateTaskInput = {
        task: "Search the codebase for authentication patterns and relevant files",
        agent: "punch",
      };

      const result = await delegateTask(input, ctx);

      expect(result.agent).toBe("scout");
      expect(result.requestedAgent).toBe("punch");
      expect(result.summary).toContain("auto-routed");
      expect(result.routing?.originalAgent).toBe("punch");
      expect(result.routing?.finalAgent).toBe("scout");

      const promptCall = (ctx.client.session.prompt as ReturnType<typeof mock>).mock.calls[0];
      expect(promptCall[0].agent).toBe("scout");
      expect(promptCall[0].system).toContain("grep_app");
      expect(promptCall[0].system).toContain("compact findings");

      const launchCall = (ctx.backgroundManager.launch as ReturnType<typeof mock>).mock.calls[0];
      expect(launchCall[0].agentName).toBe("scout");
      expect(launchCall[0].command).toContain("--agent 'scout'");
    });

    it("should keep scout when exploratory task already targets scout", async () => {
      const input: DelegateTaskInput = {
        task: "Find patterns for session handling across the repo",
        agent: "scout",
      };

      const result = await delegateTask(input, ctx);

      expect(result.agent).toBe("scout");
      expect(result.requestedAgent).toBeUndefined();
      expect(result.routing).toBeUndefined();
    });

    it("should not auto-route non-exploratory execution tasks", async () => {
      const input: DelegateTaskInput = {
        task: "Implement the session cleanup helper",
        agent: "builder",
      };

      const result = await delegateTask(input, ctx);

      expect(result.agent).toBe("builder");
      expect(result.requestedAgent).toBeUndefined();
      expect(result.routing).toBeUndefined();
    });

    it("should use default agent when not specified", async () => {
      const input: DelegateTaskInput = {
        task: "Fix bug in login",
      };

      await delegateTask(input, ctx);

      expect(DEFAULT_AGENT).toBe("punch");
    });

    it("should include context in system prompt when provided", async () => {
      const input: DelegateTaskInput = {
        task: "Optimize database queries",
        context: "Use PostgreSQL best practices",
      };

      await delegateTask(input, ctx);

      expect(ctx.client.session.prompt).toHaveBeenCalled();
      const promptCall = (ctx.client.session.prompt as ReturnType<typeof mock>).mock.calls[0];
      expect(promptCall[0].system).toContain("PostgreSQL best practices");
    });

    it("should use default timeout when not specified", async () => {
      const input: DelegateTaskInput = {
        task: "Clean up unused imports",
      };

      await delegateTask(input, ctx);

      expect(DEFAULT_TIMEOUT_MINUTES).toBe(30);
    });

    it("should pass timeout to background manager", async () => {
      const input: DelegateTaskInput = {
        task: "Long running analysis",
        timeout: 60,
      };

      await delegateTask(input, ctx);

      expect(ctx.backgroundManager.launch).toHaveBeenCalled();
      const launchCall = (ctx.backgroundManager.launch as ReturnType<typeof mock>).mock.calls[0];
      expect(launchCall[0].timeout).toBe(60);
    });

    it("should pass plan linkage to background manager", async () => {
      const input: DelegateTaskInput = {
        task: "Run linked work",
        planId: "plan-123",
        planTaskId: "plan-task-456",
      };

      await delegateTask(input, ctx);

      const launchCall = (ctx.backgroundManager.launch as ReturnType<typeof mock>).mock.calls[0];
      expect(launchCall[0].planId).toBe("plan-123");
      expect(launchCall[0].planTaskId).toBe("plan-task-456");
    });

    it("should set parentSessionId on child session", async () => {
      const input: DelegateTaskInput = {
        task: "Child task",
      };

      await delegateTask(input, ctx);

      expect(ctx.client.session.create).toHaveBeenCalled();
      const createCall = (ctx.client.session.create as ReturnType<typeof mock>).mock.calls[0];
      expect(createCall[0].parentID).toBe("parent_session_123");
    });

    it("should support all valid agents", async () => {
      const agents = ["punch", "harambe", "caesar", "george", "tasker", "scout", "builder"];

      for (const agent of agents) {
        const input: DelegateTaskInput = {
          task: `Task for ${agent}`,
          agent,
        };

        const result = await delegateTask(input, ctx);
        expect(result.agent).toBe(agent);
      }
    });

    it("should throw error when session creation fails", async () => {
      ctx.client.session.create = mock(() => Promise.resolve({ data: undefined }));

      const input: DelegateTaskInput = {
        task: "This should fail",
      };

      expect(delegateTask(input, ctx)).rejects.toThrow("Failed to create child session");
    });

    it("should not wait for task completion", async () => {
      let launchResolved = false;
      ctx.backgroundManager.launch = mock(() =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            launchResolved = true;
            resolve("task_delayed");
          }, 100);
        })
      );

      const input: DelegateTaskInput = {
        task: "Non-blocking task",
      };

      const result = await delegateTask(input, ctx);

      expect(result.taskId).toBeDefined();
      expect(launchResolved).toBe(true);
    });

    it("should include task description in session title", async () => {
      const longTask = "This is a very long task description that should be truncated in the title";
      const input: DelegateTaskInput = {
        task: longTask,
      };

      await delegateTask(input, ctx);

      expect(ctx.client.session.create).toHaveBeenCalled();
      const createCall = (ctx.client.session.create as ReturnType<typeof mock>).mock.calls[0];
      expect(createCall[0].title).toContain("Delegated:");
      expect(createCall[0].title.length).toBeLessThanOrEqual(64);
    });

    it("should handle tasks with special characters", async () => {
      const input: DelegateTaskInput = {
        task: 'Fix "quoted" strings and \'apostrophes\'',
        context: "Use \"double quotes\" in context",
      };

      const result = await delegateTask(input, ctx);
      expect(result.taskId).toBeDefined();
      expect(result.sessionId).toBeDefined();
    });

    it("should use routed agent config when task is auto-routed to scout", async () => {
      ctx.agentConfig = { model: "github-copilot/gpt-5.4", temperature: 0.7 };
      ctx.resolveAgentConfig = (agentName: string) => {
        if (agentName === "scout") {
          return { model: "github-copilot/gpt-5.4-mini", temperature: 0.2 };
        }

        if (agentName === "punch") {
          return { model: "github-copilot/gpt-5.4", temperature: 0.7 };
        }

        return undefined;
      };

      const result = await delegateTask(
        {
          task: "Explore the repository for prompt construction patterns",
          agent: "punch",
        },
        ctx,
      );

      expect(getSessionPromptParams(result.sessionId)?.temperature).toBe(0.2);
      clearSessionPromptParams(result.sessionId);
    });
  });

  describe("schema", () => {
    it("should have correct schema structure", async () => {
      const { delegateTaskSchema } = await import("./delegate-task.js");

      expect(delegateTaskSchema.type).toBe("object");
      expect(delegateTaskSchema.properties.task.type).toBe("string");
      expect(delegateTaskSchema.properties.agent.enum).toContain("tasker");
      expect(delegateTaskSchema.properties.agent.enum).toContain("punch");
      expect(delegateTaskSchema.properties.timeout.minimum).toBe(1);
      expect(delegateTaskSchema.properties.timeout.maximum).toBe(240);
      expect(delegateTaskSchema.required).toContain("task");
    });
  });
});
