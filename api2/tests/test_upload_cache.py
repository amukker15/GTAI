from __future__ import annotations

from app.main import UPLOAD_CACHE_DIR, _materialize_upload_for_cache


def test_materialize_upload_deduplicates(tmp_path):
    payload = b"sample-bytes"
    first_tmp = tmp_path / "first.mp4"
    first_tmp.write_bytes(payload)

    cached_path = _materialize_upload_for_cache(first_tmp, "demo.mp4")
    assert cached_path.parent == UPLOAD_CACHE_DIR
    assert cached_path.exists()

    second_tmp = tmp_path / "second.mp4"
    second_tmp.write_bytes(payload)
    cached_again = _materialize_upload_for_cache(second_tmp, "demo.mp4")

    assert cached_again == cached_path
    assert cached_path.exists()

    # Clean up cached artifact to avoid polluting other tests
    cached_path.unlink(missing_ok=True)
