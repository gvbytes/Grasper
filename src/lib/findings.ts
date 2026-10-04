// Shared finding shape. The scan writes findings. The fix step updates them.
// The teacher reads them. It never invents new ones.

export type Finding = {
  id: string; // Stable id, like "bandit-B608-app.py-42" or "custom-missing-env-gitignore".
  severity: "high" | "medium" | "low";
  title: string; // One line.
  file?: string; // Path relative to demo-app/.
  line?: number;
  source: "bandit" | "custom";
  detail: string;
  status: "open" | "fixed";
};
