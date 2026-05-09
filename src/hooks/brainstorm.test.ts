import { describe, it, expect } from 'vitest';
import { createBrainstormHook } from "./brainstorm.js";

describe("brainstorm hook", () => {
  it("replaces /brainstorm prompt with brainstorm directive for george", async () => {
    const hook = createBrainstormHook();

    const output = {
      parts: [{ type: "text", text: '/brainstorm "login page UX"' }],
      message: {} as Record<string, unknown>,
    };

    await hook["chat.message"]?.({ sessionID: "session-start" }, output);

    expect(output.parts[0]?.text).toContain("login page UX");
    expect(output.parts[0]?.text).toContain("Brainstorm Directives");
    expect(output.parts[0]?.text).toContain("Explore widely");
    expect(output.message.agent).toBe("george");
  });

  it("handles command.execute.before for /brainstorm", async () => {
    const hook = createBrainstormHook();

    const output = {
      parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "" }],
      message: { agent: "punch" } as Record<string, unknown>,
    };

    await hook["command.execute.before"]?.(
      { sessionID: "session-start", command: "brainstorm", arguments: "new API design" },
      output
    );

    expect(output.parts[0]?.text).toContain("new API design");
    expect(output.parts[0]?.text).toContain("Brainstorm Directives");
    expect(output.parts[0]?.id).toBe("p1");
    expect(output.message.agent).toBe("george");
  });

  it("ignores unrelated commands", async () => {
    const hook = createBrainstormHook();

    const output = {
      parts: [{ type: "text", text: "" }],
      message: {} as Record<string, unknown>,
    };

    await hook["command.execute.before"]?.(
      { sessionID: "session-start", command: "other", arguments: "" },
      output
    );

    expect(output.parts[0]?.text).toBe("");
    expect(output.message.agent).toBeUndefined();
  });
});
