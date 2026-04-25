import { AgentConfig } from "../config.js";

export interface SessionPromptParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
  providerOptions?: Record<string, unknown>;
}

const sessionPromptParamsStore = new Map<string, SessionPromptParams>();

export function setSessionPromptParams(
  sessionId: string,
  params: SessionPromptParams
): void {
  sessionPromptParamsStore.set(sessionId, params);
}

export function getSessionPromptParams(
  sessionId: string
): SessionPromptParams | undefined {
  return sessionPromptParamsStore.get(sessionId);
}

export function clearSessionPromptParams(sessionId: string): void {
  sessionPromptParamsStore.delete(sessionId);
}

export function agentConfigToPromptParams(
  agentConfig: AgentConfig | undefined
): SessionPromptParams {
  if (!agentConfig) {
    return {};
  }

  return {
    temperature: agentConfig.temperature,
    topP: agentConfig.topP,
    topK: agentConfig.topK,
    maxTokens: agentConfig.maxTokens,
    presencePenalty: agentConfig.presencePenalty,
    frequencyPenalty: agentConfig.frequencyPenalty,
    reasoningEffort: agentConfig.reasoningEffort,
    thinking: agentConfig.thinking,
    providerOptions: agentConfig.providerOptions,
  };
}
