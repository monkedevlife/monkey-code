# Monkey Code

**A troop of specialized AI agents for OpenCode**

Monkey Code brings a family of monkey-themed AI agents to your OpenCode workflow. Led by **Punch** the orchestrator, the troop handles everything from deep architectural work to quick fixes.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Configuration File](#configuration-file)
  - [JSON Schema](#json-schema)
  - [Agent Configuration](#agent-configuration)
  - [Background Tasks](#background-tasks)
  - [MCP Servers](#mcp-servers)
  - [SQLite / Vector Memory](#sqlite--vector-memory)
  - [TMUX](#tmux)
- [Environment Variables](#environment-variables)
- [Provider Presets](#provider-presets)
  - [Supported Providers](#supported-providers)
  - [Using Presets](#using-presets)
- [Tools Reference](#tools-reference)
  - [delegate-task](#delegate-task)
  - [background-output](#background-output)
  - [background-cancel](#background-cancel)
  - [interactive-bash](#interactive-bash)
  - [skill-mcp](#skill-mcp)
- [Meet the Troop](#meet-the-troop)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### 1. Install the Plugin

Monkey Code requires [Bun](https://bun.sh) (`>=1.0.0`).

```bash
# In your OpenCode project
cd .opencode/plugins

# Clone the repository
git clone https://github.com/henrychea/monkey-code.git

# Install dependencies and build
cd monkey-code
bun install        # Generates preset templates automatically
bun run build
```

### 2. Configure Your Project

Create `.opencode/monkey-code.json` in your project root:

```json
{
  "agents": {
    "punch": {
      "model": "github-copilot/gpt-5.4",
      "temperature": 0.7
    }
  }
}
```

### 3. Start Using the Troop

Ask Punch to delegate tasks to the troop:

```
> Punch, ask Harambe to analyze our authentication flow
```

---

## Configuration

### Configuration File

Monkey Code loads its active configuration from **one location only**:

| Location | Purpose |
|----------|---------|
| `.opencode/monkey-code.json` | Active project configuration (required) |

Preset files in `~/.config/monkey-code/presets/` are **starter templates only** and are never loaded automatically.

### JSON Schema

For IDE autocomplete and validation, reference the JSON schema in your config:

```json
{
  "$schema": "https://raw.githubusercontent.com/monkedevlife/monkey-code/refs/heads/master/schemas/monkey-code-config.schema.json",
  "agents": { ... }
}
```

Or in VS Code, add to your workspace settings:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["monkey-code.json"],
      "url": "https://raw.githubusercontent.com/monkedevlife/monkey-code/refs/heads/master/schemas/monkey-code-config.schema.json"
    }
  ]
}
```

### Agent Configuration

Configure individual monkeys with model and temperature settings:

```json
{
  "agents": {
    "punch": {
      "model": "openrouter/openai/gpt-4o",
      "temperature": 0.7
    },
    "harambe": {
      "model": "openrouter/deepseek/deepseek-r1",
      "temperature": 0.5
    },
    "caesar": {
      "model": "github-copilot/o1",
      "temperature": 0.3
    },
    "tasker": {
      "model": "moonshot/kimi-k2",
      "temperature": 0.6
    },
    "scout": {
      "model": "github-copilot/gpt-5.4",
      "temperature": 0.4
    },
    "builder": {
      "model": "openrouter/openai/gpt-4o-mini",
      "temperature": 0.8
    },
    "george": {
      "model": "z-ai/glm-4.5",
      "temperature": 0.7
    }
  }
}
```

**Agent Config Options:**

| Option | Type | Range | Description |
|--------|------|-------|-------------|
| `model` | string | - | Model identifier (e.g., `openrouter/openai/gpt-4o`) |
| `temperature` | number | 0.0 - 2.0 | Sampling temperature (0 = deterministic, 2 = very creative) |
| `topP` | number | 0.0 - 1.0 | Nucleus sampling threshold |
| `topK` | number | > 0 | Top-k sampling limit |
| `maxTokens` | number | > 0 | Maximum tokens to generate |
| `presencePenalty` | number | -2.0 - 2.0 | Penalty for repeating tokens |
| `frequencyPenalty` | number | -2.0 - 2.0 | Penalty for frequent tokens |
| `reasoningEffort` | string | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` | Reasoning effort level |
| `thinking` | object | - | Thinking configuration (see below) |
| `providerOptions` | object | - | Provider-specific extra options |

**Thinking Config:**

```json
{
  "agents": {
    "harambe": {
      "thinking": {
        "type": "enabled",
        "budgetTokens": 32000
      }
    }
  }
}
```

| Option | Type | Description |
|--------|------|-------------|
| `type` | string | `enabled` or `disabled` |
| `budgetTokens` | number | Token budget for thinking (required when enabled) |

### Background Tasks

Control concurrent execution and polling behavior:

```json
{
  "background": {
    "maxConcurrent": 10,
    "pollInterval": 2000
  }
}
```

**Background Config Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxConcurrent` | integer | `5` | Maximum concurrent background tasks |
| `pollInterval` | integer | `5000` | Polling interval in milliseconds |

### MCP Servers

Configure built-in MCP integrations:

```json
{
  "mcps": {
    "chromeDevTools": {
      "enabled": true,
      "executable": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "profile": "/tmp/chrome-profile",
      "flags": ["--headless"],
      "search": {
        "enabled": true,
        "engine": "google",
        "maxResults": 10
      }
    },
    "context7": {
      "enabled": true,
      "apiKey": "your-api-key"
    },
    "grepApp": {
      "enabled": true
    }
  }
}
```

**MCP Config Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `chromeDevTools.enabled` | boolean | `true` | Enable Chrome DevTools MCP |
| `chromeDevTools.executable` | string | - | Path to Chrome/Chromium binary |
| `chromeDevTools.profile` | string | - | Chrome profile directory |
| `chromeDevTools.flags` | string[] | - | Additional Chrome flags |
| `chromeDevTools.search.enabled` | boolean | `true` | Enable web search |
| `chromeDevTools.search.engine` | string | `google` | Search engine (`google` or `bing`) |
| `chromeDevTools.search.maxResults` | integer | `10` | Max search results |
| `context7.enabled` | boolean | `true` | Enable Context7 docs search |
| `context7.apiKey` | string | - | Context7 API key |
| `grepApp.enabled` | boolean | `true` | Enable Grep.app code search |

### SQLite / Vector Memory

```json
{
  "sqlite": {
    "path": "/custom/path/monkey.db",
    "vectorDimensions": 1536,
    "maxMemoryItems": 10000
  }
}
```

**SQLite Config Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | string | `~/.config/monkey-code/monkey.db` | Custom database path |
| `vectorDimensions` | integer | `1536` | Embedding dimensions |
| `maxMemoryItems` | integer | `10000` | Max stored memory items |

### TMUX

```json
{
  "tmux": {
    "enabled": true,
    "path": "/usr/local/bin/tmux"
  }
}
```

**TMUX Config Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable TMUX for interactive bash |
| `path` | string | - | Custom tmux executable path |

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONKEY_CODE_DIR` | Override the default `~/.config/monkey-code/` directory | `./.temp/ocx` |
| `OPENROUTER_API_KEY` | API key for OpenRouter provider | `sk-or-v1-...` |
| `ZAI_API_KEY` | API key for Z.AI provider | `zai-...` |
| `MOONSHOT_API_KEY` | API key for Moonshot provider | `ms-...` |

The `MONKEY_CODE_DIR` variable is useful for:
- Isolated plugin profiles (e.g., `./.temp/ocx`)
- CI/CD environments
- Testing and development

When set, all plugin data (database, tasks, logs, presets) is stored under that directory instead of `~/.config/monkey-code/`.

---

## Provider Presets

On `bun install`, Monkey Code generates starter preset files in `~/.config/monkey-code/presets/`:

```
~/.config/monkey-code/
├── presets/
│   ├── github-copilot.json
│   ├── opencode-zen.json
│   ├── openrouter.json
│   ├── z-ai.json
│   └── moonshot.json
└── preset-manifest.json
```

**Important:** These are starter templates only. Monkey Code does **not** auto-load them, merge them into runtime config, or overwrite your active `.opencode/monkey-code.json`.

### Supported Providers

| Provider | Default Model | Required Setup |
|----------|---------------|----------------|
| **GitHub Copilot** | `github-copilot/gpt-5.4` | GitHub Copilot auth in OpenCode |
| **OpenCode Zen** | `opencode-zen/gpt-5-nano` | OpenCode provider setup |
| **OpenRouter** | `openrouter/openai/gpt-4o` | `OPENROUTER_API_KEY` env var |
| **Z.AI** | `z-ai/glm-4.5` | `ZAI_API_KEY` env var |
| **Moonshot** | `moonshot/kimi-k2` | `MOONSHOT_API_KEY` env var |

**Excluded:** No Claude presets, no Gemini presets.

### Using Presets

Copy the model/provider values from preset files into your active config:

```bash
# View a preset
cat ~/.config/monkey-code/presets/openrouter.json
```

Example preset content:

```json
{
  "version": "1.0.0",
  "generatedBy": "monkey-code@0.1.0",
  "provider": "openrouter",
  "models": {
    "default": "openrouter/openai/gpt-4o",
    "fast": "openrouter/openai/gpt-4o-mini",
    "deep": "openrouter/deepseek/deepseek-r1"
  },
  "config": {
    "provider": "openrouter",
    "model": "openrouter/openai/gpt-4o",
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiEnv": "OPENROUTER_API_KEY",
    "note": "Set OPENROUTER_API_KEY before use."
  }
}
```

Use in your active config:

```json
{
  "agents": {
    "punch": {
      "model": "openrouter/openai/gpt-4o"
    },
    "harambe": {
      "model": "openrouter/deepseek/deepseek-r1"
    }
  }
}
```

---

## Tools Reference

Monkey Code registers 5 tools with OpenCode. These are called automatically by agents or manually via the plugin system.

### delegate-task

Spawn a background task assigned to a monkey agent.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | **Yes** | Task description |
| `agent` | string | No | Agent to use. Main: `punch` (default), `caesar`, `harambe`, `george`. Generic: `tasker`, `scout`, `builder` |
| `context` | string | No | Additional context for the task |
| `timeout` | number | No | Timeout in minutes, 1-240 (default: `30`) |

**Example:**

```json
{
  "tool": "delegate-task",
  "params": {
    "task": "Refactor the authentication module to use JWT",
    "agent": "harambe",
    "context": "This is a React project with TypeScript",
    "timeout": 60
  }
}
```

**Returns:**

```json
{
  "taskId": "task-abc123",
  "sessionId": "sess-xyz789",
  "status": "pending",
  "message": "Task delegated to agent 'harambe' with session sess-xyz789. Task ID: task-abc123"
}
```

### background-output

Retrieve output from a background task.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | **Yes** | Task ID to get output for |
| `wait` | boolean | No | Wait for task completion (default: `false`) |
| `timeout` | number | No | Timeout in milliseconds when waiting (default: `30000`) |

**Example:**

```json
{
  "tool": "background-output",
  "params": {
    "taskId": "task-abc123",
    "wait": true,
    "timeout": 60000
  }
}
```

**Returns:**

```json
{
  "taskId": "task-abc123",
  "status": "completed",
  "output": "...",
  "error": null,
  "startTime": "2024-01-15T10:30:00Z",
  "endTime": "2024-01-15T10:32:15Z"
}
```

### background-cancel

Cancel a running or pending background task.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | No* | Task ID to cancel |
| `all` | boolean | No | Cancel all cancellable tasks |

*Either `taskId` or `all` is required.

**Example:**

```json
{
  "tool": "background-cancel",
  "params": {
    "taskId": "task-abc123"
  }
}
```

**Returns:**

```json
{
  "success": true,
  "taskId": "task-abc123",
  "message": "Task task-abc123 has been cancelled"
}
```

### interactive-bash

Create and manage interactive bash sessions using tmux.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | **Yes** | Command to run |
| `action` | string | **Yes** | Action: `start`, `send`, `capture`, `close` |
| `sessionId` | string | No* | Session ID (required for send/capture/close) |
| `input` | string | No* | Input to send (required for send action) |
| `cwd` | string | No | Working directory |
| `lines` | number | No | Lines to capture, 1-1000 (default: `100`) |

**Actions:**

- **`start`**: Create a new tmux session with the given command
- **`send`**: Send keystrokes to an existing session
- **`capture`**: Capture output from a session
- **`close`**: Close a session

**Example - Start a Python REPL:**

```json
{
  "tool": "interactive-bash",
  "params": {
    "action": "start",
    "command": "python3"
  }
}
```

**Example - Send input:**

```json
{
  "tool": "interactive-bash",
  "params": {
    "action": "send",
    "sessionId": "sess-123",
    "input": "print('Hello from George!')"
  }
}
```

**Example - Capture output:**

```json
{
  "tool": "interactive-bash",
  "params": {
    "action": "capture",
    "sessionId": "sess-123",
    "lines": 50
  }
}
```

**Returns:**

```json
{
  "success": true,
  "sessionId": "sess-123",
  "output": "Hello from George!\n",
  "message": "Captured 50 lines from session sess-123"
}
```

### skill-mcp

Load, invoke, and unload skill-embedded MCP servers.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill` | string | **Yes** | Skill name or path to SKILL.md |
| `action` | string | **Yes** | Action: `load`, `invoke`, `unload` |
| `tool` | string | No* | Tool name (required for invoke) |
| `params` | object | No | Parameters for invoke action |

**Actions:**

- **`load`**: Load a skill and start its MCP servers
- **`invoke`**: Call a tool from a loaded skill
- **`unload`**: Stop MCP servers and unload the skill

**Example - Load Context7 skill:**

```json
{
  "tool": "skill-mcp",
  "params": {
    "skill": "context7",
    "action": "load"
  }
}
```

**Example - Invoke a tool:**

```json
{
  "tool": "skill-mcp",
  "params": {
    "skill": "context7",
    "action": "invoke",
    "tool": "query",
    "params": {
      "libraryId": "/vercel/next.js",
      "query": "How to use Server Actions?"
    }
  }
}
```

**Example - Unload:**

```json
{
  "tool": "skill-mcp",
  "params": {
    "skill": "context7",
    "action": "unload"
  }
}
```

**Returns:**

```json
{
  "success": true,
  "skillName": "context7",
  "action": "invoke",
  "message": "Tool 'query' invoked successfully",
  "data": { ... }
}
```

---

## Meet the Troop

### Main Agents

| Monkey | Role | Specialty | Best For |
|--------|------|-----------|----------|
| **Punch** | Feature Completer | All-in-one end-to-end task execution | Default agent, complex features, full implementations |
| **Caesar** | Planner | Strategic analysis and architecture design | Planning mode, system design, scope analysis |
| **Harambe** | Critic | Code review, analysis, quality assessment | Audits, reviews, finding issues, deep analysis |
| **George** | Creative | Design, UX, and creative problem solving | Frontend design, creative solutions, brainstorming |

### Generic Sub-Agents

Small, atomic tasks with minimal context:

| Monkey | Role | Specialty | Best For |
|--------|------|-----------|----------|
| **Tasker** | Atomic Tasker | Small implementations and atomic tasks | Quick fixes, utility functions, small refactors |
| **Scout** | Explorer | Skill/MCP loading and exploration | Loading skills, MCP discovery, tool exploration |
| **Builder** | Component Builder | FE components and code blocks | React components, UI elements, small code blocks |

---

## Troubleshooting

### Plugin Not Loading
- Ensure the plugin is built: `bun run build`
- Check that `.opencode/monkey-code.json` exists (can be empty `{}`)
- Verify Bun version: `bun --version` (requires >=1.0.0)

### Invalid Configuration Errors
Monkey Code validates configuration on load. Common issues:
- `temperature` out of range (must be 0.0 - 2.0)
- `pollInterval` too low (minimum 100ms)
- `maxConcurrent` less than 1

Use the [JSON Schema](#json-schema) in your editor for validation.

### TMUX Not Found
Ensure TMUX is installed:

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt-get install tmux
```

Or specify a custom path in config:

```json
{
  "tmux": {
    "path": "/usr/local/bin/tmux"
  }
}
```

### Background Task Failures
Check task logs in `~/.config/monkey-code/tasks/` (or `$MONKEY_CODE_DIR/tasks/`):

```bash
ls ~/.config/monkey-code/tasks/
```

### MCP Connection Errors
- **Chrome DevTools**: Ensure Chrome/Chromium is installed
- **Context7**: Check internet connection and API key if required
- **Grep.app**: Verify network connectivity

### Provider Presets Not Updating
Monkey Code never overwrites existing preset files. To regenerate:

```bash
rm ~/.config/monkey-code/presets/<provider>.json
rm ~/.config/monkey-code/preset-manifest.json
bun install
```

### Custom Config Directory
To use a custom plugin directory (e.g., for isolated profiles):

```bash
export MONKEY_CODE_DIR=./.temp/ocx
bun install  # Presets will be written to ./.temp/ocx/presets/
```

All plugin data (database, tasks, logs, presets) will then use this directory.
