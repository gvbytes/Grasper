import { findInstalls, hasCurlPipeSh, type InstallRequest } from "../lib/install-parser.js";
import { checkPackage, riskAction } from "../lib/registry.js";
import {
  dependencyFileKind,
  extractPackagesFromWrite,
  findRequirementRefs,
  parseRequirementNames,
  readRequirementFile,
} from "../lib/requirements.js";
import { findSecrets, isEnvFile, type SecretMatch } from "../lib/secrets.js";
import type { GrasperEvent } from "../lib/store.js";

// The guard decides: block, warn, or allow. Pure logic lives here for tests.
// The hook wrapper in index.ts adds try/catch and the SDK types.

export type Decision = {
  topic: string; // Example: "framework", "database", "package".
  choice: string; // Example: "Flask", "SQLite".
  reason: string; // The agent's own words.
  inferred?: boolean; // True when the agent never stated a reason.
  packageName?: string; // Set when the decision is about one package.
};

export type GuardState = {
  decisions: Decision[];
  nagged: Set<string>; // Package keys already blocked once for a missing decision.
};

export function newGuardState(): GuardState {
  return { decisions: [], nagged: new Set() };
}

export type GuardVerdict = {
  action: "block" | "allow";
  reason?: string; // Goes to the model as the tool result when blocked.
  warnings: string[]; // Go to the model as appendContext and to the panel.
  events: GrasperEvent[]; // Panel entries for this tool call.
};

function packageKey(install: InstallRequest): string {
  return `${install.registry}:${install.name}`;
}

// True when some logged decision covers this package.
function hasDecisionFor(state: GuardState, install: InstallRequest): boolean {
  return state.decisions.some(
    (decision) =>
      decision.packageName === install.name ||
      decision.choice.toLowerCase().includes(install.name)
  );
}

// Check one install against the registry and the decision rule.
async function evaluateInstall(
  install: InstallRequest,
  state: GuardState,
  events: GrasperEvent[]
): Promise<{ blockReason?: string; warnings: string[] }> {
  const warnings: string[] = [];
  const check = await checkPackage(install.registry, install.name);

  if (check.status === "missing") {
    const hint = check.suggestion ? ` Did you mean "${check.suggestion}"?` : "";
    const reason =
      `Grasper blocked this install: "${install.name}" does not exist on ` +
      `${install.registry === "pypi" ? "PyPI" : "npm"}.${hint} ` +
      `AI agents sometimes invent package names. Pick a real, existing package instead.`;
    events.push({
      ts: new Date().toISOString(), source: "guard", kind: "block",
      summary: `BLOCKED install of "${install.name}": not on ${install.registry}`,
      detail: { registry: install.registry, package: install.name, suggestion: check.suggestion },
    });
    return { blockReason: reason, warnings };
  }

  if (check.status === "unknown") {
    const warning =
      `Grasper warning: could not reach the ${install.registry} registry to verify "${install.name}". ` +
      `Allowed, but double-check this package name.`;
    warnings.push(warning);
    events.push({
      ts: new Date().toISOString(), source: "guard", kind: "warn",
      summary: `WARNING: registry unreachable while checking "${install.name}"`,
      detail: { registry: install.registry, package: install.name },
    });
  } else {
    // The package exists. Score its risk signals. Two or more block. One warns.
    const signals = check.signals;
    const action = riskAction(signals);
    if (action === "block") {
      const reason =
        `Grasper blocked this install: "${install.name}" exists but shows ${signals.length} risk signals: ` +
        `${signals.join("; ")}. Fake or hijacked packages often look like this. ` +
        `Pick a well-known package instead.`;
      events.push({
        ts: new Date().toISOString(), source: "guard", kind: "block",
        summary: `BLOCKED install of "${install.name}": ${signals.join("; ")}`,
        detail: { registry: install.registry, package: install.name, signals },
      });
      return { blockReason: reason, warnings };
    }
    if (action === "warn") {
      const warning = `Grasper warning: "${install.name}" shows one risk signal: ${signals[0]}.`;
      warnings.push(warning);
      events.push({
        ts: new Date().toISOString(), source: "guard", kind: "warn",
        summary: `WARNING: package "${install.name}": ${signals[0]}`,
        detail: { registry: install.registry, package: install.name, signals },
      });
    }
  }

  // Decision enforcement: block once, then allow with an inferred decision.
  if (!hasDecisionFor(state, install)) {
    const key = packageKey(install);
    if (!state.nagged.has(key)) {
      state.nagged.add(key);
      const reason =
        `Grasper needs a reason first: call log_decision with topic "package", ` +
        `choice "${install.name}", and why you chose it. Then retry the install.`;
      events.push({
        ts: new Date().toISOString(), source: "guard", kind: "block",
        summary: `BLOCKED install of "${install.name}": call log_decision first`,
        detail: { registry: install.registry, package: install.name, enforcement: "log_decision" },
      });
      return { blockReason: reason, warnings };
    }
    const inferred: Decision = {
      topic: "package", choice: install.name,
      reason: "reason not stated", inferred: true, packageName: install.name,
    };
    state.decisions.push(inferred);
    events.push({
      ts: new Date().toISOString(), source: "guard", kind: "decision",
      summary: `Decision (inferred): install ${install.name} — reason not stated`,
      detail: { ...inferred },
    });
  }

  return { warnings };
}


