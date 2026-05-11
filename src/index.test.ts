import { describe, it, expect, vi, beforeEach } from 'vitest';
import monkeyCodePlugin from './index';
import { buildBundledAgentPermission, readBundledAgent } from './bundled-agents';
import { getCavemanInstructions, CAVEMAN_LEVELS } from './caveman';

describe('Monkey Code Plugin', () => {
  it('exports a current opencode plugin module', () => {
    expect(monkeyCodePlugin).toBeDefined();
    expect(monkeyCodePlugin.id).toBe('monkey-code');
    expect(typeof monkeyCodePlugin.server).toBe('function');
  });

  it('builds restrictive permissions for read-only agents', () => {
    expect(buildBundledAgentPermission(['read', 'glob', 'grep'])).toEqual({
      '*': 'deny',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
    });
  });

  it('builds a strict allowlist when edit and bash are explicitly allowed', () => {
    expect(buildBundledAgentPermission(['bash', 'edit', 'read', 'interactive-bash'])).toEqual({
      '*': 'deny',
      bash: 'allow',
      edit: 'allow',
      read: 'allow',
      'interactive-bash': 'allow',
    });
  });

  it('maps grouped tool permissions like lsp, websearch, and edit', () => {
    expect(buildBundledAgentPermission(['write', 'lsp_symbols', 'websearch_web_search_exa'])).toEqual({
      '*': 'deny',
      edit: 'allow',
      lsp: 'allow',
      websearch: 'allow',
    });
  });

  it('reads bundled Caesar agent with a strict read-only allowlist', () => {
    const caesar = readBundledAgent('caesar');

    expect(caesar).toBeDefined();
    expect(caesar?.tools).toEqual(['question', 'read', 'glob', 'grep', 'lsp_symbols', 'plan-write', 'plan-read', 'plan-list', 'plan-update-task', 'delegate-task', 'background-output', 'background-cancel']);
    expect(caesar?.permission).toEqual({
      '*': 'deny',
      question: 'allow',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      lsp: 'allow',
      'plan-write': 'allow',
      'plan-read': 'allow',
      'plan-list': 'allow',
      'plan-update-task': 'allow',
      'delegate-task': 'allow',
      'background-output': 'allow',
      'background-cancel': 'allow',
    });
  });

  it('reads bundled Punch agent with strict edit and bash allowlist', () => {
    const punch = readBundledAgent('punch');

    expect(punch).toBeDefined();
    expect(punch?.tools).toEqual(['question', 'bash', 'edit', 'write', 'read', 'glob', 'grep', 'todowrite', 'webfetch', 'websearch', 'lsp_goto_definition', 'lsp_find_references', 'lsp_symbols', 'lsp_diagnostics', 'lsp_prepare_rename', 'lsp_rename', 'ast_grep_search', 'ast_grep_replace', 'plan-write', 'plan-read', 'plan-list', 'plan-update-task', 'delegate-task', 'background-output', 'background-cancel', 'interactive-bash', 'skill-mcp']);
    expect(punch?.permission).toEqual({
      '*': 'deny',
      question: 'allow',
      bash: 'allow',
      edit: 'allow',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      todowrite: 'allow',
      webfetch: 'allow',
      websearch: 'allow',
      lsp: 'allow',
      ast_grep_search: 'allow',
      ast_grep_replace: 'allow',
      'plan-write': 'allow',
      'plan-read': 'allow',
      'plan-list': 'allow',
      'plan-update-task': 'allow',
      'delegate-task': 'allow',
      'background-output': 'allow',
      'background-cancel': 'allow',
      'interactive-bash': 'allow',
      'skill-mcp': 'allow',
    });
  });

  it('exports current plugin server for slash command hooks', () => {
    expect(typeof monkeyCodePlugin.server).toBe('function');
  });

  it('reads bundled openspec-plan agent with restricted permissions', () => {
    const openspecPlan = readBundledAgent('openspec-plan');

    expect(openspecPlan).toBeDefined();
    expect(openspecPlan?.mode).toBe('subagent');
    expect(openspecPlan?.tools).toContain('openspec-read');
    expect(openspecPlan?.tools).toContain('openspec-write');
    expect(openspecPlan?.tools).toContain('openspec-list');
    expect(openspecPlan?.tools).toContain('plan-write');
    expect(openspecPlan?.tools).toContain('delegate-task');
    expect(openspecPlan?.tools).not.toContain('edit');
    expect(openspecPlan?.tools).not.toContain('bash');
    expect(openspecPlan?.permission).toEqual({
      '*': 'deny',
      question: 'allow',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      lsp: 'allow',
      webfetch: 'allow',
      websearch: 'allow',
      'plan-write': 'allow',
      'plan-read': 'allow',
      'plan-list': 'allow',
      'plan-update-task': 'allow',
      'delegate-task': 'allow',
      'background-output': 'allow',
      'openspec-read': 'allow',
      'openspec-write': 'allow',
      'openspec-list': 'allow',
    });
  });

  it('builds permissions for openspec tools correctly', () => {
    const perms = buildBundledAgentPermission(['openspec-read', 'openspec-write', 'openspec-list', 'read']);
    expect(perms).toEqual({
      '*': 'deny',
      read: 'allow',
      'openspec-read': 'allow',
      'openspec-write': 'allow',
      'openspec-list': 'allow',
    });
  });

  it('openspec-plan agent does not have edit or bash tools', () => {
    const openspecPlan = readBundledAgent('openspec-plan');
    expect(openspecPlan?.tools).not.toContain('edit');
    expect(openspecPlan?.tools).not.toContain('bash');
    expect(openspecPlan?.tools).not.toContain('write');
    expect(openspecPlan?.tools).not.toContain('apply_patch');
    expect(openspecPlan?.tools).not.toContain('interactive-bash');
    expect(openspecPlan?.tools).not.toContain('skill-mcp');
  });
});

