import { describe, expect, it } from "vitest";
import { isReachableAuthFree, makeResolvePrimaryLink, mintLinkToken, redeemLinkToken, type Fetcher } from "../src/links.js";
import { InMemoryStores, runCadenceJob } from "../src/cadence.js";
import { SYSTEM_DEFAULTS } from "../src/defaults.js";
import type { Account, BoardEvent, Pass } from "../src/types.js";

const SECRET = "link-secret";

describe("link tokens", () => {
  it("mints and redeems a valid token", () => {
    const t = mintLinkToken("https://figma.com/proto/x", 24, SECRET);
    const r = redeemLinkToken(t, SECRET);
    expect(r).toEqual({ ok: true, url: "https://figma.com/proto/x" });
  });

  it("rejects tampered tokens", () => {
    const t = mintLinkToken("https://figma.com/proto/x", 24, SECRET);
    expect(redeemLinkToken(t.slice(0, -2) + "xx", SECRET).ok).toBe(false);
    expect(redeemLinkToken(t, "wrong-secret").ok).toBe(false);
  });

  it("expires tokens after TTL", () => {
    const past = new Date(Date.now() - 48 * 3_600_000);
    const t = mintLinkToken("https://x.test", 24, SECRET, past);
    const r = redeemLinkToken(t, SECRET);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("ttl 0 = no expiry", () => {
    const past = new Date("2020-01-01");
    const t = mintLinkToken("https://x.test", 0, SECRET, past);
    expect(redeemLinkToken(t, SECRET).ok).toBe(true);
  });
});

describe("isReachableAuthFree", () => {
  const fetcherOf = (status: number, finalUrl?: string): Fetcher =>
    async (url) => ({ ok: status >= 200 && status < 300, status, url: finalUrl ?? url });

  it("accepts a 200", async () => {
    expect(await isReachableAuthFree("https://ok.test", fetcherOf(200))).toBe(true);
  });
  it("rejects 401/403", async () => {
    expect(await isReachableAuthFree("https://x.test", fetcherOf(401))).toBe(false);
    expect(await isReachableAuthFree("https://x.test", fetcherOf(403))).toBe(false);
  });
  it("rejects a redirect that lands on a login wall", async () => {
    expect(await isReachableAuthFree("https://doc.test/d/1", fetcherOf(200, "https://doc.test/login?next=/d/1"))).toBe(false);
  });
  it("rejects network failure", async () => {
    const failing: Fetcher = async () => { throw new Error("ECONNREFUSED"); };
    expect(await isReachableAuthFree("https://down.test", failing)).toBe(false);
  });
});

describe("resolvePrimaryLink", () => {
  const rules = structuredClone(SYSTEM_DEFAULTS["client-delivery"].link);
  const event = (fields?: Record<string, string>): BoardEvent => ({
    type: "phase_change", boardId: "b", cardId: "c", cardTitle: "t",
    explicitDates: [], fields,
  });
  const okFetch: Fetcher = async (url) => ({ ok: true, status: 200, url });

  it("pulls the phase's board field, verifies, tokenizes", async () => {
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://statuspass.ai/l", fetcher: okFetch,
    });
    const link = await resolve("In Review", event({ review_url: "https://figma.com/proto/abc" }), rules);
    expect(link?.label).toBe("Review & approve");
    expect(link?.url).toMatch(/^https:\/\/statuspass\.ai\/l\//);
    const token = link!.url.split("/l/")[1];
    expect(redeemLinkToken(token, SECRET)).toEqual({ ok: true, url: "https://figma.com/proto/abc" });
  });

  it("returns null when the target is behind a login wall", async () => {
    const gated: Fetcher = async (url) => ({ ok: true, status: 200, url: "https://drive.test/login" });
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://statuspass.ai/l", fetcher: gated,
    });
    const link = await resolve("In Review", event({ review_url: "https://drive.test/doc/1" }), rules);
    expect(link).toBeNull(); // never ship a gated link
  });

  it("uses the fallback when the field is empty", async () => {
    const withFallback = { ...rules, fallback: { label: "Project home", url: "https://agency.test/acme" } };
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://statuspass.ai/l", fetcher: okFetch,
    });
    const link = await resolve("In Review", event({}), withFallback);
    expect(link?.label).toBe("Project home");
  });

  it("returns null when nothing resolves", async () => {
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://statuspass.ai/l", fetcher: okFetch,
    });
    expect(await resolve("In Review", event({}), rules)).toBeNull();
  });
});

describe("cadence job", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  function seed(lastUpdatedDaysAgo: number) {
    const stores = new InMemoryStores();
    const account: Account = { id: "a1", name: "Agency", defaults: {}, internalNames: [] };
    stores.accounts.set("a1", account);
    const pass: Pass = {
      id: "p1", accountId: "a1", profile: "client-delivery", recipientLabel: "Acme — CEO",
      boardId: "b1", currentPhase: "Build", currentRag: "green",
      lastUpdatedAt: daysAgo(lastUpdatedDaysAgo), overrides: {},
    };
    stores.passes.set("p1", pass);
    return { stores, pass };
  }

  it("does nothing for a fresh pass", async () => {
    const { stores } = seed(2);
    const delivered: any[] = [];
    const report = await runCadenceJob({
      stores,
      deliverPassUpdate: async (_p, payload) => { delivered.push(payload); },
      notifyOperator: async () => {},
    });
    expect(report).toEqual({ nudged: [], reassured: [] });
    expect(delivered).toHaveLength(0);
  });

  it("pushes the reassure state after reassureAfterDays (default 7)", async () => {
    const { stores } = seed(8);
    const delivered: any[] = [];
    const report = await runCadenceJob({
      stores,
      deliverPassUpdate: async (_p, payload) => { delivered.push(payload); },
      notifyOperator: async () => {},
    });
    expect(report.reassured).toEqual(["p1"]);
    expect(delivered[0].text).toContain("On track");
    // pushing reassure resets the clock — second run does nothing
    const again = await runCadenceJob({
      stores,
      deliverPassUpdate: async () => { throw new Error("should not push twice"); },
      notifyOperator: async () => {},
    });
    expect(again.reassured).toEqual([]);
  });

  it("nudges the operator after senderNudgeAfterDays (default 10)", async () => {
    const { stores } = seed(12);
    const nudges: string[] = [];
    const report = await runCadenceJob({
      stores,
      deliverPassUpdate: async () => {},
      notifyOperator: async (_id, msg) => { nudges.push(msg); },
    });
    expect(report.nudged).toEqual(["p1"]);
    expect(nudges[0]).toContain("Acme — CEO");
  });
});
