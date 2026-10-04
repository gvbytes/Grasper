# Grasper spec

Status: confirmed by the user in the interview on 2026-10-04.
Working folder: /Users/JayPrakashVerma/Downloads/Grasper.
Deadline: hackathon finale today, about 6 hours left. Optimize for a reliable 3-minute demo.

## 1. The problem

- People build apps with AI coding agents. The apps work. The people do not understand them.
- The agent's explanations are short or partial. They vanish into a long chat scroll.
- The user cannot find "why did it pick Flask" later. The user cannot check the reason against the code.
- AI-built apps often ship with security holes. The user cannot judge if the app is safe to launch.
- A 2025 USENIX Security study found 19.7% of package names in AI-generated code do not exist. Attackers can publish malware under those names.
- Secrets pasted into code are a classic beginner mistake.

## 2. The users

Ranked by priority:

1. Builders like the author. They use AI agents but do not fully understand the output.
2. Non-programmers who vibecode whole apps.
3. The hackathon judges. They are the audience for today's demo.

Success for the user means two things:

- The user can answer "why did the agent do this?" for each big decision.
- The user can say "this app is safe enough to put online" because they understand the risky parts: login, passwords, database, secrets.

After using Grasper, the user fixes the security holes before launching. If the app is not safe, the user does not launch it. Changing code safely is a bonus, not the main goal.

## 3. What Grasper is

Grasper has four parts:

1. **Builder.** A Cline agent (ClineCore) that writes the demo app. Our script starts it through the Cline SDK.
2. **Grasper plugin.** An in-process AgentPlugin attached to the builder. It guards dangerous actions before they happen. It records why the agent made each decision. It writes an event log.
3. **Teacher.** A second agent (SDK Agent class). It runs after the build. It writes lessons about the app, starting with the risky parts. It grades the user's explain-back answers.
4. **Panel.** One local web page on localhost:4000. It shows the event log live, the why-log, risk findings, lessons, explain-back, and the readiness score.

All parts connect through JSON files in data/. Everything runs locally. No deployment. No CDN links.


## 4. Features

### Must-have (needed for the demo)

**Guard (during the build):**

- Hard block: install of a package that does not exist on PyPI or npm. Check PyPI first, npm second.
- Hard block: a secret pattern written into a code file. Patterns: `sk-...` and `sk-ant-...` keys, AWS `AKIA` + 16 chars, GitHub `ghp_`/`gho_`/`ghs_` tokens, `-----BEGIN ... PRIVATE KEY-----`, assignments like `api_key|secret|token|password = "long value"`. Ignore placeholders like "changeme". Never scan .env files. Never store the real secret in logs. Store a masked form like `sk-a****`.
- Hard block: `curl ... | sh` in a shell command.
- Warn only: a package that exists but looks suspicious. Very new, very few releases, or a near-typo of one of about 30 built-in popular names ("requets" warns "did you mean requests?"). Warn only when the registry cannot be reached. Warnings never block.
- A block skips the tool call and sends the reason back to the agent as the tool result. The run continues. The agent picks a safe alternative.
- Every block and warning appears in the panel in real time.

**Why-log (during the build):**

- The plugin gives the agent a `log_decision` tool. The agent calls it at decision points: framework, database, password hashing, sessions, each package installed, project structure.
- A small Flask app should produce 6 to 12 decisions.
- The system prompt tells the agent to call it. One light enforcement: the first install without a logged decision is blocked once with "call log_decision first". If the agent still skips, allow the install and record an inferred decision marked "reason not stated".

**Scan (after the build):**

- Run bandit on the demo app for real findings. Bandit must catch the seeded SQL injection.
- Custom pattern checks for what bandit misses: nonexistent packages in requirements.txt, .env missing from .gitignore, hard-coded secret key.
- The teacher explains findings. It never invents new ones.

**Teacher (after the build):**

- One lesson per risky part, risk-first. Lessons cite real file names and line numbers. Each lesson has a "reason check" line: the teacher compares the agent's logged reason against the real code.
- One explain-back question per lesson. The user types the answer in the panel. The teacher grades 0 to 100 against the real code. It shows what the user got right and what they missed. Security points count most.
- No free-form chat in v1.

**Readiness score:**

