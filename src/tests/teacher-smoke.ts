import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import { getClinePassKey } from "../adapters/cline/auth.js";

// Minimal teacher check: does an Agent run with the stored-login key at all?
const apiKey = await getClinePassKey();
console.log("got key:", apiKey.slice(0, 4) + "****");

let submitted: unknown;
const tool = createTool({
  name: "submit_done",
  description: "Submit the word READY. Ends the run.",
  inputSchema: z.object({ word: z.string() }),
  lifecycle: { completesRun: true },
  execute: async (input: { word: string }) => {
    submitted = input;
    return { ok: true };
  },
});

const agent = new Agent({
  providerId: "cline-pass",
  modelId: process.env.TEACHER_MODEL ?? "cline-pass/deepseek-v4.1-flash",
  apiKey,
  systemPrompt: "You are a test. Call submit_done with the word READY. Do not answer in plain text.",
  tools: [tool],
  maxIterations: 4,
});

agent.subscribe((event: { type: string }) => {
  if (event.type === "assistant-text-delta") process.stdout.write(String((event as { text?: string }).text ?? ""));
});

try {
  const result = await agent.run("Call submit_done now.");
  console.log("\nstatus:", result.status, "| iterations:", result.iterations, "| submitted:", JSON.stringify(submitted));
  console.log("outputText:", result.outputText?.slice(0, 300));
  if (result.error) {
    console.error("result.error:", result.error.message);
    const cause = (result.error as { cause?: unknown }).cause;
    if (cause) console.error("cause:", cause instanceof Error ? cause.message : JSON.stringify(cause)?.slice(0, 500));
  }
} catch (error) {
  console.error("AGENT ERROR:", error instanceof Error ? error.message : String(error));
}
