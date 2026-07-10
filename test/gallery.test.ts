import { describe, expect, it } from "vitest";
import { mintGalleryToken, redeemGalleryToken, renderGalleryPage, newDeliverable } from "../src/gallery.js";
import { mintBrandingToken, redeemBrandingToken } from "../src/branding.js";
import { redeemLinkToken } from "../src/links.js";
import { makeResolvePrimaryLink, type Fetcher } from "../src/links.js";
import { SYSTEM_DEFAULTS } from "../src/defaults.js";
import { startServer } from "../src/app.js";
import { InMemoryStores } from "../src/cadence.js";
import { InMemoryBrandingStore } from "../src/branding.js";
import type { BoardEvent } from "../src/types.js";

const SECRET = "link-secret";

describe("gallery tokens", () => {
  it("mints, redeems, expires, and is kind-isolated", () => {
    const t = mintGalleryToken("p1", 24, SECRET);
    expect(redeemGalleryToken(t, SECRET)).toEqual({ ok: true, passId: "p1" });
    expect(redeemBrandingToken(t, SECRET).ok).toBe(false);
    expect(redeemLinkToken(t, SECRET).ok).toBe(false);
    expect(redeemGalleryToken(mintBrandingToken("p1", 24, SECRET), SECRET).ok).toBe(false);
    const old = mintGalleryToken("p1", 1, SECRET, new Date(Date.now() - 2 * 3_600_000));
    expect(redeemGalleryToken(old, SECRET)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("gallery link source in the resolver", () => {
  const rules = structuredClone(SYSTEM_DEFAULTS["client-delivery"].link);
  const event: BoardEvent = { type: "delivered", boardId: "b", cardId: "c", cardTitle: "t", explicitDates: [] };
  const okFetch: Fetcher = async (url) => ({ ok: true, status: 200, url });

  it("Delivered resolves to a tokenized gallery URL when deliverables exist", async () => {
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://x/l", galleryBaseUrl: "https://x/g",
      hasDeliverables: async () => true, fetcher: okFetch,
    });
    const link = await resolve("Delivered", event, rules, "p1");
    expect(link?.label).toBe("View deliverables");
    expect(link?.url).toMatch(/^https:\/\/x\/g\//);
    const token = link!.url.split("/g/")[1];
    expect(redeemGalleryToken(token, SECRET)).toEqual({ ok: true, passId: "p1" });
  });

  it("an empty gallery never ships a broken promise", async () => {
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://x/l", galleryBaseUrl: "https://x/g",
      hasDeliverables: async () => false, fetcher: okFetch,
    });
    expect(await resolve("Delivered", event, rules, "p1")).toBeNull();
    // with a fallback configured, it falls through instead
    const withFb = { ...rules, fallback: { label: "Project home", url: "https://agency.test/acme" } };
    const link = await resolve("Delivered", event, withFb, "p1");
    expect(link?.label).toBe("Project home");
  });
});

describe("gallery page rendering", () => {
  it("renders images, links, and the empty state", () => {
    const items = [
      newDeliverable("p1", { kind: "image", title: "Final homepage", assetId: "a1" }),
      newDeliverable("p1", { kind: "link", title: "Live demo", url: "https://demo.acme.test/app" }),
    ];
    const html = renderGalleryPage(
      { passId: "p1", title: "Acme Website", operatorName: "Proper Selects", brandColor: "#1B2A4A" },
      items, "https://x/assets",
    );
    expect(html).toContain("Acme Website");
    expect(html).toContain("https://x/assets/a1");
    expect(html).toContain("demo.acme.test");
    expect(html).toContain("#1B2A4A");
    const empty = renderGalleryPage(null, [], "https://x/assets");
    expect(empty).toContain("Deliverables will appear here");
  });
});

describe("demo shelf behavior", () => {
  const rules = structuredClone(SYSTEM_DEFAULTS["client-delivery"].link);
  const okFetch: Fetcher = async (url) => ({ ok: true, status: 200, url });

  it("gallery is reachable from ANY phase once populated (phase source empty)", async () => {
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://x/l", galleryBaseUrl: "https://x/g",
      hasDeliverables: async () => true, fetcher: okFetch,
    });
    // Build phase, no staging_url on the board → gallery steps in
    const event: BoardEvent = { type: "deliverable_added", boardId: "b", cardId: "c", cardTitle: "t", explicitDates: [] };
    const link = await resolve("Build", event, rules, "p1");
    expect(link?.url).toMatch(/^https:\/\/x\/g\//);
    expect(link?.label).toBe("View demos & deliverables");
  });

  it("phase's own link still wins over the gallery when present", async () => {
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://x/l", galleryBaseUrl: "https://x/g",
      hasDeliverables: async () => true, fetcher: okFetch,
    });
    const event: BoardEvent = { type: "phase_change", boardId: "b", cardId: "c", cardTitle: "t",
      explicitDates: [], fields: { staging_url: "https://staging.acme.test" } };
    const link = await resolve("Build", event, rules, "p1");
    expect(link?.url).toMatch(/^https:\/\/x\/l\//); // tokenized staging link, not gallery
  });

  it("pipeline-minted gallery tokens never expire (living shelf)", async () => {
    const resolve = makeResolvePrimaryLink({
      tokenSecret: SECRET, redeemBaseUrl: "https://x/l", galleryBaseUrl: "https://x/g",
      hasDeliverables: async () => true, fetcher: okFetch,
    });
    const event: BoardEvent = { type: "delivered", boardId: "b", cardId: "c", cardTitle: "t", explicitDates: [] };
    const link = await resolve("Delivered", event, rules, "p1");
    expect(link?.expiresAt).toBeUndefined();
    const token = link!.url.split("/g/")[1];
    // redeem far in the future
    const future = new Date(Date.now() + 5 * 365 * 86_400_000);
    expect(redeemGalleryToken(token, SECRET, future)).toEqual({ ok: true, passId: "p1" });
  });

  it("gallery renders newest first", () => {
    const older = { ...newDeliverable("p1", { kind: "link", title: "Sprint 1 demo", url: "https://loom.com/1" }), addedAt: "2026-06-01T00:00:00Z" };
    const newer = { ...newDeliverable("p1", { kind: "link", title: "Sprint 6 demo", url: "https://loom.com/6" }), addedAt: "2026-07-07T00:00:00Z" };
    const html = renderGalleryPage(null, [older, newer], "https://x/assets");
    expect(html.indexOf("Sprint 6 demo")).toBeLessThan(html.indexOf("Sprint 1 demo"));
    expect(html).toContain("Jul 7");
  });
});

