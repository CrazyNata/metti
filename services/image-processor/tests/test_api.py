from __future__ import annotations

import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.main import Settings, create_app
from app.pipeline import SegmentRequest, SegmentResult


class FakeSegmenter:
    def segment(self, request: SegmentRequest) -> SegmentResult:
        alpha = np.zeros((request.image.height, request.image.width), dtype=np.uint8)
        alpha[8:-8, 12:-12] = 255
        return SegmentResult(
            alpha=alpha,
            confidence=0.95,
            provider="test-http-segmenter",
            fine_detail_recall=0.90,
            transparent_region_preserved=0.95,
        )


def _image_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (96, 64), "#eeeeee").save(output, format="JPEG")
    return output.getvalue()


def _settings() -> Settings:
    return Settings(
        api_key="test-key",
        allow_anonymous=False,
        backend="test",
        detector_model="",
        sam_model="",
        matting_model=None,
        matting_enabled=False,
        max_input_bytes=5 * 1024 * 1024,
        max_pixels=1_000_000,
        max_output_bytes=8 * 1024 * 1024,
    )


def test_process_matches_supabase_http_contract() -> None:
    client = TestClient(create_app(_settings(), FakeSegmenter()))
    response = client.post(
        "/process",
        headers={"Authorization": "Bearer test-key"},
        files={"image_file": ("source.jpg", _image_bytes(), "image/jpeg")},
        data={
            "preset": "eyewear_card",
            "category": "accessory",
            "subcategory": "glasses",
            "target_width": "1024",
            "target_height": "1024",
            "background_color": "#F8F7F5",
            "padding": "0.12",
            "shadow": "soft",
            "preserve_original_pixels": "true",
            "return_quality": "true",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["mime_type"] == "image/png"
    assert payload["quality"]["transparent_region_preserved"] == 0.95
    assert payload["image_base64"]


def test_process_requires_private_api_key() -> None:
    client = TestClient(create_app(_settings(), FakeSegmenter()))
    response = client.post(
        "/process",
        files={"image_file": ("source.jpg", _image_bytes(), "image/jpeg")},
    )
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_processor_credentials"
