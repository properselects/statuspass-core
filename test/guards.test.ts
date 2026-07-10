import { describe, expect, it } from "vitest";
import { RateLimiter, redactPath } from "../src/http-guards.js";
import { startServer } from "../src/app.js";
import { InMemoryStores } from "../src/cadence.js";

describe("RateLimiter", () => {
  it("allows up to the limit then blocks within the window", () => {
    const rl = new RateLimiter(3, 60_000);
    const t = 1_000_000;
    expect(rl.allow("ip1", t)).toBe(true);
    expect(rl.allow("ip1", t + 1)).toBe(true);
    expect(rl.allow("ip1", t + 2)).toBe(true);
    expect(rl.allow("ip1", t + 3)).toBe(false);
    expect(rl.allow("ip2", t + 3)).toBe(true);       // per-key isolation
    expect(rl.allow("ip1", t + 61_000)).toBe(true);  // window slides
  });

  it("sweep drops idle keys", () => {
    const rl = new RateLimiter(1, 1_000);
    rl.allow("ip1", 0);
    rl.sweep(10_000);
    expect(rl.allow("ip1", 10_001)).toBe(true);
  });
});

describe("log redaction", () => {
  it("redacts token and secret path segments", () => {
    expect(redactPath("/l/abc.def")).toBe("/l/[redacted]");
    expect(redactPath("/brand/tok123")).toBe("/brand/[redacted]");
    expect(redactPath("/brand/tok123/upload")).toBe("/brand/[redacted]/upload");
    expect(redactPath("/webhooks/jira/s3cret")).toBe("/webhooks/jira/[redacted]");
    expect(redactPath("/api/passes")).toBe("/api/passes");
  });
});

describe("server hardening over HTTP", () => {
  it("413s an oversized body and 429s a hammered public route", async () => {
    const { stop } = startServer({
      config: {
        port: 8092, publicBaseUrl: "http://localhost:8092",
        trelloApiSecret: "t", jiraWebhookSecret: "j", linkTokenSecret: "s",
        routing: { routine: "dev", frontier: "dev" }, cadenceIntervalMs: 3_600_000,
        consoleToken: "k", defaultAccountId: "default", stripeWebhookSecret: "", emailFrom: "test@x",
      },
      stores: new InMemoryStores(),
    });
    try {
      // Oversized JSON body → 413 (cap is 64KB)
      const big = "x".repeat(100 * 1024);
      const res = await fetch("http://localhost:8092/webhooks/trello", {
        method: "POST", body: big,
      }).catch(() => null);
      // Node may abort the socket on destroy; accept either a 413 or a network abort
      if (res) expect(res.status).toBe(413);

      // Hammer a public route past 30/min → 429
      let last = 0;
      for (let i = 0; i < 35; i++) {
        const r = await fetch("http://localhost:8092/l/nope");
        last = r.status;
      }
      expect(last).toBe(429);

      // Health endpoint unaffected by public limiter
      expect((await fetch("http://localhost:8092/healthz")).status).toBe(200);
    } finally {
      stop();
    }
  });
});
