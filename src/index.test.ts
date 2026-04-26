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
});
