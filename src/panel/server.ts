import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readEvents, readJson, writeJson, projectRoot } from "../lib/store.js";
import type { Finding } from "../lib/findings.js";
import type { Grade, Lesson } from "../lib/teacher.js";
import { computeScore } from "../lib/score.js";
import { gradeExplainBack } from "../lib/teacher.js";
import { readAppSource } from "../lib/source.js";

// The panel server. Plain Node http, no framework, no CDN.
// The page polls /api/state every 2 seconds.

const PORT = 4000;

// Demo mode reads the saved snapshot instead of the live data dir.
let mode: "live" | "snapshot" = "live";

async function readNamed<T>(name: string, fallback: T): Promise<T> {
  if (mode === "snapshot") {
    try {
      const text = await readFile(join(projectRoot, "data-snapshot", `${name}.json`), "utf8");
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }
  return readJson(name, fallback);
}

async function readAllEvents() {
  if (mode === "snapshot") {
    try {
      const text = await readFile(join(projectRoot, "data-snapshot", "events.jsonl"), "utf8");
      return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
  return readEvents();
}

async function buildState() {
  const [events, { findings }, { lessons }, grades] = await Promise.all([
    readAllEvents(),
    readNamed<{ findings: Finding[] }>("findings", { findings: [] }),
    readNamed<{ lessons: Lesson[] }>("lessons", { lessons: [] }),
    readNamed<Record<string, Grade>>("grades", {}),
  ]);
  const score = computeScore({ lessons, grades, findings });
  return { mode, score, events, findings, lessons, grades };
}

async function handleGrade(body: string): Promise<Grade & { lessonId: string }> {
  const { lessonId, answer } = JSON.parse(body) as { lessonId: string; answer: string };
  const { lessons } = await readNamed<{ lessons: Lesson[] }>("lessons", { lessons: [] });
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) throw new Error(`Unknown lesson ${lessonId}`);
  const source = await readAppSource();
  const grade = await gradeExplainBack({ lesson, answer, source });
  const grades = await readJson<Record<string, Grade>>("grades", {});
  grades[lessonId] = grade;
  await writeJson("grades", grades);
  await appendGradeEvent(lessonId, grade);
  return { ...grade, lessonId };
}

async function appendGradeEvent(lessonId: string, grade: Grade) {
  const { appendEvent } = await import("../lib/store.js");
  await appendEvent({
    ts: new Date().toISOString(), source: "teacher", kind: "grade",
    summary: `Explain-back graded ${grade.score}/100 (${lessonId})`,
    detail: { lessonId, ...grade },
  });
}

const page = await readFile(join(projectRoot, "src/panel/index.html"), "utf8");

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
    if (req.method === "GET" && req.url === "/api/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(await buildState()));
      return;
    }
    if (req.method === "POST" && req.url === "/api/mode") {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as { mode?: string };
      mode = parsed.mode === "snapshot" ? "snapshot" : "live";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ mode }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/grade") {
      const grade = await handleGrade(await readBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(grade));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Grasper panel: http://127.0.0.1:${PORT}`);
});

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
