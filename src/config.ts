import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const AGENT_NAMES = ['punch', 'harambe', 'caesar', 'george', 'tasker', 'scout', 'builder'] as const;
const CONFIG_SCHEMA_URL = 'https://raw.githubusercontent.com/monkedevlife/monkey-code/refs/heads/master/schemas/monkey-code-config.schema.json';
const DEFAULT_THINKING_BUDGET_TOKENS = 32000;

const ThinkingConfigSchema = z.object({
  type: z.enum(['enabled', 'disabled']),
  budgetTokens: z.number().positive().optional(),
});

const AgentConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().positive().optional(),
  maxTokens: z.number().positive().optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  thinking: ThinkingConfigSchema.optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
});

const AgentsSchema = z.object({
  punch: AgentConfigSchema.optional(),
  harambe: AgentConfigSchema.optional(),
  caesar: AgentConfigSchema.optional(),
  george: AgentConfigSchema.optional(),
  tasker: AgentConfigSchema.optional(),
  scout: AgentConfigSchema.optional(),
  builder: AgentConfigSchema.optional(),
});

const BackgroundConfigSchema = z.object({
  maxConcurrent: z.number().positive().default(5),
  pollInterval: z.number().positive().default(5000),
});

const ChromeDevToolsSearchSchema = z.object({
  enabled: z.boolean().default(true),
  engine: z.enum(['google', 'bing']).default('google'),
  maxResults: z.number().positive().default(10),
});

const ChromeDevToolsSchema = z.object({
  enabled: z.boolean().default(true),
  executable: z.string().optional(),
  profile: z.string().optional(),
  flags: z.array(z.string()).optional(),
  search: ChromeDevToolsSearchSchema.optional(),
});

const Context7Schema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
});

const GrepAppSchema = z.object({
  enabled: z.boolean().default(true),
});

const McpsSchema = z.object({
  chromeDevTools: ChromeDevToolsSchema.optional(),
  context7: Context7Schema.optional(),
  grepApp: GrepAppSchema.optional(),
});

const SqliteConfigSchema = z.object({
  path: z.string().optional(),
  vectorDimensions: z.number().positive().default(1536),
  maxMemoryItems: z.number().positive().default(10000),
});

const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().optional(),
});

const ConfigSchema = z.object({
  $schema: z.string().optional(),
  agents: AgentsSchema.optional(),
  background: BackgroundConfigSchema.optional(),
  mcps: McpsSchema.optional(),
  sqlite: SqliteConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;
export type BackgroundConfig = z.infer<typeof BackgroundConfigSchema>;
export type ChromeDevToolsConfig = z.infer<typeof ChromeDevToolsSchema>;
export type Context7Config = z.infer<typeof Context7Schema>;
export type GrepAppConfig = z.infer<typeof GrepAppSchema>;
export type McpsConfig = z.infer<typeof McpsSchema>;
export type SqliteConfig = z.infer<typeof SqliteConfigSchema>;
export type TmuxConfig = z.infer<typeof TmuxConfigSchema>;
type AgentName = typeof AGENT_NAMES[number];

const DEFAULT_AGENT_REASONING_CONFIGS: Record<AgentName, Pick<AgentConfig, 'reasoningEffort' | 'thinking'>> = {
  punch: {
    reasoningEffort: 'medium',
  },
  harambe: {
    thinking: { type: 'enabled', budgetTokens: DEFAULT_THINKING_BUDGET_TOKENS },
  },
  caesar: {
    reasoningEffort: 'high',
  },
  george: {
    thinking: { type: 'enabled', budgetTokens: DEFAULT_THINKING_BUDGET_TOKENS },
  },
  tasker: {
    thinking: { type: 'enabled', budgetTokens: DEFAULT_THINKING_BUDGET_TOKENS },
  },
  scout: {
    thinking: { type: 'enabled', budgetTokens: DEFAULT_THINKING_BUDGET_TOKENS },
  },
  builder: {
    thinking: { type: 'enabled', budgetTokens: DEFAULT_THINKING_BUDGET_TOKENS },
  },
};

const DEFAULT_CONFIG: Config = {
  agents: {},
  background: {
    maxConcurrent: 5,
    pollInterval: 5000,
  },
  mcps: {
    chromeDevTools: {
      enabled: true,
      search: {
        enabled: true,
        engine: 'google',
        maxResults: 10,
      },
    },
    context7: {
      enabled: true,
    },
    grepApp: {
      enabled: true,
    },
  },
  sqlite: {
    vectorDimensions: 1536,
    maxMemoryItems: 10000,
  },
  tmux: {
    enabled: true,
  },
};

function getConfigDirs(projectRoot = process.cwd()) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) {
    throw new Error('Could not determine home directory');
  }
  return {
    projectConfig: join(projectRoot, '.opencode', 'monkey-code.json'),
    userOpencodeConfigDir: join(home, '.config', 'opencode'),
    userOpencodeConfig: join(home, '.config', 'opencode', 'monkey-code.json'),
    userConfigDir: join(home, '.config', 'monkey-code'),
    dbPath: join(home, '.config', 'monkey-code', 'monkey.db'),
    tasksDir: join(home, '.config', 'monkey-code', 'tasks'),
    logsDir: join(home, '.config', 'monkey-code', 'logs'),
    presetsDir: join(home, '.config', 'monkey-code', 'presets'),
    presetManifestFile: join(home, '.config', 'monkey-code', 'preset-manifest.json'),
  };
}

