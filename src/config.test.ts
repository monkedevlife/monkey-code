import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadConfig,
  getConfigPaths,
  ConfigSchema,
  createDefaultAgentConfigs,
  createUserOpencodeConfigTemplate,
  writeUserOpencodeConfig,
} from './config';
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

describe('Config System', () => {
  const originalCwd = process.cwd();
  const testDir = '/tmp/monkey-code-config-test';
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const testHome = join(testDir, 'home');

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(testHome, { recursive: true });
    process.env.HOME = testHome;
    process.env.USERPROFILE = testHome;
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('loadConfig', () => {
    it('should load default config when no files exist', () => {
      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(5);
      expect(config.background?.pollInterval).toBe(5000);
      expect(config.mcps?.context7?.enabled).toBe(true);
      expect(config.mcps?.grepApp?.enabled).toBe(true);
      expect(config.tmux?.enabled).toBe(true);
    });

    it('should create user config directory structure', () => {
      loadConfig();

      const { userConfigDir, tasksDir, logsDir, presetsDir } = getConfigPaths();
      expect(existsSync(userConfigDir)).toBe(true);
      expect(existsSync(tasksDir)).toBe(true);
      expect(existsSync(logsDir)).toBe(true);
      expect(existsSync(presetsDir)).toBe(true);
    });

    it('should load project config from .opencode/monkey-code.json', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        background: {
          maxConcurrent: 3,
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(3);
    });

    it('should load user config from ~/.config/opencode/monkey-code.json', () => {
      const { userOpencodeConfigDir, userOpencodeConfig } = getConfigPaths();
      mkdirSync(userOpencodeConfigDir, { recursive: true });
      writeFileSync(userOpencodeConfig, JSON.stringify({ background: { maxConcurrent: 4 } }));

      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(4);
    });

    it('should let project config override user config', () => {
      const { userOpencodeConfigDir, userOpencodeConfig } = getConfigPaths();
      mkdirSync(userOpencodeConfigDir, { recursive: true });
      writeFileSync(userOpencodeConfig, JSON.stringify({ background: { maxConcurrent: 4, pollInterval: 2000 } }));

      mkdirSync('.opencode', { recursive: true });
      writeFileSync('.opencode/monkey-code.json', JSON.stringify({ background: { maxConcurrent: 9 } }));

      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(9);
      expect(config.background?.pollInterval).toBe(2000);
    });

    it('should load profile config from OPENCODE_CONFIG_DIR when set', () => {
      const profileDir = join(testDir, 'profile');
      mkdirSync(profileDir, { recursive: true });
      process.env.OPENCODE_CONFIG_DIR = profileDir;
      writeFileSync(join(profileDir, 'monkey-code.json'), JSON.stringify({ background: { maxConcurrent: 7 } }));

      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(7);
      delete process.env.OPENCODE_CONFIG_DIR;
    });

    it('should let profile config override project config', () => {
      const profileDir = join(testDir, 'profile');
      mkdirSync(profileDir, { recursive: true });
      process.env.OPENCODE_CONFIG_DIR = profileDir;
      writeFileSync(join(profileDir, 'monkey-code.json'), JSON.stringify({ background: { maxConcurrent: 7, pollInterval: 3000 } }));

      mkdirSync('.opencode', { recursive: true });
      writeFileSync('.opencode/monkey-code.json', JSON.stringify({ background: { maxConcurrent: 2 } }));

      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(7);
      expect(config.background?.pollInterval).toBe(3000);
      delete process.env.OPENCODE_CONFIG_DIR;
    });

    it('should use OPENCODE_CONFIG_DIR even when it matches user config dir', () => {
      const { userOpencodeConfigDir, userOpencodeConfig } = getConfigPaths();
      mkdirSync(userOpencodeConfigDir, { recursive: true });
      writeFileSync(userOpencodeConfig, JSON.stringify({ background: { maxConcurrent: 4 } }));
      process.env.OPENCODE_CONFIG_DIR = userOpencodeConfigDir;

      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(4);
      delete process.env.OPENCODE_CONFIG_DIR;
    });

    it('should provide user opencode config paths', () => {
      const paths = getConfigPaths();

      expect(paths.userOpencodeConfigDir).toContain('.config/opencode');
      expect(paths.userOpencodeConfig).toContain('.config/opencode/monkey-code.json');
    });

    it('should generate user config template from bundled agent defaults', () => {
      const template = createUserOpencodeConfigTemplate();

      expect(template.$schema).toBe('https://raw.githubusercontent.com/monkedevlife/monkey-code/refs/heads/master/schemas/monkey-code-config.schema.json');
      expect(template.agents?.punch?.model).toBe('github-copilot/gpt-5.4');
      expect(template.agents?.punch?.reasoningEffort).toBe('medium');
      expect(template.agents?.caesar?.model).toBe('github-copilot/gpt-5.4');
      expect(template.agents?.caesar?.reasoningEffort).toBe('high');
      expect(template.agents?.harambe?.model).toBe('github-copilot/gemini-3-flash-preview');
      expect(template.agents?.harambe?.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 });
      expect(template.agents?.tasker?.model).toBe('github-copilot/gemini-3-flash-preview');
      expect(template.agents?.tasker?.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 });
      expect(template.sqlite).toBeUndefined();
      expect(template.tmux).toBeUndefined();
    });

    it('should expose default agent config map from agent files', () => {
      const defaults = createDefaultAgentConfigs();

      expect(defaults.punch.model).toBe('github-copilot/gpt-5.4');
      expect(defaults.punch.reasoningEffort).toBe('medium');
      expect(defaults.caesar.reasoningEffort).toBe('high');
      expect(defaults.george.model).toBe('github-copilot/gemini-3-flash-preview');
      expect(defaults.george.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 });
      expect(defaults.builder.model).toBe('github-copilot/gemini-3-flash-preview');
      expect(defaults.builder.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 });
    });

    it('should backfill missing agent defaults into existing user config', () => {
      const { userOpencodeConfigDir, userOpencodeConfig } = getConfigPaths();
      mkdirSync(userOpencodeConfigDir, { recursive: true });
      writeFileSync(
        userOpencodeConfig,
        JSON.stringify({ background: { maxConcurrent: 11 }, agents: { punch: { temperature: 0.9 } } }),
      );

      const result = writeUserOpencodeConfig();
      const written = JSON.parse(readFileSync(userOpencodeConfig, 'utf-8')) as {
        $schema?: string;
        background?: { maxConcurrent?: number };
        agents?: { punch?: { temperature?: number; model?: string }; harambe?: { model?: string } };
      };

      expect(result.written).toBe(true);
      expect(written.$schema).toBe('https://raw.githubusercontent.com/monkedevlife/monkey-code/refs/heads/master/schemas/monkey-code-config.schema.json');
      expect(written.background?.maxConcurrent).toBe(11);
        expect(written.agents?.punch?.temperature).toBe(0.9);
        expect(written.agents?.punch?.model).toBe('github-copilot/gpt-5.4');
        expect(written.agents?.punch?.reasoningEffort).toBe('medium');
        expect(written.agents?.harambe?.model).toBe('github-copilot/gemini-3-flash-preview');
        expect(written.agents?.harambe?.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 });
      });

    it('should merge project config with defaults', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        background: {
          maxConcurrent: 10,
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(10);
      expect(config.background?.pollInterval).toBe(5000); // From defaults
    });

    it('should validate config against schema', () => {
      mkdirSync('.opencode', { recursive: true });
      const invalidConfig = {
        background: {
          maxConcurrent: -1, // Invalid: must be positive
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(invalidConfig));

      expect(() => loadConfig()).toThrow();
    });

    it('should handle invalid JSON in config file', () => {
      mkdirSync('.opencode', { recursive: true });
      writeFileSync('.opencode/monkey-code.json', 'invalid json {');

      expect(() => loadConfig()).toThrow();
    });

    it('should allow agent configuration', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        agents: {
          punch: {
            model: 'gpt-4',
            temperature: 0.7,
          },
          harambe: {
            model: 'gpt-3.5-turbo',
          },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.agents?.punch?.model).toBe('gpt-4');
      expect(config.agents?.punch?.temperature).toBe(0.7);
      expect(config.agents?.harambe?.model).toBe('gpt-3.5-turbo');
    });

    it('should validate SQLite config', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        sqlite: {
          vectorDimensions: 768,
          maxMemoryItems: 5000,
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.sqlite?.vectorDimensions).toBe(768);
      expect(config.sqlite?.maxMemoryItems).toBe(5000);
    });

    it('should allow disabling MCPs', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        mcps: {
          context7: { enabled: false },
          grepApp: { enabled: false },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.mcps?.context7?.enabled).toBe(false);
      expect(config.mcps?.grepApp?.enabled).toBe(false);
    });

    it('should allow tmux configuration', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        tmux: {
          enabled: false,
          path: '/custom/tmux',
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.tmux?.enabled).toBe(false);
      expect(config.tmux?.path).toBe('/custom/tmux');
    });

    it('should provide storage paths', () => {
      const paths = getConfigPaths();

      expect(paths.projectConfig).toMatch(/\/\.opencode\/monkey-code\.json$/);
      expect(paths.userConfigDir).toContain('.config/monkey-code');
      expect(paths.dbPath).toContain('.config/monkey-code/monkey.db');
      expect(paths.tasksDir).toContain('.config/monkey-code/tasks');
      expect(paths.logsDir).toContain('.config/monkey-code/logs');
      expect(paths.presetsDir).toContain('.config/monkey-code/presets');
      expect(paths.presetManifestFile).toContain('.config/monkey-code/preset-manifest.json');
    });

    it('should have correct default values for background config', () => {
      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(5);
      expect(config.background?.pollInterval).toBe(5000);
    });

    it('should have correct default values for sqlite config', () => {
      const config = loadConfig();

      expect(config.sqlite?.vectorDimensions).toBe(1536);
      expect(config.sqlite?.maxMemoryItems).toBe(10000);
    });

    it('should allow partial agent configs', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        agents: {
          punch: { model: 'gpt-4' },
          tasker: { temperature: 0.5 },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.agents?.punch?.model).toBe('gpt-4');
      expect(config.agents?.punch?.temperature).toBeUndefined();
      expect(config.agents?.tasker?.model).toBeUndefined();
      expect(config.agents?.tasker?.temperature).toBe(0.5);
    });

    it('should validate temperature range (0-2)', () => {
      mkdirSync('.opencode', { recursive: true });
      const invalidConfig = {
        agents: {
          punch: { temperature: 3 }, // Invalid: max is 2
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(invalidConfig));

      expect(() => loadConfig()).toThrow();
    });

    it('should allow all agent inference params', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        agents: {
          punch: {
            model: 'gpt-4',
            temperature: 0.7,
            topP: 0.9,
            topK: 50,
            maxTokens: 4096,
            presencePenalty: 0.5,
            frequencyPenalty: -0.5,
            reasoningEffort: 'high',
            thinking: { type: 'enabled', budgetTokens: 16000 },
            providerOptions: { seed: 42 },
          },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.agents?.punch?.model).toBe('gpt-4');
      expect(config.agents?.punch?.temperature).toBe(0.7);
      expect(config.agents?.punch?.topP).toBe(0.9);
      expect(config.agents?.punch?.topK).toBe(50);
      expect(config.agents?.punch?.maxTokens).toBe(4096);
      expect(config.agents?.punch?.presencePenalty).toBe(0.5);
      expect(config.agents?.punch?.frequencyPenalty).toBe(-0.5);
      expect(config.agents?.punch?.reasoningEffort).toBe('high');
      expect(config.agents?.punch?.thinking).toEqual({ type: 'enabled', budgetTokens: 16000 });
      expect(config.agents?.punch?.providerOptions).toEqual({ seed: 42 });
    });

    it('should validate topP range (0-1)', () => {
      mkdirSync('.opencode', { recursive: true });
      const invalidConfig = {
        agents: {
          punch: { topP: 1.5 },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(invalidConfig));

      expect(() => loadConfig()).toThrow();
    });

    it('should validate reasoningEffort enum', () => {
      mkdirSync('.opencode', { recursive: true });
      const invalidConfig = {
        agents: {
          punch: { reasoningEffort: 'extreme' },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(invalidConfig));

      expect(() => loadConfig()).toThrow();
    });

    it('should validate thinking config', () => {
      mkdirSync('.opencode', { recursive: true });
      const invalidConfig = {
        agents: {
          punch: { thinking: { type: 'auto' } },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(invalidConfig));

      expect(() => loadConfig()).toThrow();
    });

    it('should allow context7 API key', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        mcps: {
          context7: {
            enabled: true,
            apiKey: 'secret-key-123',
          },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.mcps?.context7?.apiKey).toBe('secret-key-123');
    });

    it('should accept valid caveman config with intensity', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        caveman: {
          enabled: true,
          intensity: 'ultra',
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.caveman?.enabled).toBe(true);
      expect(config.caveman?.intensity).toBe('ultra');
    });

    it('should reject invalid caveman intensity', () => {
      mkdirSync('.opencode', { recursive: true });
      const invalidConfig = {
        caveman: {
          enabled: true,
          intensity: 'invalid-level',
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(invalidConfig));

      expect(() => loadConfig()).toThrow();
    });

    it('should default caveman to disabled when omitted', () => {
      const config = loadConfig();

      expect(config.caveman?.enabled).toBe(false);
    });

    it('should use CAVEMAN_DEFAULT_MODE env var for default intensity', async () => {
      const saved = process.env.CAVEMAN_DEFAULT_MODE;
      process.env.CAVEMAN_DEFAULT_MODE = 'ultra';
      vi.resetModules();

      const { loadConfig: freshLoadConfig } = await import('./config');
      const config = freshLoadConfig();

      expect(config.caveman?.intensity).toBe('ultra');
      process.env.CAVEMAN_DEFAULT_MODE = saved;
      vi.resetModules();
      await import('./config');
    });

    it('should fall back to full intensity for invalid CAVEMAN_DEFAULT_MODE', async () => {
      const saved = process.env.CAVEMAN_DEFAULT_MODE;
      process.env.CAVEMAN_DEFAULT_MODE = 'bad-value';
      vi.resetModules();

      const { loadConfig: freshLoadConfig } = await import('./config');
      const config = freshLoadConfig();

      expect(config.caveman?.intensity).toBe('full');
      process.env.CAVEMAN_DEFAULT_MODE = saved;
      vi.resetModules();
      await import('./config');
    });

  });

  describe('ConfigSchema validation', () => {
    it('should validate a complete valid config', () => {
      const validConfig = {
        agents: {
          punch: { model: 'gpt-4', temperature: 0.7 },
          harambe: { model: 'gpt-3.5-turbo' },
        },
        background: {
          maxConcurrent: 10,
          pollInterval: 3000,
        },
        mcps: {
          context7: { enabled: true, apiKey: 'key' },
          grepApp: { enabled: false },
        },
        sqlite: {
          vectorDimensions: 768,
          maxMemoryItems: 5000,
        },
        tmux: { enabled: true, path: '/usr/bin/tmux' },
      };

      const result = ConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should reject negative maxConcurrent', () => {
      const invalidConfig = {
        background: { maxConcurrent: -5 },
      };

      const result = ConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject zero pollInterval', () => {
      const invalidConfig = {
        background: { pollInterval: 0 },
      };

      const result = ConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should accept empty partial config', () => {
      const emptyConfig = {};

      const result = ConfigSchema.safeParse(emptyConfig);
      expect(result.success).toBe(true);
    });
  });
});
