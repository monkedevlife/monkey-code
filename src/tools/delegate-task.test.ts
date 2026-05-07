import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  delegateTask,
  DEFAULT_AGENT,
  DEFAULT_TIMEOUT_MINUTES,
  type DelegateTaskInput,
  type DelegateTaskContext,
  type OpenCodeClient,
} from "./delegate-task.js";
import { getSessionPromptParams, clearSessionPromptParams } from "../utils/session-prompt-params.js";

function createMockClient(): OpenCodeClient {
  return {
    session: {
      create: vi.fn(() => Promise.resolve({ data: { id: `session_${Date.now()}` } })),
      prompt: vi.fn(() => Promise.resolve({ data: {} })),
    },
  };
}

describe("delegate-task", () => {
  let ctx: DelegateTaskContext;

  beforeEach(() => {
    ctx = {
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

      expect(result.sessionId).toMatch(/^session_/);
      expect(result.taskId).toBe(result.sessionId);
      expect(result.status).toBe("in_progress");
      expect(result.agent).toBe("punch");
      expect(result.timeout).toBe(DEFAULT_TIMEOUT_MINUTES);
      expect(result.createdAt).toBeTypeOf("string");
      expect(result.summary).toContain("Task delegated");
      expect(result.nextActions).toBeInstanceOf(Array);
      expect(result.nextActions.length).toBeGreaterThan(0);
      expect(result.nextActions[0].tool).toBe("background-output");
      expect(result.nextActions[0].params.taskId).toBe(result.sessionId);
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

      const promptCall = (ctx.client.session.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(promptCall[0].body.agent).toBe("scout");
      expect(promptCall[0].body.system).toContain("grep_app");
      expect(promptCall[0].body.system).toContain("compact findings");
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
      const promptCall2 = (ctx.client.session.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(promptCall2[0].body.system).toContain("PostgreSQL best practices");
    });

    it("should use default timeout when not specified", async () => {
      const input: DelegateTaskInput = {
        task: "Clean up unused imports",
      };

      await delegateTask(input, ctx);

      expect(DEFAULT_TIMEOUT_MINUTES).toBe(30);
    });

    it("should send prompt to session without noReply flag", async () => {
      const input: DelegateTaskInput = {
        task: "Long running analysis",
        timeout: 60,
      };

      await delegateTask(input, ctx);

      expect(ctx.client.session.prompt).toHaveBeenCalled();
      const promptCall3 = (ctx.client.session.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(promptCall3[0].body.noReply).toBeUndefined();
    });

    it("should set parentSessionId on child session", async () => {
      const input: DelegateTaskInput = {
        task: "Child task",
      };

      await delegateTask(input, ctx);

      expect(ctx.client.session.create).toHaveBeenCalled();
      const createCall = (ctx.client.session.create as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(createCall[0].body.parentID).toBe("parent_session_123");
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
      ctx.client.session.create = vi.fn(() => Promise.resolve({ data: undefined }));

      const input: DelegateTaskInput = {
        task: "This should fail",
      };

      await expect(delegateTask(input, ctx)).rejects.toThrow("Failed to create child session");
    });

    it("should complete delegation without waiting for task to finish", async () => {
      const input: DelegateTaskInput = {
        task: "Non-blocking task",
      };

      const result = await delegateTask(input, ctx);

      expect(result.sessionId).toBeDefined();
      expect(result.status).toBe("in_progress");
    });

    it("should include task description in session title", async () => {
      const longTask = "This is a very long task description that should be truncated in the title";
      const input: DelegateTaskInput = {
        task: longTask,
      };

      await delegateTask(input, ctx);

      expect(ctx.client.session.create).toHaveBeenCalled();
      const createCall2 = (ctx.client.session.create as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(createCall2[0].body.title).toContain("Delegated:");
      expect(createCall2[0].body.title.length).toBeLessThanOrEqual(64);
    });

    it("should handle tasks with special characters", async () => {
      const input: DelegateTaskInput = {
        task: 'Fix "quoted" strings and \'apostrophes\'',
        context: "Use \"double quotes\" in context",
      };

      const result = await delegateTask(input, ctx);
      expect(result.sessionId).toBeDefined();
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
