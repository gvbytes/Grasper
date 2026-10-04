import { appendEvent, demoAppDir, readEvents, readJson, writeJson } from "./lib/store.js";
import type { Finding } from "./lib/findings.js";
import type { Decision } from "./plugin/guard.js";
import { generateLessons } from "./adapters/cline/teacher.js";
import { getAppContext } from "./lib/codebase.js";

// Runs the teacher after the build and the scan.
// Reads decisions from the event log, findings from the scan, and the app source.
// Writes data/lessons.json.

const events = await readEvents();
const decisions: Decision[] = events
  .filter((event) => event.kind === "decision" && event.detail)
  .map((event) => ({
    topic: String(event.detail?.topic ?? ""),
    choice: String(event.detail?.choice ?? ""),
    reason: String(event.detail?.reason ?? ""),
    inferred: Boolean(event.detail?.inferred),
    packageName: event.detail?.packageName as string | undefined,
  }))
  .filter((decision) => decision.topic && decision.choice);

const { findings } = await readJson<{ findings: Finding[] }>("findings", { findings: [] });
const guardEvents = events
  .filter((event) => ["block", "warn", "seeded_weakness"].includes(event.kind))
  .map((event) => ({ kind: event.kind, summary: event.summary }));
// Small apps: whole source. Large apps: repo map + read/search tools.
const app = await getAppContext(demoAppDir);

console.log(
  `Teacher input: ${decisions.length} decisions, ${guardEvents.length} guard events, ${findings.length} findings, ${app.fileCount} files, ${app.mode} mode.`
);

try {
  const lessons = await generateLessons({ decisions, findings, guardEvents, app, appDir: demoAppDir });
  await writeJson("lessons", { lessons });
  for (const lesson of lessons) {
    await appendEvent({
      ts: new Date().toISOString(), source: "teacher", kind: "lesson",
      summary: `Lesson: ${lesson.title} [${lesson.risk_level}]`,
      detail: { id: lesson.id, security: lesson.security },
    });
  }
  console.log(`Teacher wrote ${lessons.length} lessons.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Cline login") || message.includes("requires re-authentication")) {
    console.error("STOP: sign in again in the Cline app, then retry.");
  } else {
    console.error("Teacher failed:", message);
  }
  process.exitCode = 1;
}
