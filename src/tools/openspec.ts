import { z } from 'zod'
import { readOpenSpecFile, writeOpenSpecFile, listOpenSpecFiles, ensureOpenSpecDir } from '../openspec/files.js'
import type { SQLiteClient } from '../utils/sqlite-client.js'

export const openspecReadSchema = z.object({
  file: z.string().describe('Relative path to the openspec file to read'),
})

export const openspecWriteSchema = z.object({
  file: z.string().describe('Relative path to the openspec file to write'),
  content: z.string().describe('File content'),
})

export const openspecListSchema = z.object({
  directory: z.string().optional().describe('Optional subdirectory to list'),
})

export interface OpenSpecToolContext {
  sqlite: SQLiteClient
  worktree: string
}

function resolveProjectId(ctx: OpenSpecToolContext): string {
  return ctx.sqlite.resolveProjectId(ctx.worktree)
}

export async function handleOpenSpecRead(
  params: { file: string },
  ctx: OpenSpecToolContext
): Promise<{ file: string; content: string }> {
  const projectId = resolveProjectId(ctx)
  ensureOpenSpecDir(projectId)
  const content = readOpenSpecFile(projectId, params.file)
  return { file: params.file, content }
}

export async function handleOpenSpecWrite(
  params: { file: string; content: string },
  ctx: OpenSpecToolContext
): Promise<{ file: string }> {
  const projectId = resolveProjectId(ctx)
  ensureOpenSpecDir(projectId)
  writeOpenSpecFile(projectId, params.file, params.content)
  return { file: params.file }
}

export async function handleOpenSpecList(
  params: { directory?: string },
  ctx: OpenSpecToolContext
): Promise<{ files: string[] }> {
  const projectId = resolveProjectId(ctx)
  ensureOpenSpecDir(projectId)
  const files = listOpenSpecFiles(projectId)
  if (params.directory) {
    const prefix = params.directory.endsWith('/') ? params.directory : params.directory + '/'
    return { files: files.filter(f => f.startsWith(prefix)) }
  }
  return { files }
}
