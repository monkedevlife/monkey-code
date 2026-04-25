import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { loadConfig, getConfigPaths, ConfigSchema } from './config';
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

describe('Config System', () => {
  const originalCwd = process.cwd();
  const testDir = '/tmp/monkey-code-config-test';
  const home = process.env.HOME || '';

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('loadConfig', () => {
    it('should load default config when no files exist', () => {
      const config = loadConfig();

      expect(config.background?.maxConcurrent).toBe(5);
      expect(config.background?.pollInterval).toBe(5000);
      expect(config.mcps?.chromeDevTools?.enabled).toBe(true);
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
      expect(config.mcps?.chromeDevTools?.enabled).toBe(true); // From defaults
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

    it('should allow Chrome DevTools configuration', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        mcps: {
          chromeDevTools: {
            enabled: true,
            executable: '/usr/bin/chromium',
            profile: 'Default',
            flags: ['--no-sandbox'],
            search: {
              enabled: true,
              engine: 'bing',
              maxResults: 20,
            },
          },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.mcps?.chromeDevTools?.executable).toBe('/usr/bin/chromium');
      expect(config.mcps?.chromeDevTools?.profile).toBe('Default');
      expect(config.mcps?.chromeDevTools?.flags).toEqual(['--no-sandbox']);
      expect(config.mcps?.chromeDevTools?.search?.engine).toBe('bing');
      expect(config.mcps?.chromeDevTools?.search?.maxResults).toBe(20);
    });

    it('should allow disabling MCPs', () => {
      mkdirSync('.opencode', { recursive: true });
      const projectConfig = {
        mcps: {
          chromeDevTools: { enabled: false },
          context7: { enabled: false },
          grepApp: { enabled: false },
        },
      };
      writeFileSync('.opencode/monkey-code.json', JSON.stringify(projectConfig));

      const config = loadConfig();

      expect(config.mcps?.chromeDevTools?.enabled).toBe(false);
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

      expect(paths.projectConfig).toBe('.opencode/monkey-code.json');
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

    it('should have correct default values for chrome devtools search', () => {
      const config = loadConfig();

      expect(config.mcps?.chromeDevTools?.search?.enabled).toBe(true);
      expect(config.mcps?.chromeDevTools?.search?.engine).toBe('google');
      expect(config.mcps?.chromeDevTools?.search?.maxResults).toBe(10);
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

    it('should validate engine enum values', () => {
      mkdirSync('.opencode', { recursive: true });
      const invalidConfig = {
        mcps: {
          chromeDevTools: {
            search: {
              engine: 'yahoo', // Invalid: must be 'google' or 'bing'
            },
          },
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
          chromeDevTools: {
            enabled: true,
            executable: '/usr/bin/chrome',
            search: { enabled: true, engine: 'google', maxResults: 15 },
          },
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
