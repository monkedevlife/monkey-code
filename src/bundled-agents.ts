import { existsSync, readFileSync } from 'fs'

const agents = ['punch', 'harambe', 'caesar', 'george', 'tasker', 'scout', 'builder', 'openspec-plan'] as const
const primaryAgents = new Set(['punch', 'harambe', 'caesar', 'george'])
const pluginRoot = new URL('..', import.meta.url)

export type BundledAgentName = (typeof agents)[number]

export type BundledAgentDefinition = {
  name: BundledAgentName
  description?: string
  model?: string
  prompt: string
  mode: 'primary' | 'subagent'
  tools?: string[]
  permission?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInlineToolList(value: unknown) {
  if (!value) return undefined
  if (Array.isArray(value)) {
    const entries = value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
    return entries.length > 0 ? entries : undefined
  }
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined

  const entries = trimmed
    .slice(1, -1)
    .split(',')
    .map((entry) => entry.trim().replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean)

  return entries.length > 0 ? entries : undefined
}

function normalizeBundledTools(tools: string[] | string | undefined) {
  if (!tools) return undefined
  if (Array.isArray(tools)) {
    return tools.filter((tool): tool is string => typeof tool === 'string')
  }
  return parseInlineToolList(tools)
}

export function buildBundledAgentPermission(tools: string[] | string | undefined) {
  const normalizedToolList = normalizeBundledTools(tools)
  if (!normalizedToolList || normalizedToolList.length === 0) return undefined

  const allowedPermissions = new Set<string>()
  const normalizedTools = normalizedToolList.map((toolName) => toolName.trim().toLowerCase())

  for (const toolName of normalizedTools) {
    if (!toolName) continue

    if (toolName === 'edit' || toolName === 'write' || toolName === 'apply_patch' || toolName === 'apply-patch') {
      allowedPermissions.add('edit')
      continue
    }

    if (toolName === 'bash') {
      allowedPermissions.add('bash')
      continue
    }

    if (toolName === 'question') {
      allowedPermissions.add('question')
      continue
    }

    if (toolName === 'read' || toolName === 'glob' || toolName === 'grep' || toolName === 'webfetch' || toolName === 'websearch' || toolName === 'skill' || toolName === 'todowrite') {
      allowedPermissions.add(toolName)
      continue
    }

    if (toolName === 'delegate-task' || toolName === 'delegate_task') {
      allowedPermissions.add('delegate-task')
      continue
    }

    if (toolName === 'plan-write' || toolName === 'plan_write') {
      allowedPermissions.add('plan-write')
      continue
    }

    if (toolName === 'plan-read' || toolName === 'plan_read') {
      allowedPermissions.add('plan-read')
      continue
    }

    if (toolName === 'plan-list' || toolName === 'plan_list') {
      allowedPermissions.add('plan-list')
      continue
    }

    if (toolName === 'plan-update-task' || toolName === 'plan_update_task') {
      allowedPermissions.add('plan-update-task')
      continue
    }

    if (toolName === 'background-output' || toolName === 'background_output') {
      allowedPermissions.add('background-output')
      continue
    }

    if (toolName === 'background-cancel' || toolName === 'background_cancel') {
      allowedPermissions.add('background-cancel')
      continue
    }

    if (toolName === 'interactive-bash' || toolName === 'interactive_bash') {
      allowedPermissions.add('interactive-bash')
      continue
    }

    if (toolName === 'skill-mcp' || toolName === 'skill_mcp') {
      allowedPermissions.add('skill-mcp')
      continue
    }

    if (toolName === 'ast_grep_search' || toolName === 'ast-grep-search') {
      allowedPermissions.add('ast_grep_search')
      continue
    }

    if (toolName === 'ast_grep_replace' || toolName === 'ast-grep-replace') {
      allowedPermissions.add('ast_grep_replace')
      continue
    }

    if (toolName === 'websearch_web_search_exa' || toolName.startsWith('websearch_')) {
      allowedPermissions.add('websearch')
      continue
    }

    if (toolName === 'lsp' || toolName.startsWith('lsp_') || toolName.startsWith('lsp-')) {
      allowedPermissions.add('lsp')
      continue
    }

    allowedPermissions.add(toolName)
  }

  return {
    '*': 'deny',
    ...Object.fromEntries(Array.from(allowedPermissions).map((toolName) => [toolName, 'allow'])),
  }
}

export function readBundledAgent(name: BundledAgentName): BundledAgentDefinition | undefined {
  const file = new URL(`./agents/${name}.md`, pluginRoot)
  if (!existsSync(file)) return undefined

  const content = readFileSync(file, 'utf-8')
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return undefined

  const frontmatter = match[1] ?? ''
  const prompt = (match[2] ?? '').trim()
  const meta = Object.fromEntries(
    frontmatter
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':')
        if (idx === -1) return [line, '']
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
      }),
  )

  const tools = parseInlineToolList(isRecord(meta) ? meta.tools : undefined)

  return {
    name,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    model: typeof meta.model === 'string' ? meta.model : undefined,
    prompt,
    mode: primaryAgents.has(name) ? 'primary' : 'subagent',
    tools,
    permission: buildBundledAgentPermission(tools),
  }
}
