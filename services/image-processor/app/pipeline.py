"""Category-aware segmentation pipeline for wardrobe card images.

The service deliberately returns a transparent cutout only. The shared
Supabase service owns the final 1024x1024 card canvas, background and shadow.
This keeps the MCP and first-party app on one deterministic presentation path.

The production backend is ``grounding_dino_sam2``:

    Grounding DINO detector (category prompt) -> SAM/SAM2 mask -> optional
    rembg alpha matting -> conservative refinement and diagnostics.

``grounded_sam2`` remains available as a legacy YOLO-World adapter. Grounding
DINO is the default because its open-vocabulary detector produces a reliable
box for narrow categories such as sunglasses in cluttered photos.

``rembg`` is available as an explicit prototype backend. It is intentionally
not category-aware and reports conservative eyewear diagnostics so a generic
background remover cannot silently turn a bad glasses photo into ``attached``.
"""

from __future__ import annotations

import io
import threading
import unicodedata
from dataclasses import dataclass
from typing import Any, Protocol, Sequence

import cv2
import numpy as np
from PIL import Image, ImageOps


class ProcessorError(RuntimeError):
    """An expected processor error that can be shown without leaking internals."""

    status_code = 422
    code = "processor_error"


class InvalidImageError(ProcessorError):
    status_code = 400
    code = "invalid_image"


class ModelNotReadyError(ProcessorError):
    status_code = 503
    code = "processor_not_ready"


class NoObjectDetectedError(ProcessorError):
    status_code = 422
    code = "no_object_detected"


@dataclass(frozen=True)
class SegmentRequest:
    image: Image.Image
    source_bytes: bytes
    preset: str
    category: str
    subcategory: str | None = None
    name: str | None = None


@dataclass(frozen=True)
class SegmentResult:
    """A model result before cropping and diagnostics."""

    alpha: np.ndarray
    confidence: float
    provider: str
    selected_box: tuple[float, float, float, float] | None = None
    fine_detail_recall: float | None = None
    transparent_region_preserved: float | None = None


class Segmenter(Protocol):
    def segment(self, request: SegmentRequest) -> SegmentResult:
        """Return an alpha matte in the source image dimensions."""


@dataclass(frozen=True)
class ProcessedCutout:
    png_bytes: bytes
    quality: dict[str, int | float]
    provider: str


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return float(max(lower, min(upper, value)))


def _to_numpy(value: Any) -> np.ndarray:
    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    return np.asarray(value)


def _to_uint8_alpha(value: Any) -> np.ndarray:
    alpha = _to_numpy(value)
    while alpha.ndim > 2:
        alpha = alpha[0]
    if alpha.ndim != 2:
        raise ProcessorError("The segmentation model returned an invalid mask.")
    alpha = np.nan_to_num(alpha.astype(np.float32), nan=0.0, posinf=255.0)
    if float(np.max(alpha)) <= 1.0:
        alpha *= 255.0
    return np.clip(alpha, 0.0, 255.0).astype(np.uint8)


