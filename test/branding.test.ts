import { describe, expect, it } from "vitest";
import {
  InMemoryBrandingStore, handleAssetUpload, handleBrandingSubmit,
  mintBrandingToken, redeemBrandingToken, toPassBranding,
} from "../src/branding.js";
import { mintLinkToken, redeemLinkToken } from "../src/links.js";
import { startServer } from "../src/app.js";
import { InMemoryStores } from "../src/cadence.js";

const SECRET = "link-secret";

describe("branding tokens", () => {
  it("mints and redeems, carrying the passId", () => {
    const t = mintBrandingToken("p1", 72, SECRET);
    expect(redeemBrandingToken(t, SECRET)).toEqual({ ok: true, passId: "p1" });
  });

  it("expires", () => {
    const past = new Date(Date.now() - 100 * 3_600_000);
    const t = mintBrandingToken("p1", 72, SECRET, past);
    expect(redeemBrandingToken(t, SECRET)).toEqual({ ok: false, reason: "expired" });
  });

  it("kind isolation: a link token is not a branding token and vice versa", () => {
    const linkTok = mintLinkToken("https://x.test", 24, SECRET);
    expect(redeemBrandingToken(linkTok, SECRET).ok).toBe(false);
    const brandTok = mintBrandingToken("p1", 72, SECRET);
    expect(redeemLinkToken(brandTok, SECRET).ok).toBe(false);
  });
});

describe("upload + submit validation", () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");

  it("accepts a valid logo and wires it into branding", async () => {
    const store = new InMemoryBrandingStore();
    const r = await handleAssetUpload(store, "p1", "logo", "image/png", png);
    expect(r.ok).toBe(true);
    const branding = await store.getBranding("p1");
    expect(branding?.logoAssetId).toBeDefined();
  });

  it("rejects wrong content types and oversized files", async () => {
    const store = new InMemoryBrandingStore();
    expect((await handleAssetUpload(store, "p1", "logo", "image/svg+xml", png)).ok).toBe(false);
    expect((await handleAssetUpload(store, "p1", "logo", "application/pdf", png)).ok).toBe(false);
    const big = Buffer.alloc(3 * 1024 * 1024);
    expect((await handleAssetUpload(store, "p1", "logo", "image/png", big)).ok).toBe(false);
  });

  it("validates hex color and caps title length", async () => {
    const store = new InMemoryBrandingStore();
    expect((await handleBrandingSubmit(store, "p1", { brandColor: "blue" })).ok).toBe(false);
    expect((await handleBrandingSubmit(store, "p1", { brandColor: "#1B2A4A", title: "x".repeat(100) })).ok).toBe(true);
    const b = await store.getBranding("p1");
    expect(b?.title).toHaveLength(60);
    expect(b?.brandColor).toBe("#1B2A4A");
  });

  it("toPassBranding produces hosted asset URLs", async () => {
    const store = new InMemoryBrandingStore();
    await handleAssetUpload(store, "p1", "logo", "image/png", png);
    await handleBrandingSubmit(store, "p1", { title: "Acme Website", brandColor: "#1B2A4A" });
    const record = (await store.getBranding("p1"))!;
    const branding = toPassBranding({ ...record, operatorName: "Proper Selects" }, "https://statuspass.ai");
    expect(branding.logoUrl).toMatch(/^https:\/\/statuspass\.ai\/assets\//);
    expect(branding.brandColor).toBe("#1B2A4A");
  });
});

describe("intake flow over HTTP", () => {
  it("serves the page, accepts upload + submit, serves the asset", async () => {
    const config = {
      port: 8098, publicBaseUrl: "http://localhost:8098",
      trelloApiSecret: "t", jiraWebhookSecret: "jira-secret", linkTokenSecret: SECRET,
      routing: { routine: "dev", frontier: "dev" }, cadenceIntervalMs: 3_600_000,
      consoleToken: "console-key", defaultAccountId: "default", stripeWebhookSecret: "", emailFrom: "test@x",
    };
    const { stop, brandingStore } = startServer({ config, stores: new InMemoryStores() });
    try {
      const token = mintBrandingToken("p1", 72, SECRET);

      const page = await fetch(`http://localhost:8098/brand/${token}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Set up your project pass");

      const png = Buffer.from("89504e470d0a1a0a", "hex");
      const up = await fetch(`http://localhost:8098/brand/${token}/upload?slot=logo`, {
        method: "POST", headers: { "content-type": "image/png" }, body: png,
      });
      expect(up.status).toBe(200);
      const { assetId } = await up.json() as { assetId: string };

      const submit = await fetch(`http://localhost:8098/brand/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Acme Website", brandColor: "#1B2A4A" }),
      });
      expect(submit.status).toBe(200);

      const asset = await fetch(`http://localhost:8098/assets/${assetId}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toBe("image/png");

      const bad = await fetch(`http://localhost:8098/brand/not-a-token`);
      expect(bad.status).toBe(404);

      expect((await brandingStore.getBranding("p1"))?.completedAt).toBeDefined();
    } finally {
      stop();
    }
  });
});
