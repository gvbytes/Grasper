import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

// Agent-agnostic codebase access for the teacher and the grader.
// Small apps: the whole source fits in one prompt ("full" mode).
// Large apps: a compact repo map plus on-demand reads and searches ("map" mode).
// Every read stays inside the app folder and skips secrets, databases, and vendored code.

export const FULL_MODE_MAX_CHARS = 30_000; // Same budget the teacher used before.
const MAX_FILE_BYTES = 400_000; // Larger files are listed but never read whole.
const MAX_READ_LINES = 300; // One read_file call returns at most this many lines.
const MAX_MAP_CHARS = 14_000;
const MAX_SYMBOLS_PER_FILE = 15;
const MAX_SEARCH_RESULTS = 40;

const SKIP_DIRS = new Set([
  "venv", ".venv", "env", "node_modules", ".git", "__pycache__", "dist", "build",
  ".next", ".cline", ".mypy_cache", ".pytest_cache", ".tox", "coverage", "site-packages",
]);

const TEXT_EXTENSIONS = new Set([
  ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".css", ".scss",
  ".json", ".md", ".txt", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".sql", ".sh",
  ".go", ".rs", ".java", ".rb", ".php", ".vue", ".svelte",
]);

// Files that must never reach a model: secrets and data.
function isDenied(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".env" || (lower.startsWith(".env.") && !lower.endsWith(".example"))) return true;
  return [".db", ".sqlite", ".sqlite3", ".pem", ".key", ".p12"].includes(extname(lower));
}

export type AppFile = { path: string; bytes: number; lines: number };

// Every readable source file in the app, relative paths, sorted.
export async function listAppFiles(root: string): Promise<AppFile[]> {
  const files: AppFile[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile() || isDenied(entry.name)) continue;
      if (!TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase()) && entry.name !== ".env.example") continue;
      try {
        const info = await stat(full);
        let lines = 0;
        if (info.size <= MAX_FILE_BYTES) lines = (await readFile(full, "utf8")).split("\n").length;
        files.push({ path: relative(root, full), bytes: info.size, lines });
      } catch {
        continue;
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// Resolve a model-supplied path safely. Returns undefined if it escapes the root or is denied.
export function safeAppPath(root: string, relPath: string): string | undefined {
  const absRoot = resolve(root);
  const target = resolve(absRoot, relPath.replace(/^[/\\]+/, ""));
  if (target !== absRoot && !target.startsWith(absRoot + sep)) return undefined;
  const parts = relative(absRoot, target).split(sep);
  if (parts.some((part) => SKIP_DIRS.has(part)) || isDenied(parts[parts.length - 1] ?? "")) return undefined;
  return target;
}

// Main symbols per file, so the model knows where things are without reading everything.
const SYMBOL_PATTERNS: RegExp[] = [
  /^\s*(?:async\s+)?def\s+(\w+)/, // Python functions
  /^\s*class\s+(\w+)/, // Python / JS / TS classes
  /^\s*@[\w.]+\.(?:route|get|post|put|patch|delete)\(\s*["']([^"']+)/, // Flask / FastAPI routes
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/, // JS / TS functions
  /^\s*export\s+(?:const|let|type|interface)\s+(\w+)/, // JS / TS exports
  /^\s*(?:app|router)\.(?:get|post|put|patch|delete|use)\(\s*["'`]([^"'`]+)/, // Express routes
  /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)/, // Go
];

function symbolsOf(text: string): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, index) => {
    if (found.length >= MAX_SYMBOLS_PER_FILE) return;
    for (const pattern of SYMBOL_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        found.push(`${match[1]}:${index + 1}`);
        break;
      }
    }
  });
  return found;
}

