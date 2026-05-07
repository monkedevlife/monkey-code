export interface ToolCallWindow {
  lastSignature: string;
  consecutiveCount: number;
  threshold: number;
}

export interface CircuitBreakerSettings {
  enabled: boolean;
  maxToolCalls: number;
  consecutiveThreshold: number;
}

export interface ToolLoopDetectionResult {
  triggered: boolean;
  toolName?: string;
  repeatedCount?: number;
}

export const DEFAULT_CIRCUIT_BREAKER_ENABLED = true;
export const DEFAULT_MAX_TOOL_CALLS = 4000;
export const DEFAULT_CONSECUTIVE_THRESHOLD = 20;

export function resolveCircuitBreakerSettings(
  overrides?: Partial<CircuitBreakerSettings>
): CircuitBreakerSettings {
  return {
    enabled: overrides?.enabled ?? DEFAULT_CIRCUIT_BREAKER_ENABLED,
    maxToolCalls: overrides?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
    consecutiveThreshold:
      overrides?.consecutiveThreshold ?? DEFAULT_CONSECUTIVE_THRESHOLD,
  };
}

function sortObject(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortObject((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

function createToolCallSignature(
  toolName: string,
  input?: Record<string, unknown> | null
): string {
  if (input == null || Object.keys(input).length === 0) {
    return toolName;
  }
  return `${toolName}::${JSON.stringify(sortObject(input))}`;
}

export function recordToolCall(
  window: ToolCallWindow | undefined,
  toolName: string,
  settings: CircuitBreakerSettings,
  input?: Record<string, unknown> | null
): ToolCallWindow {
  const signature = createToolCallSignature(toolName, input);

  if (window && window.lastSignature === signature) {
    return {
      lastSignature: signature,
      consecutiveCount: window.consecutiveCount + 1,
      threshold: settings.consecutiveThreshold,
    };
  }

  return {
    lastSignature: signature,
    consecutiveCount: 1,
    threshold: settings.consecutiveThreshold,
  };
}

export function detectRepetitiveToolUse(
  window: ToolCallWindow | undefined
): ToolLoopDetectionResult {
  if (!window || window.consecutiveCount < window.threshold) {
    return { triggered: false };
  }

  return {
    triggered: true,
    toolName: window.lastSignature.split("::")[0],
    repeatedCount: window.consecutiveCount,
  };
}
