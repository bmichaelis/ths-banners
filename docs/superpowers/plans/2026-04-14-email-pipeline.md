# Email-Driven Banner Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated pipeline that receives sponsor logo images by email, generates banner PDFs using the existing template, and emails finished banners to the printer and a CC recipient.

**Architecture:** Cloudflare Email Worker receives emails at `twolfbanners@kindacoach.com`, extracts PNG/JPG attachments, and saves them to R2 `pending/`. A GitHub Actions workflow runs every 15 minutes, downloads pending logos, calls `make_banner.py`, uploads results to R2 `done/`, then calls a Cloudflare Worker HTTP endpoint which sends the finished PDF to the printer and CC via Cloudflare's native email binding. All addresses and tokens are stored as secrets — no hardcoded values.

**Tech Stack:** Python 3 + boto3 + requests (pipeline), TypeScript + postal-mime + mimetext (Cloudflare Worker), GitHub Actions, Cloudflare R2 + Email Workers

---

## File Layout

```
banners/
  pipeline/
    __init__.py               # empty — makes pipeline a Python package
    process_pending.py        # list R2 pending/, generate banners, call Worker
  cloudflare/
    src/
      index.ts                # Worker entry point — routes email vs HTTP
      email-inbound.ts        # Email handler: parse MIME, save attachment to R2
      email-outbound.ts       # HTTP handler: read PDF from R2, send via email binding
      types.ts                # Env interface shared by all handlers
    test/
      email-inbound.test.ts
      email-outbound.test.ts
    wrangler.toml             # Worker config: R2 binding, send_email binding
    package.json
    tsconfig.json
    vitest.config.ts
  .github/
    workflows/
      banner-pipeline.yml     # Scheduled + manual workflow
  tests/
    test_process_pending.py   # pytest tests for process_pending.py
  make_banner.py              # existing
  template.pdf                # existing
```

---

## Task 1: Push repo to GitHub

**Files:** none (configuration only)

- [ ] **Step 1: Create a new GitHub repo**

Go to https://github.com/new. Name it `banners`. Keep it private. Do NOT initialize with README, .gitignore, or license (the local repo already has those).

- [ ] **Step 2: Add remote and push**

```bash
cd /Users/brett/brett-dev/banners
git remote add origin https://github.com/<your-username>/banners.git
git push -u origin main
```

Expected: all commits appear in the GitHub repo.

- [ ] **Step 3: Verify**

```bash
git remote -v
```

Expected:
```
origin  https://github.com/<your-username>/banners.git (fetch)
origin  https://github.com/<your-username>/banners.git (push)
```

---

## Task 2: Create R2 Bucket and API Tokens

**Files:** none (Cloudflare dashboard configuration)

- [ ] **Step 4: Create the R2 bucket**

1. Go to https://dash.cloudflare.com → R2 Object Storage → Create bucket
2. Name: `twolf-banners`
3. Location: automatic
4. Click Create bucket

- [ ] **Step 5: Create R2 API token**

1. R2 → Manage R2 API Tokens → Create API Token
2. Permissions: Object Read & Write
3. Specify bucket: `twolf-banners`
4. Click Create API Token
5. Copy and save: Account ID, Access Key ID, Secret Access Key (shown once only)

- [ ] **Step 6: Verify R2 access with AWS CLI**

```bash
AWS_ACCESS_KEY_ID=<your-access-key-id> \
AWS_SECRET_ACCESS_KEY=<your-secret-access-key> \
aws s3 ls s3://twolf-banners \
  --endpoint-url https://<your-account-id>.r2.cloudflarestorage.com \
  --region auto
```

Expected: empty output (no error). The bucket exists and credentials work.

---

## Task 3: Python Pipeline — `process_pending.py`

**Files:**
- Create: `pipeline/__init__.py`
- Create: `pipeline/process_pending.py`
- Create: `tests/test_process_pending.py`

- [ ] **Step 7: Create the pipeline package**

```bash
mkdir -p pipeline && touch pipeline/__init__.py
```

- [ ] **Step 8: Write failing tests**

