import { z } from 'zod';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const AgentConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const AgentsSchema = z.object({
  punch: AgentConfigSchema.optional(),
  harambe: AgentConfigSchema.optional(),
  caesar: AgentConfigSchema.optional(),
  kong: AgentConfigSchema.optional(),
  rafiki: AgentConfigSchema.optional(),
  abu: AgentConfigSchema.optional(),
  george: AgentConfigSchema.optional(),
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
  agents: AgentsSchema.optional(),
  background: BackgroundConfigSchema.optional(),
  mcps: McpsSchema.optional(),
  sqlite: SqliteConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type BackgroundConfig = z.infer<typeof BackgroundConfigSchema>;
export type ChromeDevToolsConfig = z.infer<typeof ChromeDevToolsSchema>;
export type Context7Config = z.infer<typeof Context7Schema>;
export type GrepAppConfig = z.infer<typeof GrepAppSchema>;
export type McpsConfig = z.infer<typeof McpsSchema>;
export type SqliteConfig = z.infer<typeof SqliteConfigSchema>;
export type TmuxConfig = z.infer<typeof TmuxConfigSchema>;

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

function getConfigDirs() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) {
    throw new Error('Could not determine home directory');
  }
  return {
    projectConfig: '.opencode/monkey-code.json',
    userConfigDir: join(home, '.config', 'monkey-code'),
    userConfigFile: join(home, '.config', 'monkey-code', 'config.json'),
    dbPath: join(home, '.config', 'monkey-code', 'monkey.db'),
    tasksDir: join(home, '.config', 'monkey-code', 'tasks'),
    logsDir: join(home, '.config', 'monkey-code', 'logs'),
  };
}

function ensureConfigDir() {
  const { userConfigDir, tasksDir, logsDir } = getConfigDirs();
  
  if (!existsSync(userConfigDir)) {
    mkdirSync(userConfigDir, { recursive: true });
  }
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

function loadProjectConfig(): Partial<Config> {
  const { projectConfig } = getConfigDirs();
  
  if (!existsSync(projectConfig)) {
    return {};
  }
  
  try {
    const content = readFileSync(projectConfig, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load project config from ${projectConfig}: ${error}`);
  }
}

function loadUserConfig(): Partial<Config> {
  const { userConfigFile } = getConfigDirs();
  
  if (!existsSync(userConfigFile)) {
    return {};
  }
  
  try {
    const content = readFileSync(userConfigFile, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load user config from ${userConfigFile}: ${error}`);
  }
}

export function loadConfig(): Config {
  ensureConfigDir();
  
  const userConfig = loadUserConfig();
  const projectConfig = loadProjectConfig();
  
  const userMerged = { ...DEFAULT_CONFIG, ...userConfig };
  const finalMerged = { ...userMerged, ...projectConfig };
  
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

export function getConfigPaths() {
  return getConfigDirs();
}

export { ConfigSchema };
