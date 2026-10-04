# Grasper

Keep the speed of AI. Become the owner of what it builds.

Grasper sits inside the Cline agent while it builds your app. It blocks dangerous moves before
they happen (fake packages, secrets in code, `curl | sh`) and makes the agent record why it made
each decision. After the build, a teacher agent writes lessons about your app, riskiest parts
first, and grades you when you explain them back. A local panel shows everything live, with one
readiness score.

Grasper runs in two ways:

- **Cline CLI plugin:** install it into any project and chat with Cline as usual. Grasper guards every action.
- **Script mode:** a builder script runs a Cline agent (through the Cline SDK) with Grasper attached, then a scan, a teacher and a panel.

Tested on macOS. The Linux steps use the same tools and commands.

---

## Contents

1. [What's in the repo](#1-whats-in-the-repo)
2. [Requirements](#2-requirements)
3. [Install the requirements (macOS / Linux)](#3-install-the-requirements)
4. [Environment variables](#4-environment-variables)
5. [Get the code and run the tests](#5-get-the-code-and-run-the-tests)
6. [Run Grasper inside the Cline CLI](#6-run-grasper-inside-the-cline-cli)
7. [Lessons and explain-back for your own project](#7-lessons-and-explain-back-for-your-own-project)
8. [Full demo with the included demo app](#8-full-demo-with-the-included-demo-app)
9. [Command reference](#9-command-reference)
10. [Where Grasper stores data](#10-where-grasper-stores-data)
11. [Troubleshooting](#11-troubleshooting)
12. [Large codebases](#12-large-codebases)
13. [Rate limits](#13-rate-limits)

---

## 1. What's in the repo

| Part | Files | What it does |
|---|---|---|
| Cline plugin (installable) | `cline-plugin/` (built from `src/adapters/cline/plugin.ts`) | Guards every tool call: fake packages, secrets in code, `curl \| sh`. Adds the `log_decision` tool |
| Guard logic (agent-agnostic core) | `src/plugin/guard.ts`, `src/lib/` | Install parser, registry checks (PyPI / npm), secret patterns, requirements files |
| Builder runner (script mode) | `src/run-builder.ts`, `src/adapters/cline/builder-plugin.ts` | Starts a Cline agent through the SDK with Grasper attached |
| Scan | `src/run-scan.ts` | Bandit + custom checks on the app |
| Teacher and grader | `src/run-teacher.ts`, `src/adapters/cline/teacher.ts` | Lessons and explain-back grading (Cline SDK `Agent`) |
| Panel | `src/panel/` | Local web page on `http://127.0.0.1:4000` |
| Demo app | `demo-app/` | Small Flask notes app with one SQL injection **seeded on purpose** |
| Demo scripts | `scripts/demo-weakness.py`, `demo-app/fix-demo.py` | Show the weakness, apply or revert the fix |
| Tests | `src/tests/` | Guard, registry, timing and codebase tests (no AI calls) |

---

## 2. Requirements

| Tool | Version | Needed for |
|---|---|---|
| Git | any recent | Cloning the repo |
| Node.js + npm | **22 or newer** | Grasper itself (TypeScript, run with `tsx`) |
| Python 3 + pip + venv | 3.10 or newer | The demo app and Bandit |
| Bandit | latest (in a venv, section 5) | The security scan |
| Cline CLI | 3.x (`npm i -g cline`) | Running Grasper as a plugin |
| A Cline account | free | Signing in to the Cline CLI. **Free models work for the plugin** |
| ClinePass subscription | - | Only for **script mode**: builder, teacher, grader, `npm run smoke` (they use the `cline-pass` provider) |
| Internet access | - | Registry checks against pypi.org and registry.npmjs.org, and the AI models |

Grasper's Node dependencies (`@cline/sdk`, `zod`, `tsx`, `typescript`, `esbuild`, ...) are listed in
`package.json` and installed by `npm ci`. The demo app's Python dependencies (`Flask`, `python-dotenv`)
are in `demo-app/requirements.txt`.

**No API keys are needed.** Grasper uses your Cline login, which the Cline CLI stores on your machine.

---

## 3. Install the requirements

### macOS (with Homebrew)

```bash
brew install git node@22 python
echo 'export PATH="$(brew --prefix node@22)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node -v
npm i -g cline
cline auth
```

### Linux (Ubuntu / Debian)

Node 22 is installed with nvm:

```bash
sudo apt update
sudo apt install -y git curl python3 python3-pip python3-venv
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v
npm i -g cline
cline auth
```

`node -v` must print `v22.x` or newer. `cline auth` signs you in to your Cline account: follow the prompts.

Bandit is installed in section 5, inside a virtual environment. Recent macOS (Homebrew) and Linux
Python versions block `pip install` outside a virtual environment (`externally-managed-environment`).

---

## 4. Environment variables

All are optional. Defaults work out of the box.

| Variable | Default | What it does |
|---|---|---|
| `GRASPER_DATA_DIR` | `~/.grasper/data` | Where Grasper writes its log, findings, lessons and grades. The plugin and the panel must use the same folder |
| `GRASPER_APP_DIR` | `<repo>/demo-app` | Absolute path of the app that the scan and the teacher work on |
| `BUILDER_MODEL` | `cline-pass/kimi-k3` | Model for the builder agent (script mode) |
| `TEACHER_MODEL` | `cline-pass/deepseek-v4.1-flash` | Model that writes lessons |
| `GRADER_MODEL` | `cline-pass/deepseek-v4-pro` | Model that grades explain-back answers |

Demo app only (`demo-app/.env`):

| Variable | Required | What it does |
|---|---|---|
| `SECRET_KEY` | **yes** | Flask session key. The app does not start without it |
| `PORT` | no (5000) | Port for `python app.py` |

---

## 5. Get the code and run the tests

```bash
git clone https://github.com/gvbytes/Grasper.git
cd Grasper
npm ci
npm test
```

`npm test` rebuilds the plugin bundle and runs four test suites. They need internet (registry checks)
but no AI calls. You should see:

```
ALL LIB TESTS PASSED
ALL GUARD TESTS PASSED
ALL TIMING TESTS PASSED
ALL CODEBASE TESTS PASSED
```

**Install Bandit** (for `npm run scan`) in a virtual environment inside the `Grasper` folder:

```bash
python3 -m venv venv
venv/bin/pip install bandit
venv/bin/python -m bandit --version
```

The scan runs `python3 -m bandit`, so activate the environment in the terminal where you run the scan:

```bash
source venv/bin/activate
```

`venv/` is in `.gitignore`.

---

## 6. Run Grasper inside the Cline CLI

> [!IMPORTANT]
> **macOS: fully quit the Cline desktop app first** (Cline menu → Quit). Its background hub does not
> run plugin hooks, so Grasper would silently do nothing. The CLI must start its own hub.
> Check with `pgrep -fl cline-hub-daemon`. If a hub from `/Applications/Cline.app` is listed, stop it
> with `kill <pid>`. On Linux there is no desktop app, so this step does not apply.

1. **Create a project folder and install the plugin into it** (run inside the `Grasper` folder):
   ```bash
   mkdir -p ~/grasper-try
   cline plugin install "$PWD/cline-plugin" --cwd ~/grasper-try --force
   ```
   Use the full path (`"$PWD/cline-plugin"`). With `--cwd`, a relative path like `./cline-plugin` is
   looked up inside the project folder and fails with `Plugin source path does not exist`.
   Without `--cwd`, `cline plugin install "$PWD/cline-plugin"` installs Grasper for **all** your projects.

2. **Start the panel** (second terminal, inside the `Grasper` folder):
   ```bash
   npm run panel
   ```
   Open `http://127.0.0.1:4000` in a browser.

3. **Start a Cline chat in the project** (third terminal):
   ```bash
   cd ~/grasper-try && cline
   ```
   Any model works, including the free ones (for example `cline -P cline -m cline-free/deepseek-v4.1-flash`).

4. **Try it.** Start a **new** `cline` session for each test (Ctrl+C, then `cline` again). In the same
   session, the model remembers earlier checks and changes its behavior.

   - Fake package (`flask-csrf-shield` does not exist on PyPI):
     ```text
     Set up this Flask project: create a venv, then install flask, flask-login, flask-wtf and flask-csrf-shield into it with venv/bin/pip.
     ```
     Expect: `Grasper blocked this install: "flask-csrf-shield" does not exist on PyPI ...`

   - Secret written into code (the key is fake):
     ```text
     Create a file config.py containing exactly this line: OPENAI_KEY = "sk-proj-abc123rrthsoBIDISnsnuos"
     ```
     Expect: `Grasper blocked this file write: it contains a secret (openai_key (sk-p****)) ...`
     The agent then moves the key to a `.env` file and reads it from the environment.

   - A small build (decisions appear in the panel):
     ```text
     Build a tiny Flask app here with one page that says Hello. Use a virtual environment and requirements.txt. Call log_decision before choosing any library or installing any package.
     ```

   Grasper blocks what the agent **tries** to do. Careful models sometimes check PyPI first and skip the
   fake package on their own; then there is nothing to block. That is the model being careful, not
   Grasper failing. `npm test` and `npm run guard-demo` show the block every time.

   If the key in the secret prompt shows as `•••` after you paste it, type it by hand. Some apps mask
   API-key-like text when you copy it, and a masked key is a placeholder, not a secret.

5. **Check Grasper's log:**
   ```bash
   tail -5 ~/.grasper/data/events.jsonl
   ```
   You should see `"kind":"block"` events.

In the CLI, the plugin runs inside Cline's sandbox, which gives each hook 3 seconds. Grasper uses a
fast mode there: it checks that packages exist, and it allows the call (with a warning) if a check
cannot finish in time. The full six-signal risk score (age, releases, downloads, install scripts,
links, typos) runs in script mode.

---

## 7. Lessons and explain-back for your own project

Needs ClinePass (the teacher and the grader use the `cline-pass` provider) and Bandit.

```bash
cd Grasper
source venv/bin/activate
GRASPER_APP_DIR=~/grasper-try npm run scan
GRASPER_APP_DIR=~/grasper-try npm run teach
GRASPER_APP_DIR=~/grasper-try npm run panel
```

`GRASPER_APP_DIR` must be an absolute path (`~` is expanded by the shell). Open the panel, read the
lessons (lesson 1 always explains how the whole app works), type an explain-back answer, and watch
the readiness score.

---

## 8. Full demo with the included demo app

Script mode. Needs ClinePass.

> **Note:** the demo app contains a SQL injection in the login query of `demo-app/app.py`. It is
> **seeded on purpose** to show the scan, the lessons, the fix and the explain-back.

1. **Set up the demo app** (once):
   ```bash
   cd demo-app
   python3 -m venv venv
   venv/bin/pip install -r requirements.txt
   echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(16))')" > .env
   cd ..
   ```

2. **Check the SDK and your Cline login:**
   ```bash
   npm run smoke
   ```

3. **Live guard demo.** A Cline agent tries a fake install and a secret paste. Grasper blocks both:
   ```bash
   npm run guard-demo
   ```

4. **Scan and lessons:**
   ```bash
   source venv/bin/activate
   npm run scan
   npm run teach
   npm run panel
   ```
   The panel opens on `http://127.0.0.1:4000`.

5. **Show the weakness, fix it, show it is gone:**
   ```bash
   python3 scripts/demo-weakness.py
   python3 demo-app/fix-demo.py apply
   python3 scripts/demo-weakness.py
   npm run scan
   ```
   - The first `demo-weakness.py` prints `LOGIN BYPASSED`. It starts the app itself on port 5055.
   - `fix-demo.py apply` switches to a parameterized query and turns debug off.
   - The second `demo-weakness.py` prints `LOGIN BLOCKED`.
   - `npm run scan` no longer reports the SQL injection.

6. **Explain-back** in the panel. The readiness score goes up.

7. **Reset for the next run:**
   ```bash
   python3 demo-app/fix-demo.py revert
   ```

`npm run build:demo` rebuilds the demo app from scratch with the builder agent. It is not needed:
the demo app is already in the repo.

---

## 9. Command reference

| Command | What it does | Needs |
|---|---|---|
| `npm ci` | Install Node dependencies | - |
| `npm test` | Rebuild the plugin and run all tests | Internet |
| `npm run build:plugin` | Rebuild `cline-plugin/grasper.js` | - |
| `npm run panel` | Start the panel on `127.0.0.1:4000` | - |
| `npm run scan` | Bandit + custom checks on `GRASPER_APP_DIR` | Bandit venv active (section 5) |
| `npm run teach` | Write lessons for `GRASPER_APP_DIR` | ClinePass |
| `npm run smoke` | Check the SDK and the stored Cline login | ClinePass |
| `npm run guard-demo` | Builder agent tries a fake install and a secret paste | ClinePass |
| `npm run build:demo` | Builder agent builds `demo-app/` | ClinePass |
| `npm run snapshot` | Copy the data folder to a snapshot (panel "mode" button) | - |
| `npm run fixture` | Write hand-made fallback lessons if the API is down | - |
| `cline plugin install "$PWD/cline-plugin" --cwd <project> --force` | Install the plugin into one project (run inside `Grasper`) | Cline CLI |

---

## 10. Where Grasper stores data

- `~/.grasper/data/events.jsonl`: every block, warning, decision, tool error, lesson and grade.
- `~/.grasper/data/findings.json`, `lessons.json`, `grades.json`: scan, teacher and grader output.
- `~/.grasper/data-snapshot/`: the snapshot used by the panel's snapshot mode.

Secrets are never stored. Grasper logs a masked form only (for example `sk-p****`).
The panel only listens on `127.0.0.1`.

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| Nothing gets blocked in the CLI | macOS: the Cline desktop app's hub is running. Quit the app, run `pgrep -fl cline-hub-daemon`, `kill` any hub from `/Applications/Cline.app`, restart `cline`. Check the bottom bar shows your project folder |
| `node -v` shows an old version | macOS: put Node 22 first in `PATH` (see section 3). Linux: `nvm use 22` |
| Port 4000 in use | macOS: `lsof -ti :4000 \| xargs kill`. Linux: `fuser -k 4000/tcp` |
| `No module named bandit` | Run `source venv/bin/activate` inside `Grasper` (section 5) |
| `externally-managed-environment` from pip | Install into a virtual environment (section 5), not system-wide |
| `Plugin source path does not exist` | Use the full path: `cline plugin install "$PWD/cline-plugin" --cwd <project> --force` |
| `zsh: invalid mode specification` | A `# comment` was pasted with a command. Paste commands without comments |
| The agent skips the fake package without being blocked | The model checked PyPI first. Start a new `cline` session and use a fresh fake name |
| The secret prompt is not blocked | The pasted key turned into `•••`. Type the key by hand |
| `KeyError: 'SECRET_KEY'` when the demo app starts | Create `demo-app/.env` (section 8, step 1) |
| `Grasper needs a fresh Cline login` | Run `cline auth` again |
| ClinePass limit reached | Wait for the reset, or use the panel's snapshot mode for the demo |
| Plugin changes not picked up | `npm run build:plugin`, then reinstall with `--force` |

---

## 12. Large codebases

The teacher and the grader pick a mode automatically (`src/lib/codebase.ts`):

- Small apps (under 30,000 characters of source): the whole numbered source goes into the prompt.
- Large apps: a compact repo map (every file, line counts, main functions/classes/routes with line
  numbers) plus three read-only tools: `list_files`, `read_file` (max 300 lines per call), and
  `search_code`. The teacher reads the files behind findings, guard events and decisions first.
- Every read stays inside the app folder. `.env` files, databases, keys, `venv/`, `node_modules/`
  and build folders are never listed, read or searched.

---

## 13. Rate limits

ClinePass enforces a 5-hour usage limit per account. The builder, teacher, grader, smoke test and
guard demo all use it. If you hit the limit mid-demo, switch the panel to snapshot mode
(`npm run snapshot` beforehand) and use the recorded demo video.

---

## License

MIT. See [LICENSE](LICENSE).
