# Cline SDK facts (from the cline/cline source, sdk/ folder)

## Package
- npm package: @cline/sdk (re-exports @cline/core). ESM only ("type": "module"). Node >= 22. Uses zod v4.
- Import: import { Agent, ClineCore, createTool } from "@cline/sdk"; types: import type { AgentPlugin } from "@cline/sdk";

## Providers
- ClinePass: providerId "cline-pass", model IDs like "cline-pass/kimi-k3", "cline-pass/deepseek-v4.1-flash".
- cline-pass declares apiKeyEnv: ["CLINE_API_KEY"].

## Auth (verified against @cline/core dist, 2026-10-04)
- ClineCore local backend: do NOT pass apiKey. LocalRuntimeHost.applyInitialOAuthCredentials fills
  config.apiKey from the stored Cline login when config.apiKey is empty. It runs in startResolvedSession.
- Mid-session refresh: the host calls resolveProviderApiKey({ providerId, forceRefresh: true }) and pushes
  the new key to the running agent with agent.updateConnection({ apiKey }).
- On OAuthReauthRequiredError the host throws "<providerId> requires re-authentication.".
  If we see this, stop and tell the user to sign in again in the Cline app.
- Agent (teacher) does NOT read the stored login. Credential order in @cline/llms:
  1. config.apiKey, 2. config.apiKeyResolver callback, 3. env vars from apiKeyEnv (CLINE_API_KEY), 4. throw
  "No API key is available. Pass one in the gateway or provider config."
- Teacher auth: call getClinePassKey() from src/lib/auth.ts at the start of each teacher run.
  Do not cache the key for long.
- getClinePassKey uses RuntimeOAuthTokenManager, exported from @cline/sdk:
  const key = await new RuntimeOAuthTokenManager().resolveProviderApiKey({ providerId: "cline-pass" });
  Result: { apiKey, accountId?, refreshed } or null when no login exists. null -> tell the user to sign in.
- OAuth handlers exist for "cline" and "cline-pass". cline-pass stores credentials under storageProviderId "cline".
- OAuthReauthRequiredError is exported from @cline/sdk.

## Plugin shape (AgentPlugin)
const plugin: AgentPlugin = {
  name: "grasper",
  manifest: { capabilities: ["hooks", "tools"] },   // hooks need the "hooks" capability or setup throws
  setup(api, ctx) { api.registerTool(createTool({...})); },
  hooks: { beforeRun, afterRun, beforeModel, afterModel, beforeTool, afterTool, onEvent },
};
export default plugin;

## Hooks (exactly these seven)
- beforeTool({ snapshot, tool, toolCall, input }) -> undefined | { skip?, stop?, reason?, input?, policy?, appendContext? }
  - skip: true  -> tool does not run; the model receives { error: reason } as the tool result; the run CONTINUES.
  - stop: true  -> the whole run ends (status "aborted"). Do not use for the install guard.
  - input       -> replaces the tool input.
  - appendContext -> extra text sent to the model on the next turn.
  - toolCall = { toolCallId, toolName, input }
- afterTool({ toolCall, input, result, durationMs }) -> undefined | { result?, appendContext?, stop?, reason? }
  - result = { output, isError? }. Returning result replaces what the model sees.
  - afterTool also runs for skipped tools.
- afterRun({ result }) -> void. Fires on completed, aborted AND failed. Check result.status.
- beforeRun({ snapshot }) -> undefined | { stop?, reason?, appendContext? }
- IMPORTANT: a hook that throws makes the run FAIL. Wrap every hook body in try/catch.
- With several plugins, hooks run in order; the first skip/stop wins.

## Built-in tool names (ClineCore)
read_files, search_codebase, run_commands, fetch_web_content, apply_patch, editor, skills, ask_question, submit_and_exit
(also spawn_agent and team_* tools if enabled). There is NO "bash", "write_file" or "search" tool.

## Built-in tool inputs (handle ALL shapes in hooks; hooks see the raw model input)
- run_commands: { commands: string[] } is normal. Also accepted: { commands: string }, { command: string },
  { cmd: string }, { command, args } (structured, no shell), a bare string, or an array of strings/objects.
  Each string can chain commands with &&, ;, ||, |.
- editor: { path: string (absolute), old_text?: string|null, new_text: string, insert_line?: number|null }
  - no old_text + missing file = create the file with new_text
  - old_text = replace exactly one match
  - insert_line = insert before that line
- apply_patch: { input: string } in "*** Begin Patch" format, or a bare string.
- read_files: { files: [{ path, start_line?, end_line? }] } (many aliases accepted).

