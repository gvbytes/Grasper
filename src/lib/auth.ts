import { RuntimeOAuthTokenManager } from "@cline/sdk";

// Resolve the cline-pass API key from the stored Cline login.
// Call this at the start of each teacher run. Do not cache the key.
// The teacher Agent cannot read the stored login itself.
export async function getClinePassKey(): Promise<string> {
  try {
    const manager = new RuntimeOAuthTokenManager();
    const resolved = await manager.resolveProviderApiKey({ providerId: "cline-pass" });
    if (!resolved?.apiKey) {
      throw new Error("No Cline login found. Sign in again in the Cline app, then retry.");
    }
    return resolved.apiKey;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("requires re-authentication") || message.includes("No Cline login found")) {
      throw new Error(`Grasper needs a fresh Cline login. ${message}`);
    }
    throw error;
  }
}
