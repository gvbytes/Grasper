// Lesson and grade shapes. Agent-agnostic. Every adapter and the panel share them.
// The teacher (any adapter) writes lessons. The grader writes grades. The panel reads both.

export type Lesson = {
  id: string;
  title: string;
  risk_level: "high" | "medium" | "low";
  security: boolean; // Security lessons weigh double in the score.
  body: string; // The lesson text. Plain words. Short sentences.
  file_refs: { path: string; lines: string }[]; // Example: { path: "app.py", lines: "40-48" }.
  reason_check: string; // Does the agent's logged reason match the code? Say how.
  question: string; // The explain-back question for the user.
};

export type Grade = {
  score: number; // 0 to 100.
  got_right: string[];
  missed: string[];
};
