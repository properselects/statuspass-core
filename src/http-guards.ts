// HTTP hardening primitives: bounded body reading, per-IP rate limiting,
// and structured request logging. Deliberately dependency-free.

import type { IncomingMessage } from "node:http";

// ── Bounded body reader ──────────────────────────────────────
// Every route that buffers a body MUST go through this. Rejects the moment
// the cap is exceeded rather than after buffering (memory-exhaustion guard).

export class BodyTooLarge extends Error {}

export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new BodyTooLarge(`body exceeded ${maxBytes} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export const BODY_LIMITS = {
  json: 64 * 1024,        // webhooks, console API, branding fields
  upload: 2 * 1024 * 1024 + 1024, // images (2MB + slack for the check's message)
} as const;

// ── Sliding-window rate limiter ──────────────────────────────
// In-memory, per key (usually IP+bucket). Public unauthenticated routes
// (/brand, /l, /assets) get tight limits; webhooks looser (vendors retry).

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  /** Call occasionally to drop idle keys (prevents unbounded map growth). */
  sweep(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [k, arr] of this.hits) {
      const live = arr.filter((t) => t > cutoff);
      if (live.length === 0) this.hits.delete(k);
      else this.hits.set(k, live);
    }
  }
}

export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

// ── Request logger ───────────────────────────────────────────
// One line per request: method path status ms ip. Tokens/secrets are path
// segments on /l, /brand, /webhooks/jira — redact them.

const REDACT = [/^(\/l\/)[^/]+/, /^(\/brand\/)[^/]+/, /^(\/webhooks\/jira\/)[^/]+/];

export function redactPath(pathname: string): string {
  for (const re of REDACT) {
    if (re.test(pathname)) return pathname.replace(re, "$1[redacted]");
  }
  return pathname;
}

export function logRequest(method: string, pathname: string, status: number, startedAt: number, ip: string): void {
  console.log(`[req] ${method} ${redactPath(pathname)} ${status} ${Date.now() - startedAt}ms ${ip}`);
}
