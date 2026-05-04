import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getOpenSpecDir,
  ensureOpenSpecDir,
  readOpenSpecFile,
  writeOpenSpecFile,
  listOpenSpecFiles,
} from './files'

const TEST_PROJECT_ID = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

describe('openspec/files', () => {
  afterEach(() => {
    const dir = getOpenSpecDir(TEST_PROJECT_ID)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('getOpenSpecDir', () => {
    it('returns path under HOME/.config/monkey-code/openspec', () => {
      const dir = getOpenSpecDir(TEST_PROJECT_ID)
      const home = process.env.HOME!
      expect(dir).toBe(join(home, '.config', 'monkey-code', 'openspec', TEST_PROJECT_ID))
    })
  })

  describe('ensureOpenSpecDir', () => {
    it('creates the directory and template files', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      const dir = getOpenSpecDir(TEST_PROJECT_ID)
      expect(existsSync(dir)).toBe(true)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
      expect(existsSync(join(dir, 'project.md'))).toBe(true)
      expect(existsSync(join(dir, 'specs'))).toBe(true)
    })

    it('does not overwrite existing AGENTS.md', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      const dir = getOpenSpecDir(TEST_PROJECT_ID)
      writeOpenSpecFile(TEST_PROJECT_ID, 'AGENTS.md', 'custom content')
      ensureOpenSpecDir(TEST_PROJECT_ID)
      const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
      expect(content).toBe('custom content')
    })
  })

  describe('readOpenSpecFile', () => {
    it('reads a file that was written', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      writeOpenSpecFile(TEST_PROJECT_ID, 'specs/test.spec.md', '# Test Spec')
      const content = readOpenSpecFile(TEST_PROJECT_ID, 'specs/test.spec.md')
      expect(content).toBe('# Test Spec')
    })

    it('throws for non-existent file', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      expect(() => readOpenSpecFile(TEST_PROJECT_ID, 'nonexistent.md')).toThrow()
    })
  })

  describe('writeOpenSpecFile', () => {
    it('writes content and creates parent directories', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      writeOpenSpecFile(TEST_PROJECT_ID, 'specs/nested/deep.spec.md', '# Deep')
      const dir = getOpenSpecDir(TEST_PROJECT_ID)
      const content = readFileSync(join(dir, 'specs/nested/deep.spec.md'), 'utf-8')
      expect(content).toBe('# Deep')
    })

    it('rejects path traversal with ..', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      expect(() => writeOpenSpecFile(TEST_PROJECT_ID, '../escape.md', 'bad')).toThrow()
    })

    it('rejects absolute paths', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      expect(() => writeOpenSpecFile(TEST_PROJECT_ID, '/etc/passwd', 'bad')).toThrow()
    })

    it('overwrites existing file', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      writeOpenSpecFile(TEST_PROJECT_ID, 'project.md', 'first')
      writeOpenSpecFile(TEST_PROJECT_ID, 'project.md', 'second')
      const content = readOpenSpecFile(TEST_PROJECT_ID, 'project.md')
      expect(content).toBe('second')
    })
  })

  describe('listOpenSpecFiles', () => {
    it('returns empty array for fresh directory', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      // Remove template files so the dir is truly empty (only specs/ subdir)
      const dir = getOpenSpecDir(TEST_PROJECT_ID)
      rmSync(join(dir, 'AGENTS.md'))
      rmSync(join(dir, 'project.md'))
      const files = listOpenSpecFiles(TEST_PROJECT_ID)
      expect(files).toEqual([])
    })

    it('lists all files recursively after writing', () => {
      ensureOpenSpecDir(TEST_PROJECT_ID)
      writeOpenSpecFile(TEST_PROJECT_ID, 'specs/a.spec.md', '# A')
      writeOpenSpecFile(TEST_PROJECT_ID, 'specs/b.spec.md', '# B')
      writeOpenSpecFile(TEST_PROJECT_ID, 'README.md', '# Readme')
      const files = listOpenSpecFiles(TEST_PROJECT_ID)
      expect(files).toContain('specs/a.spec.md')
      expect(files).toContain('specs/b.spec.md')
      expect(files).toContain('README.md')
    })
  })
})
