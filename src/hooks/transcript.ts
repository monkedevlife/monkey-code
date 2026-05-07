import { join } from 'path';
import { mkdirSync, appendFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';

const TRANSCRIPT_DIR = join(homedir(), '.config', 'monkey-code', 'transcripts');

function ensureTranscriptDir(): void {
  if (!existsSync(TRANSCRIPT_DIR)) {
    mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  }
}

export interface TranscriptEntry {
  type: 'tool_use' | 'tool_result';
  timestamp: string;
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
}

export function getTranscriptPath(sessionId: string): string {
  return join(TRANSCRIPT_DIR, `${sessionId}.jsonl`);
}

const MAX_TRANSCRIPT_ENTRIES = 5000;

export function appendTranscriptEntry(
  sessionId: string,
  entry: TranscriptEntry,
): void {
  ensureTranscriptDir();
  const path = getTranscriptPath(sessionId);
  const line = JSON.stringify(entry) + '\n';

  if (existsSync(path)) {
    const content = readFileSync(path, 'utf-8');
    const lineCount = content.split('\n').filter(Boolean).length;
    if (lineCount >= MAX_TRANSCRIPT_ENTRIES) return;
  }

  appendFileSync(path, line);
}

export function readTranscriptEntries(
  sessionId: string,
  limit?: number,
): TranscriptEntry[] {
  const path = getTranscriptPath(sessionId);
  if (!existsSync(path)) return [];

  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const entries = lines
    .map((line) => {
      try {
        return JSON.parse(line) as TranscriptEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is TranscriptEntry => e !== null);

  if (limit && limit > 0) {
    return entries.slice(-limit);
  }
  return entries;
}

export function readLatestTranscriptEntries(
  sessionId: string,
  limit: number,
): TranscriptEntry[] {
  return readTranscriptEntries(sessionId, limit);
}

export function clearTranscript(sessionId: string): void {
  const path = getTranscriptPath(sessionId);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function transcriptExists(sessionId: string): boolean {
  const path = getTranscriptPath(sessionId);
  return existsSync(path);
}

export function transcriptFileSize(sessionId: string): number {
  const path = getTranscriptPath(sessionId);
  if (!existsSync(path)) return 0;
  const content = readFileSync(path, 'utf-8');
  return Buffer.byteLength(content, 'utf-8');
}

export function formatTranscriptProgress(
  entries: TranscriptEntry[],
  maxEntries = 20,
): string {
  if (entries.length === 0) return '';

  const recent = entries.slice(-maxEntries);
  const lines: string[] = [];

  lines.push(`Progress: ${entries.length} tool call(s) recorded`);
  lines.push('');

  for (const entry of recent) {
    const icon = entry.type === 'tool_use' ? '▶' : '◀';
    const args = entry.tool_input
      ? Object.entries(entry.tool_input)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => `${k}=${(v as string).slice(0, 60)}`)
          .join(', ')
      : '';
    const detail = args ? ` (${args})` : '';
    lines.push(`${icon} ${entry.tool_name}${detail}`);
  }

  if (entries.length > maxEntries) {
    lines.push(`... ${entries.length - maxEntries} more entries ...`);
  }

  return lines.join('\n');
}
