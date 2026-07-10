# StatusPass — Core Engine (v1)

Working implementation of the StatusPass rules engine and update pipeline, per
`statuspass-build-doc.md`, `statuspass-rules-engine.md`, and
`statuspass-formatpassupdate-prompt.md`.

**Status: 41/41 tests passing, strict TypeScript, zero runtime deps beyond zod.**

## What's implemented

| Module | What it does |
|---|---|
| `src/types.ts` | Full rule schema: 5 rule layers, RuleSet/ResolvedRules, Account/Pass, events, ModelClient abstraction |
| `src/defaults.ts` | SYSTEM_DEFAULTS for both profiles — a new account works before any config |
| `src/merge.ts` | `mergeRuleSet` + `resolveRules`: 4-layer inheritance (system → account → profile → pass), deep map merge, **tighten-only** semantics for `suppress`/`denylist`, `neverInventDates` invariant |
| `src/significance.ts` | Notify/suppress/ambiguous decision + push cooldown |
| `src/prompt.ts` | Voice rules → conditional system prompt; delimited `<event>` payload with `dates_in_source` isolation + injection framing |
| `src/guardrail.ts` | Deterministic post-model filter: denylist, unauthorized dates, money, internal names. Plus the safe fallback line |
| `src/format.ts` | `formatPassUpdate`: schema validation (zod), phase-drift rejection, retry-once-naming-violations, fallback. Difficulty-based model routing |
| `src/pipeline.ts` | `handleBoardEvent` end to end with **injected deps** for board lookup, link resolution, delivery |
| `src/model/anthropic.ts` | Anthropic adapter behind `ModelClient`. Model names are env config (`STATUSPASS_MODEL_ROUTINE` / `_FRONTIER`) |

## Key guarantees (tested)

- A child rule layer can **never un-suppress an event, un-hide a redaction, or turn off `neverInventDates`** (`test/merge.test.ts`)
- A hallucinated date, leaked internal name, money figure, or denylisted term **cannot ship** — retry once, then the boring-true fallback (`test/guardrail.test.ts`, `test/pipeline.test.ts`)
- Prompt injection via card notes → worst case the fallback line ships, never the leak (pipeline test)
- Noise events never reach the model (cost + spam guard)
- Malformed/phase-drifted model output never ships

## What's deliberately stubbed (interfaces to wire next)

