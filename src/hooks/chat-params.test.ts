import { describe, it, expect, beforeEach } from "bun:test";
import { handleChatParams } from "./chat-params.js";
import {
  setSessionPromptParams,
  clearSessionPromptParams,
} from "../utils/session-prompt-params.js";

describe("handleChatParams", () => {
  beforeEach(() => {
    clearSessionPromptParams("test-session");
  });

  it("should apply stored params to output", async () => {
    setSessionPromptParams("test-session", {
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 4096,
    });

    const input = {
      sessionID: "test-session",
      agent: { name: "punch" },
      model: { providerID: "openai", modelID: "gpt-4" },
      provider: { id: "openai" },
      message: {},
    };

    const output: Record<string, unknown> = { options: {} };

    await handleChatParams(input, output);

    expect(output.temperature).toBe(0.7);
    expect(output.topP).toBe(0.9);
    expect(output.maxTokens).toBe(4096);
  });

  it("should apply all inference params", async () => {
    setSessionPromptParams("test-session", {
      temperature: 0.5,
      topP: 0.8,
      topK: 50,
      maxTokens: 2048,
      presencePenalty: 0.3,
      frequencyPenalty: -0.2,
      reasoningEffort: "high",
      thinking: { type: "enabled", budgetTokens: 8000 },
      providerOptions: { seed: 42 },
    });

    const input = {
      sessionID: "test-session",
      agent: { name: "harambe" },
      model: { providerID: "anthropic", modelID: "claude-opus" },
      provider: { id: "anthropic" },
      message: {},
    };

    const output: Record<string, unknown> = { options: {} };

    await handleChatParams(input, output);

    expect(output.temperature).toBe(0.5);
    expect(output.topP).toBe(0.8);
    expect(output.topK).toBe(50);
    expect(output.maxTokens).toBe(2048);
    expect(output.presencePenalty).toBe(0.3);
    expect(output.frequencyPenalty).toBe(-0.2);
    expect(output.reasoningEffort).toBe("high");
    expect(output.thinking).toEqual({ type: "enabled", budgetTokens: 8000 });
    expect((output.options as Record<string, unknown>).seed).toBe(42);
  });

  it("should preserve existing output options", async () => {
    setSessionPromptParams("test-session", {
      temperature: 0.7,
      providerOptions: { seed: 42 },
    });

    const input = {
      sessionID: "test-session",
      agent: { name: "tasker" },
      model: { providerID: "openai", modelID: "gpt-4" },
      provider: { id: "openai" },
      message: {},
    };

    const output: Record<string, unknown> = {
      options: { existingOption: true },
    };

    await handleChatParams(input, output);

    expect(output.temperature).toBe(0.7);
    expect((output.options as Record<string, unknown>).existingOption).toBe(true);
    expect((output.options as Record<string, unknown>).seed).toBe(42);
  });

  it("should not modify output when no stored params", async () => {
    const input = {
      sessionID: "test-session",
      agent: { name: "punch" },
      model: { providerID: "openai", modelID: "gpt-4" },
      provider: { id: "openai" },
      message: {},
    };

    const output: Record<string, unknown> = { options: {} };

    await handleChatParams(input, output);

    expect(output.temperature).toBeUndefined();
    expect(output.topP).toBeUndefined();
  });

  it("should handle invalid input gracefully", async () => {
    const output: Record<string, unknown> = { options: {} };

    await handleChatParams(null, output);
    await handleChatParams({}, output);
    await handleChatParams({ sessionID: "test" }, output);

    expect(output.temperature).toBeUndefined();
  });

  it("should handle invalid output gracefully", async () => {
    setSessionPromptParams("test-session", { temperature: 0.7 });

    const input = {
      sessionID: "test-session",
      agent: { name: "punch" },
      model: { providerID: "openai", modelID: "gpt-4" },
      provider: { id: "openai" },
      message: {},
    };

    await handleChatParams(input, null);
    await handleChatParams(input, "string");

    expect(true).toBe(true);
  });
});
