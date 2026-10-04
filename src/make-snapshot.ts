import { cp, mkdir, rm } from "node:fs/promises";
import { dataDir, snapshotDir } from "./lib/store.js";

// Copies the live data dir to the snapshot dir. The panel's demo mode reads it.
await rm(snapshotDir, { recursive: true, force: true });
await mkdir(snapshotDir, { recursive: true });
await cp(dataDir, snapshotDir, { recursive: true });
console.log(`snapshot saved: ${snapshotDir}`);
