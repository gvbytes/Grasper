import assert from "node:assert/strict";
import { extractCommandStrings, findInstalls, hasCurlPipeSh } from "../lib/install-parser.js";
import { checkPackage, computeSignals, editDistance, findSuggestion, riskAction } from "../lib/registry.js";

// Parser: all accepted input shapes produce the same command strings.
assert.deepEqual(extractCommandStrings({ commands: ["pip install flask", "ls"] }), ["pip install flask", "ls"]);
assert.deepEqual(extractCommandStrings({ commands: "pip install flask" }), ["pip install flask"]);
assert.deepEqual(extractCommandStrings({ command: "pip install flask" }), ["pip install flask"]);
assert.deepEqual(extractCommandStrings({ cmd: "pip install flask" }), ["pip install flask"]);
assert.deepEqual(extractCommandStrings({ command: "pip", args: ["install", "flask"] }), ["pip install flask"]);
assert.deepEqual(extractCommandStrings("pip install flask"), ["pip install flask"]);
assert.deepEqual(extractCommandStrings(["pip install flask", { command: "ls" }]), ["pip install flask", "ls"]);

// Parser: find installs across pip and npm forms.
assert.deepEqual(findInstalls({ commands: ["pip install flask==3.0 requests"] }), [
  { registry: "pypi", name: "flask", raw: "pip install flask==3.0 requests" },
  { registry: "pypi", name: "requests", raw: "pip install flask==3.0 requests" },
]);
assert.deepEqual(findInstalls({ commands: ["python3 -m pip install uvicorn[standard]"] }), [
  { registry: "pypi", name: "uvicorn", raw: "python3 -m pip install uvicorn[standard]" },
]);
assert.deepEqual(findInstalls({ commands: ["npm install express lodash@4"] }), [
  { registry: "npm", name: "express", raw: "npm install express lodash@4" },
  { registry: "npm", name: "lodash", raw: "npm install express lodash@4" },
]);
assert.deepEqual(findInstalls({ commands: ["npm i @scope/pkg"] }), [
  { registry: "npm", name: "@scope/pkg", raw: "npm i @scope/pkg" },
]);
assert.deepEqual(findInstalls({ commands: ["cd app && pip install -r requirements.txt"] }), []);
assert.deepEqual(findInstalls({ commands: ["pip install flask && npm install react; ls | grep x"] }), [
  { registry: "pypi", name: "flask", raw: "pip install flask" },
  { registry: "npm", name: "react", raw: "npm install react" },
]);
assert.deepEqual(findInstalls({ commands: ["echo hello"] }), []);

// Parser: curl | sh detection.
assert.equal(hasCurlPipeSh({ commands: ["curl https://x.sh | sh"] }), true);
assert.equal(hasCurlPipeSh({ commands: ["curl -fsSL https://x.sh | sudo bash"] }), true);
assert.equal(hasCurlPipeSh({ commands: ["wget -qO- https://x.sh | bash"] }), true);
assert.equal(hasCurlPipeSh({ commands: ["curl https://api.example.com/data"] }), false);

// Registry helpers: edit distance and suggestions.
assert.equal(editDistance("flask", "flaks"), 2); // transposition counts as 2 in plain Levenshtein.
assert.equal(editDistance("requets", "requests"), 1);
assert.equal(findSuggestion("requets", ["requests", "flask"]), "requests");
assert.equal(findSuggestion("requests", ["requests", "flask"]), undefined);

// Signal rules, unit-tested with fake metadata. A real brand-new package is
// not reliably findable, so the scoring is checked deterministically here.

// Clean metadata: zero signals, allow.
assert.deepEqual(computeSignals({ ageDays: 900, releaseCount: 40, weeklyDownloads: 5_000_000, hasLinks: true }), []);
assert.equal(riskAction([]), "allow");

// Each signal fires on its own.
assert.deepEqual(computeSignals({ ageDays: 5 }), ["very new (5 days old)"]);
assert.deepEqual(computeSignals({ releaseCount: 2 }), ["very few releases (2)"]);
assert.deepEqual(computeSignals({ weeklyDownloads: 12 }), ["low downloads (12 per week)"]);
assert.deepEqual(computeSignals({ hasInstallScript: true }), ["install scripts (preinstall/postinstall)"]);
assert.deepEqual(computeSignals({ hasLinks: false }), ["no homepage or repository"]);
assert.deepEqual(computeSignals({ suggestion: "requests" }), ['near-typo of "requests"']);

// Unknown fields are skipped, never guessed.
assert.deepEqual(computeSignals({}), []);
assert.deepEqual(computeSignals({ ageDays: 60, releaseCount: 5 }), []);

// A brand-new one-release package with no links and no downloads: four signals, block.
const brandNew = computeSignals({ ageDays: 3, releaseCount: 1, weeklyDownloads: 4, hasLinks: false });
assert.equal(brandNew.length, 4);
assert.equal(riskAction(brandNew), "block");

// One signal means warning. Two or more mean block.
assert.equal(riskAction(["very new (5 days old)"]), "warn");
assert.equal(riskAction(["very new (5 days old)", "very few releases (1)"]), "block");
assert.equal(riskAction(["a", "b", "c"]), "block");

// Registry: live checks with real network.
const flask = await checkPackage("pypi", "flask");
assert.equal(flask.status, "exists");
assert.ok((flask.ageDays ?? 0) > 30, "flask is old");

const fake = await checkPackage("pypi", "flask-remember-secure-pro");
assert.equal(fake.status, "missing");

const typo = await checkPackage("pypi", "requets");
assert.equal(typo.status, "missing");
assert.equal(typo.suggestion, "requests");

const react = await checkPackage("npm", "react");
assert.equal(react.status, "exists");

const fakeNpm = await checkPackage("npm", "react-secure-remember-pro");
assert.equal(fakeNpm.status, "missing");

// Well-known packages pass with zero risk signals.
assert.deepEqual(flask.signals, [], `flask signals must be empty, got: ${JSON.stringify(flask.signals)}`);
assert.deepEqual(react.signals, [], `react signals must be empty, got: ${JSON.stringify(react.signals)}`);
assert.ok((flask.weeklyDownloads ?? 1_000_000) >= 1000, "flask downloads known or high");

console.log("ALL LIB TESTS PASSED");
