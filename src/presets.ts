import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

export const SUPPORTED_PROVIDERS = [
  'github-copilot',
  'opencode-zen',
  'openrouter',
  'z-ai',
  'moonshot',
] as const;

export type SupportedProvider = typeof SUPPORTED_PROVIDERS[number];

export interface AgentPresetConfig {
  model?: string;
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

export interface ProviderPresetFile {
  version: '1.0.0';
  generatedBy: string;
  provider: SupportedProvider;
  models: {
    default: string;
    fast?: string;
    deep?: string;
  };
  agents: Record<string, AgentPresetConfig>;
  config: {
    provider: SupportedProvider;
    model: string;
    baseUrl?: string;
    apiEnv?: string;
    note?: string;
  };
}

export interface PresetManifest {
  version: '1.0.0';
  generatedBy: string;
  generatedAt: string;
  providers: SupportedProvider[];
}

const PRESET_VERSION = '1.0.0';

function preset(provider: SupportedProvider): ProviderPresetFile {
  switch (provider) {
    case 'github-copilot':
      return {
        version: PRESET_VERSION,
        generatedBy: 'monkey-code',
        provider,
        models: {
          default: 'github-copilot/gpt-5.4',
          fast: 'github-copilot/gpt-5.4-mini',
          deep: 'github-copilot/o1',
        },
        agents: {
          punch: { model: 'github-copilot/gpt-5.4', temperature: 0.7 },
          caesar: { model: 'github-copilot/o1', temperature: 0.2, reasoningEffort: 'high' },
          harambe: { model: 'github-copilot/gpt-5.4', temperature: 0.4 },
          george: { model: 'github-copilot/gpt-5.4', temperature: 0.8 },
          tasker: { model: 'github-copilot/gpt-5.4-mini', temperature: 0.6, maxTokens: 2048 },
          scout: { model: 'github-copilot/gpt-5.4-mini', temperature: 0.5, maxTokens: 2048 },
          builder: { model: 'github-copilot/gpt-5.4-mini', temperature: 0.7, maxTokens: 2048 },
        },
        config: {
          provider,
          model: 'github-copilot/gpt-5.4',
          note: 'Requires GitHub Copilot authentication in OpenCode.',
        },
      };
    case 'opencode-zen':
      return {
        version: PRESET_VERSION,
        generatedBy: 'monkey-code',
        provider,
        models: {
          default: 'opencode-zen/gpt-5-nano',
          fast: 'opencode-zen/gpt-5-nano',
          deep: 'opencode-zen/gpt-5',
        },
        agents: {
          punch: { model: 'opencode-zen/gpt-5', temperature: 0.7 },
          caesar: { model: 'opencode-zen/gpt-5', temperature: 0.3 },
          harambe: { model: 'opencode-zen/gpt-5', temperature: 0.4 },
          george: { model: 'opencode-zen/gpt-5', temperature: 0.8 },
          tasker: { model: 'opencode-zen/gpt-5-nano', temperature: 0.6, maxTokens: 2048 },
          scout: { model: 'opencode-zen/gpt-5-nano', temperature: 0.5, maxTokens: 2048 },
          builder: { model: 'opencode-zen/gpt-5-nano', temperature: 0.7, maxTokens: 2048 },
        },
        config: {
          provider,
          model: 'opencode-zen/gpt-5-nano',
          note: 'Uses OpenCode Zen provider defaults.',
        },
      };
    case 'openrouter':
      return {
        version: PRESET_VERSION,
        generatedBy: 'monkey-code',
        provider,
        models: {
          default: 'openrouter/openai/gpt-4o',
          fast: 'openrouter/openai/gpt-4o-mini',
          deep: 'openrouter/deepseek/deepseek-r1',
        },
        agents: {
          punch: { model: 'openrouter/openai/gpt-4o', temperature: 0.7 },
          caesar: { model: 'openrouter/openai/o1', temperature: 0.2, reasoningEffort: 'high' },
          harambe: { model: 'openrouter/deepseek/deepseek-r1', temperature: 0.4 },
          george: { model: 'openrouter/openai/gpt-4o', temperature: 0.8 },
          tasker: { model: 'openrouter/openai/gpt-4o-mini', temperature: 0.6, maxTokens: 2048 },
          scout: { model: 'openrouter/openai/gpt-4o-mini', temperature: 0.5, maxTokens: 2048 },
          builder: { model: 'openrouter/openai/gpt-4o-mini', temperature: 0.7, maxTokens: 2048 },
        },
        config: {
          provider,
          model: 'openrouter/openai/gpt-4o',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiEnv: 'OPENROUTER_API_KEY',
          note: 'Set OPENROUTER_API_KEY before use.',
        },
      };
    case 'z-ai':
      return {
        version: PRESET_VERSION,
        generatedBy: 'monkey-code',
        provider,
        models: {
          default: 'z-ai/glm-4.5',
          fast: 'z-ai/glm-4.5-air',
          deep: 'z-ai/glm-4.5',
        },
        agents: {
          punch: { model: 'z-ai/glm-4.5', temperature: 0.7 },
          caesar: { model: 'z-ai/glm-4.5', temperature: 0.3 },
          harambe: { model: 'z-ai/glm-4.5', temperature: 0.4 },
          george: { model: 'z-ai/glm-4.5', temperature: 0.8 },
          tasker: { model: 'z-ai/glm-4.5-air', temperature: 0.6, maxTokens: 2048 },
          scout: { model: 'z-ai/glm-4.5-air', temperature: 0.5, maxTokens: 2048 },
          builder: { model: 'z-ai/glm-4.5-air', temperature: 0.7, maxTokens: 2048 },
        },
        config: {
          provider,
          model: 'z-ai/glm-4.5',
          apiEnv: 'ZAI_API_KEY',
          note: 'Set ZAI_API_KEY before use.',
        },
      };
    case 'moonshot':
      return {
        version: PRESET_VERSION,
        generatedBy: 'monkey-code',
        provider,
        models: {
          default: 'moonshot/kimi-k2',
          fast: 'moonshot/kimi-k2-turbo',
          deep: 'moonshot/kimi-k2',
        },
        agents: {
          punch: { model: 'moonshot/kimi-k2', temperature: 0.7 },
          caesar: { model: 'moonshot/kimi-k2', temperature: 0.3 },
          harambe: { model: 'moonshot/kimi-k2', temperature: 0.4 },
          george: { model: 'moonshot/kimi-k2', temperature: 0.8 },
          tasker: { model: 'moonshot/kimi-k2-turbo', temperature: 0.6, maxTokens: 2048 },
          scout: { model: 'moonshot/kimi-k2-turbo', temperature: 0.5, maxTokens: 2048 },
          builder: { model: 'moonshot/kimi-k2-turbo', temperature: 0.7, maxTokens: 2048 },
        },
        config: {
          provider,
          model: 'moonshot/kimi-k2',
          apiEnv: 'MOONSHOT_API_KEY',
          note: 'Set MOONSHOT_API_KEY before use.',
        },
      };
  }
}

export function createPresetFiles(): Record<SupportedProvider, ProviderPresetFile> {
  return Object.fromEntries(
    SUPPORTED_PROVIDERS.map((provider) => [provider, preset(provider)]),
  ) as Record<SupportedProvider, ProviderPresetFile>;
}

export function writePresetFiles(baseDir: string, packageVersion = '0.1.0') {
  const presetsDir = join(baseDir, 'presets');
  mkdirSync(presetsDir, { recursive: true });

  const files = createPresetFiles();
  const written: string[] = [];
  const skipped: string[] = [];

  for (const provider of SUPPORTED_PROVIDERS) {
    const filePath = join(presetsDir, `${provider}.json`);
    if (existsSync(filePath)) {
      skipped.push(filePath);
      continue;
    }

    const payload = {
      ...files[provider],
      generatedBy: `monkey-code@${packageVersion}`,
    };
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    written.push(filePath);
  }

  const manifestPath = join(baseDir, 'preset-manifest.json');
  if (!existsSync(manifestPath)) {
    const manifest: PresetManifest = {
      version: PRESET_VERSION,
      generatedBy: `monkey-code@${packageVersion}`,
      generatedAt: new Date().toISOString(),
      providers: [...SUPPORTED_PROVIDERS],
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    written.push(manifestPath);
  } else {
    skipped.push(manifestPath);
  }

  return { written, skipped, presetsDir, manifestPath };
}

export function readExistingManifest(manifestPath: string): PresetManifest | null {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PresetManifest;
  } catch {
    return null;
  }
}

export function ensureParentDir(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}
