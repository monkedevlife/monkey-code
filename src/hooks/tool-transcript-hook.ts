import {
  appendTranscriptEntry,
  type TranscriptEntry,
} from './transcript.js';

interface ToolExecuteBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>;
}

interface ToolExecuteAfterInput {
  tool: string;
  sessionID: string;
  callID: string;
  args?: Record<string, unknown>;
}

interface ToolExecuteAfterOutput {
  title: string;
  output: string;
  metadata: unknown;
}

const TOOL_INPUT_CACHE = new Map<string, Record<string, unknown>>();

function cacheKey(sessionID: string, callID: string): string {
  return `${sessionID}:${callID}`;
}

const CACHE_TTL_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCacheCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const key of TOOL_INPUT_CACHE.keys()) {
      const parts = key.split(':');
      const timestamp = parts[2];
      if (!timestamp) continue;
      if (now - parseInt(timestamp, 36) > CACHE_TTL_MS) {
        TOOL_INPUT_CACHE.delete(key);
      }
    }
  }, CACHE_TTL_MS);
  if ('unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

function buildCompactToolOutput(
  outputText: string,
  _metadata: unknown,
): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    output: outputText.slice(0, 500),
  };

  if (outputText.length > 500) {
    compact.truncated = true;
    compact.fullLength = outputText.length;
  }

  return compact;
}

export function createToolTranscriptHook() {
  ensureCacheCleanup();

  return {
    'tool.execute.before': async (
      hookInput: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput,
    ): Promise<void> => {
      const input = output.args;
      if (!input || Object.keys(input).length === 0) return;

      TOOL_INPUT_CACHE.set(cacheKey(hookInput.sessionID, hookInput.callID), input);

      const entry: TranscriptEntry = {
        type: 'tool_use',
        timestamp: new Date().toISOString(),
        tool_name: hookInput.tool,
        tool_input: input,
      };

      appendTranscriptEntry(hookInput.sessionID, entry);
    },

    'tool.execute.after': async (
      hookInput: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput,
    ): Promise<void> => {
      const key = cacheKey(hookInput.sessionID, hookInput.callID);
      const cachedInput = TOOL_INPUT_CACHE.get(key);
      TOOL_INPUT_CACHE.delete(key);

      const entry: TranscriptEntry = {
        type: 'tool_result',
        timestamp: new Date().toISOString(),
        tool_name: hookInput.tool,
        tool_input: cachedInput,
        tool_output: buildCompactToolOutput(output.output, output.metadata),
      };

      appendTranscriptEntry(hookInput.sessionID, entry);
    },
  };
}
