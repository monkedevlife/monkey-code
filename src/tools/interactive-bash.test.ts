import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  interactiveBash,
  listSessions,
  cleanupSessions,
  interactiveBashSchema,
  type InteractiveBashInput,
  type InteractiveBashContext,
} from "./interactive-bash.js";
import {
  InteractiveManager,
  createInteractiveManager,
  InteractiveManagerError,
} from "../managers/InteractiveManager.js";

describe("interactive-bash", () => {
  let ctx: InteractiveBashContext;

  beforeEach(() => {
    ctx = {
      manager: createInteractiveManager(),
    };
  });

  afterEach(async () => {
    if (ctx.manager) {
      await ctx.manager.cleanup();
    }
  });

  describe("tmux availability", () => {
    it("should return error when tmux is not available", async () => {
      const mockManager = {
        isAvailable: () => false,
        createSession: mock(() => Promise.resolve({ id: "test" })),
      } as unknown as InteractiveManager;

      const result = await interactiveBash(
        { command: "bash", action: "start" },
        { manager: mockManager }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("tmux is not available");
    });

    it("should proceed when tmux is available", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const result = await interactiveBash(
        { command: "echo hello", action: "start" },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();

      await ctx.manager?.closeSession(result.sessionId!);
    });
  });

  describe("start action", () => {
    it("should create a new session", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const input: InteractiveBashInput = {
        command: "bash",
        action: "start",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(true);
      expect(result.sessionId).toMatch(/^monkey-\d+-\d+$/);
      expect(result.summary).toContain("Session started");

      await ctx.manager?.closeSession(result.sessionId!);
    });

    it("should create session with custom working directory", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const input: InteractiveBashInput = {
        command: "pwd",
        action: "start",
        cwd: "/tmp",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();

      await ctx.manager?.closeSession(result.sessionId!);
    });

    it("should return error when command is missing", async () => {
      const input = {
        command: "",
        action: "start" as const,
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("command is required");
    });
  });

  describe("send action", () => {
    it("should send keys to active session", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      expect(startResult.success).toBe(true);

      const sendResult = await interactiveBash(
        {
          command: "bash",
          action: "send",
          sessionId: startResult.sessionId,
          input: "echo test",
        },
        ctx
      );

      expect(sendResult.success).toBe(true);
      expect(sendResult.summary).toContain("Sent");

      await ctx.manager?.closeSession(startResult.sessionId!);
    });

    it("should return error when sessionId is missing", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "send",
        input: "test",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("sessionId is required");
    });

    it("should return error when input is missing", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "send",
        sessionId: "test-session",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("input is required");
    });

    it("should return error for non-existent session", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const input: InteractiveBashInput = {
        command: "bash",
        action: "send",
        sessionId: "non-existent-session",
        input: "test",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("capture action", () => {
    it("should capture output from session", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      expect(startResult.success).toBe(true);

      await new Promise((r) => setTimeout(r, 100));

      const captureResult = await interactiveBash(
        {
          command: "bash",
          action: "capture",
          sessionId: startResult.sessionId,
        },
        ctx
      );

      expect(captureResult.success).toBe(true);
      expect(captureResult.output).toBeDefined();
      expect(typeof captureResult.output).toBe("string");

      await ctx.manager?.closeSession(startResult.sessionId!);
    });

    it("should capture specified number of lines", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      expect(startResult.success).toBe(true);

      await new Promise((r) => setTimeout(r, 100));

      const captureResult = await interactiveBash(
        {
          command: "bash",
          action: "capture",
          sessionId: startResult.sessionId,
          lines: 10,
        },
        ctx
      );

      expect(captureResult.success).toBe(true);
      expect(captureResult.summary).toContain("10 lines");

      await ctx.manager?.closeSession(startResult.sessionId!);
    });

    it("should return error when sessionId is missing", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "capture",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("sessionId is required");
    });

    it("should return error for non-existent session", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const input: InteractiveBashInput = {
        command: "bash",
        action: "capture",
        sessionId: "non-existent-session",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("close action", () => {
    it("should close active session", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      expect(startResult.success).toBe(true);

      const closeResult = await interactiveBash(
        {
          command: "bash",
          action: "close",
          sessionId: startResult.sessionId,
        },
        ctx
      );

      expect(closeResult.success).toBe(true);
      expect(closeResult.summary).toContain("closed");
    });

    it("should return error when sessionId is missing", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "close",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("sessionId is required");
    });

    it("should not throw when closing non-existent session", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const input: InteractiveBashInput = {
        command: "bash",
        action: "close",
        sessionId: "non-existent-session",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(true);
      expect(result.summary).toContain("closed");
    });
  });

  describe("unknown action", () => {
    it("should return error for unknown action", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const input = {
        command: "bash",
        action: "invalid" as InteractiveBashInput["action"],
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });

  describe("error handling", () => {
    it("should handle InteractiveManagerError", async () => {
      const mockManager = {
        isAvailable: () => true,
        createSession: mock(() => {
          throw new InteractiveManagerError(
            "Test error",
            "TEST_CODE",
            "test-session"
          );
        }),
      } as unknown as InteractiveManager;

      const result = await interactiveBash(
        { command: "bash", action: "start" },
        { manager: mockManager }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Test error");
      expect(result.sessionId).toBe("test-session");
    });

    it("should handle generic errors", async () => {
      const mockManager = {
        isAvailable: () => true,
        createSession: mock(() => {
          throw new Error("Generic error");
        }),
      } as unknown as InteractiveManager;

      const result = await interactiveBash(
        { command: "bash", action: "start" },
        { manager: mockManager }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Generic error");
    });
  });

  describe("listSessions", () => {
    it("should return empty array when no sessions", async () => {
      const sessions = await listSessions(ctx);
      expect(sessions).toEqual([]);
    });

    it("should return active sessions", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const session1 = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      const session2 = await interactiveBash(
        { command: "zsh", action: "start" },
        ctx
      );

      const sessions = await listSessions(ctx);

      expect(sessions.length).toBe(2);
      expect(sessions.map((s) => s.id)).toContain(session1.sessionId!);
      expect(sessions.map((s) => s.id)).toContain(session2.sessionId!);

      await ctx.manager?.closeSession(session1.sessionId!);
      await ctx.manager?.closeSession(session2.sessionId!);
    });
  });

  describe("cleanupSessions", () => {
    it("should close all sessions", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      await interactiveBash({ command: "bash", action: "start" }, ctx);
      await interactiveBash({ command: "zsh", action: "start" }, ctx);

      await cleanupSessions(ctx);

      const sessions = await listSessions(ctx);
      expect(sessions.length).toBe(0);
    });

    it("should be safe to call multiple times", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      await interactiveBash({ command: "bash", action: "start" }, ctx);

      await cleanupSessions(ctx);
      await cleanupSessions(ctx);

      const sessions = await listSessions(ctx);
      expect(sessions.length).toBe(0);
    });
  });

  describe("schema", () => {
    it("should have correct schema structure", () => {
      expect(interactiveBashSchema.type).toBe("object");
      expect(interactiveBashSchema.properties.command.type).toBe("string");
      expect(interactiveBashSchema.properties.action.type).toBe("string");
      expect(interactiveBashSchema.properties.action.enum).toContain("start");
      expect(interactiveBashSchema.properties.action.enum).toContain("send");
      expect(interactiveBashSchema.properties.action.enum).toContain("capture");
      expect(interactiveBashSchema.properties.action.enum).toContain("close");
      expect(interactiveBashSchema.properties.sessionId.type).toBe("string");
      expect(interactiveBashSchema.properties.input.type).toBe("string");
      expect(interactiveBashSchema.properties.cwd.type).toBe("string");
      expect(interactiveBashSchema.properties.lines.type).toBe("number");
      expect(interactiveBashSchema.properties.lines.minimum).toBe(1);
      expect(interactiveBashSchema.properties.lines.maximum).toBe(1000);
      expect(interactiveBashSchema.required).toContain("command");
      expect(interactiveBashSchema.required).toContain("action");
    });
  });

  describe("full workflow", () => {
    it("should handle complete session lifecycle", async () => {
      if (!ctx.manager?.isAvailable()) {
        return;
      }

      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      expect(startResult.success).toBe(true);
      expect(startResult.sessionId).toBeDefined();

      const sessionId = startResult.sessionId!;

      const sendResult = await interactiveBash(
        {
          command: "bash",
          action: "send",
          sessionId,
          input: "echo 'Hello World'",
        },
        ctx
      );
      expect(sendResult.success).toBe(true);

      await new Promise((r) => setTimeout(r, 200));

      const sendEnterResult = await interactiveBash(
        {
          command: "bash",
          action: "send",
          sessionId,
          input: "Enter",
        },
        ctx
      );
      expect(sendEnterResult.success).toBe(true);

      await new Promise((r) => setTimeout(r, 200));

      const captureResult = await interactiveBash(
        {
          command: "bash",
          action: "capture",
          sessionId,
          lines: 50,
        },
        ctx
      );
      expect(captureResult.success).toBe(true);
      expect(captureResult.output).toBeDefined();

      const closeResult = await interactiveBash(
        {
          command: "bash",
          action: "close",
          sessionId,
        },
        ctx
      );
      expect(closeResult.success).toBe(true);
    });
  });
});
