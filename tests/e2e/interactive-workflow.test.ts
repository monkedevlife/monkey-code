import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  interactiveBash,
  listSessions,
  cleanupSessions,
  type InteractiveBashInput,
  type InteractiveBashContext,
} from "../../src/tools/interactive-bash.js";
import type { InteractiveSession } from "../../src/types/index.js";
import type { InteractiveManager } from "../../src/managers/InteractiveManager.js";

interface MockSession extends InteractiveSession {
  process?: { killed: boolean };
  outputs: string[];
}

function createMockInteractiveManager(): InteractiveManager {
  const sessions = new Map<string, MockSession>();
  let sessionCounter = 0;

  const manager = {
    isAvailable: mock(() => true),

    createSession: mock((command: string, cwd?: string) => {
      sessionCounter++;
      const sessionId = `mock_session_${Date.now()}_${sessionCounter}`;
      const session: MockSession = {
        id: sessionId,
        command,
        cwd,
        createdAt: Date.now(),
        isActive: true,
        outputs: [],
        process: { killed: false },
      };
      sessions.set(sessionId, session);

      return Promise.resolve({
        id: sessionId,
        command,
        cwd,
        createdAt: session.createdAt,
        isActive: true,
      });
    }),

    sendKeys: mock((sessionId: string, keys: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      if (!session.isActive) {
        throw new Error(`Session ${sessionId} is not active`);
      }
      session.outputs.push(`Sent: ${keys}`);
      return Promise.resolve();
    }),

    captureOutput: mock((sessionId: string, lines: number = 100) => {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      const output = session.outputs.length > 0
        ? session.outputs.slice(-lines).join("\n")
        : `Mock output for ${session.command}\nLine 1\nLine 2\nLine 3`;

      session.lastOutput = output;
      return Promise.resolve(output);
    }),

    closeSession: mock((sessionId: string) => {
      const session = sessions.get(sessionId);
      if (session) {
        session.isActive = false;
        if (session.process) {
          session.process.killed = true;
        }
        sessions.delete(sessionId);
      }
      return Promise.resolve();
    }),

    listSessions: mock(() => {
      const sessionList = Array.from(sessions.values()).map((s) => ({
        id: s.id,
        command: s.command,
        cwd: s.cwd,
        createdAt: s.createdAt,
        isActive: s.isActive,
        lastOutput: s.lastOutput,
      }));
      return Promise.resolve(sessionList.sort((a, b) => b.createdAt - a.createdAt));
    }),

    cleanup: mock(() => {
      sessions.clear();
      return Promise.resolve();
    }),

    _sessions: sessions,
    _addOutput: (sessionId: string, output: string) => {
      const session = sessions.get(sessionId);
      if (session) {
        session.outputs.push(output);
      }
    },
  } as unknown as InteractiveManager & {
    _sessions: Map<string, MockSession>;
    _addOutput: (sessionId: string, output: string) => void;
  };

  return manager;
}

