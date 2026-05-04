import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';

const AGENTS_MD_TEMPLATE = `# Agents

This file defines the AI agents used in this project.

## Agent Roles

<!-- Define agent roles and responsibilities here -->

`;

const PROJECT_MD_TEMPLATE = `# Project Overview

<!-- Project vision, goals, and scope -->

## Architecture

<!-- High-level architecture description -->

## Tech Stack

<!-- Technologies used -->

`;

export function getOpenSpecDir(projectId: string): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error('Could not determine home directory');
  }
  return join(home, '.config', 'monkey-code', 'openspec', projectId);
}

export function ensureOpenSpecDir(projectId: string): void {
  const dir = getOpenSpecDir(projectId);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const agentsPath = join(dir, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, AGENTS_MD_TEMPLATE, 'utf-8');
  }

  const projectPath = join(dir, 'project.md');
  if (!existsSync(projectPath)) {
    writeFileSync(projectPath, PROJECT_MD_TEMPLATE, 'utf-8');
  }

  const specsDir = join(dir, 'specs');
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }
}

export function readOpenSpecFile(projectId: string, relativePath: string): string {
  const dir = getOpenSpecDir(projectId);
  const fullPath = join(dir, relativePath);

  if (!existsSync(fullPath)) {
    throw new Error(`OpenSpec file not found: ${relativePath}`);
  }

  return readFileSync(fullPath, 'utf-8');
}

export function writeOpenSpecFile(projectId: string, relativePath: string, content: string): void {
  if (relativePath.includes('..') || relativePath.startsWith('/')) {
    throw new Error(`Invalid path: ${relativePath}`);
  }

  const dir = getOpenSpecDir(projectId);
  const fullPath = join(dir, relativePath);

  const lastSep = fullPath.lastIndexOf(sep);
  if (lastSep !== -1) {
    const parentDir = fullPath.substring(0, lastSep);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
  }

  writeFileSync(fullPath, content, 'utf-8');
}

export function listOpenSpecFiles(projectId: string): string[] {
  const dir = getOpenSpecDir(projectId);

  if (!existsSync(dir)) {
    return [];
  }

  const result: string[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        result.push(relative(dir, fullPath));
      }
    }
  }

  walk(dir);
  return result;
}
