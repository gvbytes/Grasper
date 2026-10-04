# Grasper Cline plugin

The installable Cline plugin. It guards the agent while it builds:

- Blocks installs of packages that do not exist on PyPI or npm.
- Blocks secrets written into code files. Logs a masked form only.
- Blocks `curl ... | sh`.
- Records why the agent made each decision, through the `log_decision` tool.
- Logs tool errors and "could not verify in time" warnings.

Data goes to `~/.grasper/data` (override with `GRASPER_DATA_DIR`), so the panel
at `http://127.0.0.1:4000` shows app-mode events too.

## Install (Cline CLI)

From the Grasper repo root:

```bash
cline plugin install ./cline-plugin --cwd <your-project> --force
```

Leave out `--cwd` to install it for all projects. Then run `cline` inside the
project. Plugins work in the Cline CLI, SDK and Kanban, not in the VS Code or
JetBrains extensions.

On macOS, fully quit the Cline desktop app first. Its background hub does not
run plugin hooks, so the CLI must start its own hub.

The sandbox gives each hook 3000 ms. Grasper fits all work in a 2200 ms budget
and fails open (allow + warn) if verification cannot finish.

## Rebuild

From the Grasper repo root:

```bash
npm run build:plugin
```

esbuild bundles `src/adapters/cline/plugin.ts` into the single file
`cline-plugin/grasper.js`. zod is bundled in. `@cline/*` stays external: the
Cline runtime provides it.
