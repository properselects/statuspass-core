// Anthropic adapter for ModelClient. The app never imports this directly —
// it's injected. Swapping providers = writing another adapter, zero app changes.

import type { ModelClient } from "../types.js";

export function createAnthropicClient(apiKey: string, baseUrl = "https://api.anthropic.com"): ModelClient {
  return {
    async complete({ system, user, model, maxTokens = 300 }) {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
      return data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    },
  };
}

// Routing is config, not code — per the build doc's model-abstraction layer.
export const DEFAULT_ROUTING = {
  routine: process.env.STATUSPASS_MODEL_ROUTINE ?? "claude-sonnet-4-6",
  frontier: process.env.STATUSPASS_MODEL_FRONTIER ?? "claude-opus-4-8",
};
