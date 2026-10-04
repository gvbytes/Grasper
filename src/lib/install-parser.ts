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
function splitSegments(command: string): string[] {
  return command.split(/&&|\|\||[;|]/).map((part) => part.trim()).filter(Boolean);
}

// Strip version specifiers and extras: "flask==3.0" -> "flask", "uvicorn[standard]" -> "uvicorn".
function cleanName(token: string): string {
  return token.split(/[=<>!~[\]]/)[0].trim();
}

function isFlag(token: string): boolean {
  return token.startsWith("-");
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
]);

// Collect package names from the words after "install"/"add".
function collectPackages(words: string[], raw: string, registry: "pypi" | "npm"): InstallRequest[] {
  const found: InstallRequest[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
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

// Find all install commands in one segment.
function parseSegment(segment: string): InstallRequest[] {
  const words = segment.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // pip install flask | pip3 install flask | python -m pip install flask | python3 -m pip install flask
  let pipWords: string[] | null = null;
  if ((words[0] === "pip" || words[0] === "pip3") && words[1] === "install") {
    pipWords = words.slice(2);
  } else if (
    (words[0] === "python" || words[0] === "python3") &&
    words[1] === "-m" && words[2] === "pip" && words[3] === "install"
  ) {
    pipWords = words.slice(4);
  }
  if (pipWords) return collectPackages(pipWords, segment, "pypi");

  // npm install react | npm i react | pnpm add react | yarn add react
  if (words[0] === "npm" && (words[1] === "install" || words[1] === "i")) {
    return collectPackages(words.slice(2), segment, "npm");
  }
  if ((words[0] === "pnpm" || words[0] === "yarn") && words[1] === "add") {
    return collectPackages(words.slice(2), segment, "npm");
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
