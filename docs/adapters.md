# Adapters: how Grasper maps to other agents

Grasper is split for portability:

| Layer | Location | Agent-specific? |
|---|---|---|
| Core | `src/lib/*`, `src/plugin/guard.ts` | No. No `@cline` imports. |
| Cline adapter | `src/adapters/cline/*` | Yes: SDK plugin, teacher Agent, auth. |
| Shared UI | `src/panel/*` | No. Reads JSON files only. |

The core gives every adapter the same building blocks:

- `install-parser.ts`: extracts package installs from shell commands.
- `requirements.ts`: requirements files, dependency manifests, `-r` resolution.
- `registry.ts`: PyPI/npm checks with risk signals. `enableAppMode()` for tight time budgets.
- `secrets.ts`: secret patterns with masked logging.
- `guard.ts`: the verdict logic — block, warn, allow — plus events.
- `store.ts`: events and JSON documents under `~/.grasper/data`.
- `lessons.ts`: lesson and grade shapes every adapter must produce.

## Plan for a Claude Code adapter (no code yet)

Claude Code has hooks, not in-process plugins. The mapping:

| Grasper concept | Claude Code equivalent |
|---|---|
| `beforeTool(run_commands)` | `PreToolUse` matcher `Bash`. The hook receives the command string. Feed it to `evaluateRunCommands`. Return a deny decision with the block reason on block. |
| `beforeTool(editor/apply_patch)` | `PreToolUse` matchers `Write` and `Edit`. Map `Write` to `{ path, new_text }` and `Edit` to `{ path, new_text }` from the tool input. Feed to `evaluateFileWrite`. Deny on block. |
| `afterTool` tool errors | `PostToolUse` with `tool_response`. Map `is_error: true` to a `tool_error` event. |
| `log_decision` tool | No custom tools exist. Two options: (a) a slash command `/grasper:log-decision` the model is instructed to call; (b) parse "DECISION:" prefixes from user turns. Option (a) is cleaner. |
| Event log | Every hook writes through the same `appendEvent`, so the panel works unchanged. |
| Timeout budget | Claude Code kills slow hooks. Wrap calls in the same 2200 ms `Promise.race` budget as the Cline app adapter. Fail open with a warning. |

## Plan for an Antigravity adapter (no code yet)

Antigravity exposes tool-call interceptors. The mapping follows the same lines:
intercept shell commands and file writes, call the same `evaluateRunCommands` /
`evaluateFileWrite`, and write events through `store.ts`. The registry runs in
app mode (existence only, 1500 ms) if the interceptor budget is tight.

## Rules for every adapter

- Every hook in try/catch. Never throw into the host agent.
- Fail open: when verification cannot finish, allow and log a warning.
- Never log a real secret. Always the masked form.
- All events go through `appendEvent`, so the panel needs no changes.
