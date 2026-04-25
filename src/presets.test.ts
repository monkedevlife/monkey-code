import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SUPPORTED_PROVIDERS,
  createPresetFiles,
  writePresetFiles,
  readExistingManifest,
} from './presets.js';

describe('presets', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'monkey-code-presets-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates preset definitions for supported providers only', () => {
    const presets = createPresetFiles();
    expect(Object.keys(presets)).toEqual([...SUPPORTED_PROVIDERS]);
    expect(presets['github-copilot'].provider).toBe('github-copilot');
    expect(presets['openrouter'].config.apiEnv).toBe('OPENROUTER_API_KEY');
  });

  it('includes agent configs in presets', () => {
    const presets = createPresetFiles();
    const openrouter = presets['openrouter'];
    expect(openrouter.agents).toBeDefined();
    expect(openrouter.agents.punch).toBeDefined();
    expect(openrouter.agents.punch.model).toBe('openrouter/openai/gpt-4o');
    expect(openrouter.agents.harambe.model).toBe('openrouter/deepseek/deepseek-r1');
    expect(openrouter.agents.builder.temperature).toBe(0.7);
  });

  it('writes preset files and manifest without overwriting existing files', () => {
    const first = writePresetFiles(tempDir, '0.1.0');
    expect(first.written.length).toBeGreaterThan(0);
    expect(existsSync(join(tempDir, 'presets', 'github-copilot.json'))).toBe(true);
    expect(existsSync(join(tempDir, 'preset-manifest.json'))).toBe(true);

    const original = readFileSync(join(tempDir, 'presets', 'github-copilot.json'), 'utf-8');
    const second = writePresetFiles(tempDir, '0.2.0');
    expect(second.skipped).toContain(join(tempDir, 'presets', 'github-copilot.json'));
    expect(readFileSync(join(tempDir, 'presets', 'github-copilot.json'), 'utf-8')).toBe(original);
  });

  it('reads existing manifest safely', () => {
    writePresetFiles(tempDir, '0.1.0');
    const manifest = readExistingManifest(join(tempDir, 'preset-manifest.json'));
    expect(manifest?.providers).toEqual([...SUPPORTED_PROVIDERS]);
  });
});
