import { describe, it, expect, beforeEach } from "bun:test";
import {
  setSessionPromptParams,
  getSessionPromptParams,
  clearSessionPromptParams,
  agentConfigToPromptParams,
} from "./session-prompt-params.js";
import type { AgentConfig } from "../config.js";

describe("session-prompt-params", () => {
  beforeEach(() => {
    clearSessionPromptParams("test-session");
    clearSessionPromptParams("other-session");
  });

  describe("setSessionPromptParams / getSessionPromptParams", () => {
    it("should store and retrieve params", () => {
      const params = {
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 4096,
      };

      setSessionPromptParams("test-session", params);
      const retrieved = getSessionPromptParams("test-session");

      expect(retrieved).toEqual(params);
    });

    it("should return undefined for unknown session", () => {
      const retrieved = getSessionPromptParams("unknown-session");
      expect(retrieved).toBeUndefined();
    });

    it("should overwrite existing params", () => {
      setSessionPromptParams("test-session", { temperature: 0.5 });
      setSessionPromptParams("test-session", { temperature: 0.8 });

      const retrieved = getSessionPromptParams("test-session");
      expect(retrieved?.temperature).toBe(0.8);
    });

    it("should isolate params between sessions", () => {
      setSessionPromptParams("test-session", { temperature: 0.7 });
      setSessionPromptParams("other-session", { temperature: 0.3 });

      expect(getSessionPromptParams("test-session")?.temperature).toBe(0.7);
      expect(getSessionPromptParams("other-session")?.temperature).toBe(0.3);
    });
  });

  describe("clearSessionPromptParams", () => {
    it("should remove stored params", () => {
      setSessionPromptParams("test-session", { temperature: 0.7 });
      clearSessionPromptParams("test-session");

      const retrieved = getSessionPromptParams("test-session");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("agentConfigToPromptParams", () => {
    it("should convert full agent config to prompt params", () => {
      const config: AgentConfig = {
        model: "gpt-4",
        temperature: 0.7,
        topP: 0.9,
        topK: 50,
        maxTokens: 4096,
        presencePenalty: 0.5,
        frequencyPenalty: -0.5,
        reasoningEffort: "high",
        thinking: { type: "enabled", budgetTokens: 16000 },
        providerOptions: { seed: 42 },
      };

      const params = agentConfigToPromptParams(config);

      expect(params.temperature).toBe(0.7);
      expect(params.topP).toBe(0.9);
      expect(params.topK).toBe(50);
      expect(params.maxTokens).toBe(4096);
      expect(params.presencePenalty).toBe(0.5);
      expect(params.frequencyPenalty).toBe(-0.5);
      expect(params.reasoningEffort).toBe("high");
      expect(params.thinking).toEqual({ type: "enabled", budgetTokens: 16000 });
      expect(params.providerOptions).toEqual({ seed: 42 });
    });

    it("should handle partial agent config", () => {
      const config: AgentConfig = {
        temperature: 0.5,
      };

      const params = agentConfigToPromptParams(config);

      expect(params.temperature).toBe(0.5);
      expect(params.topP).toBeUndefined();
      expect(params.maxTokens).toBeUndefined();
    });

    it("should return empty object for undefined config", () => {
      const params = agentConfigToPromptParams(undefined);
      expect(params).toEqual({});
    });
  });
});