```python
# tests/test_process_pending.py
import pathlib
import re
from unittest.mock import MagicMock, call, patch

import pytest


def test_list_pending_files_returns_object_keys():
    from pipeline.process_pending import list_pending_files

    client = MagicMock()
    client.list_objects_v2.return_value = {
        "Contents": [
            {"Key": "pending/"},
            {"Key": "pending/550e8400-e29b-41d4-a716-446655440000-acme-logo.png"},
            {"Key": "pending/6ba7b810-9dad-11d1-80b4-00c04fd430c8-uccu.jpg"},
        ]
    }
    result = list_pending_files(client, "twolf-banners")
    assert result == [
        "pending/550e8400-e29b-41d4-a716-446655440000-acme-logo.png",
        "pending/6ba7b810-9dad-11d1-80b4-00c04fd430c8-uccu.jpg",
    ]


def test_list_pending_files_empty_bucket():
    from pipeline.process_pending import list_pending_files

    client = MagicMock()
    client.list_objects_v2.return_value = {}
    result = list_pending_files(client, "twolf-banners")
    assert result == []


def test_derive_sponsor_name_strips_uuid_and_extension():
    from pipeline.process_pending import derive_sponsor_name

    key = "pending/550e8400-e29b-41d4-a716-446655440000-acme-logo.png"
    assert derive_sponsor_name(key) == "acme-logo"


def test_derive_sponsor_name_jpg():
    from pipeline.process_pending import derive_sponsor_name

    key = "pending/6ba7b810-9dad-11d1-80b4-00c04fd430c8-timpanogos-timberwolves.jpg"
    assert derive_sponsor_name(key) == "timpanogos-timberwolves"


def test_process_file_generates_banner_and_calls_worker(tmp_path):
    from pipeline.process_pending import process_file

    # Arrange: fake R2 client
    client = MagicMock()
    # download_file writes the actual template.pdf as a stand-in for the logo
    project_root = pathlib.Path(__file__).parent.parent

    def fake_download(bucket, key, dest):
        # Copy uccu logo as a real PNG so make_banner.py succeeds
        import shutil
        shutil.copy(str(project_root / "uccu-logo_tag.png"), dest)

    client.download_file.side_effect = fake_download

    # Arrange: fake HTTP response
    with patch("pipeline.process_pending.requests") as mock_requests:
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_requests.post.return_value = mock_response

        process_file(
            client=client,
            bucket="twolf-banners",
            key="pending/550e8400-e29b-41d4-a716-446655440000-acme-logo.png",
            worker_url="https://worker.example.com",
            api_token="test-token",
            printer_email="printer@example.com",
            cc_email="cc@example.com",
        )

    # Assert: uploaded to done/
    client.upload_file.assert_called_once()
    upload_args = client.upload_file.call_args
    assert upload_args[0][2] == "done/acme-logo-banner.pdf"

    # Assert: called worker with correct payload
    mock_requests.post.assert_called_once()
    post_kwargs = mock_requests.post.call_args
    assert post_kwargs[1]["json"]["banner_key"] == "done/acme-logo-banner.pdf"
    assert post_kwargs[1]["json"]["sponsor_name"] == "acme-logo"
    assert post_kwargs[1]["headers"]["Authorization"] == "Bearer test-token"

    # Assert: deleted from pending
    client.delete_object.assert_called_once_with(
        Bucket="twolf-banners",
        Key="pending/550e8400-e29b-41d4-a716-446655440000-acme-logo.png",
    )
```

- [ ] **Step 9: Run tests to confirm they fail**

```bash
cd /Users/brett/brett-dev/banners
python3 -m pytest tests/test_process_pending.py -v
```

Expected: `ImportError: cannot import name 'list_pending_files' from 'pipeline.process_pending'`

- [ ] **Step 10: Implement `pipeline/process_pending.py`**

