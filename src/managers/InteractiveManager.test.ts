import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  InteractiveManager,
  InteractiveManagerError,
  createInteractiveManager,
} from "./InteractiveManager";

describe("InteractiveManager", () => {
  let manager: InteractiveManager;

  beforeEach(() => {
    manager = createInteractiveManager();
  });

  afterEach(async () => {
    try {
      await manager.cleanup();
    } catch {
    }
  });

  describe("isAvailable", () => {
    it("should detect tmux availability", () => {
      const available = manager.isAvailable();
      expect(typeof available).toBe("boolean");
    });
  });

  describe("createSession", () => {
    it("should create a session successfully", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("bash");

      expect(session).toBeDefined();
      expect(session.id).toMatch(/^monkey-\d+-\d+$/);
      expect(session.command).toBe("bash");
      expect(session.isActive).toBe(true);
      expect(session.createdAt).toBeGreaterThan(0);

      await manager.closeSession(session.id);
    });

    it("should create session with custom working directory", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const customCwd = "/tmp";
      const session = await manager.createSession("pwd", customCwd);
      expect(session.cwd).toBe(customCwd);

      await manager.closeSession(session.id);
    });

    it("should throw error when tmux is not available", async () => {
      if (manager.isAvailable()) {
        return;
      }

      let error: Error | undefined;
      try {
        await manager.createSession("bash");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(InteractiveManagerError);
      expect(error?.message).toContain("tmux is not available");
    });

    it("should generate unique session IDs", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session1 = await manager.createSession("bash");
      const session2 = await manager.createSession("bash");

      expect(session1.id).not.toBe(session2.id);

      await manager.closeSession(session1.id);
      await manager.closeSession(session2.id);
    });

    it("should handle concurrent session operations", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const promises = [
        manager.createSession("bash"),
        manager.createSession("zsh"),
      ];

      const sessions = await Promise.all(promises);
      expect(sessions.length).toBe(2);
      expect(new Set(sessions.map((s) => s.id)).size).toBe(2);

      for (const session of sessions) {
        await manager.closeSession(session.id);
      }
    });
  });

  describe("sendKeys", () => {
    it("should send keys to an active session", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("bash");
      await manager.sendKeys(session.id, "echo hello");

      await manager.closeSession(session.id);
    });

    it("should throw error for non-existent session", async () => {
      let error: Error | undefined;
      try {
        await manager.sendKeys("non-existent-session-id", "test");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(InteractiveManagerError);
      expect(error?.message).toContain("Session non-existent-session-id not found");
    });

    it("should throw error for inactive session", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("bash");
      
      const sessions = (manager as any).sessions;
      const sessionInfo = sessions.get(session.id);
      sessionInfo.isActive = false;

      let error: Error | undefined;
      try {
        await manager.sendKeys(session.id, "test");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(InteractiveManagerError);
      expect(error?.message).toContain("is not active");

      sessionInfo.isActive = true;
      await manager.closeSession(session.id);
    });
  });

  describe("captureOutput", () => {
    it("should capture output from session", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("bash");
      await new Promise((r) => setTimeout(r, 100));
      
      const output = await manager.captureOutput(session.id);
      expect(typeof output).toBe("string");

      await manager.closeSession(session.id);
    });

    it("should capture specified number of lines", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("bash");
      await new Promise((r) => setTimeout(r, 100));
      
      const output = await manager.captureOutput(session.id, 10);
      expect(typeof output).toBe("string");

      await manager.closeSession(session.id);
    });

    it("should throw error for non-existent session", async () => {
      let error: Error | undefined;
      try {
        await manager.captureOutput("non-existent-session-id");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(InteractiveManagerError);
      expect(error?.message).toContain("Session non-existent-session-id not found");
    });

    it("should store last output in session", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("bash");
      await new Promise((r) => setTimeout(r, 100));
      
      const output = await manager.captureOutput(session.id);

      const sessions = await manager.listSessions();
      const found = sessions.find((s) => s.id === session.id);
      expect(found?.lastOutput).toBe(output);

      await manager.closeSession(session.id);
    });
  });

  describe("closeSession", () => {
    it("should close an active session", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("bash");
      await manager.closeSession(session.id);

      const sessions = await manager.listSessions();
      expect(sessions.length).toBe(0);
    });

    it("should not throw when closing non-existent session", async () => {
      await manager.closeSession("non-existent-session-id");
    });
  });

  describe("listSessions", () => {
    it("should return empty array when no sessions", async () => {
      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });

    it("should return all active sessions", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session1 = await manager.createSession("bash");
      const session2 = await manager.createSession("zsh");

      const sessions = await manager.listSessions();
      expect(sessions.length).toBe(2);
      expect(sessions.map((s) => s.id)).toContain(session1.id);
      expect(sessions.map((s) => s.id)).toContain(session2.id);

      await manager.closeSession(session1.id);
      await manager.closeSession(session2.id);
    });

    it("should sort sessions by createdAt descending", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session1 = await manager.createSession("bash");
      await new Promise((r) => setTimeout(r, 50));
      const session2 = await manager.createSession("zsh");

      const sessions = await manager.listSessions();
      expect(sessions[0].createdAt).toBeGreaterThanOrEqual(sessions[1].createdAt);

      await manager.closeSession(session1.id);
      await manager.closeSession(session2.id);
    });

    it("should include session details", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("node script.js", "/tmp");
      
      const sessions = await manager.listSessions();
      expect(sessions[0].command).toBe("node script.js");
      expect(sessions[0].cwd).toBe("/tmp");
      expect(sessions[0].isActive).toBe(true);

      await manager.closeSession(session.id);
    });
  });

  describe("cleanup", () => {
    it("should close all sessions", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      await manager.createSession("bash");
      await manager.createSession("zsh");

      await manager.cleanup();

      const sessions = await manager.listSessions();
      expect(sessions.length).toBe(0);
    });

    it("should be safe to call multiple times", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      await manager.createSession("bash");
      
      await manager.cleanup();
      await manager.cleanup();

      const sessions = await manager.listSessions();
      expect(sessions.length).toBe(0);
    });
  });

  describe("InteractiveManagerError", () => {
    it("should create error with message and code", () => {
      const error = new InteractiveManagerError("test error", "TEST_CODE");
      expect(error.message).toBe("test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.name).toBe("InteractiveManagerError");
    });

    it("should create error with sessionId", () => {
      const error = new InteractiveManagerError("test error", "TEST_CODE", "session-123");
      expect(error.sessionId).toBe("session-123");
    });

    it("should be instanceof Error", () => {
      const error = new InteractiveManagerError("test", "CODE");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("createInteractiveManager", () => {
    it("should create new InteractiveManager instance", () => {
      const mgr = createInteractiveManager();
      expect(mgr).toBeInstanceOf(InteractiveManager);
    });

    it("should create independent instances", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const mgr1 = createInteractiveManager();
      const mgr2 = createInteractiveManager();

      const session = await mgr1.createSession("bash");
      
      const sessions1 = await mgr1.listSessions();
      const sessions2 = await mgr2.listSessions();

      expect(sessions1.length).toBe(1);
      expect(sessions2.length).toBe(0);

      await mgr1.closeSession(session.id);
    });
  });

  describe("edge cases", () => {
    it("should handle commands with special characters", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession('echo "hello world"');
      expect(session.command).toContain('echo');

      await manager.closeSession(session.id);
    });

    it("should handle empty command", async () => {
      if (!manager.isAvailable()) {
        return;
      }

      const session = await manager.createSession("");
      expect(session.command).toBe("");

      await manager.closeSession(session.id);
    });
  });
});
