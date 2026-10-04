import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { checkPackage } from "./lib/registry.js";
import { appendEvent, demoAppDir, readJson, writeJson } from "./lib/store.js";
import type { Finding } from "./lib/findings.js";

// Scans the demo app after the build.
// Bandit finds real Python issues. Custom checks cover what bandit misses.
// Writes data/findings.json and appends one event per finding.

const run = promisify(execFile);

type BanditResult = {
  filename: string;
  line_number: number;
  issue_severity: "LOW" | "MEDIUM" | "HIGH";
  issue_text: string;
  test_id: string;
  test_name: string;
};

function banditSeverity(level: string, testId: string): Finding["severity"] {
  // SQL injection in a login query is high risk in reality. Bandit calls B608 medium.
  if (testId === "B608") return "high";
  if (level === "HIGH") return "high";
  if (level === "MEDIUM") return "medium";
  return "low";
}

// demo-weakness.py is our exploit harness, not the app. Its subprocess and urllib
// calls are deliberate. Do not scan it.
function isAppFile(filename: string): boolean {
  return !relative(demoAppDir, filename).startsWith("demo-weakness.py");
}

async function runBandit(): Promise<Finding[]> {
  try {
    // Bandit exits 1 when it finds issues. That is normal, not an error.
    const { stdout } = await run(
      "python3",
      // Scan the real app folder (GRASPER_APP_DIR or demo-app), skipping virtual environments.
      ["-m", "bandit", "-r", demoAppDir, "-x", `${join(demoAppDir, "venv")},${join(demoAppDir, ".venv")}`, "-f", "json"],
      { cwd: demoAppDir, maxBuffer: 16 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as { results?: BanditResult[] };
    return (parsed.results ?? []).filter((r) => isAppFile(r.filename)).map((result) => ({
      id: `bandit-${result.test_id}-${relative(demoAppDir, result.filename)}-${result.line_number}`,
      severity: banditSeverity(result.issue_severity, result.test_id),
      title: result.issue_text,
      file: relative(demoAppDir, result.filename),
      line: result.line_number,
      source: "bandit" as const,
      detail: `${result.test_id} ${result.test_name}`,
      status: "open" as const,
    }));
  } catch (error) {
    // execFile rejects on exit code 1. The JSON is still on stdout.
    const stdout = (error as { stdout?: string }).stdout;
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout) as { results?: BanditResult[] };
        return (parsed.results ?? []).filter((r) => isAppFile(r.filename)).map((result) => ({
          id: `bandit-${result.test_id}-${relative(demoAppDir, result.filename)}-${result.line_number}`,
          severity: banditSeverity(result.issue_severity, result.test_id),
          title: result.issue_text,
          file: relative(demoAppDir, result.filename),
          line: result.line_number,
          source: "bandit" as const,
          detail: `${result.test_id} ${result.test_name}`,
          status: "open" as const,
        }));
      } catch {
        // Fall through to the error event below.
      }
    }
    console.error("[scan] bandit failed:", error);
    return [];
  }
}

// Custom check 1: every package in requirements.txt must exist on PyPI.
async function checkRequirements(): Promise<Finding[]> {
  const findings: Finding[] = [];
  let text: string;
  try {
    text = await readFile(join(demoAppDir, "requirements.txt"), "utf8");
  } catch {
    return findings; // No requirements file, nothing to check.
  }
  for (const line of text.split("\n")) {
    const name = line.split(/[=<>!~;\s]/)[0].trim();
    if (!name || name.startsWith("#") || name.startsWith("-")) continue;
    const check = await checkPackage("pypi", name.toLowerCase().replace(/[-_.]+/g, "-"));
    if (check.status === "missing") {
      findings.push({
        id: `custom-missing-package-${name}`,
        severity: "high",
        title: `Package "${name}" in requirements.txt does not exist on PyPI`,
        file: "requirements.txt",
        source: "custom",
        detail: check.suggestion ? `Did you mean "${check.suggestion}"?` : "The agent invented this name.",
        status: "open",
      });
    }
  }
  return findings;
}

// Custom check 2: .env must be in .gitignore.
async function checkGitignore(): Promise<Finding[]> {
  try {
    const text = await readFile(join(demoAppDir, ".gitignore"), "utf8");
    const lines = text.split("\n").map((line) => line.trim());
    if (lines.includes(".env")) return [];
  } catch {
    // No .gitignore at all is also a finding.
  }
  return [{
    id: "custom-env-not-gitignored",
    severity: "medium",
    title: ".env is not excluded by .gitignore. Secrets could be committed.",
    file: ".gitignore",
    source: "custom",
    detail: "Add a line with .env to demo-app/.gitignore.",
    status: "open",
  }];
}

// Custom check 3: no hard-coded SECRET_KEY in Python files.
async function checkSecretKey(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const entries = await readdir(demoAppDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".py")) continue;
    const path = join(entry.parentPath, entry.name);
    if (path.includes("venv")) continue;
    const text = await readFile(path, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (/SECRET_KEY\s*=\s*["'][^"']+["']/.test(line)) {
        findings.push({
          id: `custom-hardcoded-secret-${entry.name}-${index + 1}`,
          severity: "high",
          title: "Hard-coded SECRET_KEY in code. It belongs in .env.",
          file: relative(demoAppDir, path),
          line: index + 1,
          source: "custom",
          detail: "Read the secret key from an environment variable.",
          status: "open",
        });
      }
    });
  }
  return findings;
}

const findings: Finding[] = [
  ...(await runBandit()),
  ...(await checkRequirements()),
  ...(await checkGitignore()),
  ...(await checkSecretKey()),
];

// Compare with the previous scan. Report new findings and fixed ones once.
const previous = await readJson<{ findings: Finding[] }>("findings", { findings: [] });
const previousIds = new Map(previous.findings.map((f) => [f.id, f]));

await writeJson("findings", { findings });

const now = new Date().toISOString();
for (const finding of findings) {
  if (previousIds.has(finding.id)) continue; // Already reported. No duplicate events.
  await appendEvent({
    ts: now, source: "scan", kind: "finding",
    summary: `[${finding.severity.toUpperCase()}] ${finding.title}`,
    detail: { ...finding },
  });
}
for (const old of previous.findings) {
  if (findings.some((f) => f.id === old.id)) continue;
  await appendEvent({
    ts: now, source: "scan", kind: "finding_fixed",
    summary: `FIXED: ${old.title}`,
    detail: { ...old },
  });
}
await appendEvent({
  ts: now, source: "scan", kind: "scan_summary",
  summary: `Scan complete: ${findings.length} findings (${findings.filter((f) => f.severity === "high").length} high).`,
  detail: {},
});
console.log(`Scan complete: ${findings.length} findings (${findings.filter((f) => f.severity === "high").length} high).`);