```python
# pipeline/process_pending.py
import os
import pathlib
import re
import subprocess
import sys
import tempfile

import boto3
import requests


def get_r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def list_pending_files(client, bucket: str) -> list:
    response = client.list_objects_v2(Bucket=bucket, Prefix="pending/")
    return [
        obj["Key"]
        for obj in response.get("Contents", [])
        if obj["Key"] != "pending/"
    ]


_UUID_PREFIX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-"
)


def derive_sponsor_name(r2_key: str) -> str:
    filename = r2_key.split("/")[-1]
    name_with_ext = _UUID_PREFIX.sub("", filename)
    return pathlib.Path(name_with_ext).stem


def process_file(
    client,
    bucket: str,
    key: str,
    worker_url: str,
    api_token: str,
    printer_email: str,
    cc_email: str,
) -> None:
    sponsor_name = derive_sponsor_name(key)
    project_root = pathlib.Path(__file__).parent.parent

    with tempfile.TemporaryDirectory() as tmpdir:
        ext = pathlib.Path(key).suffix
        logo_path = pathlib.Path(tmpdir) / f"{sponsor_name}{ext}"
        banner_path = pathlib.Path(tmpdir) / f"{sponsor_name}-banner.pdf"

        client.download_file(bucket, key, str(logo_path))

        result = subprocess.run(
            [sys.executable, str(project_root / "make_banner.py"),
             str(logo_path), str(banner_path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"make_banner.py failed for {key}: {result.stderr}")

        done_key = f"done/{sponsor_name}-banner.pdf"
        client.upload_file(
            str(banner_path),
            bucket,
            done_key,
            ExtraArgs={"ContentType": "application/pdf"},
        )

        response = requests.post(
            f"{worker_url}/send-banner",
            headers={"Authorization": f"Bearer {api_token}"},
            json={
                "banner_key": done_key,
                "printer_email": printer_email,
                "cc_email": cc_email,
                "sponsor_name": sponsor_name,
            },
        )
        response.raise_for_status()

    client.delete_object(Bucket=bucket, Key=key)


def main():
    client = get_r2_client()
    bucket = os.environ["R2_BUCKET_NAME"]
    worker_url = os.environ["CF_WORKER_SEND_URL"]
    api_token = os.environ["CF_WORKER_API_TOKEN"]
    printer_email = os.environ["PRINTER_EMAIL"]
    cc_email = os.environ["CC_EMAIL"]

    pending = list_pending_files(client, bucket)
    if not pending:
        print("No pending files. Exiting.")
        return

    errors = []
    for key in pending:
        try:
            print(f"Processing {key}...")
            process_file(client, bucket, key, worker_url, api_token,
                         printer_email, cc_email)
            print(f"  Done: {key}")
        except Exception as exc:
            print(f"  ERROR processing {key}: {exc}")
            errors.append((key, str(exc)))

    if errors:
        print(f"\nFailed ({len(errors)}):")
        for key, err in errors:
            print(f"  {key}: {err}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 11: Install dependencies**

```bash
pip3 install boto3 requests
```

- [ ] **Step 12: Run tests to confirm they pass**

```bash
python3 -m pytest tests/test_process_pending.py -v
```

Expected: 5 tests `PASSED`

- [ ] **Step 13: Run full test suite**

```bash
python3 -m pytest tests/ -v
```

Expected: all 7 tests `PASSED`

- [ ] **Step 14: Commit**

```bash
git add pipeline/__init__.py pipeline/process_pending.py tests/test_process_pending.py
git commit -m "feat: add pipeline/process_pending.py with tests"
```

---

## Task 4: GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/banner-pipeline.yml`

- [ ] **Step 15: Create the workflow file**

```yaml
# .github/workflows/banner-pipeline.yml
name: Banner Pipeline

on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

jobs:
  process-banners:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: pip install pymupdf pillow boto3 requests

      - name: Process pending banners
        env:
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
          CF_WORKER_SEND_URL: ${{ secrets.CF_WORKER_SEND_URL }}
          CF_WORKER_API_TOKEN: ${{ secrets.CF_WORKER_API_TOKEN }}
          PRINTER_EMAIL: ${{ secrets.PRINTER_EMAIL }}
          CC_EMAIL: ${{ secrets.CC_EMAIL }}
        run: python3 pipeline/process_pending.py
```

