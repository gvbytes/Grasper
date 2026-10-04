import type { Finding } from "./findings.js";
import type { Grade, Lesson } from "./teacher.js";

// One readiness number, 0 to 100, shown big on the panel.
// Score = weighted share of passed lessons, minus 15 per open high finding.
// Security lessons weigh double. A lesson passes at grade >= 60.
// The score only gets high after real fixes, not just understanding.

export const PASS_MARK = 60;
export const HIGH_FINDING_PENALTY = 15;

export function computeScore(input: {
  lessons: Lesson[];
  grades: Record<string, Grade>;
  findings: Finding[];
}): number {
  const { lessons, grades, findings } = input;

  let totalWeight = 0;
  let passedWeight = 0;
  for (const lesson of lessons) {
    const weight = lesson.security ? 2 : 1;
    totalWeight += weight;
    const grade = grades[lesson.id];
    if (grade && grade.score >= PASS_MARK) passedWeight += weight;
  }

  const base = totalWeight === 0 ? 0 : (100 * passedWeight) / totalWeight;
  const openHigh = findings.filter((f) => f.severity === "high" && f.status === "open").length;
  const score = base - HIGH_FINDING_PENALTY * openHigh;
  return Math.max(0, Math.min(100, Math.round(score)));
}
