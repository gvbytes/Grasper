// Checks package names against PyPI and npm.
// Every call has a 6000 ms timeout with one retry. Network failure means status "unknown", never a block.

export type RegistryStatus = "exists" | "missing" | "unknown";

export type RegistryCheck = {
  status: RegistryStatus;
  ageDays?: number; // Days since the first release.
  releaseCount?: number;
  weeklyDownloads?: number; // Undefined when the download service fails.
  hasInstallScript?: boolean; // npm only: preinstall/postinstall in the latest version.
  hasLinks?: boolean; // A homepage or repository link exists.
  suggestion?: string; // "did you mean X" from the popular list.
  signals: string[]; // Risk signals for packages that exist. Empty when clean.
};

// Metadata used for the signal rules. All fields optional: unknown means skip.
export type PackageMeta = {
  ageDays?: number;
  releaseCount?: number;
  weeklyDownloads?: number;
  hasInstallScript?: boolean;
  hasLinks?: boolean;
  suggestion?: string;
};

const TIMEOUT_MS = 6000;
const METADATA_TIMEOUT_MS = 3000;
const NEW_PACKAGE_DAYS = 30;
const FEW_RELEASES = 2;
const LOW_WEEKLY_DOWNLOADS = 1000;

// Risk signals for a package that exists. Two or more mean block. One means warning.
export function computeSignals(meta: PackageMeta): string[] {
  const signals: string[] = [];
  if (meta.ageDays !== undefined && meta.ageDays < NEW_PACKAGE_DAYS) {
    signals.push(`very new (${meta.ageDays} days old)`);
  }
  if (meta.releaseCount !== undefined && meta.releaseCount <= FEW_RELEASES) {
    signals.push(`very few releases (${meta.releaseCount})`);
  }
  if (meta.weeklyDownloads !== undefined && meta.weeklyDownloads < LOW_WEEKLY_DOWNLOADS) {
    signals.push(`low downloads (${meta.weeklyDownloads} per week)`);
  }
  if (meta.hasInstallScript === true) {
    signals.push("install scripts (preinstall/postinstall)");
  }
  if (meta.hasLinks === false) {
    signals.push("no homepage or repository");
  }
  if (meta.suggestion) {
    signals.push(`near-typo of "${meta.suggestion}"`);
  }
  return signals;
}

// Two or more signals block the install. One signal warns. Zero signals allow.
export function riskAction(signals: string[]): "block" | "warn" | "allow" {
  if (signals.length >= 2) return "block";
  if (signals.length === 1) return "warn";
  return "allow";
}

// About 30 popular names per registry, for typo warnings.
const POPULAR_PYPI = [
  "flask", "django", "fastapi", "requests", "numpy", "pandas", "scipy", "sqlalchemy",
  "celery", "pytest", "click", "boto3", "pillow", "matplotlib", "scikit-learn", "torch",
  "transformers", "openai", "anthropic", "pydantic", "uvicorn", "gunicorn", "aiohttp",
  "httpx", "redis", "pymongo", "psycopg2", "cryptography", "beautifulsoup4", "lxml",
  "jinja2", "werkzeug", "tqdm", "rich", "typer", "starlette",
];

const POPULAR_NPM = [
  "react", "react-dom", "vue", "angular", "svelte", "next", "express", "fastify",
  "lodash", "axios", "moment", "dayjs", "chalk", "commander", "typescript", "webpack",
  "vite", "eslint", "prettier", "jest", "vitest", "mocha", "zod", "yup", "prisma",
  "mongoose", "pg", "mysql2", "redis", "socket.io", "tailwindcss", "postcss", "dotenv",
  "cors", "helmet", "jsonwebtoken", "bcrypt",
];

// Levenshtein distance, for typo detection.
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) grid[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
    }
  }
  return grid[a.length][b.length];
}

