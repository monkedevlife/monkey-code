import { join } from 'path';
import { tool, type Plugin, type Config as OpenCodeConfig } from '@opencode-ai/plugin';
import { readFileSync, existsSync } from 'fs';
import { loadConfig, getConfigPaths, type Config as MonkeyConfig, type McpsConfig } from './config.js';
import { createSQLiteClient, type SQLiteClient } from './utils/sqlite-client.js';
import { createBackgroundManager, type BackgroundManager, type BackgroundManagerConfig } from './managers/BackgroundManager.js';
import { createInteractiveManager, type InteractiveManager } from './managers/InteractiveManager.js';
import { createSkillMcpManager, type SkillMcpManager, type SkillMcpManagerOptions } from './managers/SkillMcpManager.js';
import { delegateTask, type DelegateTaskInput } from './tools/delegate-task.js';
import { getBackgroundOutput, type BackgroundOutputParams } from './tools/background-output.js';
import { createBackgroundCancelTool, type BackgroundCancelParams } from './tools/background-cancel.js';
import { interactiveBash, type InteractiveBashInput, cleanupSessions } from './tools/interactive-bash.js';
import { skillMcp, type SkillMcpParams, cleanupAllSkills } from './tools/skill-mcp.js';
import { handleChatParams } from './hooks/chat-params.js';

const agents = ['punch', 'harambe', 'caesar', 'george', 'tasker', 'scout', 'builder'] as const;
const primaryAgents = new Set(['punch', 'harambe', 'caesar', 'george']);
const schema = tool.schema;
const pluginRoot = new URL('..', import.meta.url);

type PluginState = {
  config?: MonkeyConfig;
  sqlite?: SQLiteClient;
  backgroundManager?: BackgroundManager;
  interactiveManager?: InteractiveManager;
  skillMcpManager?: SkillMcpManager;
  backgroundCancelTool?: Awaited<ReturnType<typeof createBackgroundCancelTool>>;
  isInitialized: boolean;
};

const pluginState: PluginState = {
  isInitialized: false,
};

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function readBundledAgent(name: typeof agents[number]) {
  const file = new URL(`./agents/${name}.md`, pluginRoot);
  if (!existsSync(file)) return undefined;

  const content = readFileSync(file, 'utf-8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return undefined;

  const frontmatter = match[1] ?? '';
  const prompt = (match[2] ?? '').trim();
  const meta = Object.fromEntries(
    frontmatter
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':');
        if (idx === -1) return [line, ''];
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      }),
  );

  return {
    name,
    description: meta.description,
    model: meta.model,
    prompt,
    mode: primaryAgents.has(name) ? 'primary' : 'subagent',
  };
}

function applyMonkeyAgents(config: OpenCodeConfig) {
  const mutableConfig = config as OpenCodeConfig & {
    agent?: Record<string, unknown>;
    default_agent?: string;
  };
  const agentConfig =
    mutableConfig.agent && typeof mutableConfig.agent === 'object' && !Array.isArray(mutableConfig.agent)
      ? mutableConfig.agent
      : {};

  for (const name of agents) {
    const bundled = readBundledAgent(name);
    if (!bundled) continue;

    const existing =
      agentConfig[name] && typeof agentConfig[name] === 'object' && !Array.isArray(agentConfig[name])
        ? (agentConfig[name] as Record<string, unknown>)
        : {};

    const configured = resolveAgentConfig(name);
    agentConfig[name] = {
      ...existing,
      ...(bundled.description ? { description: bundled.description } : {}),
      ...(bundled.prompt ? { prompt: bundled.prompt } : {}),
      ...(bundled.model ? { model: bundled.model } : {}),
      ...(configured?.model ? { model: configured.model } : {}),
      ...(configured?.temperature !== undefined ? { temperature: configured.temperature } : {}),
      mode: bundled.mode,
    };
  }

  mutableConfig.agent = agentConfig;
  mutableConfig.default_agent = 'punch';
}

function resolveAgentConfig(agentName?: string) {
  if (!pluginState.config?.agents || !agentName) return undefined;
  return pluginState.config.agents[agentName as keyof typeof pluginState.config.agents];
}