def encode_png(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def decode_source(
    payload: bytes,
    content_type: str | None,
    max_pixels: int,
) -> Image.Image:
    if not payload:
        raise InvalidImageError("The uploaded image is empty.")
    if len(payload) > 5 * 1024 * 1024:
        raise InvalidImageError("The uploaded image is too large.")
    allowed_types = {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
    }
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type not in allowed_types:
        raise InvalidImageError("Use JPEG, PNG, WebP, HEIC or HEIF images.")
    try:
        with Image.open(io.BytesIO(payload)) as decoded:
            decoded.load()
            if decoded.width * decoded.height > max_pixels:
                raise InvalidImageError("The uploaded image has too many pixels.")
            # Apply the camera orientation once, then use RGB pixels for every
            # backend. The cutout later reuses these exact source pixels.
            return ImageOps.exif_transpose(decoded).convert("RGB")
    except InvalidImageError:
        raise
    except Exception as error:
        raise InvalidImageError("The uploaded image could not be decoded.") from error


def _alpha_bbox(
    alpha: np.ndarray,
    threshold: int = 2,
) -> tuple[int, int, int, int] | None:
    visible = alpha >= threshold
    coordinates = np.argwhere(visible)
    if coordinates.size == 0:
        return None
    y0, x0 = coordinates.min(axis=0)
    y1, x1 = coordinates.max(axis=0) + 1
    return int(x0), int(y0), int(x1), int(y1)


def _clip_box(
    box: Sequence[float],
    width: int,
    height: int,
    padding_ratio: float = 0.0,
) -> tuple[int, int, int, int] | None:
    if len(box) != 4:
        return None
    x0, y0, x1, y1 = [float(value) for value in box]
    if x1 <= x0 or y1 <= y0:
        return None
    padding = max(x1 - x0, y1 - y0) * padding_ratio
    x0 = max(0.0, x0 - padding)
    y0 = max(0.0, y0 - padding)
    x1 = min(float(width), x1 + padding)
    y1 = min(float(height), y1 + padding)
    if x1 <= x0 or y1 <= y0:
        return None
    return int(x0), int(y0), max(int(x1), int(x0) + 1), max(int(y1), int(y0) + 1)


def _component_filter(alpha: np.ndarray, preset: str) -> np.ndarray:
    binary = (alpha >= 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if count <= 1:
        return alpha

    # Eyewear has deliberately disconnected but meaningful pieces: bridges,
    # rims and thin temples. Keep very small components there; only remove
    # single-pixel dust. Ordinary cards can use a slightly stronger filter.
    minimum_area = max(4, int(alpha.shape[0] * alpha.shape[1] * 0.0000025))
    if preset == "eyewear_card":
        minimum_area = min(minimum_area, 12)
    keep = np.zeros_like(binary)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area >= minimum_area:
            keep[labels == label] = 1
    if not np.any(keep):
        return alpha
    return np.where(keep > 0, alpha, 0).astype(np.uint8)


def refine_alpha(
    raw_alpha: Any,
    preset: str,
    selected_box: Sequence[float] | None = None,
) -> np.ndarray:
    alpha = _to_uint8_alpha(raw_alpha)
    height, width = alpha.shape
    if selected_box is not None:
        # A detector ROI is the important anti-cup/anti-case guard. The small
        # expansion keeps thin glasses temples from being clipped by the box.
        roi = _clip_box(
            selected_box,
            width,
            height,
            0.08 if preset == "eyewear_card" else 0.04,
        )
        if roi is not None:
            x0, y0, x1, y1 = roi
            clipped = np.zeros_like(alpha)
            clipped[y0:y1, x0:x1] = 255
            alpha = np.minimum(alpha, clipped)

    alpha = _component_filter(alpha, preset)
    if int(np.max(alpha)) == 255 and int(np.unique(alpha).size) <= 2:
        # Anti-alias a hard SAM mask by less than one pixel. This preserves
        # source pixels while avoiding jagged edges in the final SVG card.
        alpha = cv2.GaussianBlur(alpha, (0, 0), 0.65)
    return alpha


def _component_count(visible: np.ndarray) -> int:
    count, _, _, _ = cv2.connectedComponentsWithStats(
        visible.astype(np.uint8),
        8,
    )
    return max(0, int(count) - 1)


def estimate_fine_detail_recall(image: Image.Image, alpha: np.ndarray) -> float:
    gray = np.asarray(image.convert("L"))
    edges = cv2.Canny(gray, 50, 160) > 0
    bbox = _alpha_bbox(alpha, 12)
    if bbox is None:
        return 0.0
    x0, y0, x1, y1 = bbox
    candidate = np.zeros_like(edges)
    candidate[y0:y1, x0:x1] = True
    expected = int(np.count_nonzero(edges & candidate))
    if expected == 0:
        return 0.86
    retained = int(np.count_nonzero(edges & (alpha >= 24)))
    return _clamp(retained / expected)


def _quality_metrics(
    image: Image.Image,
    alpha: np.ndarray,
    preset: str,
    confidence: float,
    fine_detail_recall: float | None,
    transparent_region_preserved: float | None,
) -> dict[str, int | float]:
    height, width = alpha.shape
    visible = alpha >= 32
    area = int(np.count_nonzero(visible))
    bbox = _alpha_bbox(alpha, 2)
    if bbox is None or area == 0:
        return {
            "width": int(width),
            "height": int(height),
            "segmentation_confidence": 0.0,
            "foreground_ratio": 0.0,
            "foreground_width_ratio": 0.0,
            "foreground_height_ratio": 0.0,
            "disconnected_regions": 0,
            "halo_ratio": 1.0,
            "edge_truncation_ratio": 1.0,
            "retained_background_ratio": 1.0,
            "source_similarity": 1.0,
            "fine_detail_recall": 0.0,
            "transparent_region_preserved": 0.0,
        }

    x0, y0, x1, y1 = bbox
    expanded = _clip_box(bbox, width, height, 0.02)
    outside = np.ones_like(visible)
    if expanded is not None:
        ex0, ey0, ex1, ey1 = expanded
        outside[ey0:ey1, ex0:ex1] = False
    retained = float(np.mean(alpha[outside] / 255.0)) if np.any(outside) else 1.0

    border = np.zeros_like(visible)
    border[0, :] = True
    border[-1, :] = True
    border[:, 0] = True
    border[:, -1] = True
    edge_truncation = float(np.count_nonzero(visible & border) / max(area, 1))

    boundary = cv2.morphologyEx(
        visible.astype(np.uint8),
        cv2.MORPH_GRADIENT,
        np.ones((3, 3), dtype=np.uint8),
    ) > 0
    soft_edge = boundary & (alpha > 0) & (alpha < 180)
    halo = float(np.count_nonzero(soft_edge) / max(area, 1))

    detail = fine_detail_recall
    if detail is None:
        detail = estimate_fine_detail_recall(image, alpha)

    if transparent_region_preserved is None:
        soft_pixels = np.count_nonzero((alpha > 8) & (alpha < 245))
        soft_ratio = soft_pixels / max(area, 1)
        transparent_region_preserved = (
            0.90 if preset == "eyewear_card" and soft_ratio >= 0.005 else 1.0
        )

    return {
        "width": int(width),
        "height": int(height),
        "segmentation_confidence": round(_clamp(confidence), 4),
        "foreground_ratio": round(_clamp(area / (width * height)), 6),
        "foreground_width_ratio": round(_clamp((x1 - x0) / width), 6),
        "foreground_height_ratio": round(_clamp((y1 - y0) / height), 6),
        "disconnected_regions": _component_count(visible),
        "halo_ratio": round(_clamp(halo), 6),
        "edge_truncation_ratio": round(_clamp(edge_truncation), 6),
        "retained_background_ratio": round(_clamp(retained), 6),
        # This is a background-probe similarity, not a product similarity:
        # a value close to one means that source-like pixels remain in the
        # corners/outside the selected object.
        "source_similarity": round(_clamp(max(retained, halo)), 6),
        "fine_detail_recall": round(_clamp(float(detail)), 6),
        "transparent_region_preserved": round(
            _clamp(float(transparent_region_preserved)),
            6,
        ),
    }


def _crop_cutout(image: Image.Image, alpha: np.ndarray, preset: str) -> bytes:
    bbox = _alpha_bbox(alpha, 2)
    if bbox is None:
        raise NoObjectDetectedError("The segmentation mask is empty.")
    x0, y0, x1, y1 = bbox
    padding_ratio = 0.06 if preset == "eyewear_card" else 0.04
    padding = max(2, int(max(x1 - x0, y1 - y0) * padding_ratio))
    x0 = max(0, x0 - padding)
    y0 = max(0, y0 - padding)
    x1 = min(image.width, x1 + padding)
    y1 = min(image.height, y1 + padding)
    rgba = np.dstack((np.asarray(image.convert("RGB")), alpha))
    return encode_png(Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA"))


def process_image(
    request: SegmentRequest,
    segmenter: Segmenter,
    max_output_bytes: int = 8 * 1024 * 1024,
) -> ProcessedCutout:
    result = segmenter.segment(request)
    alpha = refine_alpha(result.alpha, request.preset, result.selected_box)
    if alpha.shape != (request.image.height, request.image.width):
        raise ProcessorError("The segmentation mask dimensions do not match the image.")
    if int(np.count_nonzero(alpha >= 2)) == 0:
        raise NoObjectDetectedError("The segmentation mask is empty.")
    quality = _quality_metrics(
        request.image,
        alpha,
        request.preset,
        result.confidence,
        result.fine_detail_recall,
        result.transparent_region_preserved,
    )
    png_bytes = _crop_cutout(request.image, alpha, request.preset)
    if len(png_bytes) > max_output_bytes:
        raise ProcessorError("The processed cutout is too large.")
    if not bool(np.any(_png_alpha_probe(png_bytes) == 0)):
        raise ProcessorError("The processed cutout has no transparent background.")
    return ProcessedCutout(png_bytes, quality, result.provider)


def _png_alpha_probe(payload: bytes) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(payload)) as decoded:
            return np.asarray(decoded.convert("RGBA"))[:, :, 3]
    except Exception as error:
        raise ProcessorError("The processed cutout is not a valid PNG.") from error


def _model_prompts(request: SegmentRequest) -> list[str]:
    if request.preset == "eyewear_card":
        return [
            "a pair of sunglasses",
            "black sunglasses",
            "eyeglasses",
            "glasses",
        ]
    prompts = {
        "outer": ["a jacket", "a coat", "a blazer", "outerwear"],
        "top": ["a shirt", "a top", "a blouse", "a sweater", "a turtleneck", "a hoodie"],
        "bottom": ["pants", "trousers", "jeans", "a skirt", "shorts"],
        "shoes": ["a shoe", "a sneaker", "a boot", "a heel", "sandals"],
        "accessory": [
            "a bag",
            "a hat",
            "a scarf",
            "a belt",
            "a watch",
            "jewelry",
            "a hair clip",
            "a barrette",
        ],
    }
    return prompts.get(request.category, ["clothing", "fashion item"])


def _primary_model_prompt(request: SegmentRequest) -> str:
    """Choose one focused phrase for an open-vocabulary detector.

    Grounding DINO scores the text tokens in a caption. Combining several
    synonyms in one caption lowers the score of the correct box and makes the
    quality gate unnecessarily reject a good detection. The legacy YOLO-World
    path still receives the full synonym list above.
    """

    value = unicodedata.normalize(
        "NFKC",
        " ".join(part for part in (request.subcategory, request.name) if part),
    ).lower()
    if request.preset == "eyewear_card":
        if "sunglass" in value:
            return "sunglasses"
        if "optical" in value or "eyeglass" in value:
            return "eyeglasses"
        return "glasses"
    if request.category == "top" and request.subcategory in {
        "turtleneck",
        "turtlenecks",
    }:
        return "a turtleneck"
    if request.category == "accessory" and request.subcategory in {
        "hair-clip",
        "hair-clips",
        "hair_clip",
        "hair_clips",
        "barrette",
        "barrettes",
    }:
        return "a hair clip"
    if request.category == "shoes" and request.subcategory in {
        "sneaker",
        "sneakers",
    }:
        # Wardrobe photos normally contain a displayed pair. Asking for the
        # pair prevents Grounding DINO from selecting only one shoe and lets
        # SAM segment the complete displayed object as one card.
        return "a pair of sneakers"
    return _model_prompts(request)[0]


class RembgSegmenter:
    """Generic background remover used only when explicitly selected."""

    def __init__(self, model_name: str = "u2net", alpha_matting: bool = True):
        try:
            from rembg import new_session, remove
        except ImportError as error:
            raise ModelNotReadyError(
                "Install rembg or select a category-aware SAM backend."
            ) from error
        self._remove = remove
        self._session = new_session(model_name)
        self._alpha_matting = alpha_matting

    def segment(self, request: SegmentRequest) -> SegmentResult:
        source = encode_png(request.image)
        try:
            output = self._remove(
                source,
                session=self._session,
                alpha_matting=self._alpha_matting,
                alpha_matting_foreground_threshold=240,
                alpha_matting_background_threshold=10,
                alpha_matting_erode_size=10,
                force_return_bytes=True,
            )
            with Image.open(io.BytesIO(output)) as decoded:
                rgba = np.asarray(decoded.convert("RGBA"))
        except ProcessorError:
            raise
        except Exception as error:
            raise ProcessorError("The generic matting model failed.") from error
        if rgba.shape[:2] != (request.image.height, request.image.width):
            raise ProcessorError("The matting model changed the source dimensions.")
        alpha = refine_alpha(rgba[:, :, 3], request.preset)
        soft_ratio = np.count_nonzero((alpha > 8) & (alpha < 245)) / max(
            np.count_nonzero(alpha >= 32),
            1,
        )
        # rembg has no object detector confidence. Keep this conservative so
        # eyewear cannot be promoted without a category-aware detector.
        confidence = 0.76
        transparency = (
            0.88 if request.preset == "eyewear_card" and soft_ratio >= 0.005 else 0.62
        )
        return SegmentResult(
            alpha=alpha,
            confidence=confidence,
            provider="rembg-u2net",
            fine_detail_recall=estimate_fine_detail_recall(request.image, alpha),
            transparent_region_preserved=transparency,
        )


class GroundedSam2Segmenter:
    """YOLO-World detector + SAM/SAM2 prompt segmentation + alpha matting."""

    def __init__(
        self,
        detector_model: str,
        sam_model: str,
        matting_model: str | None = "u2net",
        detector_confidence: float = 0.20,
        matting_enabled: bool = True,
    ):
        try:
            from ultralytics import SAM, YOLOWorld
        except ImportError as error:
            raise ModelNotReadyError(
                "Install ultralytics and provide detector/SAM model weights."
            ) from error
        try:
            self._detector = YOLOWorld(detector_model)
            self._sam = SAM(sam_model)
        except Exception as error:
            raise ModelNotReadyError(
                "The detector or SAM model weights could not be loaded."
            ) from error
        if not hasattr(self._detector, "set_classes"):
            raise ModelNotReadyError(
                "The detector must be a YOLO-World/YOLOE model with set_classes()."
            )
        self._lock = threading.RLock()
        self._detector_confidence = detector_confidence
        self._provider_name = "ultralytics-grounded-sam2"
        self._matting: RembgSegmenter | None = None
        if matting_enabled and matting_model:
            self._matting = RembgSegmenter(matting_model, alpha_matting=True)

    def _detect(
        self,
        request: SegmentRequest,
        source: np.ndarray,
    ) -> tuple[tuple[float, float, float, float], float]:
        prompts = _model_prompts(request)
        with self._lock:
            self._detector.set_classes(prompts)
            predictions = self._detector.predict(
                source=source,
                conf=self._detector_confidence,
                imgsz=1280,
                verbose=False,
            )
        if not predictions:
            raise NoObjectDetectedError("The category detector found no object.")
        boxes = getattr(predictions[0], "boxes", None)
        if boxes is None:
            raise NoObjectDetectedError("The category detector found no object.")
        coordinates = _to_numpy(getattr(boxes, "xyxy", []))
        confidences = _to_numpy(getattr(boxes, "conf", []))
        if coordinates.size == 0:
            raise NoObjectDetectedError("The category detector found no object.")
        if coordinates.ndim == 1:
            coordinates = coordinates.reshape((1, 4))

        height, width = source.shape[:2]
        image_area = float(width * height)
        candidates: list[tuple[float, tuple[float, float, float, float], float]] = []
        for index, raw_box in enumerate(coordinates):
            if len(raw_box) != 4:
                continue
            x0, y0, x1, y1 = [float(value) for value in raw_box]
            x0, y0 = max(0.0, x0), max(0.0, y0)
            x1, y1 = min(float(width), x1), min(float(height), y1)
            area = max(0.0, x1 - x0) * max(0.0, y1 - y0)
            if area <= 0 or area / image_area < 0.002 or area / image_area > 0.92:
                continue
            confidence = float(confidences[index]) if index < len(confidences) else 0.0
            border_touch = int(x0 <= 1) + int(y0 <= 1) + int(x1 >= width - 1) + int(y1 >= height - 1)
            score = confidence - border_touch * 0.015
            candidates.append((score, (x0, y0, x1, y1), confidence))
        if not candidates:
            raise NoObjectDetectedError("The category detector found no usable object.")
        _, selected_box, confidence = max(candidates, key=lambda item: item[0])
        return selected_box, _clamp(confidence)

    def _sam_mask(
        self,
        source: np.ndarray,
        box: tuple[float, float, float, float],
    ) -> tuple[np.ndarray, float]:
        with self._lock:
            predictions = self._sam.predict(
                source=source,
                bboxes=[list(box)],
                imgsz=1024,
                verbose=False,
            )
        if not predictions:
            raise NoObjectDetectedError("SAM returned no mask.")
        masks = getattr(predictions[0], "masks", None)
        if masks is None or not hasattr(masks, "data"):
            raise NoObjectDetectedError("SAM returned no mask.")
        data = _to_numpy(masks.data)
        if data.size == 0:
            raise NoObjectDetectedError("SAM returned no mask.")
        while data.ndim > 2:
            data = data[0]
        if data.ndim != 2:
            raise NoObjectDetectedError("SAM returned an invalid mask.")
        height, width = source.shape[:2]
        if data.shape != (height, width):
            data = cv2.resize(
                data.astype(np.float32),
                (width, height),
                interpolation=cv2.INTER_LINEAR,
            )
        confidence_values = _to_numpy(getattr(masks, "conf", []))
        sam_confidence = float(confidence_values.flat[0]) if confidence_values.size else 0.88
        return data, _clamp(sam_confidence)

    def segment(self, request: SegmentRequest) -> SegmentResult:
        with self._lock:
            source = np.asarray(request.image.convert("RGB"))
            selected_box, detector_confidence = self._detect(request, source)
            sam_mask, sam_confidence = self._sam_mask(source, selected_box)
            sam_alpha = np.where(sam_mask >= 0.15, 255, 0).astype(np.uint8)

            matte_alpha = sam_alpha
            if self._matting is not None:
                matte_alpha = self._matting.segment(request).alpha
                # Matting supplies soft pixels (important for transparent
                # lenses), while the selected SAM ROI prevents a nearby
                # case/cup from surviving the generic matte.
                kernel_size = max(3, int(round(max(source.shape[:2]) * 0.004)))
                if kernel_size % 2 == 0:
                    kernel_size += 1
                kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
                dilated_sam = cv2.dilate(sam_alpha, kernel, iterations=1)
                soft_roi = cv2.GaussianBlur(dilated_sam, (0, 0), 1.1)
                matte_alpha = np.minimum(matte_alpha, soft_roi.astype(np.uint8))

            alpha = refine_alpha(matte_alpha, request.preset, selected_box)
            confidence = min(detector_confidence, sam_confidence)
            has_soft_alpha = np.count_nonzero((alpha > 8) & (alpha < 245)) > 0
            transparent = (
                0.91 if request.preset == "eyewear_card" and has_soft_alpha else
                0.64 if request.preset == "eyewear_card" else 1.0
            )
            return SegmentResult(
                alpha=alpha,
                confidence=confidence,
                provider=f"{self._provider_name}-matting" if self._matting else
                self._provider_name,
                selected_box=selected_box,
                fine_detail_recall=estimate_fine_detail_recall(request.image, alpha),
                transparent_region_preserved=transparent,
            )


class GroundingDinoSam2Segmenter(GroundedSam2Segmenter):
    """Grounding DINO detector + SAM2 prompt segmentation + matting.

    Grounding DINO accepts open-vocabulary text prompts, so the same service
    can select sunglasses, a blazer or shoes without a custom class list. The
    detector score is kept as the confidence evidence sent to the shared
    quality gate; no score is invented from the image bytes.
    """

    def __init__(
        self,
        detector_model: str,
        sam_model: str,
        matting_model: str | None = "u2net",
        detector_confidence: float = 0.25,
        matting_enabled: bool = True,
    ):
        try:
            import torch
            from transformers import (
                AutoModelForZeroShotObjectDetection,
                AutoProcessor,
            )
            from ultralytics import SAM
        except ImportError as error:
            raise ModelNotReadyError(
                "Install transformers, ultralytics and provide detector/SAM models."
            ) from error
        try:
            self._torch = torch
            self._processor = AutoProcessor.from_pretrained(detector_model)
            self._detector = AutoModelForZeroShotObjectDetection.from_pretrained(
                detector_model,
            )
            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            self._detector.to(self._device)
            self._detector.eval()
            self._sam = SAM(sam_model)
        except Exception as error:
            raise ModelNotReadyError(
                "The Grounding DINO or SAM model weights could not be loaded."
            ) from error
        self._lock = threading.RLock()
        self._detector_confidence = detector_confidence
        self._provider_name = "grounding-dino-sam2"
        self._matting: RembgSegmenter | None = None
        if matting_enabled and matting_model:
            self._matting = RembgSegmenter(matting_model, alpha_matting=True)

    def _detect(
        self,
        request: SegmentRequest,
        source: np.ndarray,
    ) -> tuple[tuple[float, float, float, float], float]:
        caption = f"{_primary_model_prompt(request).rstrip('.')}."
        source_image = Image.fromarray(source, mode="RGB")
        with self._lock:
            inputs = self._processor(
                images=source_image,
                text=caption,
                return_tensors="pt",
            )
            inputs = {
                key: value.to(self._device) if hasattr(value, "to") else value
                for key, value in inputs.items()
            }
            with self._torch.inference_mode():
                outputs = self._detector(**inputs)
            height, width = source.shape[:2]
            target_sizes = self._torch.tensor(
                [[height, width]],
                device=self._device,
            )
            try:
                detections = self._processor.post_process_grounded_object_detection(
                    outputs,
                    inputs["input_ids"],
                    threshold=self._detector_confidence,
                    text_threshold=max(0.08, self._detector_confidence * 0.5),
                    target_sizes=target_sizes,
                )
            except TypeError:
                # Keep compatibility with Transformers releases whose
                # post-processing method no longer takes input_ids positionally.
                detections = self._processor.post_process_grounded_object_detection(
                    outputs,
                    threshold=self._detector_confidence,
                    text_threshold=max(0.08, self._detector_confidence * 0.5),
                    target_sizes=target_sizes,
                )

        if not detections:
            raise NoObjectDetectedError("The category detector found no object.")
        detection = detections[0]
        coordinates = _to_numpy(detection.get("boxes", []))
        confidences = _to_numpy(detection.get("scores", []))
        if coordinates.size == 0:
            raise NoObjectDetectedError("The category detector found no object.")
        if coordinates.ndim == 1:
            coordinates = coordinates.reshape((1, 4))

        image_area = float(width * height)
        candidates: list[tuple[float, tuple[float, float, float, float], float]] = []
        for index, raw_box in enumerate(coordinates):
            if len(raw_box) != 4:
                continue
            x0, y0, x1, y1 = [float(value) for value in raw_box]
            x0, y0 = max(0.0, x0), max(0.0, y0)
            x1, y1 = min(float(width), x1), min(float(height), y1)
            area = max(0.0, x1 - x0) * max(0.0, y1 - y0)
            if area <= 0 or area / image_area < 0.002 or area / image_area > 0.92:
                continue
            confidence = float(confidences[index]) if index < len(confidences) else 0.0
            border_touch = int(x0 <= 1) + int(y0 <= 1) + int(x1 >= width - 1) + int(y1 >= height - 1)
            score = confidence - border_touch * 0.015
            candidates.append((score, (x0, y0, x1, y1), confidence))
        if not candidates:
            raise NoObjectDetectedError("The category detector found no usable object.")
        _, selected_box, confidence = max(candidates, key=lambda item: item[0])
        return selected_box, _clamp(confidence)


def create_segmenter(
    backend: str,
    *,
    detector_model: str | None = None,
    sam_model: str = "/models/sam2_b.pt",
    matting_model: str | None = "u2net",
    matting_enabled: bool = True,
) -> Segmenter:
    normalized = backend.strip().lower()
    if normalized == "rembg":
        return RembgSegmenter(matting_model or "u2net", alpha_matting=True)
    if normalized in {
        "grounding_dino_sam2",
        "grounded_dino_sam2",
        "dino_sam2",
    }:
        return GroundingDinoSam2Segmenter(
            detector_model=detector_model or "IDEA-Research/grounding-dino-tiny",
            sam_model=sam_model,
            matting_model=matting_model,
            matting_enabled=matting_enabled,
        )
    if normalized in {"grounded_sam", "grounded_sam2", "sam2"}:
        return GroundedSam2Segmenter(
            detector_model=detector_model or "/models/yolov8s-worldv2.pt",
            sam_model=sam_model,
            matting_model=matting_model,
            matting_enabled=matting_enabled,
        )
    raise ModelNotReadyError(
        "METTI_PROCESSOR_BACKEND must be grounding_dino_sam2, grounded_sam2 or rembg."
    )