// Find a "did you mean" suggestion. Distance 1 always counts. Distance 2 counts for longer names.
export function findSuggestion(name: string, popular: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of popular) {
    if (candidate === name) return undefined; // The name itself is popular. Not a typo.
    const distance = editDistance(name, candidate);
    const allowed = candidate.length >= 5 ? 2 : 1;
    if (distance <= allowed && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

async function fetchOnce(url: string, timeoutMs: number, abbreviated = false): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The abbreviated npm format is much smaller. The full document for react is many MB.
    const headers = abbreviated ? { accept: "application/vnd.npm.install-v1+json" } : undefined;
    const response = await fetch(url, { signal: controller.signal, headers });
    if (response.status === 404) return { ok: false, status: 404 };
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, status: response.status, body: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch with one retry on timeout. Venue Wi-Fi is flaky.
async function fetchJson(url: string, abbreviated = false, timeoutMs = TIMEOUT_MS): Promise<{ ok: boolean; status: number; body?: unknown }> {
  try {
    return await fetchOnce(url, timeoutMs, abbreviated);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    if (!aborted) throw error;
    return fetchOnce(url, timeoutMs, abbreviated);
  }
}

function daysSince(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.floor(ms / 86_400_000);
}

// PyPI weekly downloads. Skip when the service fails.
async function pypiWeeklyDownloads(name: string): Promise<number | undefined> {
  try {
    const result = await fetchJson(`https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`);
    if (!result.ok) return undefined;
    const body = result.body as { data?: { last_week?: number } };
    const week = body.data?.last_week;
    return typeof week === "number" ? week : undefined;
  } catch {
    return undefined;
  }
}

// npm weekly downloads. Skip when the service fails.
async function npmWeeklyDownloads(encoded: string): Promise<number | undefined> {
  try {
    const result = await fetchJson(`https://api.npmjs.org/downloads/point/last-week/${encoded}`);
    if (!result.ok) return undefined;
    const body = result.body as { downloads?: number };
    return typeof body.downloads === "number" ? body.downloads : undefined;
  } catch {
    return undefined;
  }
}

async function checkPypi(name: string): Promise<RegistryCheck> {
  const suggestion = findSuggestion(name, POPULAR_PYPI);
  try {
    const downloadsPromise = pypiWeeklyDownloads(name); // Runs in parallel.
    const result = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (result.status === 404) return { status: "missing", suggestion, signals: [] };
    if (!result.ok) return { status: "unknown", suggestion, signals: [] };
    const body = result.body as {
      releases?: Record<string, { upload_time?: string }[]>;
      info?: { home_page?: string | null; project_url?: string | null; project_urls?: Record<string, string> | null };
    };
    const releases = body.releases ?? {};
    const releaseCount = Object.keys(releases).length;
    let oldest: number | undefined;
    for (const files of Object.values(releases)) {
      for (const file of files) {
        if (!file.upload_time) continue;
        const time = new Date(file.upload_time).getTime();
        if (oldest === undefined || time < oldest) oldest = time;
      }
    }
    const ageDays = oldest === undefined ? undefined : Math.floor((Date.now() - oldest) / 86_400_000);
    const info = body.info ?? {};
    const hasLinks = Boolean(
      info.home_page || info.project_url || (info.project_urls && Object.keys(info.project_urls).length > 0)
    );
    const weeklyDownloads = await downloadsPromise;
    const meta = { ageDays, releaseCount, weeklyDownloads, hasLinks, suggestion };
    return { status: "exists", ...meta, signals: computeSignals(meta) };
  } catch {
    return { status: "unknown", suggestion, signals: [] };
  }
}

async function checkNpm(name: string): Promise<RegistryCheck> {
  const suggestion = findSuggestion(name, POPULAR_NPM);
  try {
    // Scoped names need the slash encoded: @scope/name -> @scope%2Fname.
    const encoded = name.startsWith("@") ? name.replace("/", "%2F") : name;
    // The /latest endpoint is a small document. Fast existence check and manifest.
    const latest = await fetchJson(`https://registry.npmjs.org/${encoded}/latest`);
    if (latest.status === 404) return { status: "missing", suggestion, signals: [] };
    if (!latest.ok) return { status: "unknown", suggestion, signals: [] };

    const manifest = (latest.body ?? {}) as {
      scripts?: Record<string, string>;
      homepage?: string;
      repository?: unknown;
    };
    const hasInstallScript = Boolean(
      manifest.scripts && (manifest.scripts.preinstall || manifest.scripts.postinstall)
    );
    const hasLinks = Boolean(manifest.homepage || manifest.repository);

    // Age and release count need the full document. Best effort with a short timeout.
    let ageDays: number | undefined;
    let releaseCount: number | undefined;
    const downloadsPromise = npmWeeklyDownloads(encoded); // Runs in parallel.
    try {
      const full = await fetchJson(`https://registry.npmjs.org/${encoded}`, true, METADATA_TIMEOUT_MS);
      if (full.ok) {
        const body = full.body as { time?: Record<string, string> };
        const time = body.time ?? {};
        const created = time.created;
        releaseCount = Math.max(0, Object.keys(time).length - 2); // Minus created and modified.
        ageDays = created ? daysSince(created) : undefined;
      }
    } catch {
      // Metadata is nice to have. Existence is already confirmed.
    }
    const weeklyDownloads = await downloadsPromise;
    const meta = { ageDays, releaseCount, weeklyDownloads, hasInstallScript, hasLinks, suggestion };
    return { status: "exists", ...meta, signals: computeSignals(meta) };
  } catch {
    return { status: "unknown", suggestion, signals: [] };
  }
}

// In-memory cache for one run. The same package is never checked twice.
const cache = new Map<string, RegistryCheck>();

export async function checkPackage(registry: "pypi" | "npm", name: string): Promise<RegistryCheck> {
  const key = `${registry}:${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const check = registry === "pypi" ? await checkPypi(name) : await checkNpm(name);
  cache.set(key, check);
  return check;
}

