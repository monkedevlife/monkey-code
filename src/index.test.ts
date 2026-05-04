import { describe, it, expect } from 'bun:test';
import monkeyCodePlugin, { buildBundledAgentPermission, readBundledAgent } from './index';

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
    expect(punch?.permission).toEqual({
      '*': 'deny',
      question: 'allow',
      bash: 'allow',
      edit: 'allow',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      lsp: 'allow',
      ast_grep_search: 'allow',
      ast_grep_replace: 'allow',
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
