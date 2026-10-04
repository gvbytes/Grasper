import { ClineCore } from "@cline/sdk";
import { projectRoot } from "./lib/store.js";

// Step 1 smoke test. Starts the smallest possible ClineCore run.
// Passes no apiKey. The local backend must resolve the stored Cline login.
// Done when: the run completes and prints READY.

const cline = await ClineCore.create({ clientName: "grasper", backendMode: "local" });

try {
  const started = await cline.start({
    config: {
      providerId: "cline-pass",
      modelId: "cline-pass/glm-5.3-flash",
      cwd: projectRoot,
      workspaceRoot: projectRoot,
      systemPrompt: "You are a smoke test. Answer with exactly one word: READY",
      mode: "act",
      enableTools: false,
      enableSpawnAgent: false,
      enableAgentTeams: false,
      disableMcpSettingsTools: true,
      maxIterations: 2,
    },
    prompt: "Say READY.",
    interactive: false,
    toolPolicies: { "*": { autoApprove: true } },
  });

  const result = started.result;
  console.log("finishReason:", result?.finishReason);
  console.log("text:", result?.text);
  if (result?.text?.includes("READY")) {
    console.log("SMOKE OK");
  } else {
    console.log("SMOKE FAILED: unexpected output");
    process.exitCode = 1;
  }
  await cline.stop(started.sessionId);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("requires re-authentication") || message.includes("No API key")) {
    console.error("SMOKE FAILED: no usable Cline login. Sign in again in the Cline app, then retry.");
  } else {
    console.error("SMOKE FAILED:", message);
  }
  process.exitCode = 1;
} finally {
  await cline.dispose();
}
