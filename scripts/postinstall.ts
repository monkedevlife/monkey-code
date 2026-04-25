import { join } from 'path';
import { writePresetFiles } from '../src/presets.js';
import { writeUserOpencodeConfig } from '../src/config.js';

function getHomeDir() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    throw new Error('Unable to determine home directory for Monkey Code preset install.');
  }
  return home;
}

async function main() {
  const baseDir = join(getHomeDir(), '.config', 'monkey-code');
  const packageVersion = process.env.npm_package_version || '0.1.0';
  const result = writePresetFiles(baseDir, packageVersion);
  const userConfigResult = writeUserOpencodeConfig();

  const lines = [
    '[monkey-code] preset bootstrap complete',
    `[monkey-code] presets dir: ${result.presetsDir}`,
    `[monkey-code] user opencode config: ${userConfigResult.path}`,
    '[monkey-code] these files are editable starter templates only and are NOT auto-loaded as active config',
  ];

  if (result.written.length > 0) {
    lines.push(`[monkey-code] wrote: ${result.written.join(', ')}`);
  }
  if (result.skipped.length > 0) {
    lines.push(`[monkey-code] skipped existing: ${result.skipped.join(', ')}`);
  }
  lines.push(
    userConfigResult.written
      ? `[monkey-code] wrote active user config: ${userConfigResult.path}`
      : `[monkey-code] kept existing user config: ${userConfigResult.path}`,
  );
  lines.push('[monkey-code] user config is loaded from ~/.config/opencode/monkey-code.json');
  lines.push('[monkey-code] project config in .opencode/monkey-code.json overrides user config');
  lines.push('[monkey-code] copy any preset values you want into ~/.config/opencode/monkey-code.json or .opencode/monkey-code.json');
  lines.push('[monkey-code] supported providers: github-copilot, opencode-zen, openrouter, z-ai, moonshot');
  lines.push('[monkey-code] excluded providers: claude, gemini');

  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.warn('[monkey-code] preset bootstrap failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 0;
});
