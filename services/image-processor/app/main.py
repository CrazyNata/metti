"""HTTP adapter for the private Metti wardrobe image processor."""

from __future__ import annotations

import base64
import hmac
import logging
import os
import secrets
import threading
from dataclasses import dataclass

from fastapi import FastAPI, File, Form, Header, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .pipeline import (
    InvalidImageError,
    ModelNotReadyError,
    ProcessedCutout,
    ProcessorError,
    SegmentRequest,
    Segmenter,
    create_segmenter,
    decode_source,
    process_image,
)


LOGGER = logging.getLogger("metti-image-processor")
ALLOWED_PRESETS = {"wardrobe_card", "eyewear_card"}
ALLOWED_CATEGORIES = {"outer", "top", "bottom", "shoes", "accessory"}
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}


def _env_bool(name: str, fallback: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return fallback


def _env_int(name: str, fallback: int, maximum: int | None = None) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return fallback
    if value <= 0:
        return fallback
    return min(value, maximum) if maximum else value


@dataclass(frozen=True)
class Settings:
    api_key: str
    allow_anonymous: bool
    backend: str
    detector_model: str
    sam_model: str
    matting_model: str | None
    matting_enabled: bool
    max_input_bytes: int
    max_pixels: int
    max_output_bytes: int

    @classmethod
    def from_env(cls) -> "Settings":
        matting_model = os.getenv("METTI_MATTING_MODEL", "u2net").strip()
        return cls(
            api_key=os.getenv("METTI_PROCESSOR_API_KEY", "").strip(),
            allow_anonymous=_env_bool("METTI_PROCESSOR_ALLOW_ANONYMOUS", False),
            backend=os.getenv("METTI_PROCESSOR_BACKEND", "grounded_sam2").strip(),
            detector_model=os.getenv(
                "METTI_DETECTOR_MODEL",
                "/models/yolov8s-worldv2.pt",
            ).strip(),
            sam_model=os.getenv("METTI_SAM_MODEL", "/models/sam2_b.pt").strip(),
            matting_model=matting_model or None,
            matting_enabled=_env_bool("METTI_MATTING_ENABLED", True),
            max_input_bytes=_env_int(
                "METTI_PROCESSOR_MAX_INPUT_BYTES",
                5 * 1024 * 1024,
                5 * 1024 * 1024,
            ),
            max_pixels=_env_int(
                "METTI_PROCESSOR_MAX_PIXELS",
                20_000_000,
                40_000_000,
            ),
            max_output_bytes=_env_int(
                "METTI_PROCESSOR_MAX_OUTPUT_BYTES",
                8 * 1024 * 1024,
                16 * 1024 * 1024,
            ),
        )


class AuthenticationError(ProcessorError):
    status_code = 401
    code = "invalid_processor_credentials"


class ProcessorRuntime:
    def __init__(self, settings: Settings, segmenter: Segmenter | None = None):
        self.settings = settings
        self._segmenter = segmenter
        self._load_error: ModelNotReadyError | None = None
        self._load_lock = threading.Lock()

    def get(self) -> Segmenter:
        if self._segmenter is not None:
            return self._segmenter
        if self._load_error is not None:
            raise self._load_error
        with self._load_lock:
            if self._segmenter is not None:
                return self._segmenter
            if self._load_error is not None:
                raise self._load_error
            try:
                if not self.settings.api_key and not self.settings.allow_anonymous:
                    raise ModelNotReadyError(
                        "METTI_PROCESSOR_API_KEY is required unless anonymous mode is enabled."
                    )
                self._segmenter = create_segmenter(
                    self.settings.backend,
                    detector_model=self.settings.detector_model,
                    sam_model=self.settings.sam_model,
                    matting_model=self.settings.matting_model,
                    matting_enabled=self.settings.matting_enabled,
                )
                return self._segmenter
            except ModelNotReadyError as error:
                self._load_error = error
                raise
            except Exception as error:
                self._load_error = ModelNotReadyError(
                    "The image processor models are not ready."
                )
                raise self._load_error from error

    @property
    def ready(self) -> bool:
        return self._segmenter is not None and self._load_error is None


async def _read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise InvalidImageError("The uploaded image is too large.")
        chunks.append(chunk)
    return b"".join(chunks)


def _normalized_content_type(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().lower()


def _check_access(
    settings: Settings,
    authorization: str | None,
    x_api_key: str | None,
) -> None:
    if not settings.api_key:
        if settings.allow_anonymous:
            return
        raise ModelNotReadyError("The processor API key is not configured.")
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    candidate = (x_api_key or bearer).strip()
    if not candidate or not hmac.compare_digest(candidate, settings.api_key):
        raise AuthenticationError("Invalid processor credentials.")


def _error_response(error: ProcessorError, request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "error": error.code,
            "message": str(error),
            "request_id": request_id,
        },
    )


def _success_payload(result: ProcessedCutout, request_id: str) -> dict[str, object]:
    return {
        "provider": result.provider,
        "image_base64": base64.b64encode(result.png_bytes).decode("ascii"),
        "mime_type": "image/png",
        "quality": result.quality,
        "request_id": request_id,
    }


def create_app(
    settings: Settings | None = None,
    segmenter: Segmenter | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    runtime = ProcessorRuntime(resolved_settings, segmenter)
    app = FastAPI(
        title="Metti Wardrobe Image Processor",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
    )

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        try:
            runtime.get()
        except ModelNotReadyError as error:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "not_ready",
                    "backend": resolved_settings.backend,
                    "error": error.code,
                },
            )
        return JSONResponse(
            content={
                "status": "ok",
                "backend": resolved_settings.backend,
                "authentication": "api_key" if resolved_settings.api_key else "anonymous",
            }
        )

    @app.post("/process")
    async def process(
        image_file: UploadFile = File(...),
        preset: str = Form("wardrobe_card"),
        category: str = Form("accessory"),
        subcategory: str = Form(""),
        name: str = Form(""),
        target_width: int = Form(1024),
        target_height: int = Form(1024),
        background_color: str = Form("#F8F7F5"),
        padding: float = Form(0.12),
        shadow: str = Form("soft"),
        preserve_original_pixels: str = Form("true"),
        return_quality: str = Form("true"),
        authorization: str | None = Header(default=None),
        x_api_key: str | None = Header(default=None),
    ) -> JSONResponse:
        request_id = secrets.token_urlsafe(12)
        try:
            _check_access(resolved_settings, authorization, x_api_key)
            if preset not in ALLOWED_PRESETS:
                raise ProcessorError("Unsupported image preset.")
            if category not in ALLOWED_CATEGORIES:
                raise ProcessorError("Unsupported wardrobe category.")
            if target_width != 1024 or target_height != 1024:
                raise ProcessorError("Wardrobe cards must target 1024x1024.")
            if background_color.upper() != "#F8F7F5":
                raise ProcessorError("The wardrobe background must be #F8F7F5.")
            if shadow != "soft" or not (0 <= padding <= 0.25):
                raise ProcessorError("Unsupported card presentation parameters.")
            if preserve_original_pixels.strip().lower() not in {"true", "1"}:
                raise ProcessorError("preserve_original_pixels must be true.")
            if return_quality.strip().lower() not in {"true", "1"}:
                raise ProcessorError("return_quality must be true.")
            content_type = _normalized_content_type(image_file.content_type)
            if content_type not in ALLOWED_CONTENT_TYPES:
                raise InvalidImageError("Use JPEG, PNG, WebP, HEIC or HEIF images.")
            payload = await _read_limited(
                image_file,
                min(resolved_settings.max_input_bytes, 5 * 1024 * 1024),
            )
            source = decode_source(payload, content_type, resolved_settings.max_pixels)
            request = SegmentRequest(
                image=source,
                source_bytes=payload,
                preset=preset,
                category=category,
                subcategory=subcategory.strip() or None,
                name=name.strip() or None,
            )
            segmenter = await run_in_threadpool(runtime.get)
            result = await run_in_threadpool(
                process_image,
                request,
                segmenter,
                resolved_settings.max_output_bytes,
            )
            return JSONResponse(content=_success_payload(result, request_id))
        except ProcessorError as error:
            return _error_response(error, request_id)
        except Exception:
            # Never log image bytes or provider responses. The request id is
            # enough to correlate a generic 500 with a server-side trace.
            LOGGER.exception("Image processor request failed: %s", request_id)
            return JSONResponse(
                status_code=500,
                content={
                    "error": "processor_internal_error",
                    "message": "The image processor failed.",
                    "request_id": request_id,
                },
            )

    return app


app = create_app()