describe("E2E: Interactive Bash Workflow", () => {
  let mockManager: InteractiveManager & {
    _sessions: Map<string, MockSession>;
    _addOutput: (sessionId: string, output: string) => void;
  };
  let ctx: InteractiveBashContext;

  beforeEach(() => {
    mockManager = createMockInteractiveManager();
    ctx = { manager: mockManager };
  });

  afterEach(async () => {
    await mockManager.cleanup();
  });

  describe("Start Session Flow", () => {
    it("should start interactive bash session", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "start",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(true);
      expect(result.sessionId).toMatch(/^mock_session_/);
      expect(result.message).toContain("Session started");
    });

    it("should start session with specific command", async () => {
      const input: InteractiveBashInput = {
        command: "node",
        action: "start",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.message).toContain("node");
    });

    it("should start session with working directory", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "start",
        cwd: "/tmp/test",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
    });

    it("should fail to start without command", async () => {
      const input: InteractiveBashInput = {
        command: "",
        action: "start",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("command is required");
    });
  });

  describe("Send Keys Flow", () => {
    it("should send keys to active session", async () => {
      const startInput: InteractiveBashInput = {
        command: "bash",
        action: "start",
      };

      const startResult = await interactiveBash(startInput, ctx);
      expect(startResult.success).toBe(true);
      expect(startResult.sessionId).toBeDefined();

      const sessionId = startResult.sessionId!;

      const sendInput: InteractiveBashInput = {
        command: "bash",
        action: "send",
        sessionId,
        input: "echo 'Hello World'",
      };

      const sendResult = await interactiveBash(sendInput, ctx);

      expect(sendResult.success).toBe(true);
      expect(sendResult.sessionId).toBe(sessionId);
      expect(sendResult.message).toContain("Keys sent");
    });

    it("should send multiple commands to session", async () => {
      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      const sessionId = startResult.sessionId!;

      const commands = [
        "cd /tmp",
        "ls -la",
        "pwd",
        "echo 'Done'",
      ];

      for (const cmd of commands) {
        const result = await interactiveBash(
          {
            command: "bash",
            action: "send",
            sessionId,
            input: cmd,
          },
          ctx
        );
        expect(result.success).toBe(true);
      }
    });

    it("should fail to send keys without sessionId", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "send",
        input: "echo test",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("sessionId is required");
    });

    it("should fail to send keys without input", async () => {
      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );

      const input: InteractiveBashInput = {
        command: "bash",
        action: "send",
        sessionId: startResult.sessionId!,
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("input is required");
    });

    it("should fail to send keys to non-existent session", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "send",
        sessionId: "nonexistent_session",
        input: "echo test",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Capture Output Flow", () => {
    it("should capture output from session", async () => {
      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      const sessionId = startResult.sessionId!;

      await interactiveBash(
        {
          command: "bash",
          action: "send",
          sessionId,
          input: "echo 'Test output'",
        },
        ctx
      );

      const captureInput: InteractiveBashInput = {
        command: "bash",
        action: "capture",
        sessionId,
        lines: 50,
      };

      const captureResult = await interactiveBash(captureInput, ctx);

      expect(captureResult.success).toBe(true);
      expect(captureResult.sessionId).toBe(sessionId);
      expect(captureResult.output).toBeDefined();
      expect(captureResult.message).toContain("Captured");
    });

    it("should capture specified number of lines", async () => {
      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      const sessionId = startResult.sessionId!;

      for (let i = 0; i < 10; i++) {
        mockManager._addOutput(sessionId, `Line ${i}`);
      }

      const captureResult = await interactiveBash(
        {
          command: "bash",
          action: "capture",
          sessionId,
          lines: 5,
        },
        ctx
      );

      expect(captureResult.success).toBe(true);
      expect(captureResult.output).toBeDefined();
    });

    it("should use default lines when not specified", async () => {
      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );

      const captureResult = await interactiveBash(
        {
          command: "bash",
          action: "capture",
          sessionId: startResult.sessionId!,
        },
        ctx
      );

      expect(captureResult.success).toBe(true);
      expect(captureResult.output).toBeDefined();
    });

    it("should fail to capture without sessionId", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "capture",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("sessionId is required");
    });
  });

  describe("Close Session Flow", () => {
    it("should close active session", async () => {
      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      const sessionId = startResult.sessionId!;

      const closeInput: InteractiveBashInput = {
        command: "bash",
        action: "close",
        sessionId,
      };

      const closeResult = await interactiveBash(closeInput, ctx);

      expect(closeResult.success).toBe(true);
      expect(closeResult.sessionId).toBe(sessionId);
      expect(closeResult.message).toContain("closed");
    });

    it("should fail to close without sessionId", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "close",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("sessionId is required");
    });

    it("should handle closing non-existent session gracefully", async () => {
      const input: InteractiveBashInput = {
        command: "bash",
        action: "close",
        sessionId: "nonexistent_session",
      };

      const result = await interactiveBash(input, ctx);

      expect(result.success).toBe(true);
    });
  });

  describe("List Sessions Flow", () => {
    it("should list all active sessions", async () => {
      await interactiveBash({ command: "bash", action: "start" }, ctx);
      await interactiveBash({ command: "node", action: "start" }, ctx);
      await interactiveBash({ command: "python", action: "start" }, ctx);

      const sessions = await listSessions(ctx);

      expect(sessions).toHaveLength(3);
      sessions.forEach((s) => {
        expect(s.id).toMatch(/^mock_session_/);
        expect(s.isActive).toBe(true);
      });
    });

    it("should return empty list when no sessions", async () => {
      const sessions = await listSessions(ctx);
      expect(sessions).toHaveLength(0);
    });

    it("should not list closed sessions", async () => {
      const startResult = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );
      await interactiveBash(
        { command: "bash", action: "close", sessionId: startResult.sessionId! },
        ctx
      );

      const sessions = await listSessions(ctx);
      expect(sessions).toHaveLength(0);
    });
  });

  describe("Cleanup Flow", () => {
    it("should cleanup all sessions", async () => {
      await interactiveBash({ command: "bash", action: "start" }, ctx);
      await interactiveBash({ command: "node", action: "start" }, ctx);

      let sessions = await listSessions(ctx);
      expect(sessions).toHaveLength(2);

      await cleanupSessions(ctx);

      sessions = await listSessions(ctx);
      expect(sessions).toHaveLength(0);
    });
  });

  describe("End-to-End Complete Workflow", () => {
    it("should complete full workflow: start → send → capture → close", async () => {
      const startResult = await interactiveBash(
        { command: "bash", action: "start", cwd: "/tmp" },
        ctx
      );

      expect(startResult.success).toBe(true);
      expect(startResult.sessionId).toBeDefined();
      const sessionId = startResult.sessionId!;

      const commands = ["cd /tmp", "mkdir test_dir", "ls -la"];
      for (const cmd of commands) {
        const sendResult = await interactiveBash(
          { command: "bash", action: "send", sessionId, input: cmd },
          ctx
        );
        expect(sendResult.success).toBe(true);
      }

      mockManager._addOutput(sessionId, "total 0");
      mockManager._addOutput(sessionId, "drwxr-xr-x 2 user user 40 Jan 1 00:00 .");
      mockManager._addOutput(sessionId, "drwxr-xr-x 10 user user 200 Jan 1 00:00 ..");

      const captureResult = await interactiveBash(
        { command: "bash", action: "capture", sessionId, lines: 10 },
        ctx
      );

      expect(captureResult.success).toBe(true);
      expect(captureResult.output).toBeDefined();
      expect(captureResult.sessionId).toBe(sessionId);

      const closeResult = await interactiveBash(
        { command: "bash", action: "close", sessionId },
        ctx
      );

      expect(closeResult.success).toBe(true);
      expect(closeResult.sessionId).toBe(sessionId);

      const sessions = await listSessions(ctx);
      expect(sessions).toHaveLength(0);
    });

    it("should handle multiple concurrent sessions", async () => {
      const sessions: string[] = [];

      for (let i = 0; i < 3; i++) {
        const result = await interactiveBash(
          { command: "bash", action: "start" },
          ctx
        );
        expect(result.success).toBe(true);
        sessions.push(result.sessionId!);
      }

      expect(sessions).toHaveLength(3);

      for (const sessionId of sessions) {
        await interactiveBash(
          { command: "bash", action: "send", sessionId, input: `echo Session ${sessionId}` },
          ctx
        );
      }

      const activeSessions = await listSessions(ctx);
      expect(activeSessions).toHaveLength(3);

      for (const sessionId of sessions) {
        await interactiveBash(
          { command: "bash", action: "close", sessionId },
          ctx
        );
      }

      const finalSessions = await listSessions(ctx);
      expect(finalSessions).toHaveLength(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle tmux not available", async () => {
      mockManager.isAvailable = mock(() => false);

      const result = await interactiveBash(
        { command: "bash", action: "start" },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("tmux is not available");
    });

    it("should handle unknown action", async () => {
      const result = await interactiveBash(
        { command: "bash", action: "unknown" as any },
        ctx
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });
});
