import { describe, it, expect, mock } from "bun:test";
import { createStopAllHook } from "./stop-all.js";

describe("stop-all hook", () => {
  it("cancels all background tasks, cleans interactive sessions, and aborts current session", async () => {
    const backgroundManager = {
      listTasks: mock(() => Promise.resolve([
        { id: "task-1", status: "pending" },
        { id: "task-2", status: "in_progress" },
        { id: "task-3", status: "completed" },
      ])),
      cancel: mock(() => Promise.resolve()),
    } as any;

    const interactiveManager = {
      cleanup: mock(() => Promise.resolve()),
    } as any;

    const abortCurrentSession = mock(() => Promise.resolve());

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
      listTasks: mock(() => Promise.resolve([])),
      cancel: mock(() => Promise.resolve()),
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
});
