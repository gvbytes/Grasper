// Detects secrets written into code files. Hard block per spec.
// We never store the real secret. We store a masked form like "sk-a****".
// We never scan .env files. That is where secrets belong.

export type SecretMatch = {
  kind: string; // Example: "openai_key", "aws_key", "assignment".
  masked: string; // Safe to log. Never the real value.
};

// Placeholders are allowed. Beginners copy them from tutorials.
const PLACEHOLDERS = new Set([
  "changeme", "change-me", "your-key-here", "your_api_key", "your-api-key",
  "example", "example-key", "placeholder", "xxxx", "xxxxxxxx", "test",
  "dummy", "sample", "todo", "none", "null", "secret",
]);

const KEY_PATTERNS: { kind: string; regex: RegExp }[] = [
  { kind: "anthropic_key", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { kind: "openai_key", regex: /sk-[a-zA-Z0-9_-]{20,}/ },
  { kind: "aws_access_key", regex: /AKIA[0-9A-Z]{16}/ },
  { kind: "github_token", regex: /gh[pousr]_[a-zA-Z0-9]{20,}/ },
  { kind: "private_key", regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
];

// Assignments like api_key = "long value" or "secret": "long value".
// The name only needs to END in a secret word, so OPENAI_KEY and db_password count.
const ASSIGNMENT_REGEX =
  /[a-z0-9_]*(?:api[-_]?key|secret|token|password|passwd)[a-z0-9_]*\s*[:=]\s*["']([^"']{8,})["']/i;

// Mask a secret for logs: first 4 characters plus ****.
export function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 4)}****`;
}

function isPlaceholder(value: string): boolean {
  const lowered = value.toLowerCase().replace(/[_\s]/g, "-");
  if (PLACEHOLDERS.has(lowered)) return true;
  // Values that are clearly not real: repeated characters, env lookups.
  if (/^(.)\1+$/.test(value)) return true;
  if (/^(process\.env|os\.environ|env\(|getenv)/.test(value)) return true;
  return false;
}

// True when the path points at a .env file. We never scan those.
export function isEnvFile(path: string | undefined): boolean {
  if (!path) return false;
  const base = path.split("/").pop() ?? "";
  return base === ".env" || base.startsWith(".env.");
}

// Scan text for secrets. Returns all matches, masked.
export function findSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { kind, regex } of KEY_PATTERNS) {
    const match = text.match(regex);
    if (match) matches.push({ kind, masked: maskSecret(match[0]) });
  }
  for (const match of text.matchAll(new RegExp(ASSIGNMENT_REGEX, "gi"))) {
    const value = match[1];
    if (isPlaceholder(value)) continue;
    const name = match[0].split(/[:=]/)[0].trim();
    matches.push({ kind: "assignment", masked: `${name} = "${maskSecret(value)}"` });
  }
  return matches;
}
