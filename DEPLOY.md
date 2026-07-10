# StatusPass — Deployment Runbook (for an OpenClaw operator)

Follow steps in order. Steps marked **[HUMAN]** must be done by the owner —
do not attempt them, do not ask for the credentials involved; request that the
human complete the step and confirm. Every phase ends with a **VERIFY** gate:
do not proceed past a failed gate; report the failure instead.

## Constraints (read first)
- **Run exactly ONE instance.** The cadence timer and rate limiter are
  per-process; multiple instances will double-push "on track" updates.
- Do not run without Supabase in production (in-memory stores lose all data
  on restart). Phase 2's VERIFY gate enforces this.
- Never log or echo the values of secrets. Env var *names* are fine.

## Phase 0 — [HUMAN] Accounts & secrets
The owner creates, outside this session:
1. Supabase project → note `SUPABASE_URL`; keep the **service-role key** private.
2. WalletWallet account (walletwallet.dev) → API key `ww_live_...`.
3. Anthropic API key.
4. A Node 22 host (Railway / Fly.io / Render / a VPS) with the ability to set
   environment variables, and DNS for the chosen domain.
5. Generate three random secrets (32+ chars): `STATUSPASS_LINK_SECRET`,
   `STATUSPASS_CONSOLE_TOKEN`, `JIRA_WEBHOOK_SECRET`.
6. Set ALL env vars on the host (see table in README.md), including
   `STATUSPASS_PUBLIC_URL=https://<domain>`.

**VERIFY:** human confirms env vars are set on the host. You never see the values.

## Phase 1 — Database schema
1. Ask the human to run `supabase/schema.sql` in the Supabase SQL editor
   (or run it yourself ONLY if given a scoped migration path — never request
   the service-role key into your context).

**VERIFY:** human confirms: 6 tables exist (accounts, profile_configs, passes,
card_index, branding, assets) and the `branding-assets` bucket is public.

## Phase 2 — Deploy
1. `npm ci && npx tsc --noEmit && npx vitest run` — all unit tests must pass.
2. `npx tsx smoke-personas.ts` — the persona QA suite. It boots a local
   server and walks six personas end to end (agency + client, freelancer,
   program manager, stakeholder edge cases, hostile QA, quiet project).
   It must print `QA SUMMARY: 26/26 checks passed` and exit 0. If any check
   fails, STOP and report the failing line verbatim — do not deploy.
3. Deploy the repo to the host; start command: `npm start`.
4. Read the boot logs.

**VERIFY (all required):**
- Log line `[stores] Supabase` is present. If you see the in-memory warning
  instead, STOP — env is wrong; report to the human.
- No `[warn]` lines about missing `STATUSPASS_CONSOLE_TOKEN`, `TRELLO_API_SECRET`,
  or `ANTHROPIC_API_KEY`.
- `curl https://<domain>/healthz` → 200 `ok`.

## Phase 3 — Smoke test (no client involved)
1. Open `https://<domain>/console?key=<STATUSPASS_CONSOLE_TOKEN>` (ask the
   human to do this on their phone).
2. Human clicks "Create a demo pass for yourself", opens the branding link on
   their phone, uploads any square image, saves.

**VERIFY (human confirms):**
- The same page showed "Add to your wallet" after saving. (If it showed
  "you'll receive an add link shortly", the WalletWallet key or adapter wiring
  failed — collect the `[auto-issue]` log line and report. The wire shape was verified against walletwallet.dev docs; if the vendor has changed it since, corrections go only in `src/walletwallet.ts` (toWWBody).)
- Tapping it installed a pass in Apple/Google Wallet.
- **[HUMAN judgment]** The pass looks right (logo, color, phase). Vendor API
  quirks on first live issuance are expected; a human decides what "right" is.
3. In the console Board tab, drag the demo pass to another phase, add a note.

**VERIFY:** the human's phone shows a lock-screen update with a clean sentence.
This is the product working end to end.

## Phase 4 — Board integrations (optional at launch)
Trello: with the human's Trello API key/token, register per connected board:
`POST https://api.trello.com/1/webhooks` with
`callbackURL=https://<domain>/webhooks/trello`, `idModel=<board id>`.
Jira: human points a Jira webhook or Automation rule at
`https://<domain>/webhooks/jira/<JIRA_WEBHOOK_SECRET>` for issue-updated +
comment events.

**VERIFY:** move a Trello card / Jira issue on a mapped column; the linked
pass updates. An unmapped column should produce an operator nudge in the logs,
not silence.

## Phase 5 — Handoff notes
- Rollback: redeploy the previous build; schema is additive, no down-migrations needed at v1.
- Watch for: `[auto-issue]` errors (vendor), `[cadence]` errors (timer),
  repeated 429s in `[req]` logs (raise limiter constants in `src/app.ts` only
  if traffic is legitimate).
- Known limits, do not "fix" without the owner: single instance only;
  rate limiter and cadence state are in-process; WalletWallet signs passes
  under its platform certificate (acceptable at this stage by decision).
