# Grasper project rules

## Project

- Grasper = a Cline SDK plugin + a teacher agent + a local web panel.
- Stack: Node 22, TypeScript run with tsx, @cline/sdk, zod v4, plain HTML panel, JSON files in data/.
- Demo app: a small Python Flask notes app in demo-app/.
- Everything runs locally. No deployment. No database server. No Next.js. No CDN links (venue Wi-Fi may fail).

## SDK rules

- Read docs/sdk-facts.md before writing any SDK code.
- If a name is not in docs/sdk-facts.md, open the type files in node_modules/@cline/ and find the real name. Never guess.
- Attach the plugin with config.extensions and backendMode "local". Do not use pluginPaths.
- Every hook body is wrapped in try/catch. A hook must never throw. On error, log it and return undefined.
- Every network call has a timeout (2500 ms) and never blocks on failure.

## Code rules

- Make the smallest change that works. Do not refactor working code.
- After each change, run the check command from the task.
- Do not add packages unless the task says so.
- All JSON writes go through src/lib/store.ts.

## Writing style for comments, lessons and UI text

- One fact or one instruction per sentence.
- Sentences under 20 words. Active voice. Simple present tense.
- Use the same word for the same thing every time.
- No filler words: "simply", "just", "clearly", "robust", "seamless", "leverage".