function createClientAdapter(input: Parameters<Plugin>[0]) {
  return {
    session: {
      create: async (params: { parentID?: string; title?: string }) => {
        const result = await input.client.session.create({
          body: {
            parentID: params.parentID,
            title: params.title,
          },
        });

        return {
          data: result.data ? { id: result.data.id } : undefined,
        };
      },
      prompt: async (params: {
        sessionID: string;
        agent?: string;
        system?: string;
        parts: Array<{ type: string; text: string }>;
        noReply?: boolean;
      }) => {
        const result = await input.client.session.prompt({
          path: { id: params.sessionID },
          body: {
            agent: params.agent,
            system: params.system,
            noReply: params.noReply,
            parts: params.parts.map((part) => ({
              type: 'text' as const,
              text: part.text,
            })),
          },
        });

        return { data: result.data };
      },
    },
  };
}

async function initializePlugin(input: Parameters<Plugin>[0]) {
  if (pluginState.isInitialized) return;

  const config = loadConfig(input.worktree);
  pluginState.config = config;

  const paths = getConfigPaths(input.worktree);
  const sqlite = createSQLiteClient(paths.dbPath);
  await sqlite.initialize();
  pluginState.sqlite = sqlite;

  const backgroundConfig: BackgroundManagerConfig = {
    concurrencyLimit: config.background?.maxConcurrent ?? 5,
    pollIntervalMs: config.background?.pollInterval ?? 5000,
  };
  const backgroundManager = createBackgroundManager(sqlite, backgroundConfig);
  await backgroundManager.initialize();
  pluginState.backgroundManager = backgroundManager;

  pluginState.interactiveManager = createInteractiveManager();

  const skillMcpOptions: SkillMcpManagerOptions = {
    builtinConfig: config.mcps as McpsConfig,
  };
  const skillMcpManager = createSkillMcpManager(skillMcpOptions);
  try {
    await skillMcpManager.initializeBuiltinMcps();
  } catch (error) {
    console.warn('[monkey-code] Failed to initialize some builtin MCPs:', error instanceof Error ? error.message : String(error));
  }
  pluginState.skillMcpManager = skillMcpManager;

  pluginState.backgroundCancelTool = await createBackgroundCancelTool(backgroundManager, sqlite);
  pluginState.isInitialized = true;
}

async function shutdownPlugin() {
  if (!pluginState.isInitialized) return;

  if (pluginState.interactiveManager) {
    await cleanupSessions({ manager: pluginState.interactiveManager });
  }

  if (pluginState.skillMcpManager) {
    await cleanupAllSkills(pluginState.skillMcpManager);
    await pluginState.skillMcpManager.cleanup();
  }

  if (pluginState.backgroundManager) {
    await pluginState.backgroundManager.shutdown();
  }

  if (pluginState.sqlite) {
    await pluginState.sqlite.close();
  }

  pluginState.config = undefined;
  pluginState.sqlite = undefined;
  pluginState.backgroundManager = undefined;
  pluginState.interactiveManager = undefined;
  pluginState.skillMcpManager = undefined;
  pluginState.backgroundCancelTool = undefined;
  pluginState.isInitialized = false;
}

async function handleDelegateTaskRequest(args: DelegateTaskInput, sessionID: string, input: Parameters<Plugin>[0]) {
  if (!pluginState.backgroundManager) throw new Error('Plugin not initialized');

  return delegateTask(args, {
    backgroundManager: pluginState.backgroundManager,
    client: createClientAdapter(input),
    parentSessionId: sessionID,
    agentConfig: resolveAgentConfig(args.agent ?? 'punch'),
    worktree: input.worktree,
    directory: input.directory,
  });
}

async function handleBackgroundOutputRequest(args: BackgroundOutputParams) {
  if (!pluginState.backgroundManager) throw new Error('Plugin not initialized');
  return getBackgroundOutput(pluginState.backgroundManager, args);
}

async function handleBackgroundCancelRequest(args: BackgroundCancelParams) {
  if (!pluginState.backgroundCancelTool) throw new Error('Plugin not initialized');
  return pluginState.backgroundCancelTool.execute(args);
}

