import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FULL_MODE_MAX_CHARS,
  buildRepoMap,
  getAppContext,
  listAppFiles,
  readFileRange,
  safeAppPath,
  searchCode,
} from "../lib/codebase.js";
import { projectRoot } from "../lib/store.js";

// No model calls. Builds a fake large repo and checks map mode, safety, and search.

const root = await mkdtemp(join(tmpdir(), "grasper-bigrepo-"));
try {
  // 60 Python modules, each ~1.5k chars: well over the full-mode budget.
  await mkdir(join(root, "app", "services"), { recursive: true });
  for (let i = 0; i < 60; i++) {
    const body = [
      `class Service${i}:`,
      `    def run_${i}(self, value):`,
      `        return value * ${i}`,
      ...Array.from({ length: 40 }, (_, n) => `# filler line ${n} for module ${i}`),
    ].join("\n");
    await writeFile(join(root, "app", "services", `service_${i}.py`), body);
  }
  await writeFile(
    join(root, "app", "main.py"),
    ['from flask import Flask', 'app = Flask(__name__)', '', '@app.route("/login", methods=["POST"])', "def login():", '    return "ok"'].join("\n")
  );
  // Things that must never reach a model.
  await writeFile(join(root, ".env"), "OPENAI_KEY=sk-should-never-be-read-1234567890");
  await writeFile(join(root, "notes.db"), "binary-ish");
  await mkdir(join(root, "venv", "lib"), { recursive: true });
  await writeFile(join(root, "venv", "lib", "vendored.py"), "def vendored(): pass");
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "function vendoredJs() {}");

  // Listing skips secrets, data, and vendored folders.
  const files = await listAppFiles(root);
  const paths = files.map((f) => f.path);
  assert.equal(paths.length, 61, `expected 61 source files, got ${paths.length}`);
  assert.ok(!paths.some((p) => p.includes(".env") || p.endsWith(".db")), "secrets/data must not be listed");
  assert.ok(!paths.some((p) => p.startsWith("venv") || p.startsWith("node_modules")), "vendored code must not be listed");

  // Large repo switches to map mode.
  const context = await getAppContext(root);
  assert.equal(context.mode, "map");
  assert.equal(context.fileCount, 61);
  assert.ok(context.text.includes("login:5") || context.text.includes("/login:4"), "map must show the login route/function");

  // The map stays compact and names symbols with line numbers.
  const map = await buildRepoMap(root);
  assert.ok(map.length <= 15_000, `map too long: ${map.length}`);
  assert.ok(map.includes("Service0:1"), "map must include class symbols with line numbers");

  // Reads are numbered, capped, and refuse escapes and secrets.
  const read = await readFileRange(root, "app/main.py", 4, 5);
  assert.ok(read.includes('4: @app.route("/login"'), read);
  assert.ok((await readFileRange(root, "../../etc/passwd")).startsWith("Refused"));
  assert.ok((await readFileRange(root, ".env")).startsWith("Refused"));
  assert.ok((await readFileRange(root, "notes.db")).startsWith("Refused"));
  assert.ok((await readFileRange(root, "venv/lib/vendored.py")).startsWith("Refused"));
  assert.equal(safeAppPath(root, "/app/main.py"), join(root, "app", "main.py"), "leading slash is treated as relative");

  // Search finds real code and never searches secrets or vendored code.
  const hits = await searchCode(root, "def login");
  assert.ok(hits.includes("app/main.py:5"), hits);
  assert.ok((await searchCode(root, "sk-should-never")).startsWith("No matches"), "search must skip .env");
  assert.ok((await searchCode(root, "vendored")).startsWith("No matches"), "search must skip venv/node_modules");
  assert.ok((await searchCode(root, "(")).length > 0, "invalid regex falls back to plain text");

  // The real demo app is small, so the demo behaves exactly as before.
  const demo = await getAppContext(join(projectRoot, "demo-app"));
  assert.equal(demo.mode, "full", `demo-app should fit in ${FULL_MODE_MAX_CHARS} chars, got ${demo.totalChars}`);
  assert.ok(demo.text.includes("### app.py"), "full mode includes app.py");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("ALL CODEBASE TESTS PASSED");