// Evaluate a run_commands call: curl|sh, installs, requirements files, decision enforcement.
// baseDir is the session working directory. It resolves relative "-r <file>" paths.
export async function evaluateRunCommands(
  input: unknown,
  state: GuardState,
  baseDir: string = process.cwd()
): Promise<GuardVerdict> {
  const events: GrasperEvent[] = [];
  const warnings: string[] = [];

  if (hasCurlPipeSh(input)) {
    const reason =
      "Grasper blocked this command: piping curl/wget into a shell runs unknown code. " +
      "Download the script, read it, then run it.";
    events.push({
      ts: new Date().toISOString(), source: "guard", kind: "block",
      summary: "BLOCKED curl|sh command",
      detail: {},
    });
    return { action: "block", reason, warnings, events };
  }

  const installs = findInstalls(input);
  for (const install of installs) {
    const verdict = await evaluateInstall(install, state, events);
    warnings.push(...verdict.warnings);
    if (verdict.blockReason) {
      return { action: "block", reason: verdict.blockReason, warnings, events };
    }
  }

  // "pip install -r <file>": check every package named inside the file.
  for (const ref of findRequirementRefs(input, baseDir)) {
    const text = await readRequirementFile(ref.path);
    if (text === null) {
      const warning =
        `Grasper warning: could not read the requirements file "${ref.path}". ` +
        `Allowed, but check its package names yourself.`;
      warnings.push(warning);
      events.push({
        ts: new Date().toISOString(), source: "guard", kind: "warn",
        summary: `WARNING: could not read requirements file "${ref.path}"`,
        detail: { file: ref.path },
      });
      continue;
    }
    for (const name of parseRequirementNames(text)) {
      const check = await checkPackage("pypi", name);
      if (check.status === "missing") {
        const hint = check.suggestion ? ` Did you mean "${check.suggestion}"?` : "";
        const reason =
          `Grasper blocked this install: the requirements file "${ref.path}" lists ` +
          `"${name}", which does not exist on PyPI.${hint} ` +
          `Fix the file: remove or replace the invented package name.`;
        events.push({
          ts: new Date().toISOString(), source: "guard", kind: "block",
          summary: `BLOCKED install: requirements file lists missing package "${name}"`,
          detail: { file: ref.path, package: name, registry: "pypi", suggestion: check.suggestion },
        });
        return { action: "block", reason, warnings, events };
      }
    }
  }

  return { action: "allow", warnings, events };
}

// Pull the text content, file path, and kind out of editor or apply_patch inputs.
function extractWrite(input: unknown): { path?: string; text: string; isPatch: boolean } {
  if (!input || typeof input !== "object") {
    return { text: typeof input === "string" ? input : "", isPatch: false };
  }
  const record = input as Record<string, unknown>;
  if (typeof record.new_text === "string") {
    return {
      path: typeof record.path === "string" ? record.path : undefined,
      text: record.new_text,
      isPatch: false,
    };
  }
  if (typeof record.input === "string") {
    // apply_patch format. Paths appear in "*** Add File: <path>" lines.
    const pathMatch = /\*\*\*\s*(?:Add|Update) File:\s*(\S+)/.exec(record.input);
    return { path: pathMatch?.[1], text: record.input, isPatch: true };
  }
  return { text: "", isPatch: false };
}

function fileName(path: string | undefined): string {
  return (path ?? "").split("/").pop() ?? "(unknown file)";
}

// Only the lines a patch adds. Header lines starting with +++ are excluded.
function addedPatchLines(patch: string): string {
  return patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

// Evaluate a file write: dependency manifests first, then secrets. Async: registry checks.
export async function evaluateFileWrite(input: unknown): Promise<GuardVerdict> {
  const events: GrasperEvent[] = [];
  const warnings: string[] = [];
  const { path, text, isPatch } = extractWrite(input);

  // Dependency files: check every added package name before the write.
  const kind = dependencyFileKind(path);
  if (kind && text) {
    const content = isPatch ? addedPatchLines(text) : text;
    const packages = extractPackagesFromWrite(kind, content);
    for (const pkg of packages) {
      const check = await checkPackage(pkg.registry, pkg.name);
      if (check.status === "missing") {
        const registryName = pkg.registry === "pypi" ? "PyPI" : "npm";
        const reason =
          `Grasper blocked this file write: it adds "${pkg.name}" to ${fileName(path)}, ` +
          `but that package does not exist on ${registryName}. ` +
          `AI agents sometimes invent package names. Pick a real, existing package.`;
        events.push({
          ts: new Date().toISOString(), source: "guard", kind: "block",
          summary: `BLOCKED write to ${fileName(path)}: missing package "${pkg.name}"`,
          detail: { file: fileName(path), package: pkg.name, registry: pkg.registry, suggestion: check.suggestion },
        });
        return { action: "block", reason, warnings, events };
      }
    }
  }

  if (!text || isEnvFile(path)) return { action: "allow", warnings, events };

  const matches: SecretMatch[] = findSecrets(text);
  if (matches.length === 0) return { action: "allow", warnings, events };

  const kinds = matches.map((match) => `${match.kind} (${match.masked})`).join(", ");
  const reason =
    `Grasper blocked this file write: it contains a secret (${kinds}). ` +
    `Move the secret to a .env file and read it with an environment variable. Then retry.`;
  events.push({
    ts: new Date().toISOString(), source: "guard", kind: "block",
    summary: `BLOCKED secret in file write: ${kinds}`,
    detail: { path, matches },
  });
  return { action: "block", reason, warnings, events };
}
