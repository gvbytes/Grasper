import { demoAppDir } from "./store.js";
import { getAppContext } from "./codebase.js";

// Kept for older callers. Returns the full source for small apps,
// or the repo map for large ones. New code should use getAppContext directly.
export async function readAppSource(): Promise<string> {
  return (await getAppContext(demoAppDir)).text;
}
