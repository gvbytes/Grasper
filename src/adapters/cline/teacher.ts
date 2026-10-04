import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import type { Grade, Lesson } from "../../lib/lessons.js";
import { getClinePassKey } from "./auth.js";
import type { Decision } from "../../plugin/guard.js";
import type { Finding } from "../../lib/findings.js";
import { type AppContext, listAppFiles, readFileRange, searchCode } from "../../lib/codebase.js";

// The teacher is a Cline SDK Agent. It never invents findings.
// It explains real findings and real decisions, against the real code.
// Structured output comes from a submit tool with completesRun. No JSON parsing.

const LESSON_MODEL = process.env.TEACHER_MODEL ?? "cline-pass/deepseek-v4.1-flash";
const GRADER_MODEL = process.env.GRADER_MODEL ?? "cline-pass/deepseek-v4-pro";

const STYLE = `Writing rules:
- One fact per sentence. Sentences under 20 words.
- Explain like the reader has never seen the concept. Define every term.
- Reference real file names and line numbers from the code given to you.`;

// Read-only codebase tools. Every path stays inside the app folder; secrets and data files are refused.
function codebaseTools(root: string) {
  return [
    createTool({
      name: "list_files",
      description: "List the app's source files with line counts. Optional folder prefix to narrow it.",
      inputSchema: z.object({ prefix: z.string().optional().describe("Only files whose path starts with this.") }),
      execute: async (input: { prefix?: string }) => {
        const files = await listAppFiles(root);
        const shown = files.filter((f) => !input.prefix || f.path.startsWith(input.prefix)).slice(0, 300);
        return shown.map((f) => `${f.path} (${f.lines} lines)`).join("\n") || "No files.";
      },
    }),
    createTool({
      name: "read_file",
      description: "Read numbered lines from one app file (max 300 lines per call). Use it before you cite code.",
      inputSchema: z.object({
        path: z.string().describe("Path relative to the app folder, as shown in the repo map."),
        start_line: z.number().optional(),
        end_line: z.number().optional(),
      }),
      execute: async (input: { path: string; start_line?: number; end_line?: number }) =>
        readFileRange(root, input.path, input.start_line ?? 1, input.end_line),
    }),
    createTool({
      name: "search_code",
      description: "Search every app file for a regex or text. Returns file:line matches.",
      inputSchema: z.object({ query: z.string() }),
      execute: async (input: { query: string }) => searchCode(root, input.query),
    }),
  ];
}

// The code section of a prompt: the whole source for small apps, the repo map for large ones.
function codeSection(app: AppContext): string {
  if (app.mode === "full") return `## App source\n${app.text}`;
  return `## Repo map (large codebase: ${app.fileCount} files, too big to include whole)
${app.text}

How to read this codebase:
- Use read_file to read the exact lines you explain. Never cite code you have not read.
- Start with files named in the scan findings and guard events, then the files behind the logged decisions, then the entry points (main app file, routes).
- Use search_code to find where something is defined or used.`;
}

