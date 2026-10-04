import assert from "node:assert/strict";

// Timing test for the BUNDLED app-mode plugin (cline-plugin/grasper.js).
// The Cline app sandbox gives hooks a hard 3000 ms. Every case must finish
// under 2500 ms. Prints each time.

const LIMIT_MS = 2500;

type HookResult = { skip?: boolean; reason?: string; appendContext?: string };
type ToolLike = { name: string; execute: (input: unknown) => Promise<unknown> };
type PluginLike = {
  name: string;
  manifest: { capabilities: string[] };
  setup: (api: { registerTool: (tool: unknown) => void }, ctx?: unknown) => void;
  hooks: {
    beforeTool: (context: unknown) => Promise<HookResult | undefined>;
    afterTool: (context: unknown) => Promise<unknown>;
  };
};

// Import the built bundle via a non-literal specifier (it has no .d.ts).
// GRASPER_DATA_DIR is set by npm test, so events stay out of the real data dir.
const bundleUrl = new URL("../../cline-plugin/grasper.js", import.meta.url).href;
const bundle = (await import(bundleUrl)) as { plugin: PluginLike; default: PluginLike };
const plugin = bundle.plugin;
assert.ok(plugin?.hooks?.beforeTool, "bundled plugin must expose beforeTool");
assert.equal(bundle.default, plugin, "default export must be the same plugin object");
assert.equal(plugin.name, "grasper");
assert.deepEqual(plugin.manifest.capabilities, ["hooks", "tools"]);

// Grab the log_decision tool through setup, like the Cline app does.
const tools: ToolLike[] = [];
plugin.setup({ registerTool: (tool) => tools.push(tool as ToolLike) });
const logDecision = tools.find((tool) => tool.name === "log_decision");
assert.ok(logDecision, "log_decision tool must be registered");
await logDecision!.execute({ topic: "package", choice: "python-dotenv", reason: "Loads .env files.", package_name: "python-dotenv" });
// uvicorn is used in the unreachable-registry case. Decide it up front, so the
// only thing that could block there is the registry itself.
await logDecision!.execute({ topic: "package", choice: "uvicorn", reason: "ASGI server.", package_name: "uvicorn" });

const beforeTool = plugin.hooks.beforeTool;

function contextFor(toolName: string, input: unknown) {
  return {
    toolCall: { toolCallId: "t", toolName, input },
    input,
    snapshot: {},
    tool: {},
  };
}

async function timed(name: string, toolName: string, input: unknown): Promise<HookResult | undefined> {
  const start = Date.now();
  const result = await beforeTool(contextFor(toolName, input));
  const ms = Date.now() - start;
  const outcome = result?.skip ? "blocked" : result?.appendContext ? "allowed/warned" : "allowed";
  console.log(`${name}: ${ms} ms -> ${outcome}`);
  assert.ok(ms < LIMIT_MS, `${name} took ${ms} ms, limit is ${LIMIT_MS} ms`);
  return result;
}

// 1. Fake package: blocked fast.
const fake = await timed("fake package", "run_commands", { commands: ["pip install flask-remember-secure-pro"] });
assert.equal(fake?.skip, true, "fake package must be blocked");
assert.match(fake?.reason ?? "", /does not exist on PyPI/);

// 2. Real package with a logged decision: allowed fast.
const real = await timed("real package", "run_commands", { commands: ["pip install python-dotenv"] });
assert.notEqual(real?.skip, true, "real package with a decision must not be blocked");

// 3. Secret write: blocked fast. The real secret must not appear in the result.
const secret = await timed("secret write", "editor", {
  path: "/app/config.py",
  new_text: 'OPENAI_KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456"\n',
});
assert.equal(secret?.skip, true, "secret write must be blocked");

// 4. Unreachable registry: fail open, warn, never block.
const realFetch = globalThis.fetch;
globalThis.fetch = (() => Promise.reject(new TypeError("simulated network failure"))) as typeof fetch;
try {
  const unreachable = await timed(
    "unreachable registry",
    "run_commands",
    { commands: ["pip install uvicorn"] } // uvicorn: uncached in this process.
  );
  assert.notEqual(unreachable?.skip, true, "unreachable registry must never block: fail open");
} finally {
  globalThis.fetch = realFetch;
}

console.log("ALL TIMING TESTS PASSED");