- [ ] **Step 16: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/banner-pipeline.yml'))"
```

Expected: no output (no error).

- [ ] **Step 17: Commit**

```bash
git add .github/workflows/banner-pipeline.yml
git commit -m "feat: add GitHub Actions banner pipeline workflow"
git push
```

---

## Task 5: Cloudflare Worker — Project Scaffold

**Files:**
- Create: `cloudflare/package.json`
- Create: `cloudflare/tsconfig.json`
- Create: `cloudflare/wrangler.toml`
- Create: `cloudflare/vitest.config.ts`
- Create: `cloudflare/src/types.ts`

- [ ] **Step 18: Install Wrangler globally (if not already installed)**

```bash
npm install -g wrangler
wrangler --version
```

Expected: `⛅️ wrangler X.X.X` (any recent version)

- [ ] **Step 19: Create `cloudflare/package.json`**

```json
{
  "name": "twolf-banners-worker",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "test": "vitest run"
  },
  "dependencies": {
    "mimetext": "^3.0.22",
    "postal-mime": "^1.0.12"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240925.0",
    "typescript": "^5.5.2",
    "vitest": "^1.6.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 20: Create `cloudflare/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 21: Create `cloudflare/wrangler.toml`**

```toml
name = "twolf-banners-worker"
main = "src/index.ts"
compatibility_date = "2024-09-23"

[[r2_buckets]]
binding = "R2"
bucket_name = "twolf-banners"
preview_bucket_name = "twolf-banners-preview"

[[send_email]]
name = "SEND_EMAIL"

# Secrets (set via `wrangler secret put`):
# FROM_EMAIL, PRINTER_EMAIL, CC_EMAIL, API_TOKEN
```

- [ ] **Step 22: Create `cloudflare/vitest.config.ts`**

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 23: Create `cloudflare/src/types.ts`**

```typescript
export interface Env {
  R2: R2Bucket;
  SEND_EMAIL: SendEmail;
  FROM_EMAIL: string;
  API_TOKEN: string;
  PRINTER_EMAIL: string;
  CC_EMAIL: string;
}
```

- [ ] **Step 24: Install npm dependencies**

```bash
cd cloudflare
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 25: Commit scaffold**

```bash
cd /Users/brett/brett-dev/banners
git add cloudflare/
git commit -m "feat: scaffold Cloudflare Worker project"
```

---

## Task 6: Worker — Email Inbound Handler

**Files:**
- Create: `cloudflare/src/email-inbound.ts`
- Create: `cloudflare/test/email-inbound.test.ts`

- [ ] **Step 26: Create `cloudflare/src/email-inbound.ts`**

```typescript
import PostalMime from "postal-mime";
import type { Env } from "./types";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg"];

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const parser = new PostalMime();
  // Consume the ReadableStream via Response before parsing (most reliable approach in Workers)
  const rawData = await new Response(message.raw).arrayBuffer();
  const email = await parser.parse(rawData);

  for (const attachment of email.attachments ?? []) {
    const mimeType = attachment.mimeType?.toLowerCase() ?? "";
    if (!ALLOWED_TYPES.includes(mimeType)) continue;

    const safeFilename = sanitizeFilename(
      attachment.filename ?? `logo.${mimeType.split("/")[1]}`
    );
    const uuid = crypto.randomUUID();
    const key = `pending/${uuid}-${safeFilename}`;

    await env.R2.put(key, attachment.content, {
      httpMetadata: { contentType: mimeType },
    });
  }
}
```

- [ ] **Step 27: Write `cloudflare/test/email-inbound.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleInboundEmail } from "../src/email-inbound";
import type { Env } from "../src/types";

// Minimal stub for ForwardableEmailMessage
function makeMessage(rawEmail: string): ForwardableEmailMessage {
  const encoder = new TextEncoder();
  return {
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(rawEmail));
        controller.close();
      },
    }),
    from: "sender@example.com",
    to: "twolfbanners@kindacoach.com",
    headers: new Headers(),
    forward: vi.fn(),
    reply: vi.fn(),
    reject: vi.fn(),
    setReject: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

// Minimal raw MIME email with a PNG attachment
const RAW_WITH_PNG = [
  "MIME-Version: 1.0",
  "From: sponsor@example.com",
  "To: twolfbanners@kindacoach.com",
  "Subject: Logo",
  'Content-Type: multipart/mixed; boundary="boundary"',
  "",
  "--boundary",
  "Content-Type: text/plain",
  "",
  "Here is our logo.",
  "--boundary",
  "Content-Type: image/png",
  'Content-Disposition: attachment; filename="acme-logo.png"',
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0KGgo=",  // minimal valid base64
  "--boundary--",
].join("\r\n");

const RAW_NO_IMAGE = [
  "MIME-Version: 1.0",
  "From: sponsor@example.com",
  "To: twolfbanners@kindacoach.com",
  "Subject: No attachment",
  "Content-Type: text/plain",
  "",
  "No attachment here.",
].join("\r\n");

