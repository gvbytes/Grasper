import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { demoAppDir } from "./store.js";

// Reads the demo-app source into one string for the teacher and the grader.
// Skips venv, databases, and binary files. Caps sizes so prompts stay small.

const TEXT_EXTENSIONS = new Set([".py", ".txt", ".md", ".html", ".css", ".js", ".json", ".env.example"]);
const MAX_FILE_CHARS = 8000;
const MAX_TOTAL_CHARS = 30_000;

export async function readAppSource(): Promise<string> {
  const parts: string[] = [];
  let total = 0;

  let entries;
  try {
    entries = await readdir(demoAppDir, { withFileTypes: true, recursive: true });
  } catch {
    return "(demo-app not found)";
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (path.includes("venv") || path.includes("__pycache__")) continue;
    const ext = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    if (total >= MAX_TOTAL_CHARS) break;

    const rel = relative(demoAppDir, path);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    if (text.length > MAX_FILE_CHARS) text = text.slice(0, MAX_FILE_CHARS) + "\n... (truncated)";
    // Line numbers let the teacher cite real lines.
    const numbered = text.split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n");
    parts.push(`### ${rel}\n${numbered}`);
    total += numbered.length;
  }

  return parts.join("\n\n") || "(no source files found)";
}
