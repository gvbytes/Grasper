import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import { getClinePassKey } from "./auth.js";
import type { Decision } from "../plugin/guard.js";
import type { Finding } from "./findings.js";

// The teacher is an SDK Agent. It never invents findings.
// It explains real findings and real decisions, against the real code.
// Structured output comes from a submit tool with completesRun. No JSON parsing.

export type Lesson = {
  id: string;
  title: string;
  risk_level: "high" | "medium" | "low";
  security: boolean; // Security lessons weigh double in the score.
  body: string; // The lesson text. Plain words. Short sentences.
  file_refs: { path: string; lines: string }[]; // Example: { path: "app.py", lines: "40-48" }.
  reason_check: string; // Does the agent's logged reason match the code? Say how.
  question: string; // The explain-back question for the user.
};

export type Grade = {
  score: number; // 0 to 100.
  got_right: string[];
  missed: string[];
};

const LESSON_MODEL = process.env.TEACHER_MODEL ?? "cline-pass/deepseek-v4.1-flash";
const GRADER_MODEL = process.env.GRADER_MODEL ?? "cline-pass/deepseek-v4-pro";

const STYLE = `Writing rules:
- One fact per sentence. Sentences under 20 words.
- Explain like the reader has never seen the concept. Define every term.
- Reference real file names and line numbers from the code given to you.`;

// Generate lessons from the real build data.
export async function generateLessons(input: {
  decisions: Decision[];
  findings: Finding[];
  guardEvents: { kind: string; summary: string }[]; // Blocks and warnings Grasper raised.
  source: string; // Concatenated demo-app source with file names.
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
  - one line per file: what the file is for
  - one line per route/page: what it does
  - then trace one real request step by step (the login), from the browser form, to the route in app.py, to the database, and back to the page, with file and line numbers
  - risk_level low, security false, and an explain-back question asking the user to describe that flow in their own words.
- After lesson 1, write one lesson per high or medium finding, riskiest first.
- Write one lesson about any blocked install or blocked secret: what Grasper stopped and why.
- Then up to three lessons for the biggest decisions (framework, database, auth).
- Each lesson has a reason_check line: compare the agent's logged reason with the real code.
- Each lesson ends with one explain-back question the user must answer in their own words.
- Give each lesson a short descriptive id that names its topic, like sql-injection-login. Never use generic ids like lesson-2.
- Call submit_lessons at the end. Do not answer in plain text.`,
    tools: [submitTool],
    maxIterations: 8,
  });

  const prompt = `Here is the app, the decisions, the guard events, and the scan findings.

## Decisions logged during the build
${input.decisions.map((d) => `- ${d.topic} = ${d.choice}: ${d.reason}${d.inferred ? " (inferred, reason not stated)" : ""}`).join("\n") || "(none)"}

## Guard events (what Grasper blocked or warned about)
${input.guardEvents.map((g) => `- [${g.kind}] ${g.summary}`).join("\n") || "(none)"}

## Scan findings
${input.findings.map((f) => `- [${f.severity}] ${f.title} (${f.source}${f.file ? `, ${f.file}${f.line ? `:${f.line}` : ""}` : ""})`).join("\n") || "(none)"}

## App source
${input.source}

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
  source: string;
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
- Call submit_grade at the end. Do not answer in plain text.`,
    tools: [submitTool],
    maxIterations: 6,
  });

  const prompt = `Lesson: ${input.lesson.title}
Question: ${input.lesson.question}

The user's answer:
${input.answer}

The real code:
${input.source}

Grade the answer. Call submit_grade when done.`;

  const result = await agent.run(prompt);
  if (!submitted) {
    console.error("[teacher] no grade submitted. status:", result.status, "output:", result.outputText);
    throw new Error("Grader did not submit a grade.");
  }
  return submitted;
}
