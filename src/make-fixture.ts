import { writeJson } from "./lib/store.js";
import type { Lesson } from "./lib/teacher.js";

// Development fixture for the panel. Also the demo fallback if the API is down.
// The real teacher output replaces this file when run-teacher succeeds.

const lessons: Lesson[] = [
  {
    id: "lesson-sql-injection",
    title: "SQL injection in the login query",
    risk_level: "high",
    security: true,
    body: [
      "The login query is built with an f-string. Attacker input becomes SQL code.",
      "Typing ' OR '1'='1' -- as the username makes the condition always true.",
      "The rest of the query is commented out. No password is checked. The attacker is logged in.",
      "The fix: use a parameterized query with ? placeholders. The database treats input as data, never as code.",
      "Then check the password with check_password_hash in Python.",
    ].join("\n"),
    file_refs: [{ path: "app.py", lines: "119-121" }],
    reason_check:
      "The code comment says this was seeded on purpose for the demo. The builder's other queries (register, notes) use ? parameters, so the agent knows the safe pattern.",
    question: "Explain how the payload ' OR '1'='1' -- bypasses the login, and how a parameterized query stops it.",
  },
  {
    id: "lesson-debug-mode",
    title: "Flask runs with debug=True",
    risk_level: "high",
    security: true,
    body: [
      "app.run(debug=True) turns on the Werkzeug debugger.",
      "The debugger shows a Python console in the browser when an error happens.",
      "Anyone who can reach the app can run arbitrary Python code on your machine.",
      "This is fine on your own laptop while developing. It must never be on in a deployed app.",
      "The fix: remove debug=True, or read it from an environment variable that is off in production.",
    ].join("\n"),
    file_refs: [{ path: "app.py", lines: "184" }],
    reason_check: "No decision was logged about debug mode. The agent added it by habit for local development.",
    question: "Why is debug=True dangerous on a public server, and when is it acceptable?",
  },
  {
    id: "lesson-framework",
    title: "Why the agent picked Flask and SQLite",
    risk_level: "low",
    security: false,
    body: [
      "The agent chose Flask because the task asked for a small Python web app.",
      "Flask gives routing, sessions, and templates in one package, with no build step.",
      "It chose SQLite through the sqlite3 standard library. No database server is needed.",
      "The trade-off: SQLite is one file. It is perfect for a demo, but many users writing at once can be slow.",
    ].join("\n"),
    file_refs: [{ path: "app.py", lines: "1-22" }, { path: "requirements.txt", lines: "1-2" }],
    reason_check: "The logged reason matches the code: Flask routing and sqlite3 are really used, and there is no build step.",
    question: "In your own words: why Flask and SQLite for this app, and what is the trade-off of SQLite?",
  },
  {
    id: "lesson-password-hashing",
    title: "Passwords are hashed, not stored",
    risk_level: "medium",
    security: true,
    body: [
      "The register route stores generate_password_hash(password), not the password.",
      "A hash is a one-way scramble. You cannot turn it back into the password.",
      "At login, check_password_hash compares the typed password with the stored hash.",
      "If the database leaks, attackers get hashes, not passwords.",
      "Note: the seeded SQL injection skips the password check entirely. Hashing alone is not enough.",
    ].join("\n"),
    file_refs: [{ path: "app.py", lines: "93-95" }, { path: "app.py", lines: "122" }],
    reason_check: "The logged auth decision says hashing ships with Flask via werkzeug. The code confirms it: werkzeug.security is imported and used.",
    question: "What is stored in the database instead of the password, and why does that protect users if the database leaks?",
  },
];

await writeJson("lessons", { lessons });
console.log(`fixture: wrote ${lessons.length} lessons (replace with real teacher output)`);
