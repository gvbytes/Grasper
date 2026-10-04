import { createTool } from "@cline/sdk";
import type { AgentHooks, AgentPlugin, AgentTool } from "@cline/sdk";
import { z } from "zod";
import { appendEvent } from "../lib/store.js";
import {
  evaluateFileWrite,
  evaluateRunCommands,
  newGuardState,
  type GuardState,
} from "./guard.js";

// The Grasper plugin. One instance per builder run, so state stays per-run.
// Guards installs and secrets. Records decisions through the log_decision tool.

const FILE_WRITE_TOOLS = new Set(["editor", "apply_patch"]);

type BeforeToolContext = Parameters<NonNullable<AgentHooks["beforeTool"]>>[0];
type SetupApi = { registerTool: (tool: AgentTool) => void };

export function createGrasperPlugin(): AgentPlugin {
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
          },
        })
      );
    },

    hooks: {
      beforeTool: async ({ toolCall, input }: BeforeToolContext) => {
        // A hook must never throw. On error, log it and allow the call.
        try {
          const toolName = toolCall.toolName;
          let verdict;
          if (toolName === "run_commands") {
            verdict = await evaluateRunCommands(input, state);
          } else if (FILE_WRITE_TOOLS.has(toolName)) {
            verdict = evaluateFileWrite(input);
          } else {
            return undefined;
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
    },
  };
}

export default createGrasperPlugin();
