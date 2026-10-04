import { appendEvent } from "./lib/store.js";

// One-time script: record the seeded weakness honestly in the event log.
await appendEvent({
  ts: new Date().toISOString(),
  source: "builder",
  kind: "seeded_weakness",
  summary: "Seeded on purpose: SQL injection in the login query (app.py), to show the teach-and-fix loop.",
  detail: { file: "app.py", honest: true },
});
console.log("seed noted");
