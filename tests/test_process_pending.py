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
    project_root = pathlib.Path(__file__).parent.parent

    def fake_download(bucket, key, dest):
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