describe("handleInboundEmail", () => {
  it("saves PNG attachment to R2 pending/", async () => {
    const mockR2 = { put: vi.fn().mockResolvedValue(undefined) };
    const env = { R2: mockR2 } as unknown as Env;

    await handleInboundEmail(makeMessage(RAW_WITH_PNG), env);

    expect(mockR2.put).toHaveBeenCalledOnce();
    const [key, , opts] = mockR2.put.mock.calls[0];
    expect(key).toMatch(/^pending\/[0-9a-f-]+-acme-logo\.png$/);
    expect(opts.httpMetadata.contentType).toBe("image/png");
  });

  it("ignores emails with no image attachments", async () => {
    const mockR2 = { put: vi.fn() };
    const env = { R2: mockR2 } as unknown as Env;

    await handleInboundEmail(makeMessage(RAW_NO_IMAGE), env);

    expect(mockR2.put).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 28: Run Worker tests**

```bash
cd /Users/brett/brett-dev/banners/cloudflare
npm test
```

Expected: `2 tests passed`

- [ ] **Step 29: Commit**

```bash
cd /Users/brett/brett-dev/banners
git add cloudflare/src/email-inbound.ts cloudflare/test/email-inbound.test.ts
git commit -m "feat: add Worker email-inbound handler with tests"
```

---

## Task 7: Worker — Email Outbound Handler + Entry Point

**Files:**
- Create: `cloudflare/src/email-outbound.ts`
- Create: `cloudflare/src/index.ts`
- Create: `cloudflare/test/email-outbound.test.ts`

- [ ] **Step 30: Create `cloudflare/src/email-outbound.ts`**

```typescript
import { createMimeMessage } from "mimetext";
import type { Env } from "./types";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function handleSendBanner(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (auth !== `Bearer ${env.API_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: {
    banner_key: string;
    printer_email: string;
    cc_email: string;
    sponsor_name: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { banner_key, printer_email, cc_email, sponsor_name } = body;

  const obj = await env.R2.get(banner_key);
  if (!obj) {
    return new Response(`Banner not found: ${banner_key}`, { status: 404 });
  }
  const pdfBytes = await obj.arrayBuffer();

  const msg = createMimeMessage();
  msg.setSender({ addr: env.FROM_EMAIL });
  msg.setRecipient(printer_email);
  msg.setCc(cc_email);
  msg.setSubject(`Banner Ready: ${sponsor_name}`);
  msg.addMessage({
    contentType: "text/plain",
    data: `The banner PDF for ${sponsor_name} is attached.`,
  });
  msg.addAttachment({
    filename: `${sponsor_name}-banner.pdf`,
    contentType: "application/pdf",
    data: arrayBufferToBase64(pdfBytes),
    encoding: "base64",
  });

  const rawEmail = msg.asRaw();
  const emailMessage = new EmailMessage(env.FROM_EMAIL, printer_email, rawEmail);
  await env.SEND_EMAIL.send(emailMessage);

  return new Response("OK", { status: 200 });
}
```

- [ ] **Step 31: Create `cloudflare/src/index.ts`**

```typescript
import { handleInboundEmail } from "./email-inbound";
import { handleSendBanner } from "./email-outbound";
import type { Env } from "./types";

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await handleInboundEmail(message, env);
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/send-banner") {
      return handleSendBanner(request, env);
    }
    return new Response("Not Found", { status: 404 });
  },
};
```

- [ ] **Step 32: Write `cloudflare/test/email-outbound.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleSendBanner } from "../src/email-outbound";
import type { Env } from "../src/types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    R2: {
      get: vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      }),
    } as unknown as R2Bucket,
    SEND_EMAIL: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as SendEmail,
    FROM_EMAIL: "twolfbanners@kindacoach.com",
    API_TOKEN: "secret-token",
    PRINTER_EMAIL: "printer@example.com",
    CC_EMAIL: "cc@example.com",
    ...overrides,
  };
}