describe("deliverables end to end", () => {
  it("add link + upload image via API, gallery page serves both", async () => {
    const stores = new InMemoryStores();
    const brandingStore = new InMemoryBrandingStore();
    stores.accounts.set("default", { id: "default", name: "A", defaults: {}, internalNames: [] });
    stores.passes.set("p1", {
      id: "p1", accountId: "default", profile: "client-delivery", recipientLabel: "Acme — CEO",
      boardId: "internal", currentPhase: "Delivered", lastUpdatedAt: new Date().toISOString(), overrides: {},
    });
    const { stop } = startServer({
      config: {
        port: 8091, publicBaseUrl: "http://localhost:8091",
        trelloApiSecret: "t", jiraWebhookSecret: "j", linkTokenSecret: SECRET,
        routing: { routine: "dev", frontier: "dev" }, cadenceIntervalMs: 3_600_000,
        consoleToken: "k", defaultAccountId: "default", stripeWebhookSecret: "", emailFrom: "test@x",
      },
      stores, brandingStore,
    });
    try {
      const auth = { authorization: "Bearer k" };
      // add a link deliverable
      const add = await fetch("http://localhost:8091/api/passes/p1/deliverables", {
        method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ kind: "link", title: "Live demo", url: "https://demo.test/app" }),
      });
      expect(add.status).toBe(201);
      // upload an image deliverable
      const png = Buffer.from("89504e470d0a1a0a", "hex");
      const up = await fetch("http://localhost:8091/api/passes/p1/deliverables/upload?title=Final%20shot", {
        method: "POST", headers: { ...auth, "content-type": "image/png" }, body: new Uint8Array(png),
      });
      expect(up.status).toBe(201);
      // list returns both + a gallery url
      const list = await (await fetch("http://localhost:8091/api/passes/p1/deliverables", { headers: auth })).json() as any;
      expect(list.items).toHaveLength(2);
      // the public gallery page serves without auth
      const page = await fetch(list.galleryUrl);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Live demo");
      expect(html).toContain("Final shot");
      // adding a deliverable fires a pass update through the pipeline
      const add2 = await fetch("http://localhost:8091/api/passes/p1/deliverables", {
        method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ kind: "link", title: "Sprint 2 demo", url: "https://loom.com/2" }),
      });
      const body2 = await add2.json() as any;
      // first add shipped; this one may hit the 60-min cooldown — both are correct behavior
      expect(["shipped", "skipped"]).toContain(body2.outcome.action);

      // bad kind rejected
      const bad = await fetch("http://localhost:8091/api/passes/p1/deliverables", {
        method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ kind: "link", title: "x", url: "javascript:alert(1)" }),
      });
      expect(bad.status).toBe(400);
    } finally {
      stop();
    }
  });
});