- One number, 0 to 100, shown big on the panel.
- Score = percent of lessons passed. Security lessons weigh double. Subtract 15 per open high-risk finding.
- The score only gets high after the SQL injection is actually fixed, not just understood.

**Panel:**

- Top three for the demo: live event log with big red BLOCKED entries, the big readiness score, the decision why-log.
- Then: risk findings, lessons, explain-back box with grade.

**Demo app:**

- A small Python Flask notes app with login and SQLite, in demo-app/.
- One seeded weakness: SQL injection in the login query. We tell the judges we planted it on purpose. If the builder writes unsafe code on its own, even better, but we do not depend on it.

**Demo safety:**

- A recorded backup video. The user records it. No build time.
- A demo mode where the panel reads a saved snapshot of data/ instead of the live files.

### Nice-to-have (only if time remains)

- Explain any single why-log entry on demand ("Explain" button per entry).
- Replay animation of a saved run in the panel.
- Knowledge profile per topic, beyond the single readiness score.
- npm registry check, if the demo build never touches npm.
- README with SDK field notes.

### Explicitly out of scope for v1

- Free-form chat with the teacher.
- Hard blocks for suspicious-but-existing packages.
- Helping the user change code safely.
- Deployment, user accounts, a database server, any hosted service.

## 5. How Grasper uses the Cline SDK

All names come from docs/sdk-facts.md. Step 1 of the build plan verifies them against the installed package.

- **The builder is ClineCore.** We create it with ClineCore.create({ backendMode: "local" }). We start it with a system prompt, mode "act", and toolPolicies { "*": { autoApprove: true } }. The system prompt carries the build task and the log_decision duty.
- **Grasper is an AgentPlugin.** It declares capabilities ["hooks", "tools"]. We attach it through config.extensions, not pluginPaths. Extensions run in-process, so hooks can do network checks. pluginPaths runs in a sandbox with a 3-second hook timeout.
- **The guard lives in the beforeTool hook.** It inspects run_commands and editor inputs in all their accepted shapes. It returns { skip: true, reason } to block. Skip sends the reason to the model as the tool result. The run continues. We never use stop: true for the guard.
- **Every hook body is wrapped in try/catch.** A hook that throws fails the whole run. On error a hook logs and returns undefined.
- **Registry checks have a 2500 ms timeout.** A registry failure produces a warning, never a block.
- **log_decision is a custom tool.** We build it with createTool and register it in the plugin's setup.
- **The teacher is an SDK Agent.** Structured output uses a submit_* tool with a zod schema and lifecycle { completesRun: true }. We save the tool input. We do not parse JSON from prose. The teacher result field is outputText, not text.
- **Models run through ClinePass.** providerId "cline-pass". The builder uses the stored Cline login. The teacher gets its key from getClinePassKey() in src/lib/auth.ts at the start of each run. If a run fails with "requires re-authentication" or no login is found, we stop and tell the user to sign in again in the Cline app.

## 6. Demo plan (3 minutes)

Before the demo: the full build already ran. The panel already holds the why-log, findings, and lessons. The backup video is recorded. The snapshot for demo mode is saved.

1. "I build my ideas with AI agents. They work, but honestly I can't explain them. So we built Grasper." (15 s)
2. Panel: the why-log from the build. Every decision has the agent's own reason. (30 s)
3. Live: run the short guard demo task. Grasper blocks a fake package install and a secret paste in real time. Say the fake package name is made up on purpose. (40 s)
4. Lesson: login and database, with real line numbers and the reason check. (30 s)
5. demo-weakness.py: LOGIN BYPASSED. Apply the fix. Re-scan. LOGIN BLOCKED. (30 s)
6. Explain-back: the user types their own answer live and sees the grade. The readiness score goes up. If time runs short, show the grade from a prepared run instead. (25 s)
7. "Keep the speed of AI. Become the owner of what it builds." (10 s)

If the live part fails: switch the panel to demo mode with the saved snapshot, or play the backup video.

## 7. Cut order, agreed with the user

1. Explain-back grading and readiness refinements (cut first if truly out of time).
2. Written lessons shrink to short explanations.
3. Explain-one-entry, replay mode, knowledge profile, README.

Never cut: the live guard blocks, the why-log, lessons in some form, the panel, the demo snapshot.