// A compact map: every file with its size and main symbols, capped in length.
export async function buildRepoMap(root: string): Promise<string> {
  const files = await listAppFiles(root);
  const lines: string[] = [`${files.length} source files (path, lines, main symbols with line numbers):`];
  let size = lines[0].length;
  let omitted = 0;
  for (const file of files) {
    let symbols: string[] = [];
    if (file.bytes <= MAX_FILE_BYTES) {
      try {
        symbols = symbolsOf(await readFile(join(root, file.path), "utf8"));
      } catch {
        symbols = [];
      }
    }
    const line = `- ${file.path} (${file.lines} lines)${symbols.length ? `: ${symbols.join(", ")}` : ""}`;
    if (size + line.length > MAX_MAP_CHARS) {
      omitted++;
      continue;
    }
    lines.push(line);
    size += line.length + 1;
  }
  if (omitted) lines.push(`- ... ${omitted} more files not shown. Use list_files and search_code to find them.`);
  return lines.join("\n");
}

// Numbered lines from one file, at most MAX_READ_LINES per call.
export async function readFileRange(root: string, relPath: string, startLine = 1, endLine?: number): Promise<string> {
  const target = safeAppPath(root, relPath);
  if (!target) return `Refused: "${relPath}" is outside the app or is a secret/data file.`;
  let text: string;
  try {
    const info = await stat(target);
    if (info.size > MAX_FILE_BYTES) return `Refused: "${relPath}" is too large to read (${info.size} bytes). Use search_code.`;
    text = await readFile(target, "utf8");
  } catch {
    return `Not found: "${relPath}".`;
  }
  const all = text.split("\n");
  const start = Math.max(1, Math.floor(startLine));
  const end = Math.min(all.length, Math.floor(endLine ?? start + MAX_READ_LINES - 1), start + MAX_READ_LINES - 1);
  const body = all.slice(start - 1, end).map((line, i) => `${start + i}: ${line}`).join("\n");
  const more = end < all.length ? `\n... (${all.length} lines total; read more with start_line=${end + 1})` : "";
  return `### ${relPath} (lines ${start}-${end} of ${all.length})\n${body}${more}`;
}

// Search all app files for a regex (falls back to plain text). Returns "file:line: text" matches.
export async function searchCode(root: string, query: string): Promise<string> {
  let pattern: RegExp;
  try {
    pattern = new RegExp(query, "i");
  } catch {
    pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const results: string[] = [];
  for (const file of await listAppFiles(root)) {
    if (file.bytes > MAX_FILE_BYTES) continue;
    let text: string;
    try {
      text = await readFile(join(root, file.path), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && results.length < MAX_SEARCH_RESULTS; i++) {
      if (pattern.test(lines[i])) results.push(`${file.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
    }
    if (results.length >= MAX_SEARCH_RESULTS) {
      results.push(`... stopped at ${MAX_SEARCH_RESULTS} matches. Narrow the query.`);
      break;
    }
  }
  return results.join("\n") || `No matches for "${query}".`;
}

export type AppContext = {
  mode: "full" | "map";
  text: string; // Full numbered source, or the repo map.
  fileCount: number;
  totalChars: number;
};

// Pick the mode: the whole source if it fits the old budget, otherwise the repo map.
export async function getAppContext(root: string): Promise<AppContext> {
  const files = await listAppFiles(root);
  const parts: string[] = [];
  let total = 0;
  let fits = true;
  for (const file of files) {
    if (file.bytes > MAX_FILE_BYTES) {
      fits = false;
      break;
    }
    let text: string;
    try {
      text = await readFile(join(root, file.path), "utf8");
    } catch {
      continue;
    }
    const numbered = text.split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n");
    total += numbered.length;
    if (total > FULL_MODE_MAX_CHARS) {
      fits = false;
      break;
    }
    parts.push(`### ${file.path}\n${numbered}`);
  }
  if (fits) {
    return { mode: "full", text: parts.join("\n\n") || "(no source files found)", fileCount: files.length, totalChars: total };
  }
  const map = await buildRepoMap(root);
  return { mode: "map", text: map, fileCount: files.length, totalChars: total };
}