describe('getCavemanInstructions', () => {
  it('returns distinct strings for each level', () => {
    const results = CAVEMAN_LEVELS.map(level => getCavemanInstructions(level));
    for (const result of results) {
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('CRITICAL RULES');
      expect(result).toContain('Caveman Mode');
    }
    expect(new Set(results).size).toBe(6);
  });

  it('throws on unknown level', () => {
    expect(() => getCavemanInstructions('invalid' as any)).toThrow();
  });

  it('includes code block and inline code preservation rules', () => {
    const full = getCavemanInstructions('full');
    expect(full).toContain('copy EXACTLY');
    expect(full).toContain('Code blocks');
  });

  it('includes auto-clarity rules', () => {
    const full = getCavemanInstructions('full');
    expect(full).toContain('Security warnings');
    expect(full).toContain('stop caveman');
  });
});

describe('caveman chat hook', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  async function getFreshPlugin() {
    const { default: plugin } = await import('./index');
    return plugin;
  }

  function createMockInput(worktree = process.cwd()) {
    return {
      worktree,
      directory: worktree,
      client: {
        session: {
          abort: vi.fn().mockResolvedValue(undefined),
          create: vi.fn().mockResolvedValue({ data: { id: 'test-session' } }),
          prompt: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    } as any;
  }

  it('activates caveman with bare /caveman using config default intensity', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    const output = { parts: [] as any[] };
    await server['chat.message']!({ parts: [{ type: 'text', text: '/caveman' }] }, output);
    expect(output.parts).toContainEqual({ type: 'text', text: '🦣 Caveman mode activated: full' });
  });

  it('activates caveman with explicit /caveman ultra', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    const output = { parts: [] as any[] };
    await server['chat.message']!({ parts: [{ type: 'text', text: '/caveman ultra' }] }, output);
    expect(output.parts).toContainEqual({ type: 'text', text: '🦣 Caveman mode activated: ultra' });
  });

  it('activates caveman with /caveman wenyan mapped to wenyan-full', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    const output = { parts: [] as any[] };
    await server['chat.message']!({ parts: [{ type: 'text', text: '/caveman wenyan' }] }, output);
    expect(output.parts).toContainEqual({ type: 'text', text: '🦣 Caveman mode activated: wenyan-full' });
  });

  it('disables caveman with stop caveman', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    await server['chat.message']!({ parts: [{ type: 'text', text: '/caveman full' }] }, { parts: [] });
    const output = { parts: [] as any[] };
    await server['chat.message']!({ parts: [{ type: 'text', text: 'stop caveman' }] }, output);
    expect(output.parts).toContainEqual({ type: 'text', text: '🦣 Caveman mode disabled.' });
  });

  it('disables caveman with deactivate caveman', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    await server['chat.message']!({ parts: [{ type: 'text', text: '/caveman full' }] }, { parts: [] });
    const output = { parts: [] as any[] };
    await server['chat.message']!({ parts: [{ type: 'text', text: 'deactivate caveman' }] }, output);
    expect(output.parts).toContainEqual({ type: 'text', text: '🦣 Caveman mode disabled.' });
  });

  it('natural-language enable uses config default intensity', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    const output = { parts: [] as any[] };
    await server['chat.message']!({ parts: [{ type: 'text', text: 'activate caveman' }] }, output);
    expect(output.parts).toContainEqual({ type: 'text', text: '🦣 Caveman mode activated: full' });
  });

  it('natural-language turn on caveman uses config default intensity', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    const output = { parts: [] as any[] };
    await server['chat.message']!({ parts: [{ type: 'text', text: 'turn on caveman' }] }, output);
    expect(output.parts).toContainEqual({ type: 'text', text: '🦣 Caveman mode activated: full' });
  });

  it('prepends caveman block to agent prompts when active', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    await server['chat.message']!({ parts: [{ type: 'text', text: '/caveman full' }] }, { parts: [] });
    const mockConfig = { agent: {} as Record<string, any> };
    await server.config(mockConfig);
    const punchPrompt = mockConfig.agent['punch']?.prompt ?? '';
    const cavemanBlock = getCavemanInstructions('full');
    expect(punchPrompt.startsWith(cavemanBlock)).toBe(true);
    const bundled = readBundledAgent('punch');
    expect(punchPrompt).toContain(bundled?.prompt ?? '');
  });

  it('does not mutate bundled prompt object directly', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    await server['chat.message']!({ parts: [{ type: 'text', text: '/caveman full' }] }, { parts: [] });
    const bundledBefore = readBundledAgent('punch');
    const promptBefore = bundledBefore?.prompt;
    const mockConfig = { agent: {} as Record<string, any> };
    await server.config(mockConfig);
    const bundledAfter = readBundledAgent('punch');
    expect(bundledAfter?.prompt).toBe(promptBefore);
  });

  it('does not prepend caveman block when disabled', async () => {
    const plugin = await getFreshPlugin();
    const server = await plugin.server(createMockInput());
    const mockConfig = { agent: {} as Record<string, any> };
    await server.config(mockConfig);
    const punchPrompt = mockConfig.agent['punch']?.prompt ?? '';
    const cavemanBlock = getCavemanInstructions('full');
    expect(punchPrompt.startsWith(cavemanBlock)).toBe(false);
  });

});