function makeRequest(body: object, token = "secret-token"): Request {
  return new Request("https://worker.example.com/send-banner", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("handleSendBanner", () => {
  it("returns 401 for missing or wrong token", async () => {
    const env = makeEnv();
    const req = makeRequest({ banner_key: "done/x.pdf" }, "wrong-token");
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(401);
    expect(env.SEND_EMAIL.send).not.toHaveBeenCalled();
  });

  it("returns 404 when banner_key not found in R2", async () => {
    const env = makeEnv({
      R2: { get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket,
    });
    const req = makeRequest({
      banner_key: "done/missing.pdf",
      printer_email: "p@example.com",
      cc_email: "cc@example.com",
      sponsor_name: "acme",
    });
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(404);
  });

  it("sends email and returns 200 on success", async () => {
    const env = makeEnv();
    const req = makeRequest({
      banner_key: "done/acme-banner.pdf",
      printer_email: "printer@example.com",
      cc_email: "cc@example.com",
      sponsor_name: "acme",
    });
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(200);
    expect(env.SEND_EMAIL.send).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 33: Run all Worker tests**

```bash
cd /Users/brett/brett-dev/banners/cloudflare
npm test
```

Expected: `5 tests passed` (2 inbound + 3 outbound)

- [ ] **Step 34: Commit**

```bash
cd /Users/brett/brett-dev/banners
git add cloudflare/src/email-outbound.ts cloudflare/src/index.ts cloudflare/test/email-outbound.test.ts
git commit -m "feat: add Worker email-outbound handler, entry point, and tests"
git push
```

---

## Task 8: Deploy Worker and Configure Cloudflare

**Files:** none (deployment + dashboard configuration)

- [ ] **Step 35: Authenticate Wrangler**

```bash
cd /Users/brett/brett-dev/banners/cloudflare
wrangler login
```

Complete the browser auth flow.

- [ ] **Step 36: Deploy the Worker**

```bash
wrangler deploy
```

Expected output includes:
```
✅ Deployed twolf-banners-worker
https://twolf-banners-worker.<your-subdomain>.workers.dev
```

Copy the worker URL — you'll need it for GitHub secrets.

- [ ] **Step 37: Set Worker secrets**

```bash
wrangler secret put FROM_EMAIL
# Enter: twolfbanners@kindacoach.com

wrangler secret put PRINTER_EMAIL
# Enter: <printer's email address>

wrangler secret put CC_EMAIL
# Enter: <your email address>

wrangler secret put API_TOKEN
# Enter: <generate a strong random string, e.g. openssl rand -hex 32>
```

Save the `API_TOKEN` value — you'll add it as a GitHub secret next.

- [ ] **Step 38: Configure Email Routing in Cloudflare dashboard**

1. Go to https://dash.cloudflare.com → `kindacoach.com` → Email → Email Routing
2. Enable Email Routing if not already enabled
3. Add a Custom Address:
   - Address: `twolfbanners@kindacoach.com`
   - Action: Send to a Worker
   - Worker: `twolf-banners-worker`
4. Save

- [ ] **Step 39: Verify Worker is reachable**

```bash
curl -X POST https://twolf-banners-worker.<your-subdomain>.workers.dev/send-banner \
  -H "Authorization: Bearer wrong-token" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `Unauthorized` (401). Confirms the Worker is deployed and routing requests.

---

## Task 9: Add GitHub Secrets and Run End-to-End Smoke Test

**Files:** none (GitHub configuration + manual verification)

- [ ] **Step 40: Add GitHub Actions secrets**

Go to https://github.com/<your-username>/banners/settings/secrets/actions → New repository secret.

Add each secret:

| Name | Value |
|------|-------|
| `R2_ACCOUNT_ID` | Your Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 API token key from Task 2 |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret from Task 2 |
| `R2_BUCKET_NAME` | `twolf-banners` |
| `CF_WORKER_SEND_URL` | `https://twolf-banners-worker.<your-subdomain>.workers.dev` |
| `CF_WORKER_API_TOKEN` | The `API_TOKEN` value from Step 37 |
| `PRINTER_EMAIL` | Printer's email address |
| `CC_EMAIL` | Your email address |

- [ ] **Step 41: Upload a test logo to R2 pending/**

```bash
AWS_ACCESS_KEY_ID=<key> \
AWS_SECRET_ACCESS_KEY=<secret> \
aws s3 cp "uccu-logo_tag.png" \
  "s3://twolf-banners/pending/550e8400-e29b-41d4-a716-446655440000-smoke-test.png" \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --region auto
```

- [ ] **Step 42: Trigger the pipeline manually**

Go to https://github.com/<your-username>/banners/actions → Banner Pipeline → Run workflow → Run workflow.

- [ ] **Step 43: Verify results**

1. Watch the workflow run complete successfully (green checkmark)
2. Check R2 `done/` for `smoke-test-banner.pdf`:

```bash
AWS_ACCESS_KEY_ID=<key> \
AWS_SECRET_ACCESS_KEY=<secret> \
aws s3 ls s3://twolf-banners/done/ \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --region auto
```

3. Confirm email arrived at printer address and CC

- [ ] **Step 44: Send a real test email**

Send an email to `twolfbanners@kindacoach.com` with a PNG logo attached. Wait up to 15 minutes for the next scheduled run (or trigger manually). Confirm the banner PDF arrives at the printer email.

---

## Done

- Sponsor emails a PNG/JPG to `twolfbanners@kindacoach.com`
- Pipeline runs every 15 minutes, generates banner, emails to printer + CC
- All addresses configurable via secrets — no code changes required
- Full test coverage: Python pipeline (pytest) + TypeScript Worker (vitest)
