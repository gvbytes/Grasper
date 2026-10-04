# Grasper Cline plugin

The installable Cline plugin. It guards the agent while it builds:

- Blocks installs of packages that do not exist on PyPI or npm.
- Blocks secrets written into code files. Logs a masked form only.
- Blocks `curl ... | sh`.
- Records why the agent made each decision, through the `log_decision` tool.
- Logs tool errors and "could not verify in time" warnings.

Data goes to `~/.grasper/data` (override with `GRASPER_DATA_DIR`), so the panel
at `http://127.0.0.1:4000` shows app-mode events too.

## Install in the Cline app

Point the Cline app at this folder as a plugin package, or copy this folder
into your Cline plugins directory. The app sandbox gives each hook 3000 ms;
Grasper fits all work in a 2200 ms budget and fails open (allow + warn) if
verification cannot finish.

## Rebuild

From the Grasper repo root:

```bash
npm run build:plugin
```

esbuild bundles `src/adapters/cline/plugin.ts` into the single file
`cline-plugin/grasper.js`. zod is bundled in. `@cline/*` stays external: the
Cline app provides it.
