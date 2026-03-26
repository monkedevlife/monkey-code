# 🐵 Monkey Code

**A troop of specialized AI agents for OpenCode**

Monkey Code brings a family of monkey-themed AI agents to your OpenCode workflow. Led by **Punch** the orchestrator, the troop handles everything from deep architectural work to quick fixes, all with their own personalities and specialties.

## 🐒 Meet the Troop

| Monkey | Role | Specialty |
|--------|------|-----------|
| 🦍 **Punch** | Orchestrator | Delegates tasks to the troop, manages workflows |
| 🦍 **Harambe** | Deep Worker | Complex implementations, never forgets |
| 🐵 **Caesar** | Architect | Strategic planning, system design |
| 🦍 **Kong** | Implementer | Building features, heavy coding |
| 🐵 **Rafiki** | Reviewer | Code review, wisdom, quality |
| 🐒 **Abu** | Quick Specialist | Fast fixes, prototyping |
| 🐵 **George** | Explorer | Research, codebase exploration |

## Features

- **🐵 Background Tasks**: Punch delegates to Harambe/Kong for async work
- **🐵 Interactive Bash**: George opens PTY sessions (vim, REPLs, TUIs)
- **🐵 Skill-Embedded MCPs**: Chrome DevTools, Context7 (Rafiki), Grep.app
- **🐵 Vector Memory**: SQLite + sqlite-vss for agent memory
- **🐵 Task Delegation**: Specialized monkeys for every job

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

🐵 **Ask Punch to delegate to Harambe for deep work:**

```typescript
// Punch delegates a background task to Harambe
const { taskId } = await delegateTask({
  task: 'Analyze the codebase structure and identify patterns',
  agent: 'harambe',  // Deep autonomous worker
  context: 'This is a React project with TypeScript'
});

// Later, check on Harambe's progress
const status = await backgroundOutput({ taskId });

// Or ask Abu for a quick status check
const quickStatus = await backgroundOutput({ taskId, wait: false });
```

### Interactive Bash (George's Terminal)

🐵 **George opens interactive sessions for exploration:**

```typescript
// George spawns a Python REPL
const session = await interactiveBash({
  action: 'start',
  command: 'python3'
});

// Send commands to the session
await interactiveBash({
  action: 'send',
  sessionId: session.sessionId,
  input: 'print("Hello from George!")'
});

// Capture the output
const output = await interactiveBash({
  action: 'capture',
  sessionId: session.sessionId
});

// Close when done
await interactiveBash({
  action: 'close',
  sessionId: session.sessionId
});
```

### Documentation Search (Rafiki's Wisdom)

🐵 **Rafiki uses Context7 to find documentation:**

```typescript
// Load the Context7 skill
await skillMcp({
  skill: 'context7',
  action: 'load'
});

// Rafiki queries Next.js documentation
const docs = await skillMcp({
  skill: 'context7',
  action: 'invoke',
  tool: 'query',
  params: {
    libraryId: '/vercel/next.js',
    query: 'How to use Server Actions?'
  }
});

// Unload when done
await skillMcp({
  skill: 'context7',
  action: 'unload'
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

### 🐵 Monkey Troop Tools

| Tool | Description | Used By |
|------|-------------|---------|
| `delegateTask({ task, agent?, context?, timeout? })` | Spawns a background task assigned to a monkey agent | Punch (orchestrator) |
| `backgroundOutput({ taskId, wait? })` | Retrieves output from Harambe's or Kong's background work | Any monkey |
| `backgroundCancel({ taskId })` | Stops a running background task | Punch (manager) |
| `interactiveBash({ action, command?, sessionId?, input?, cwd? })` | Manages interactive PTY sessions (REPLs, TUIs) | George (explorer) |
| `skillMcp({ skill, action, tool?, params? })` | Loads and invokes skill-embedded MCP servers | Rafiki (wisdom), Kong (implementation) |

### Agent Specialties

| Monkey | Specialty | Best For |
|--------|-----------|----------|
| **Punch** | Orchestration | Delegating tasks, managing the troop |
| **Harambe** | Deep Work | Complex multi-file implementations |
| **Caesar** | Architecture | System design, planning |
| **Kong** | Implementation | Building features, coding |
| **Rafiki** | Review | Code review, quality assurance |
| **Abu** | Quick Tasks | Fast fixes, prototyping |
| **George** | Exploration | Research, codebase exploration |

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
