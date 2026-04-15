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
    keys = []
    kwargs: dict = {"Bucket": bucket, "Prefix": "pending/"}
    while True:
        response = client.list_objects_v2(**kwargs)
        for obj in response.get("Contents", []):
            if obj["Key"] != "pending/":
                keys.append(obj["Key"])
        if response.get("IsTruncated"):
            kwargs["ContinuationToken"] = response["NextContinuationToken"]
        else:
            break
    return keys


_UUID_PREFIX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-"
)


def derive_sponsor_name(r2_key: str) -> str:
    filename = r2_key.split("/")[-1]
    name_with_ext = _UUID_PREFIX.sub("", filename)
    return pathlib.Path(name_with_ext).stem


_DEFAULT_EMAIL_BODY = (
    "The banner PDF for {{sponsor_name}} is ready for download.\n\n"
    "Download link (expires in 7 days):\n{{download_url}}\n"
)


def process_file(
    client,
    bucket: str,
    key: str,
    worker_url: str,
    api_token: str,
    printer_email: str,
    cc_email: str,
    email_body_template: str = _DEFAULT_EMAIL_BODY,
) -> None:
    sponsor_name = derive_sponsor_name(key)
    project_root = pathlib.Path(__file__).parent.parent

    metadata = client.head_object(Bucket=bucket, Key=key).get("Metadata", {})
    sender_email = metadata.get("senderemail") or None

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

        download_url = client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': done_key},
            ExpiresIn=604800,  # 7 days
        )

        email_body = email_body_template.replace(
            "{sponsor_name}", sponsor_name
        ).replace("{download_url}", download_url)

        payload: dict = {
            "banner_key": done_key,
            "printer_email": printer_email,
            "cc_email": cc_email,
            "sponsor_name": sponsor_name,
            "download_url": download_url,
            "email_body": email_body,
        }
        if sender_email:
            payload["sender_email"] = sender_email

        response = requests.post(
            f"{worker_url.rstrip('/')}/send-banner",
            headers={"Authorization": f"Bearer {api_token}"},
            json=payload,
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(
                f"Worker responded {response.status_code}: {response.text[:500]}"
            )

        client.delete_object(Bucket=bucket, Key=key)


def main():
    client = get_r2_client()
    bucket = os.environ["R2_BUCKET_NAME"]
    worker_url = os.environ["CF_WORKER_SEND_URL"]
    api_token = os.environ["CF_WORKER_API_TOKEN"]
    printer_email = os.environ["PRINTER_EMAIL"]
    cc_email = os.environ["CC_EMAIL"]

    email_body_template = os.environ.get("EMAIL_BODY_TEMPLATE", _DEFAULT_EMAIL_BODY)

    pending = list_pending_files(client, bucket)
    if not pending:
        print("No pending files. Exiting.")
        return

    errors = []
    for key in pending:
        try:
            print(f"Processing {key}...")
            process_file(client, bucket, key, worker_url, api_token,
                         printer_email, cc_email, email_body_template)
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