1. ~~Trello webhook~~ — **DONE**: `src/trello/` — signature verification (HMAC-SHA1), action classification, `BoardEvent` translation, framework-agnostic handler. See `test/trello.test.ts`.
2. **`resolvePrimaryLink`** — pull URL from the mapped board field, tokenize with TTL, verify reachable + auth-free (per build doc §6).
3. **`deliverPassUpdate`** — the AddToWallet-style vendor call (buy, don't build).
4. **Stores** — `getPassForBoardCard` / `getAccount` / `getProfileConfig` against your DB (Supabase fits your stack).
5. **Cadence job** — scheduled scan for sender nudges + "on track" reassure state.
6. **Console** — the 5-screen pass control panel editing these rule objects.

## Run

```bash
npm install
npx vitest run      # 27 tests
npx tsc --noEmit    # typecheck
```

## Using the formatter directly

```ts
import { createAnthropicClient, DEFAULT_ROUTING } from "./src/model/anthropic.js";
import { formatPassUpdate } from "./src/format.js";

const client = createAnthropicClient(process.env.ANTHROPIC_API_KEY!);
const result = await formatPassUpdate({ event, phase, rag, profile, voice, ctx }, client, DEFAULT_ROUTING);
// result.update.text is guaranteed guardrail-clean or the safe fallback
```

## MVP ship checklist

**Implemented & tested (124/124):** rules engine, formatter + guardrail, Trello webhook (signed), link tokenization + reachability check + `/l/:token` redemption, cadence job, bootable server (`src/server.ts`).

### Env vars
| Var | Purpose |
|---|---|
| `STATUSPASS_LINK_SECRET` | HMAC secret for tokenized links (required) |
| `TRELLO_API_SECRET` | Trello webhook signature verification (required) |
| `ANTHROPIC_API_KEY` | Model access; unset → dev echo model |
| `STATUSPASS_PUBLIC_URL` | Public base URL (webhook callback + link redemption) |
| `STATUSPASS_MODEL_ROUTINE` / `_FRONTIER` | Model routing config |
| `PORT`, `STATUSPASS_CADENCE_INTERVAL_MS` | Server/timer config |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Production stores (else in-memory) |
| `STATUSPASS_CONSOLE_TOKEN` | Console access key |
| `JIRA_WEBHOOK_SECRET` | Jira webhook path secret |

### Remaining to go live
1. ~~Supabase~~ — **DONE**: `src/supabase.ts` (SupabaseStores + SupabaseBrandingStore) + `supabase/schema.sql` (run in the SQL editor; creates tables + the public `branding-assets` bucket). Boots automatically when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set; falls back to in-memory otherwise. `getVendorSerial`/`saveVendorSerial` are ready to wire into the WalletWallet adapter's `getPassMeta`/`saveSerial`.
2. ~~Pass vendor~~ — **DONE**: `src/walletwallet.ts` (adapter: issue + push both wallets) + `src/passdesign.ts` (both profile templates as code). **API verified against live walletwallet.dev docs (2026-07)** — base api.walletwallet.dev, barcodeValue/barcodeFormat, single `color` hex, logoURL/thumbnailURL/stripURL, aux fields folded into secondary, `shareUrl` from the response as the add link. Get API key at walletwallet.dev — free < 1,000 passes/mo; note custom color + images are Pro ($39/mo, 30-day trial on signup).
3. **Jira integration** — **DONE**: `src/jira/webhook.ts`. Point a Jira Cloud webhook (or Automation rule) at `{PUBLIC_URL}/webhooks/jira/{JIRA_WEBHOOK_SECRET}` for issue-updated + comment events. Status transitions flow through the same columnToPhase mapping as Trello lists. Env: `JIRA_WEBHOOK_SECRET`.
3b. **Internal status board** — **DONE**: Board tab in the console. One card per pass, columns = canonical phases, drag-to-phase fires a `phase_change` through the full pipeline (with optional note-on-drop). Operators with no Trello/Jira can run entirely on this; integrations become the zero-touch upgrade.
4. **Register the Trello webhook** per connected board: `POST https://api.trello.com/1/webhooks` with `callbackURL={STATUSPASS_PUBLIC_URL}/webhooks/trello`.
4. **Pass issuance flow** — create pass via vendor, store the board↔pass mapping (`cardIndex`), hand the add-link/QR to the operator.
5. ~~Console~~ — **DONE**: served at `/console?key={STATUSPASS_CONSOLE_TOKEN}`. Passes list (ticket cards + staleness wear states), pass detail with resolved rules + manual send-update, board→phase mapping editor, issuance (creates pass + card index + 72h client branding link). API under `/api/*`, bearer-guarded. Env: `STATUSPASS_CONSOLE_TOKEN` (required for console).
6. Deploy (any Node 22 host), point DNS, set env, `npm start`.

## Branding intake ("design phase" for the client)
Operator mints a one-time link (`mintBrandingToken(passId, 72, LINK_SECRET)` → `{PUBLIC_URL}/brand/{token}`) and sends it to the client. The client uploads a logo and picks a brand color on a hosted page — no account, no vendor exposure. Assets serve from `/assets/{id}` and flow into the WalletWallet spec via `toPassBranding()`. Tokens are kind-scoped: a branding token can never be redeemed as a pass link and vice versa. Swap `InMemoryBrandingStore` → Supabase Storage for prod.

## Automation & UX pass
- **One-link client onboarding**: branding submit auto-issues the vendor pass and the SAME page shows "Add to your wallet." Operator sends one link; the client brands and installs in one sitting. Idempotent (re-submit reuses the stored addUrl). Degrades gracefully without a vendor.
- **Name-only issuance**: board connection is an optional `<details>`; passes default to the internal board.
- **Self-demo pass** on the empty Passes tab — operator sees their own phone buzz in minute one.
- **Unmapped-column nudge**: a phase_change from an unmapped board column notifies the operator with the exact column name instead of silently stalling; the update still ships at the current phase.
- Copy-link buttons throughout.

## Multi-tenancy, auth, billing (Phase 3 readiness)
Self-serve signup/login at `/signup` and `/login` (scrypt passwords, HttpOnly session cookies, 30-day kind-scoped tokens). Every console endpoint is account-scoped — cross-tenant read/write is a 404, verified by tests. Tier enforcement at pass issuance (free 1 / solo 5 / studio 25 / agency 75; 402 with upgrade message). Stripe: webhook at `/webhooks/stripe` with manual signature verification (no SDK), `checkout.session.completed` / subscription events flip the account tier via `STRIPE_PRICE_SOLO|STUDIO|AGENCY` env price IDs; `createCheckoutSession()` available for the upgrade flow. White-label: agency tier puts the operator's name on the pass instead of the StatusPass wordmark. Operator nudges deliver by email (Resend via `RESEND_API_KEY`, console fallback) with a welcome email on signup. Cross-tenant board collisions rejected with 409 at registration; internal-board passes skip the card index entirely. **Legacy mode intact:** `STATUSPASS_CONSOLE_TOKEN` still maps to the default account, so single-tenant design-partner deployments and DEPLOY.md work unchanged. New env: `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `RESEND_API_KEY`, `STATUSPASS_EMAIL_FROM`. Re-run schema.sql for the new account columns.

## First-run onboarding
Opening the console with zero passes starts a three-step guided flow: what StatusPass is (one sentence) → create a demo pass and add it to your own wallet → drag it on the Board and feel the lock-screen buzz. One action per screen, skippable, remembered per browser (localStorage). The empty state after skipping stays quiet.

## Demo shelf (deliverables gallery)
Each pass has a living demo shelf — sprint demo Looms/Zoom recordings, live links, pictures of finished work — managed from the pass detail screen and served as a hosted, auth-free page at `/g/{token}` (kind-scoped, newest-first with dates). Adding a deliverable fires a `deliverable_added` event through the full pipeline, so the stakeholder's lock screen announces "Sprint 6 demo is up" with the shelf as the tap (cooldown prevents bulk-add spam). Once populated, the shelf is reachable from ANY phase whenever the phase's own link source is empty; the phase's own link wins when present. Pipeline-minted shelf tokens never expire (living surface); an empty shelf never ships a link. Deliberately a shelf, not a portal: no comments, approvals, or view-tracking. Schema: `deliverables` table (re-run schema.sql if already deployed).

## Later (build on first prospect request)
- Asana / Monday / Linear integrations — ~1 afternoon each via the `BoardEvent` seam (see `src/trello/`, `src/jira/` as patterns). Trigger: a real prospect names the tool.
