# Grasper

Keep the speed of AI. Become the owner of what it builds.

Grasper sits inside the Cline agent while it builds your app. It blocks dangerous moves before
they happen (fake packages, secrets in code, `curl | sh`) and makes the agent record why it made
each decision. After the build, a teacher agent writes lessons about your app, riskiest parts
first, and grades you when you explain them back. A local panel shows everything live, with one
readiness score.

## Parts

| Part | File | What it does |
|---|---|---|
| Plugin | src/plugin/ | beforeTool guard + log_decision tool + secrets guard |
| Builder runner | src/run-builder.ts | Starts ClineCore with the plugin attached |
| Scan | src/run-scan.ts | bandit + custom checks, writes data/findings.json |
| Teacher | src/run-teacher.ts, src/lib/teacher.ts | Lessons and explain-back grading (SDK Agent) |
| Panel | src/panel/ | localhost:4000, polls data/ every 2 s |
| Demo app | demo-app/ | Flask notes app with one seeded SQL injection |

## Setup

- Node 22+. On this machine: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
- `npm install`
- Python 3 with flask and bandit (`pip3 install bandit`).
- Sign in to the Cline app. The builder uses the stored login. No API key needed.
  The teacher resolves the same login through RuntimeOAuthTokenManager (src/lib/auth.ts).

## Install the Plugin

To install Grasper as a Cline plugin directly from the repository:

```bash
cline plugin install ./cline-plugin
```

Alternatively, point the Cline app at the `cline-plugin` directory or copy it into your Cline plugins directory.
Before installing or distributing, build the standalone bundle:

```bash
npm run build:plugin
```


## Run order

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm run smoke        # verifies the SDK and the stored login
npm run build:demo   # builder agent builds demo-app/ with Grasper attached
npm run scan         # bandit + custom checks -> data/findings.json
npm run teach        # teacher writes lessons -> data/lessons.json
npm run panel        # http://localhost:4000
```

## Demo (3 minutes)

> **Note:** The demo app comes with a vulnerability (SQL injection in `app.py`) that is **seeded on purpose**. This is designed to demonstrate Grasper's ability to catch flaws, have the teacher agent generate lessons, and let the developer explain back fixes to improve their readiness score.

1. Panel: the why-log from the build.
2. Live guard demo: `npm run guard-demo` blocks a fake install and a secret paste.
3. Lesson: SQL injection in app.py, with the reason check.
4. `python3 scripts/demo-weakness.py` prints LOGIN BYPASSED.
5. `python3 demo-app/fix-demo.py apply`, re-run scan, weakness test prints LOGIN BLOCKED.
6. Explain-back in the panel. The readiness score goes up.

`python3 demo-app/fix-demo.py revert` puts the seeded weakness back for rehearsal.

## Safety nets

- `npm run snapshot` copies data/ to data-snapshot/. The panel "mode" button switches to it.
- src/make-fixture.ts writes hand-made lessons for panel development. The real teacher
  output replaces it. If the API is down during the demo, run `npm run fixture` and say so.

## Rate limits

ClinePass enforces a 5-hour limit per account. The builder, teacher, grader, and guard demo all
use it. Budget calls before the demo. If you hit the limit mid-demo: switch the panel to snapshot
mode and use the recorded backup video.
