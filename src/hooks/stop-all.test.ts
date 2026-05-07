import { describe, it, expect, vi } from 'vitest';
import { createStopAllHook } from "./stop-all.js";

describe("stop-all hook", () => {
  it("cancels all background tasks, cleans interactive sessions, and aborts current session", async () => {
    const backgroundManager = {
      listTasks: vi.fn(() => Promise.resolve([
        { id: "task-1", status: "pending" },
        { id: "task-2", status: "in_progress" },
        { id: "task-3", status: "completed" },
      ])),
      cancel: vi.fn(() => Promise.resolve()),
    } as any;

    const interactiveManager = {
      cleanup: vi.fn(() => Promise.resolve()),
    } as any;

    const abortCurrentSession = vi.fn(() => Promise.resolve());

    const hook = createStopAllHook({
      backgroundManager,
      interactiveManager,
      abortCurrentSession,
    });

    const output = {
      parts: [{ type: "text", text: "/stop-all" }],
      message: {},
    };

    await hook["chat.message"]?.({ sessionID: "session-1" }, output);

    expect(backgroundManager.cancel).toHaveBeenCalledTimes(2);
    expect(interactiveManager.cleanup).toHaveBeenCalled();
    expect(abortCurrentSession).toHaveBeenCalledWith("session-1");
    expect(output.parts[0]?.text).toContain("Stopped 2 background task(s)");
  });

  it("ignores non stop-all messages", async () => {
    const backgroundManager = {
      listTasks: vi.fn(() => Promise.resolve([])),
      cancel: vi.fn(() => Promise.resolve()),
    } as any;

    const hook = createStopAllHook({ backgroundManager });
    const output = {
      parts: [{ type: "text", text: "hello" }],
      message: {},
    };

    await hook["chat.message"]?.({ sessionID: "session-1" }, output);

    expect(backgroundManager.listTasks).not.toHaveBeenCalled();
    expect(output.parts[0]?.text).toBe("hello");
  });

  it("handles command.execute.before for /stop-all command", async () => {
    const backgroundManager = {
      listTasks: vi.fn(() => Promise.resolve([
        { id: "task-1", status: "pending" },
      ])),
      cancel: vi.fn(() => Promise.resolve()),
    } as any;

    const abortCurrentSession = vi.fn(() => Promise.resolve());

    const hook = createStopAllHook({
      backgroundManager,
      abortCurrentSession,
    });

    const output = {
      parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "" }],
      message: {},
    };

    await hook["command.execute.before"]?.(
      { sessionID: "session-1", command: "stop-all", arguments: "" },
      output
    );

    expect(backgroundManager.cancel).toHaveBeenCalledTimes(1);
    expect(abortCurrentSession).toHaveBeenCalledWith("session-1");
    expect(output.parts[0]?.text).toContain("Stopped 1 background task(s)");
    expect(output.parts[0]?.id).toBe("p1");
  });

  it("ignores unrelated commands in command.execute.before", async () => {
    const backgroundManager = {
      listTasks: vi.fn(() => Promise.resolve([])),
      cancel: vi.fn(() => Promise.resolve()),
    } as any;

    const hook = createStopAllHook({ backgroundManager });
    const output = {
      parts: [{ type: "text", text: "" }],
      message: {},
    };

    await hook["command.execute.before"]?.(
      { sessionID: "session-1", command: "other", arguments: "" },
      output
    );

    expect(backgroundManager.listTasks).not.toHaveBeenCalled();
    expect(output.parts[0]?.text).toBe("");
  });
});
