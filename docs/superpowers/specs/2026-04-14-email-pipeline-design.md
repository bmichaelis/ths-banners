# Phase 1: Email-Driven Banner Pipeline Design

**Date:** 2026-04-14
**Status:** Approved

## Overview

An automated pipeline that receives sponsor logo images by email, generates banner PDFs using the existing template system, and emails the finished banners to the printer and a CC recipient.

**Inbound address:** `twolfbanners@kindacoach.com` (Cloudflare Email Routing)
**Trigger:** Email with PNG or JPG attachment sent to the inbound address
**Output:** Banner PDF emailed to printer + CC

---

## Architecture & Data Flow

```
[Sponsor email with logo attachment]
         ↓
[Cloudflare Email Worker]
  • parses MIME, extracts PNG/JPG
  • saves to R2: pending/{uuid}-{filename}
         ↓
[Cloudflare R2 bucket: twolf-banners]
  pending/   ← logos waiting to be processed
  done/      ← finished banner PDFs (archive)
         ↓
[GitHub Actions — runs every 15 min]
  • lists R2 pending/
  • downloads each logo
  • runs make_banner.py
  • uploads PDF to R2 done/
  • calls Cloudflare Worker /send-banner
  • deletes from pending/
         ↓
[Cloudflare Worker HTTP endpoint]
  • reads PDF from R2
  • constructs MIME email with attachment
  • sends via Cloudflare send_email binding
         ↓
[Printer email + CC to you]
```

---

## Component 1: Cloudflare Worker (`cloudflare/`)

A single TypeScript Worker deployed via Wrangler with two entry points.

### Email handler
Triggered when an email arrives at `twolfbanners@kindacoach.com`:
- Parses the raw MIME email using the `postal-mime` library
- Extracts PNG and JPG attachments (silently ignores emails with no valid attachments)
- Saves each attachment to R2 under `pending/{uuid}-{original-filename}`

### HTTP handler — `POST /send-banner`
Triggered by GitHub Actions after a banner is generated:
- Requires `Authorization: Bearer {CF_WORKER_API_TOKEN}` header — rejects with 401 if missing or wrong
- Accepts JSON body: `{ banner_key, printer_email, cc_email, sponsor_name }`
- Reads the PDF from R2 using `banner_key`
- Constructs a MIME email with the PDF as an attachment
- Sends via Cloudflare's native `send_email` binding
- Responds 200 on success, 4xx/5xx on failure

### `wrangler.toml` bindings
- `R2` — the `twolf-banners` bucket
- `send_email` — Cloudflare outbound email capability
- Secrets (via `wrangler secret put`): `FROM_EMAIL`, `PRINTER_EMAIL`, `CC_EMAIL`

### File location
`cloudflare/` folder at repo root:
```
cloudflare/
  src/
    index.ts        # Worker entry point (email + HTTP handlers)
    email-inbound.ts
    email-outbound.ts
  wrangler.toml
  package.json
```

---

## Component 2: R2 Bucket (`twolf-banners`)

Flat two-folder structure used as a processing queue:

```
twolf-banners/
  pending/
    {uuid}-{original-filename}.png   ← written by Email Worker
    {uuid}-{original-filename}.jpg
  done/
    {uuid}-{sponsor-name}-banner.pdf ← written by GitHub Actions
```

The `uuid` prefix prevents collisions when multiple sponsors email simultaneously. `done/` is kept as an archive — no automatic cleanup in Phase 1.

---

## Component 3: GitHub Actions Workflow

**File:** `.github/workflows/banner-pipeline.yml`

**Triggers:**
- Scheduled: every 15 minutes (`*/15 * * * *`)
- Manual: `workflow_dispatch`

**Steps:**
1. Checkout repo
2. Set up Python + install `pymupdf`, `pillow`, `boto3`
3. Run `pipeline/process_pending.py` which:
   - Lists R2 `pending/` — exits cleanly if empty
   - For each pending file:
     - Downloads logo to a temp file
     - Runs `make_banner.py` to generate banner PDF
     - Uploads PDF to R2 `done/`
     - Derives `sponsor_name` by stripping the `{uuid}-` prefix and file extension from the R2 key (e.g. `pending/abc123-acme-logo.png` → `acme-logo`)
     - POSTs to Cloudflare Worker `/send-banner` with `banner_key`, `printer_email`, `cc_email`, `sponsor_name`
     - Deletes file from R2 `pending/`
   - Logs errors per file and continues — one bad attachment doesn't block others

The processing logic lives in `pipeline/process_pending.py` (not inline shell) so it is testable and readable.

---

## Component 4: Configuration & Secrets

### GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | Bucket name (`twolf-banners`) |
| `CF_WORKER_SEND_URL` | Full URL of Worker `/send-banner` endpoint |
| `CF_WORKER_API_TOKEN` | Bearer token authenticating GitHub Actions → Worker |

### Cloudflare Worker secrets (via `wrangler secret put`)

| Secret | Purpose |
|--------|---------|
| `FROM_EMAIL` | Outbound sender address (default: `twolfbanners@kindacoach.com`) |
| `PRINTER_EMAIL` | Printer's email address |
| `CC_EMAIL` | CC recipient (owner) email address |

All addresses are configurable without code changes.

---

## File Layout

```
banners/
  cloudflare/
    src/
      index.ts
      email-inbound.ts
      email-outbound.ts
    wrangler.toml
    package.json
  pipeline/
    process_pending.py
  .github/
    workflows/
      banner-pipeline.yml
  make_banner.py          # existing
  template.pdf            # existing
  create_template.py      # existing
  tests/
    test_create_template.py
    test_make_banner.py
    test_process_pending.py   # new
```

---

## Out of Scope (Phase 1)

- Batch mode / sponsors list (Phase 2)
- PNG/JPG export (Phase 3)
- Multiple layout sizes (Phase 3)
- Automatic cleanup of `done/` folder
- Notifications for failed processing
- Reply to sender confirming receipt