function ensureConfigDir(projectRoot = process.cwd()) {
  const { userConfigDir, tasksDir, logsDir, presetsDir } = getConfigDirs(projectRoot);
  
  if (!existsSync(userConfigDir)) {
    mkdirSync(userConfigDir, { recursive: true });
  }
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  if (!existsSync(presetsDir)) {
    mkdirSync(presetsDir, { recursive: true });
  }
}

function loadConfigFile(filePath: string): Partial<Config> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load config from ${filePath}: ${error}`);
  }
}

function readConfigFileIfExists(filePath: string): Partial<Config> {
  return loadConfigFile(filePath);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConfigLayers<T extends Record<string, unknown>>(...layers: T[]): T {
  return layers.reduce<T>((acc, layer) => {
    const next = { ...acc } as Record<string, unknown>;

    for (const [key, value] of Object.entries(layer)) {
      const existing = next[key];
      next[key] = isObject(existing) && isObject(value)
        ? mergeConfigLayers(existing, value)
        : value;
    }

    return next as T;
  }, {} as T);
}

function readAgentFrontmatter(name: AgentName) {
  const filePath = new URL(`../agents/${name}.md`, import.meta.url);
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    throw new Error(`Failed to parse agent frontmatter for ${name}`);
  }

  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':');
        if (idx === -1) return [line, ''];
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      }),
  );
}

function createDefaultAgentConfig(name: AgentName): AgentConfig {
  const frontmatter = readAgentFrontmatter(name);
  return AgentConfigSchema.parse({
    model: frontmatter.model,
    ...DEFAULT_AGENT_REASONING_CONFIGS[name],
  });
}

function defaultChromeExecutable() {
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

export function createDefaultAgentConfigs(): Record<AgentName, AgentConfig> {
  return Object.fromEntries(
    AGENT_NAMES.map((name) => [name, createDefaultAgentConfig(name)]),
  ) as Record<AgentName, AgentConfig>;
}

export function createUserOpencodeConfigTemplate(): Partial<Config> {
  return {
    $schema: CONFIG_SCHEMA_URL,
    agents: createDefaultAgentConfigs(),
    background: {},
    mcps: {
      chromeDevTools: {
        executable: defaultChromeExecutable(),
      },
    },
  };
}

export function writeUserOpencodeConfig(projectRoot = process.cwd()) {
  const { userOpencodeConfigDir, userOpencodeConfig } = getConfigDirs(projectRoot);
  const template = createUserOpencodeConfigTemplate();

  if (!existsSync(userOpencodeConfigDir)) {
    mkdirSync(userOpencodeConfigDir, { recursive: true });
  }

  if (existsSync(userOpencodeConfig)) {
    const existing = readConfigFileIfExists(userOpencodeConfig);
    const merged = {
      ...mergeConfigLayers(template, existing),
      $schema: CONFIG_SCHEMA_URL,
    };
    const before = JSON.stringify(existing);
    const after = JSON.stringify(merged);

    if (before === after) {
      return { path: userOpencodeConfig, written: false };
    }

    writeFileSync(
      userOpencodeConfig,
      `${JSON.stringify(merged, null, 2)}\n`,
      'utf-8',
    );

    return { path: userOpencodeConfig, written: true };
  }

  writeFileSync(
    userOpencodeConfig,
    `${JSON.stringify(template, null, 2)}\n`,
    'utf-8',
  );

  return { path: userOpencodeConfig, written: true };
}

export function loadConfig(projectRoot = process.cwd()): Config {
  ensureConfigDir(projectRoot);
  const { projectConfig, userOpencodeConfig } = getConfigDirs(projectRoot);
  const userConfig = loadConfigFile(userOpencodeConfig);
  const localConfig = loadConfigFile(projectConfig);

  const finalMerged = mergeConfigLayers(DEFAULT_CONFIG, userConfig, localConfig);
  
  try {
    return ConfigSchema.parse(finalMerged);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      throw new Error(`Invalid config: ${messages}`);
    }
    throw error;
  }
}

export function getConfigPaths(projectRoot = process.cwd()) {
  return getConfigDirs(projectRoot);
}

export { ConfigSchema };
