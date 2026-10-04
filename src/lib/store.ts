import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// All JSON reads and writes for Grasper go through this file.
// The panel, the plugin, the scan, and the teacher share these paths.

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Tests set GRASPER_DATA_DIR to a temp dir. Demo data stays clean.
export const dataDir = process.env.GRASPER_DATA_DIR ?? join(projectRoot, "data");
export const demoAppDir = join(projectRoot, "demo-app");

const eventsPath = join(dataDir, "events.jsonl");

export type EventSource = "guard" | "builder" | "scan" | "teacher" | "panel";

export type GrasperEvent = {
  ts: string; // ISO time
  source: EventSource;
  kind: string; // Examples: "block", "warn", "decision", "finding", "lesson", "grade".
  summary: string; // One line for the panel.
  detail?: Record<string, unknown>;
};

// Append one event to data/events.jsonl.
export async function appendEvent(event: GrasperEvent): Promise<void> {
  try {
    await mkdir(dataDir, { recursive: true });
    await appendFile(eventsPath, JSON.stringify(event) + "\n", "utf8");
  } catch (error) {
    console.error("[store] appendEvent failed:", error);
  }
}

// Read all events. Returns [] when the file is missing or a line is bad.
export async function readEvents(): Promise<GrasperEvent[]> {
  try {
    const text = await readFile(eventsPath, "utf8");
    const events: GrasperEvent[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as GrasperEvent);
      } catch {
        console.error("[store] skipping bad event line");
      }
    }
    return events;
  } catch {
    return [];
  }
}

// Write one named JSON document, like "findings" -> data/findings.json.
export async function writeJson(name: string, value: unknown): Promise<void> {
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, `${name}.json`), JSON.stringify(value, null, 2), "utf8");
  } catch (error) {
    console.error(`[store] writeJson ${name} failed:`, error);
  }
}

// Read one named JSON document. Returns fallback when missing or invalid.
export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(join(dataDir, `${name}.json`), "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