// Generate lessons from the real build data.
export async function generateLessons(input: {
  decisions: Decision[];
  findings: Finding[];
  guardEvents: { kind: string; summary: string }[]; // Blocks and warnings Grasper raised.
  app: AppContext; // Full source (small apps) or repo map (large apps).
  appDir: string; // Absolute app folder for the read tools.
}): Promise<Lesson[]> {
  let submitted: Lesson[] | undefined;

  const submitTool = createTool({
    name: "submit_lessons",
    description: "Submit the final lessons. This ends your run.",
    inputSchema: z.object({
      lessons: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          risk_level: z.enum(["high", "medium", "low"]),
          security: z.boolean(),
          body: z.string(),
          file_refs: z.array(z.object({ path: z.string(), lines: z.string() })),
          reason_check: z.string(),
          question: z.string(),
        })
      ),
    }),
    lifecycle: { completesRun: true },
    execute: async (input: { lessons: Lesson[] }) => {
      submitted = input.lessons;
      return { ok: true };
    },
  });

  const apiKey = await getClinePassKey(); // Fresh key each run. Never cached.
  const agent = new Agent({
    providerId: "cline-pass",
    modelId: LESSON_MODEL,
    apiKey,
    systemPrompt: `You are the Grasper teacher. You teach a beginner the app their AI agent built.
${STYLE}
Rules:
- Lesson 1 is always "How your app works", for a complete beginner:
  - one line per file: what the file is for. If the app has more than 25 files, describe each main folder and the 10 most important files instead
  - one line per route/page: what it does (for a large app, the main ones)
  - then trace one real request step by step (the login if there is one), from the browser form, to the route, to the database, and back to the page, with file and line numbers
  - risk_level low, security false, and an explain-back question asking the user to describe that flow in their own words.
- After lesson 1, write one lesson per high or medium finding, riskiest first.
- Write one lesson about any blocked install or blocked secret: what Grasper stopped and why.
- Then up to three lessons for the biggest decisions (framework, database, auth).
- Each lesson has a reason_check line: compare the agent's logged reason with the real code.
- Each lesson ends with one explain-back question the user must answer in their own words.
- Give each lesson a short descriptive id that names its topic, like sql-injection-login. Never use generic ids like lesson-2.
- Call submit_lessons at the end. Do not answer in plain text.`,
    tools: [...codebaseTools(input.appDir), submitTool],
    // Large codebases need turns to read files before writing.
    maxIterations: input.app.mode === "map" ? 40 : 12,
  });

  const prompt = `Here is the app, the decisions, the guard events, and the scan findings.

## Decisions logged during the build
${input.decisions.map((d) => `- ${d.topic} = ${d.choice}: ${d.reason}${d.inferred ? " (inferred, reason not stated)" : ""}`).join("\n") || "(none)"}

## Guard events (what Grasper blocked or warned about)
${input.guardEvents.map((g) => `- [${g.kind}] ${g.summary}`).join("\n") || "(none)"}

## Scan findings
${input.findings.map((f) => `- [${f.severity}] ${f.title} (${f.source}${f.file ? `, ${f.file}${f.line ? `:${f.line}` : ""}` : ""})`).join("\n") || "(none)"}

${codeSection(input.app)}

Write the lessons now. Call submit_lessons when done.`;

  const result = await agent.run(prompt);
  if (!submitted) {
    console.error("[teacher] no lessons submitted. status:", result.status, "output:", result.outputText);
    throw new Error("Teacher did not submit lessons.");
  }
  return submitted;
}


// Grade one explain-back answer against the real code. Security points count most.
export async function gradeExplainBack(input: {
  lesson: Lesson;
  answer: string;
  app: AppContext;
  appDir: string;
}): Promise<Grade> {
  let submitted: Grade | undefined;

  const submitTool = createTool({
    name: "submit_grade",
    description: "Submit the final grade. This ends your run.",
    inputSchema: z.object({
      score: z.number().min(0).max(100),
      got_right: z.array(z.string()),
      missed: z.array(z.string()),
    }),
    lifecycle: { completesRun: true },
    execute: async (input: Grade) => {
      submitted = input;
      return { ok: true };
    },
  });

  const apiKey = await getClinePassKey();
  const agent = new Agent({
    providerId: "cline-pass",
    modelId: GRADER_MODEL,
    apiKey,
    systemPrompt: `You are the Grasper grader. You grade a beginner's explanation of their own app.
${STYLE}
Rules:
- Grade the answer against the real code, not against the lesson text.
- Security understanding counts most. A wrong security claim caps the score at 40.
- got_right and missed list short, concrete points.
- If you only have a repo map, read the lesson's files with read_file before grading.
- Call submit_grade at the end. Do not answer in plain text.`,
    tools: [...codebaseTools(input.appDir), submitTool],
    maxIterations: input.app.mode === "map" ? 20 : 8,
  });

  const prompt = `Lesson: ${input.lesson.title}
Question: ${input.lesson.question}

The user's answer:
${input.answer}

Files this lesson refers to: ${input.lesson.file_refs.map((r) => `${r.path}:${r.lines}`).join(", ") || "(none)"}

${input.app.mode === "full" ? `The real code:\n${input.app.text}` : codeSection(input.app)}

Grade the answer. Call submit_grade when done.`;

  const result = await agent.run(prompt);
  if (!submitted) {
    console.error("[teacher] no grade submitted. status:", result.status, "output:", result.outputText);
    throw new Error("Grader did not submit a grade.");
  }
  return submitted;
}
