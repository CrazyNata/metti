from __future__ import annotations

import io

import numpy as np
from PIL import Image

from app.pipeline import (
    SegmentRequest,
    SegmentResult,
    encode_png,
    process_image,
)


class FakeSegmenter:
    def segment(self, request: SegmentRequest) -> SegmentResult:
        alpha = np.zeros((request.image.height, request.image.width), dtype=np.uint8)
        alpha[30:170, 50:250] = 255
        # A thin disconnected temple must survive the eyewear refinement.
        if request.preset == "eyewear_card":
            alpha[92:98, 245:300] = 220
        return SegmentResult(
            alpha=alpha,
            confidence=0.94,
            provider="test-segmenter",
            selected_box=(45, 25, 305, 175),
            fine_detail_recall=0.92,
            transparent_region_preserved=0.96,
        )


def test_process_returns_transparent_png_and_source_pixels() -> None:
    image = Image.new("RGB", (320, 200), (242, 242, 242))
    pixels = image.load()
    pixels[100, 100] = (15, 35, 55)
    result = process_image(
        SegmentRequest(
            image=image,
            source_bytes=encode_png(image),
            preset="eyewear_card",
            category="accessory",
            subcategory="glasses",
            name="thin metal frame",
        ),
        FakeSegmenter(),
    )

    with Image.open(io.BytesIO(result.png_bytes)) as output:
        rgba = np.asarray(output.convert("RGBA"))
    assert rgba.shape[2] == 4
    assert np.min(rgba[:, :, 3]) == 0
    assert np.max(rgba[:, :, 3]) > 0
    assert np.any(np.all(rgba[:, :, :3] == (15, 35, 55), axis=2))
    assert result.provider == "test-segmenter"
    assert result.quality["segmentation_confidence"] == 0.94
    assert result.quality["transparent_region_preserved"] == 0.96


def test_processing_keeps_eye_wear_disconnected_components() -> None:
    image = Image.new("RGB", (320, 200), "white")
    result = process_image(
        SegmentRequest(
            image=image,
            source_bytes=encode_png(image),
            preset="eyewear_card",
            category="accessory",
            subcategory="sunglasses",
        ),
        FakeSegmenter(),
    )
    assert 1 <= result.quality["disconnected_regions"] <= 14