async function handleInteractiveBashRequest(args: InteractiveBashInput, directory: string) {
  if (!pluginState.interactiveManager) throw new Error('Plugin not initialized');
  return interactiveBash(
    {
      ...args,
      cwd: args.cwd ?? directory,
    },
    { manager: pluginState.interactiveManager },
  );
}

async function handleSkillMcpRequest(args: SkillMcpParams, worktree: string) {
  if (!pluginState.skillMcpManager) throw new Error('Plugin not initialized');
  return skillMcp(args, {
    manager: pluginState.skillMcpManager,
    skillPaths: [join(worktree, '.opencode', 'skills')],
  });
}

export const server: Plugin = async (input) => {
  await initializePlugin(input);

  return {
    config: async (config: OpenCodeConfig) => {
      applyMonkeyAgents(config);
    },
    tool: {
      'delegate-task': tool({
        description: 'Delegate a task to background execution using an AI agent',
        args: {
          task: schema.string().describe('Task description'),
          agent: schema.enum(agents).optional().describe('Agent to use'),
          context: schema.string().optional().describe('Additional context'),
          timeout: schema.number().min(1).max(240).optional().describe('Timeout in minutes'),
        },
        async execute(args, context) {
          return stringify(await handleDelegateTaskRequest(args, context.sessionID, input));
        },
      }),
      'background-output': tool({
        description: 'Get output from a background task, optionally waiting for completion',
        args: {
          taskId: schema.string().describe('Task ID to get output for'),
          wait: schema.boolean().optional().describe('Wait for task completion'),
          timeout: schema.number().optional().describe('Timeout in milliseconds when waiting'),
        },
        async execute(args) {
          return stringify(await handleBackgroundOutputRequest(args));
        },
      }),
      'background-cancel': tool({
        description: 'Cancel a running or pending background task, or cancel all tasks',
        args: {
          taskId: schema.string().optional().describe('Task ID to cancel'),
          all: schema.boolean().optional().describe('Cancel all cancellable tasks'),
        },
        async execute(args) {
          if (!args.all && !args.taskId) {
            throw new Error('taskId is required unless all is true');
          }

          return stringify(
            await handleBackgroundCancelRequest({
              taskId: args.taskId ?? '',
              all: args.all,
            }),
          );
        },
      }),
      'interactive-bash': tool({
        description: 'Create and manage interactive bash sessions using tmux',
        args: {
          command: schema.string().optional().describe('Command to run in the interactive session'),
          action: schema.enum(['start', 'send', 'capture', 'close']).describe('Action to perform'),
          sessionId: schema.string().optional().describe('Session ID for send/capture/close actions'),
          input: schema.string().optional().describe('Input to send to the session'),
          cwd: schema.string().optional().describe('Working directory for the session'),
          lines: schema.number().min(1).max(1000).optional().describe('Number of lines to capture'),
        },
        async execute(args, context) {
          return stringify(
            await handleInteractiveBashRequest(
              {
                command: args.command ?? '',
                action: args.action,
                sessionId: args.sessionId,
                input: args.input,
                cwd: args.cwd,
                lines: args.lines,
              },
              context.directory,
            ),
          );
        },
      }),
      'skill-mcp': tool({
        description: 'Load, invoke, and unload skill MCP servers with embedded instructions',
        args: {
          skill: schema.string().describe('Skill name or path'),
          action: schema.enum(['load', 'invoke', 'unload']).describe('Action to perform'),
          tool: schema.string().optional().describe('Tool to invoke'),
          params: schema.record(schema.string(), schema.unknown()).optional().describe('Tool parameters'),
        },
        async execute(args) {
          return stringify(await handleSkillMcpRequest(args, input.worktree));
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type === 'server.instance.disposed') {
        await shutdownPlugin();
      }
    },
    'chat.params': async (hookInput, output) => {
      await handleChatParams(hookInput, output);
    },
  };
};

const plugin = {
  id: 'monkey-code',
  server,
};

export default plugin;
