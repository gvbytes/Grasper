import { createTool } from "@cline/core";
import type { AgentHooks, AgentPlugin, AgentTool } from "@cline/core";
import { z } from "zod";
import { enableAppMode } from "../../lib/registry.js";
import {
  evaluateFileWrite,
  evaluateRunCommands,
  newGuardState,
  type GuardState,
} from "../../plugin/guard.js";
import { appendEvent } from "../../lib/store.js";

// The Cline app plugin. Runs in the app's sandbox, which gives every hook
// a hard 3000 ms. All guard work fits in a 2200 ms budget. If the budget
// runs out, the call is allowed and a warning is logged. Fail open, never silent.
// App mode registry: existence checks only, one attempt, 1500 ms, cached.

enableAppMode();

const BUDGET_MS = 2200;
const FILE_WRITE_TOOLS = new Set(["editor", "apply_patch"]);

type BeforeToolContext = Parameters<NonNullable<AgentHooks["beforeTool"]>>[0];
type AfterToolContext = Parameters<NonNullable<AgentHooks["afterTool"]>>[0];
type SetupApi = { registerTool: (tool: AgentTool) => void };

// Run work under a time budget. Null means the budget ran out.
async function withBudget<T>(work: Promise<T>, budgetMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function short(value: unknown, max: number): string {
  try {
    return JSON.stringify(value ?? "").slice(0, max);
  } catch {
    return "(unserializable)";
  }
}


export function createAppPlugin(): AgentPlugin {
  const state: GuardState = newGuardState();

  return {
    name: "grasper",
    manifest: { capabilities: ["hooks", "tools"] },

    setup(api: SetupApi) {
      api.registerTool(
        createTool({
          name: "log_decision",
          description:
            "Record why you made a technical decision. Call this BEFORE you act on a decision: " +
            "choosing a framework, a database, an auth method, a session approach, or installing a package. " +
            "Grasper shows your reasons to the user in a panel.",
          inputSchema: z.object({
            topic: z.string().describe("What kind of decision: framework, database, package, structure, auth, sessions."),
            choice: z.string().describe("What you chose, e.g. Flask."),
            reason: z.string().describe("Why you chose it, in one or two plain sentences."),
            package_name: z.string().optional().describe("The package name when the topic is package."),
          }),
          execute: async (input: { topic: string; choice: string; reason: string; package_name?: string }) => {
            try {
              const decision = {
                topic: input.topic,
                choice: input.choice,
                reason: input.reason,
                packageName: input.package_name,
              };
              state.decisions.push(decision);
              await appendEvent({
                ts: new Date().toISOString(), source: "builder", kind: "decision",
                summary: `Decision: ${input.topic} = ${input.choice} — ${input.reason}`,
                detail: { ...decision },
              });
              return { ok: true, recorded: true };
            } catch (error) {
              console.error("[grasper] log_decision failed:", error);
              return { ok: false, recorded: false };
            }
          },
        })
      );
    },

    hooks: {
      beforeTool: async ({ toolCall, input }: BeforeToolContext) => {
        // A hook must never throw. On error, log it and allow the call.
        try {
          if (toolCall.toolName !== "run_commands" && !FILE_WRITE_TOOLS.has(toolCall.toolName)) {
            return undefined;
          }

          const work =
            toolCall.toolName === "run_commands"
              ? evaluateRunCommands(input, state)
              : evaluateFileWrite(input);

          const verdict = await withBudget(work, BUDGET_MS);
          if (verdict === null) {
            // Budget exhausted: allow and warn. Fail open, say so.
            await appendEvent({
              ts: new Date().toISOString(), source: "guard", kind: "warn",
              summary: `WARNING: could not verify ${toolCall.toolName} in time. Allowed.`,
              detail: { tool: toolCall.toolName, reason: "budget_exhausted" },
            });
            return {
              appendContext:
                "Grasper could not verify this call in time. It was allowed. " +
                "Double-check the package names or file content yourself.",
            };
          }

          for (const event of verdict.events) {
            await appendEvent(event);
          }

          if (verdict.action === "block") {
            return { skip: true, reason: verdict.reason ?? "Blocked by Grasper." };
          }
          if (verdict.warnings.length > 0) {
            return { appendContext: verdict.warnings.join("\n") };
          }
          return undefined;
        } catch (error) {
          console.error("[grasper] beforeTool hook failed:", error);
          return undefined;
        }
      },

      afterTool: async ({ toolCall, input, result }: AfterToolContext) => {
        // Log tool errors. They often reveal a blocked or broken step.
        try {
          if (!result?.isError) return undefined;
          await appendEvent({
            ts: new Date().toISOString(), source: "guard", kind: "tool_error",
            summary: `Tool error in ${toolCall.toolName}`,
            detail: {
              tool: toolCall.toolName,
              input: short(input, 120),
              error: short(result.output, 300),
            },
          });
          return undefined;
        } catch (error) {
          console.error("[grasper] afterTool hook failed:", error);
          return undefined;
        }
      },
    },
  };
}

const plugin = createAppPlugin();
export { plugin };
export default plugin;
