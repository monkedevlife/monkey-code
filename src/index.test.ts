import { describe, it, expect } from 'bun:test';
import monkeyCodePlugin from './index';

describe('Monkey Code Plugin', () => {
  it('loads successfully', () => {
    const plugin = monkeyCodePlugin();
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('monkey-code');
    expect(plugin.version).toBe('0.1.0');
    expect(plugin.hooks).toBeDefined();
  });
});
