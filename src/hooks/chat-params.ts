import {
  getSessionPromptParams,
  SessionPromptParams,
} from "../utils/session-prompt-params.js";

export interface ChatParamsInput {
  sessionID: string;
  agent: { name?: string };
  model: { providerID: string; modelID: string };
  provider: { id?: string };
  message: { variant?: string };
}

export interface ChatParamsOutput {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  maxOutputTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  reasoningEffort?:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh";
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
  options: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildChatParamsInput(raw: unknown): ChatParamsInput | null {
  if (!isRecord(raw)) return null;

  const sessionID = raw.sessionID;
  const agent = raw.agent;
  const model = raw.model;
  const provider = raw.provider;
  const message = raw.message;

  if (typeof sessionID !== "string") return null;
  if (!isRecord(model)) return null;
  if (!isRecord(provider)) return null;
  if (!isRecord(message)) return null;

  let agentName: string | undefined;
  if (typeof agent === "string") {
    agentName = agent;
  } else if (isRecord(agent)) {
    const name = agent.name;
    if (typeof name === "string") {
      agentName = name;
    }
  }
  if (!agentName) return null;

  const providerID = model.providerID;
  const modelID =
    typeof model.modelID === "string"
      ? model.modelID
      : typeof model.id === "string"
        ? model.id
      : undefined;
  if (typeof providerID !== "string") return null;
  if (typeof modelID !== "string") return null;

  return {
    sessionID,
    agent: { name: agentName },
    model: { providerID, modelID },
    provider: {
      id:
        typeof provider.id === 'string'
          ? provider.id
          : isRecord(provider.info) && typeof provider.info.id === 'string'
            ? provider.info.id
            : providerID,
    },
    message,
  };
}

function applyParamsToOutput(
  params: SessionPromptParams,
  output: ChatParamsOutput
): void {
  if (params.temperature !== undefined) {
    output.temperature = params.temperature;
  }
  if (params.topP !== undefined) {
    output.topP = params.topP;
  }
  if (params.topK !== undefined) {
    output.topK = params.topK;
  }
  if (params.maxTokens !== undefined) {
    output.maxTokens = params.maxTokens;
    output.maxOutputTokens = params.maxTokens;
  }
  if (params.presencePenalty !== undefined) {
    output.presencePenalty = params.presencePenalty;
  }
  if (params.frequencyPenalty !== undefined) {
    output.frequencyPenalty = params.frequencyPenalty;
  }
  if (params.reasoningEffort !== undefined) {
    output.reasoningEffort = params.reasoningEffort;
  }
  if (params.thinking !== undefined) {
    output.thinking = params.thinking;
  }
  if (params.providerOptions) {
    output.options = {
      ...output.options,
      ...params.providerOptions,
    };
  }
}

export async function handleChatParams(
  input: unknown,
  output: unknown
): Promise<void> {
  const normalizedInput = buildChatParamsInput(input);
  if (!normalizedInput) return;

  if (!isRecord(output)) return;
  
  const outputRecord = output as Record<string, unknown>;
  if (!isRecord(outputRecord.options)) {
    outputRecord.options = {};
  }

  const chatOutput: ChatParamsOutput = {
    temperature: typeof outputRecord.temperature === 'number' ? outputRecord.temperature : undefined,
    topP: typeof outputRecord.topP === 'number' ? outputRecord.topP : undefined,
    topK: typeof outputRecord.topK === 'number' ? outputRecord.topK : undefined,
    maxTokens:
      typeof outputRecord.maxTokens === 'number'
        ? outputRecord.maxTokens
        : typeof outputRecord.maxOutputTokens === 'number'
          ? outputRecord.maxOutputTokens
          : undefined,
    maxOutputTokens: typeof outputRecord.maxOutputTokens === 'number' ? outputRecord.maxOutputTokens : undefined,
    presencePenalty: typeof outputRecord.presencePenalty === 'number' ? outputRecord.presencePenalty : undefined,
    frequencyPenalty: typeof outputRecord.frequencyPenalty === 'number' ? outputRecord.frequencyPenalty : undefined,
    reasoningEffort: typeof outputRecord.reasoningEffort === 'string' ? outputRecord.reasoningEffort as ChatParamsOutput['reasoningEffort'] : undefined,
    thinking: isRecord(outputRecord.thinking) ? outputRecord.thinking as ChatParamsOutput['thinking'] : undefined,
    options: outputRecord.options as Record<string, unknown>,
  };

  const storedParams = getSessionPromptParams(normalizedInput.sessionID);
  if (storedParams) {
    applyParamsToOutput(storedParams, chatOutput);
  }

  if (chatOutput.temperature !== undefined) outputRecord.temperature = chatOutput.temperature;
  if (chatOutput.topP !== undefined) outputRecord.topP = chatOutput.topP;
  if (chatOutput.topK !== undefined) outputRecord.topK = chatOutput.topK;
  if (chatOutput.maxTokens !== undefined) {
    outputRecord.maxTokens = chatOutput.maxTokens;
    outputRecord.maxOutputTokens = chatOutput.maxTokens;
  }
  if (chatOutput.presencePenalty !== undefined) outputRecord.presencePenalty = chatOutput.presencePenalty;
  if (chatOutput.frequencyPenalty !== undefined) outputRecord.frequencyPenalty = chatOutput.frequencyPenalty;
  if (chatOutput.reasoningEffort !== undefined) outputRecord.reasoningEffort = chatOutput.reasoningEffort;
  if (chatOutput.thinking !== undefined) outputRecord.thinking = chatOutput.thinking;
  if (Object.keys(chatOutput.options).length > 0) outputRecord.options = chatOutput.options;
}
