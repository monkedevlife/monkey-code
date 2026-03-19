# Monkey Code

Monkey Code is an OpenCode plugin designed to create a streamlined coding environment for AI agents. It provides a suite of tools for background task management, interactive PTY sessions via TMUX, and integration with specialized Model Context Protocol (MCP) servers.

## Features

- **Background Tasks**: Execute long-running commands asynchronously and retrieve output later.
- **Interactive Bash**: Real-time interaction with terminal applications (vim, htop, etc.) using TMUX.
- **Skill-embedded MCPs**: Native support for Chrome DevTools, Context7, and Grep.app.
- **Task Delegation**: Spawn specialized subagents (Punch, Harambe, Caesar, etc.) for specific tasks.
- **Unified Configuration**: Flexible configuration at both user and project levels.

## Installation

Monkey Code requires [Bun](https://bun.sh) to be installed on your system.

```bash
# Clone the repository
git clone https://github.com/henrychea/monkey-code.git
cd monkey-code

# Install dependencies
bun install

# Build the plugin
bun run build
```

## Configuration

Monkey Code searches for configuration in two locations:
1. **Global User Config**: `~/.config/monkey-code/config.json`
2. **Project-specific Config**: `.opencode/monkey-code.json` (overrides global config)

### Example Configuration

```json
{
  "agents": {
    "punch": {
      "model": "gpt-4-turbo",
      "temperature": 0.7
    }
  },
  "background": {
    "maxConcurrent": 10,
    "pollInterval": 2000
  },
  "mcps": {
    "chromeDevTools": {
      "enabled": true,
      "search": {
        "engine": "google"
      }
    }
  }
}
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `agents` | Configuration for specialized subagents. | `{}` |
| `background.maxConcurrent` | Maximum number of concurrent background tasks. | `5` |
| `background.pollInterval` | Interval (ms) to check for background task updates. | `5000` |
| `mcps.chromeDevTools.enabled` | Enable/disable Chrome DevTools MCP. | `true` |
| `mcps.context7.enabled` | Enable/disable Context7 documentation search. | `true` |
| `mcps.grepApp.enabled` | Enable/disable Grep.app code search. | `true` |
| `tmux.enabled` | Enable/disable TMUX integration for interactive bash. | `true` |

## Usage Examples

### Background Tasks

Run a command in the background and check its status:

```typescript
// Start a background task
const { taskId } = await call_omo_agent({
  subagent_type: 'explore',
  prompt: 'Analyze the codebase structure',
  run_in_background: true
});

// Later, retrieve the output
const output = await background_output({ task_id: taskId });
```

### Interactive Bash

Interact with TUI applications using TMUX subcommands:

```typescript
// Start a new vim session
await interactive_bash({ tmux_command: 'send-keys -t monkey-code "vim index.ts" Enter' });
```

### Documentation Search (Context7)

Query library documentation directly:

```typescript
const docs = await context7_query_docs({
  libraryId: '/vercel/next.js',
  query: 'How to use Server Actions?'
});
```

## Architecture

Monkey Code is built as a modular plugin for the OpenCode platform.

- **Managers**: Centralized logic for task orchestration, state management, and configuration loading.
- **Tools**: Atomic units of functionality (background-output, skill-mcp, etc.) exposed to AI agents.
- **Utils**: Helper functions for file system operations, logging, and process management.
- **Types**: Strongly typed interfaces using Zod for validation and TypeScript for development.

### Data Storage

The plugin maintains local state in `~/.config/monkey-code/`:
- `monkey.db`: SQLite database for vector memory and persistent state.
- `tasks/`: Directory containing logs and metadata for background tasks.
- `logs/`: Application-level logs for debugging.

## API Reference

### Core Tools

- `background_output(taskId: string)`: Retrieves output from a background task.
- `background_cancel(taskId: string)`: Cancels a running background task.
- `interactive_bash(tmuxCommand: string)`: Executes a TMUX command for interactive PTY sessions.
- `skill_mcp(mcpName: string, ...)`: Invokes a specific MCP tool or resource.
- `call_omo_agent(config: AgentPrompt)`: Spawns or continues a specialized subagent.

## Troubleshooting

### TMUX Not Found
Ensure TMUX is installed and available in your system's PATH. You can specify a custom path in the configuration:
```json
"tmux": { "path": "/usr/local/bin/tmux" }
```

### Background Task Failures
Check the logs in `~/.config/monkey-code/tasks/` for detailed error messages and standard output from failed background processes.

### MCP Connection Errors
Verify your internet connection and ensure any required API keys (e.g., for Context7) are correctly set in your configuration file.
