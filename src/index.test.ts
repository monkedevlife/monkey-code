import { describe, it, expect } from 'bun:test';
import monkeyCodePlugin from './index';

describe('Monkey Code Plugin', () => {
  it('exports a current opencode plugin module', () => {
    expect(monkeyCodePlugin).toBeDefined();
    expect(monkeyCodePlugin.id).toBe('monkey-code');
    expect(typeof monkeyCodePlugin.server).toBe('function');
  });
});
