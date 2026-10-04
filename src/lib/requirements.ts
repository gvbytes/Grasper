import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { extractCommandStrings, splitSegments, stripQuotes } from "./install-parser.js";

// Requirements files and dependency manifests. The guard checks these two ways:
// 1. "pip install -r <file>" reads the file and checks every package in it.
// 2. A write to the file checks the added package names before the write.

export type RequirementRef = { path: string }; // Resolved absolute path.

// Find -r/--requirement files in pip install commands.
// Relative paths resolve against the command's working directory.
// "cd X &&" chain prefixes update that directory. baseDir is the session cwd.
export function findRequirementRefs(input: unknown, baseDir: string): RequirementRef[] {
  const refs: RequirementRef[] = [];
  for (const command of extractCommandStrings(input)) {
    let cwd = baseDir;
    for (const segment of splitSegments(command)) {
      const cdMatch = /^cd\s+(['"]?)([^'"]+)\1$/.exec(segment.trim());
      if (cdMatch) {
        cwd = resolve(cwd, cdMatch[2]);
        continue;
      }
      for (const file of requirementFilesInSegment(segment)) {
        refs.push({ path: isAbsolute(file) ? file : join(cwd, file) });
      }
    }
  }
  return refs;
}

function requirementFilesInSegment(segment: string): string[] {
  const words = segment.split(/\s+/).filter(Boolean);
  let start = -1;
  if ((words[0] === "pip" || words[0] === "pip3") && words[1] === "install") start = 2;
  else if (
    (words[0] === "python" || words[0] === "python3") &&
    words[1] === "-m" && words[2] === "pip" && words[3] === "install"
  ) start = 4;
  else if (words[0] === "uv" && words[1] === "pip" && words[2] === "install") start = 3;
  if (start === -1) return [];

  const files: string[] = [];
  for (let i = start; i < words.length; i++) {
    const word = stripQuotes(words[i]);
    if (word === "-r" || word === "--requirement") {
      const next = words[i + 1];
      if (next) {
        files.push(stripQuotes(next));
        i++;
      }
    } else if (word.startsWith("--requirement=")) {
      files.push(word.slice("--requirement=".length));
    }
  }
  return files;
}

// Normalize a PyPI name: lowercase, runs of -_. become -.
function normalizePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

const VALID_NAME = /^[a-z0-9][a-z0-9._@/-]*$/i;

// Parse package names from requirements.txt content.
export function parseRequirementNames(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const name = trimmed.split(/[=<>!~;\s[(]/)[0].replace(/^["']+|["']+$/g, "");
    if (name && VALID_NAME.test(name)) names.add(normalizePypiName(name));
  }
  return [...names];
}

export type DependencyFileKind = "requirements" | "package-json" | "pyproject";

// Which dependency manifest is this file, if any?
export function dependencyFileKind(path: string | undefined): DependencyFileKind | undefined {
  const base = ((path ?? "").split("/").pop() ?? "").toLowerCase();
  if (base === "requirements.txt" || base === "requirements.in" || /^requirements[\w.-]*\.(txt|in)$/.test(base)) {
    return "requirements";
  }
  if (base === "package.json") return "package-json";
  if (base === "pyproject.toml" || base === "pipfile") return "pyproject";
  return undefined;
}

export type AddedPackage = { registry: "pypi" | "npm"; name: string };

// Extract package names from the content written to a dependency file.
export function extractPackagesFromWrite(kind: DependencyFileKind, content: string): AddedPackage[] {
  if (kind === "requirements") {
    return parseRequirementNames(content).map((name) => ({ registry: "pypi" as const, name }));
  }

  if (kind === "package-json") {
    const deps = new Set<string>();
    try {
      const parsed = JSON.parse(content) as Record<string, Record<string, unknown>>;
      for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        const section = parsed[key];
        if (section && typeof section === "object") {
          for (const name of Object.keys(section)) deps.add(name);
        }
      }
    } catch {
      // Partial edit. Fall back to dependency sections only, never other keys.
      for (const match of content.matchAll(/"(?:devDependencies|dependencies|optionalDependencies|peerDependencies)"\s*:\s*\{([^}]*)\}/g)) {
        for (const keyMatch of match[1].matchAll(/"([^"]+)"\s*:/g)) deps.add(keyMatch[1]);
      }
    }
    return [...deps]
      .filter((name) => VALID_NAME.test(name))
      .map((name) => ({ registry: "npm" as const, name: name.toLowerCase() }));
  }

  // pyproject.toml: PEP 621 arrays and Poetry sections.
  const names = new Set<string>();
  for (const match of content.matchAll(/([a-z-]*dependencies)\s*=\s*\[([^\]]*)\]/gi)) {
    for (const item of match[2].split(",")) {
      const name = item.trim().split(/[=<>!~;\s(]/)[0].replace(/^["']+|["']+$/g, "");
      if (name && VALID_NAME.test(name)) names.add(normalizePypiName(name));
    }
  }
  const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?=\n\[|$)/.exec(content);
  if (poetry) {
    for (const line of poetry[1].split("\n")) {
      const name = line.split("=")[0].trim().replace(/^["']+|["']+$/g, "");
      if (name && VALID_NAME.test(name)) names.add(normalizePypiName(name));
    }
  }
  return [...names].map((name) => ({ registry: "pypi" as const, name }));
}

// Read a requirements file. Returns null when the file cannot be read.
export async function readRequirementFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
