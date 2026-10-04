// Extracts package installs from raw run_commands inputs.
// Hooks see the raw model input, so we handle every accepted shape.
// Shapes from docs/sdk-facts.md:
//   { commands: string[] }, { commands: string }, { command: string },
//   { cmd: string }, { command, args }, a bare string, or an array.

export type InstallRequest = {
  registry: "pypi" | "npm";
  name: string; // Normalized package name.
  raw: string; // The token as typed, for messages.
};

// Collect every command string from any accepted input shape.
export function extractCommandStrings(input: unknown): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) {
    return input.flatMap((item) => extractCommandStrings(item));
  }
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (Array.isArray(record.commands)) return record.commands.flatMap((c) => extractCommandStrings(c));
    if (typeof record.commands === "string") return [record.commands];
    if (typeof record.command === "string") {
      const args = Array.isArray(record.args) ? record.args.join(" ") : "";
      return [args ? `${record.command} ${args}` : record.command];
    }
    if (typeof record.cmd === "string") return [record.cmd];
  }
  return [];
}

// Split one command string into segments on &&, ;, ||, |.
export function splitSegments(command: string): string[] {
  return command.split(/&&|\|\||[;|]/).map((part) => part.trim()).filter(Boolean);
}

// Strip version specifiers and extras: "flask==3.0" -> "flask", "uvicorn[standard]" -> "uvicorn".
function cleanName(token: string): string {
  return token.split(/[=<>!~[\]]/)[0].trim();
}

function isFlag(token: string): boolean {
  return token.startsWith("-");
}

// Shell redirects are not package names: "2>&1", ">log.txt", ">>", "&>".
function isRedirect(token: string): boolean {
  return /^(\d*|&)[<>]/.test(token);
}

// A bare redirect operator takes the next word as its target: "> log.txt", "2> err.txt".
function redirectTakesNext(token: string): boolean {
  return /^(\d*|&)?(<|>{1,2})$/.test(token);
}

// Normalize a PyPI name: lowercase, runs of -_. become -.
function normalizePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

// Flags whose NEXT token is a value, not a package name. Example: -r requirements.txt.
const VALUE_FLAGS = new Set([
  "-r", "--requirement", "-c", "--constraint", "-e", "--editable",
  "-i", "--index-url", "--extra-index-url", "-f", "--find-links",
  "-t", "--target", "-d", "--download", "--prefix", "--root",
  "--registry", "--cache-dir", "--proxy",
  "-p", "--package", // npx -p <pkg>: the value is a package, not the command.
]);

// Strip matching quotes around a token: 'Flask[async]>=3' -> Flask[async]>=3.
export function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return token.slice(1, -1);
    }
  }
  return token;
}

// Collect package names from the words after "install"/"add".
function collectPackages(words: string[], raw: string, registry: "pypi" | "npm"): InstallRequest[] {
  const found: InstallRequest[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = stripQuotes(words[i]);
    if (isRedirect(word)) {
      if (redirectTakesNext(word)) i++;
      continue;
    }
    if (isFlag(word)) {
      // Skip the flag value too, unless the flag already carries it (--flag=value).
      if (!word.includes("=") && VALUE_FLAGS.has(word)) i++;
      continue;
    }
    if (word.endsWith(".txt") || word.endsWith(".in")) continue; // Requirements files.
    let name: string;
    if (registry === "npm") {
      // Strip npm version/tag suffix, but keep the @scope prefix.
      name = word.startsWith("@") ? word : word.split("@")[0];
    } else {
      name = cleanName(word);
    }
    name = cleanName(name);
    if (!name) continue;
    found.push({ registry, name: registry === "pypi" ? normalizePypi(name) : name.toLowerCase(), raw });
  }
  return found;
}

// Program name without its path or version suffix:
// "venv/bin/pip" -> "pip", "pip3.14" -> "pip", "/usr/bin/python3" -> "python".
function programName(word: string): string {
  const base = stripQuotes(word).split("/").pop() ?? "";
  if (/^pip\d*(\.\d+)?$/.test(base)) return "pip";
  if (/^python\d*(\.\d+)?$/.test(base)) return "python";
  return base;
}

// Drop leading "sudo", "env" and "VAR=value" words: "sudo PIP_NO_CACHE=1 pip install x" -> "pip install x".
function stripPrefixes(words: string[]): string[] {
  let i = 0;
  while (i < words.length && (words[i] === "sudo" || words[i] === "env" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) i++;
  return words.slice(i);
}

// Words after "install", skipping pip's own flags before it: "pip -q install x" -> ["x"].
function afterInstall(words: string[], start: number): string[] | null {
  for (let i = start; i < words.length; i++) {
    if (words[i] === "install") return words.slice(i + 1);
    if (!isFlag(words[i])) return null;
    if (!words[i].includes("=") && VALUE_FLAGS.has(words[i])) i++;
  }
  return null;
}

// Find all install commands in one segment.
function parseSegment(segment: string): InstallRequest[] {
  const words = stripPrefixes(segment.split(/\s+/).filter(Boolean));
  if (words.length === 0) return [];
  const program = programName(words[0]);

  // pip install flask | venv/bin/pip install flask | pip3.14 install flask | python -m pip install flask
  let pipWords: string[] | null = null;
  if (program === "pip") {
    pipWords = afterInstall(words, 1);
  } else if (program === "python" && words[1] === "-m" && words[2] === "pip") {
    pipWords = afterInstall(words, 3);
  }
  if (pipWords) return collectPackages(pipWords, segment, "pypi");

  // uv pip install flask | uv add flask
  if (program === "uv" && words[1] === "pip" && words[2] === "install") {
    return collectPackages(words.slice(3), segment, "pypi");
  }
  if (program === "uv" && words[1] === "add") {
    return collectPackages(words.slice(2), segment, "pypi");
  }

  // npm install react | npm i react | pnpm add react | yarn add react
  if (program === "npm" && (words[1] === "install" || words[1] === "i")) {
    return collectPackages(words.slice(2), segment, "npm");
  }
  if ((program === "pnpm" || program === "yarn") && words[1] === "add") {
    return collectPackages(words.slice(2), segment, "npm");
  }

  // npx <pkg> | pnpm dlx <pkg> | bunx <pkg>: the first non-flag word is the package.
  if (program === "npx" || program === "bunx") return parseNpxStyle(words, 1, segment);
  if (program === "pnpm" && words[1] === "dlx") return parseNpxStyle(words, 2, segment);

  return [];
}

// Tools like npx download a package, then run it. Only the package name counts.
// Everything after it is a command argument, not another package.
function parseNpxStyle(words: string[], startIndex: number, raw: string): InstallRequest[] {
  for (let i = startIndex; i < words.length; i++) {
    const word = stripQuotes(words[i]);
    if (isFlag(word)) {
      if (!word.includes("=") && VALUE_FLAGS.has(word)) i++;
      continue;
    }
    const name = cleanName(word.startsWith("@") ? word : word.split("@")[0]);
    if (!name) return [];
    return [{ registry: "npm", name: name.toLowerCase(), raw }];
  }
  return [];
}

// Main entry: all install requests in a raw run_commands input.
export function findInstalls(input: unknown): InstallRequest[] {
  const commands = extractCommandStrings(input);
  return commands.flatMap((command) => splitSegments(command).flatMap(parseSegment));
}

// Detect "curl ... | sh" and "wget ... | sh" style pipes. Hard block per spec.
export function hasCurlPipeSh(input: unknown): boolean {
  return extractCommandStrings(input).some((command) =>
    /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/.test(command)
  );
}