## createTool
createTool({
  name, description,
  inputSchema: z.object({...}) or a JSON schema object (top level must be an object),
  execute: async (input, context) => result,   // returned value goes to the model; a throw becomes an error result
  lifecycle: { completesRun: true },           // optional: a successful call ends the run
  timeoutMs,                                   // optional, default 30000

## ClineCore (the builder agent)
const cline = await ClineCore.create({ clientName: "grasper", backendMode: "local" });
const unsubscribe = cline.subscribe((event) => { ... });   // event.type: "chunk" | "agent_event" | "ended" | "status" | ...
const started = await cline.start({
  config: {
    providerId: "cline-pass", modelId: "cline-pass/kimi-k3", apiKey: process.env.CLINE_API_KEY,
    cwd: "<absolute path>", workspaceRoot: "<absolute path>",
    systemPrompt: "...",                // REQUIRED
    mode: "act", enableTools: true, maxIterations: 40,
    enableSpawnAgent: false, enableAgentTeams: false, disableMcpSettingsTools: true,
    extensions: [grasperPlugin],        // in-process plugin object (needs backendMode "local")
  },
  prompt: "...",
  interactive: false,
  toolPolicies: { "*": { autoApprove: true } },
});
// started.result: { text, finishReason: "completed"|"max_iterations"|"aborted"|"mistake_limit"|"error", iterations, usage, toolCalls }
await cline.stop(started.sessionId); await cline.dispose();

- agent_event payload: event.payload.event with type content_start | content_update | content_end
  (contentType "text" | "reasoning" | "tool"; fields text, toolName, input, output, error), plus notice, usage, done, error.
- Tool approvals: auto-approve is the default. If a policy sets autoApprove:false and there is no
  requestToolApproval callback, the call is REJECTED. So never set autoApprove:false in a headless run.

## Plugin loading: why we use extensions, not pluginPaths
- pluginPaths loads the plugin in a SANDBOX subprocess: hook timeout 3 seconds, JSON-only payloads,
  state resets after idle. Too tight for network checks.
- extensions: [pluginObject] with backendMode "local" runs in-process. Use this.

## Agent (the teacher)
const agent = new Agent({
  providerId: "cline-pass", modelId: "cline-pass/deepseek-v4.1-flash", apiKey: process.env.CLINE_API_KEY,
  systemPrompt: "...", tools: [...], maxIterations: 8,
});
const unsubscribe = agent.subscribe((event) => { if (event.type === "assistant-text-delta") process.stdout.write(event.text); });
const result = await agent.run("...");
// result: { status, outputText, iterations, usage: { inputTokens, outputTokens, totalCost? } }
// NOTE: the field is outputText. The README example "result.text" and "agent.hasRun" are wrong.
- Structured output pattern (from Cline's code-review-bot example): give the agent a submit_* tool
  with a zod schema and lifecycle { completesRun: true }; save the tool input in a variable. No JSON parsing.

## Verified
Verified against node_modules/@cline (installed 2026-10-04):
- @cline/sdk re-exports everything from @cline/core ("export * from \"@cline/core\"").
- Agent is an alias of AgentRuntime from @cline/agents. Config: providerId + modelId + optional apiKey.
- Agent credential order: apiKey, apiKeyResolver, apiKeyEnv (CLINE_API_KEY for cline-pass), else throw.
- LocalRuntimeHost.applyInitialOAuthCredentials exists and fills an empty apiKey from the stored login.
- RuntimeOAuthTokenManager.resolveProviderApiKey({ providerId, forceRefresh? }) returns
  Promise<{ apiKey, accountId?, refreshed } | null>. Exported from @cline/sdk. OAuthReauthRequiredError too.
- cline-pass OAuth credentials live under storageProviderId "cline".
- Re-auth error message: "<providerId> requires re-authentication.".
- Hook context types (shared/dist/agent.d.ts): beforeTool gets { snapshot, tool, toolCall, input }.
  Result type: { skip?, stop?, reason?, input?, policy?, appendContext? }. Matches the facts above.
- afterTool context adds result, startedAt, endedAt, durationMs.
- Plugin shape: ContributionRegistryExtension { name, manifest { capabilities }, hooks?, setup?(api, ctx) }.
  Valid capabilities: "hooks", "tools", "commands", "rules", "skills", "messageBuilders", "providers",
  "automationEvents", "mcp". Our plugin uses ["hooks", "tools"].
- createTool exists in @cline/shared with zod-schema and JSON-schema overloads. lifecycle.completesRun exists.
- ClineCore.create({ clientName, backendMode: "local" }) and cline.start({ config, prompt, interactive,
  toolPolicies }) exist. CoreSessionConfig requires systemPrompt and accepts extensions, hooks, pluginPaths.
- StartSessionResult: { sessionId, manifest, manifestPath, messagesPath, result?: AgentResult }.
- AgentResult: { text, usage, messages, toolCalls, iterations, finishReason, model, startedAt, endedAt,
  durationMs }. finishReason: "completed" | "max_iterations" | "aborted" | "mistake_limit" | "error".
- cline-pass model IDs in the installed catalog: kimi-k3, deepseek-v4-pro, deepseek-v4.1-flash, glm-5.3,
  glm-5.3-flash, qwen3.7-max, qwen3.7-plus, qwen3.8-max, minimax-m3, mimo-v2.5, mimo-v2.5-pro,
  mimo-v2.6-flash, mimo-v2.6-pro, muse-spark-1.3-contributor.
Not yet verified live: a real ClineCore run end to end. Step 1 smoke test covers it.

})
