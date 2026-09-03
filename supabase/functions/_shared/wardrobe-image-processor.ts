import type { ImageMimeType, PreparedImage } from "./image-service.ts";
import type { WardrobeCategory } from "./types.ts";

export const WARDROBE_CARD_SIZE = 1024;
export const WARDROBE_CARD_BACKGROUND = "#F8F7F5";

export type WardrobeImagePreset = "wardrobe_card" | "eyewear_card";

export interface ImageProcessingRequest {
  image: PreparedImage;
  category: WardrobeCategory;
  subcategory?: string | null;
  name?: string | null;
  preset: WardrobeImagePreset;
}

/**
 * Metrics are returned by the segmentation/matting service together with the
 * cutout. They are deliberately required: a binary image without quality
 * evidence must never be promoted to a finished wardrobe card.
 */
export interface ImageQualityMetrics {
  width: number;
  height: number;
  segmentationConfidence: number;
  foregroundRatio: number;
  foregroundWidthRatio: number;
  foregroundHeightRatio: number;
  disconnectedRegions: number;
  haloRatio: number;
  edgeTruncationRatio: number;
  retainedBackgroundRatio: number;
  sourceSimilarity: number;
  fineDetailRecall: number;
  transparentRegionPreserved: number;
}

export interface ImageProcessorResult {
  /** A transparent, tightly-cropped foreground PNG. */
  cutout: PreparedImage;
  quality: ImageQualityMetrics;
  provider?: string;
}

export interface WardrobeImageProcessor {
  process(input: ImageProcessingRequest): Promise<ImageProcessorResult>;
}

export interface ImageQualityValidation {
  valid: boolean;
  reasons: string[];
}

export interface HttpWardrobeImageProcessorOptions {
  endpoint: string;
  apiKey?: string;
  authToken?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_WARDROBE_CARD_BYTES = 5 * 1024 * 1024;

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(
  value: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const parsed = numberValue(value[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizedMime(value: string | null | undefined): string {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d &&
    bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function pngHasTransparency(bytes: Uint8Array): boolean {
  if (!isPng(bytes) || bytes.length < 33) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let colorType = -1;
  let hasTransparencyChunk = false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    if (length > bytes.length - offset - 12) return false;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    if (type === "IHDR") {
      if (length < 13) return false;
      // IHDR data is width, height, bit depth, then color type.
      colorType = bytes[offset + 17];
    }
    if (type === "tRNS") hasTransparencyChunk = true;
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return colorType === 4 || colorType === 6 || hasTransparencyChunk;
}

export function pngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

function base64ToBytes(value: string, maxBytes: number): Uint8Array {
  const encoded = value.replace(/\s+/g, "");
  if (!encoded || encoded.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error("Image processor output is too large.");
  }
  let binary: string;
  try {
    binary = atob(encoded);
  } catch (_) {
    throw new Error("Image processor returned invalid base64.");
  }
  if (!binary.length || binary.length > maxBytes) {
    throw new Error("Image processor output is empty or too large.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function metricObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function qualityFromObject(
  value: unknown,
  fallbackDimensions: { width: number; height: number } | null,
): ImageQualityMetrics | null {
  const source = metricObject(value);
  if (!source) return null;
  const width = firstNumber(source, "width", "image_width") ??
    fallbackDimensions?.width ?? null;
  const height = firstNumber(source, "height", "image_height") ??
    fallbackDimensions?.height ?? null;
  const quality: ImageQualityMetrics = {
    width: width ?? 0,
    height: height ?? 0,
    segmentationConfidence: firstNumber(
      source,
      "segmentationConfidence",
      "segmentation_confidence",
      "confidence",
    ) ?? -1,
    foregroundRatio: firstNumber(
      source,
      "foregroundRatio",
      "foreground_ratio",
      "object_area_ratio",
    ) ?? -1,
    foregroundWidthRatio: firstNumber(
      source,
      "foregroundWidthRatio",
      "foreground_width_ratio",
      "object_width_ratio",
    ) ?? -1,
    foregroundHeightRatio: firstNumber(
      source,
      "foregroundHeightRatio",
      "foreground_height_ratio",
      "object_height_ratio",
    ) ?? -1,
    disconnectedRegions: firstNumber(
      source,
      "disconnectedRegions",
      "disconnected_regions",
      "components",
    ) ?? -1,
    haloRatio: firstNumber(source, "haloRatio", "halo_ratio", "halo") ?? -1,
    edgeTruncationRatio: firstNumber(
      source,
      "edgeTruncationRatio",
      "edge_truncation_ratio",
      "edge_touch_ratio",
    ) ?? -1,
    retainedBackgroundRatio: firstNumber(
      source,
      "retainedBackgroundRatio",
      "retained_background_ratio",
      "background_ratio",
    ) ?? -1,
    sourceSimilarity: firstNumber(
      source,
      "sourceSimilarity",
      "source_similarity",
      "input_similarity",
    ) ?? -1,
    fineDetailRecall: firstNumber(
      source,
      "fineDetailRecall",
      "fine_detail_recall",
      "thin_detail_recall",
    ) ?? -1,
    transparentRegionPreserved: firstNumber(
      source,
      "transparentRegionPreserved",
      "transparent_region_preserved",
      "transparency_preserved",
    ) ?? -1,
  };
  return quality;
}

function headerMetrics(
  headers: Headers,
  dimensions: { width: number; height: number } | null,
): ImageQualityMetrics | null {
  const values: Record<string, unknown> = {
    width: headers.get("x-metti-width"),
    height: headers.get("x-metti-height"),
    segmentation_confidence: headers.get("x-metti-segmentation-confidence"),
    foreground_ratio: headers.get("x-metti-foreground-ratio"),
    foreground_width_ratio: headers.get("x-metti-foreground-width-ratio"),
    foreground_height_ratio: headers.get("x-metti-foreground-height-ratio"),
    disconnected_regions: headers.get("x-metti-disconnected-regions"),
    halo_ratio: headers.get("x-metti-halo-ratio"),
    edge_truncation_ratio: headers.get("x-metti-edge-truncation-ratio"),
    retained_background_ratio: headers.get("x-metti-retained-background-ratio"),
    source_similarity: headers.get("x-metti-source-similarity"),
    fine_detail_recall: headers.get("x-metti-fine-detail-recall"),
    transparent_region_preserved: headers.get(
      "x-metti-transparent-region-preserved",
    ),
  };
  return qualityFromObject(values, dimensions);
}

function qualityForResponse(
  payload: Record<string, unknown>,
  headers: Headers,
  dimensions: { width: number; height: number } | null,
): ImageQualityMetrics | null {
  return qualityFromObject(
    payload.quality ?? payload.metrics ?? payload.diagnostics,
    dimensions,
  ) ?? headerMetrics(headers, dimensions);
}

function responseBytesTooLarge(bytes: Uint8Array, maxBytes: number): void {
  if (!bytes.length || bytes.byteLength > maxBytes) {
    throw new Error("Image processor output is empty or too large.");
  }
}

function endpointUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (_) {
    throw new Error("Image processor URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Image processor URL must use HTTP(S).");
  }
  if (url.username || url.password) {
    throw new Error("Image processor URL must not contain credentials.");
  }
  return url.toString();
}

export class HttpWardrobeImageProcessor implements WardrobeImageProcessor {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpWardrobeImageProcessorOptions) {
    this.endpoint = endpointUrl(options.endpoint);
    this.apiKey = String(options.apiKey ?? "").trim();
    this.authToken = String(options.authToken ?? "").trim();
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0
      ? Math.min(options.timeoutMs, 120_000)
      : DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes && options.maxOutputBytes > 0
      ? Math.min(options.maxOutputBytes, 16 * 1024 * 1024)
      : DEFAULT_MAX_OUTPUT_BYTES;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async process(input: ImageProcessingRequest): Promise<ImageProcessorResult> {
    const form = new FormData();
    const sourceBuffer = new ArrayBuffer(input.image.bytes.byteLength);
    new Uint8Array(sourceBuffer).set(input.image.bytes);
    form.append(
      "image_file",
      new Blob([sourceBuffer], { type: input.image.contentType }),
      "wardrobe-source",
    );
    form.append("preset", input.preset);
    form.append("category", input.category);
    form.append("subcategory", input.subcategory ?? "");
    form.append("name", input.name ?? "");
    form.append("target_width", String(WARDROBE_CARD_SIZE));
    form.append("target_height", String(WARDROBE_CARD_SIZE));
    form.append("background_color", WARDROBE_CARD_BACKGROUND);
    form.append("padding", "0.12");
    form.append("shadow", "soft");
    form.append("preserve_original_pixels", "true");
    form.append("return_quality", "true");

    const headers = new Headers({ accept: "application/json, image/png" });
    if (this.apiKey) {
      headers.set("authorization", `Bearer ${this.apiKey}`);
      headers.set("x-api-key", this.apiKey);
    } else if (this.authToken) {
      headers.set("authorization", `Bearer ${this.authToken}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(
        error instanceof Error && error.name === "AbortError"
          ? "Image processor timed out."
          : "Image processor is unavailable.",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Image processor failed with HTTP ${response.status}.`);
    }

    const contentType = normalizedMime(response.headers.get("content-type"));
    let bytes: Uint8Array;
    let quality: ImageQualityMetrics | null = null;
    let provider = response.headers.get("x-metti-provider") ?? undefined;
    let outputMime = contentType || "image/png";
    if (contentType === "application/json" || contentType.endsWith("+json")) {
      const payload = await response.json() as Record<string, unknown>;
      const encoded = payload.image_base64 ?? payload.data;
      if (typeof encoded !== "string") {
        throw new Error("Image processor did not return image bytes.");
      }
      bytes = base64ToBytes(encoded, this.maxOutputBytes);
      outputMime = normalizedMime(
        typeof payload.mime_type === "string"
          ? payload.mime_type
          : typeof payload.content_type === "string"
          ? payload.content_type
          : "image/png",
      );
      provider = typeof payload.provider === "string"
        ? payload.provider
        : provider;
      quality = qualityForResponse(
        payload,
        response.headers,
        pngDimensions(bytes),
      );
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      responseBytesTooLarge(bytes, this.maxOutputBytes);
      quality = headerMetrics(response.headers, pngDimensions(bytes));
    }

    responseBytesTooLarge(bytes, this.maxOutputBytes);
    if (
      !isPng(bytes) || !pngHasTransparency(bytes) || outputMime !== "image/png"
    ) {
      throw new Error("Image processor must return a transparent PNG cutout.");
    }
    if (!quality) {
      throw new Error("Image processor did not return quality metrics.");
    }
    return {
      cutout: {
        bytes,
        contentType: "image/png",
        size: bytes.byteLength,
      },
      quality,
      provider: provider || "http-image-processor",
    };
  }
}

export function imagePresetForWardrobeItem(
  category: WardrobeCategory,
  subcategory?: string | null,
  name?: string | null,
): WardrobeImagePreset {
  const value = [category, subcategory, name].filter(Boolean).join(" ")
    .normalize("NFKC").toLocaleLowerCase();
  return /(?:^|[\s_-])(glasses|sunglasses|eyeglasses|eyewear|optical_glasses|optical glasses)(?:$|[\s_-])/
      .test(
        value,
      )
    ? "eyewear_card"
    : "wardrobe_card";
}

const QUALITY_LIMITS: Record<WardrobeImagePreset, {
  confidence: number;
  maxDisconnected: number;
  minFineDetailRecall: number;
}> = {
  wardrobe_card: {
    confidence: 0.72,
    maxDisconnected: 8,
    minFineDetailRecall: 0.55,
  },
  eyewear_card: {
    confidence: 0.78,
    maxDisconnected: 14,
    // The detector/SAM metric is intentionally conservative for tinted
    // lenses: reflections create image edges that are not object boundaries.
    // Background, halo and component checks remain strict for eyewear.
    minFineDetailRecall: 0.60,
  },
};

function between(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function validateImageQuality(
  quality: ImageQualityMetrics,
  preset: WardrobeImagePreset,
): ImageQualityValidation {
  const limits = QUALITY_LIMITS[preset];
  const reasons: string[] = [];
  if (!Number.isInteger(quality.width) || quality.width < 16) {
    reasons.push("invalid_cutout_width");
  }
  if (!Number.isInteger(quality.height) || quality.height < 16) {
    reasons.push("invalid_cutout_height");
  }
  if (!between(quality.segmentationConfidence, limits.confidence, 1)) {
    reasons.push("low_segmentation_confidence");
  }
  if (!between(quality.foregroundRatio, 0.01, 0.92)) {
    reasons.push("invalid_foreground_ratio");
  }
  if (!between(quality.foregroundWidthRatio, 0.04, 0.98)) {
    reasons.push("invalid_foreground_width");
  }
  if (!between(quality.foregroundHeightRatio, 0.04, 0.98)) {
    reasons.push("invalid_foreground_height");
  }
  if (
    !Number.isInteger(quality.disconnectedRegions) ||
    quality.disconnectedRegions < 1 ||
    quality.disconnectedRegions > limits.maxDisconnected
  ) {
    reasons.push("too_many_disconnected_regions");
  }
  if (!between(quality.haloRatio, 0, 0.16)) reasons.push("halo_detected");
  if (!between(quality.edgeTruncationRatio, 0, 0.01)) {
    reasons.push("object_truncated");
  }
  if (!between(quality.retainedBackgroundRatio, 0, 0.10)) {
    reasons.push("background_retained");
  }
  if (!between(quality.sourceSimilarity, 0, 0.985)) {
    reasons.push("background_not_removed");
  }
  if (!between(quality.fineDetailRecall, limits.minFineDetailRecall, 1)) {
    reasons.push("fine_details_lost");
  }
  if (
    preset === "eyewear_card" &&
    !between(quality.transparentRegionPreserved, 0.75, 1)
  ) {
    reasons.push("transparent_regions_lost");
  }
  return { valid: reasons.length === 0, reasons };
}

function base64(value: Uint8Array): string {
  let result = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    result += String.fromCharCode(
      ...value.subarray(offset, Math.min(value.length, offset + chunkSize)),
    );
  }
  return btoa(result);
}

/**
 * Composites the untouched cutout onto a new square SVG canvas. The SVG is an
 * image artifact, not a generated redraw: all visible item pixels come from
 * the provider's PNG, while the wrapper supplies the shared background and a
 * low-opacity soft shadow.
 */
export function composeWardrobeCard(
  cutout: PreparedImage,
  preset: WardrobeImagePreset,
): { bytes: Uint8Array; contentType: ImageMimeType; size: number } {
  if (
    cutout.contentType !== "image/png" || !pngHasTransparency(cutout.bytes)
  ) {
    throw new Error("Only transparent PNG cutouts can become wardrobe cards.");
  }
  const data = base64(cutout.bytes);
  const box = 0.80 * WARDROBE_CARD_SIZE;
  const margin = (WARDROBE_CARD_SIZE - box) / 2;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WARDROBE_CARD_SIZE}" height="${WARDROBE_CARD_SIZE}" viewBox="0 0 ${WARDROBE_CARD_SIZE} ${WARDROBE_CARD_SIZE}">
  <defs>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0 0 0 0 0.22 0 0 0 0 0.18 0 0 0 0 0.14 0 0 0 0.18 0"/>
      <feGaussianBlur stdDeviation="11"/>
    </filter>
  </defs>
  <rect width="${WARDROBE_CARD_SIZE}" height="${WARDROBE_CARD_SIZE}" fill="${WARDROBE_CARD_BACKGROUND}"/>
  <g opacity="0.65" transform="translate(0 8)" filter="url(#soft-shadow)">
   <image x="${margin}" y="${margin}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${data}"/>
  </g>
  <image x="${margin}" y="${margin}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${data}"/>
</svg>`;
  const bytes = new TextEncoder().encode(svg);
  if (bytes.byteLength > MAX_WARDROBE_CARD_BYTES) {
    throw new Error("Processed wardrobe card is too large.");
  }
  return { bytes, contentType: "image/svg+xml", size: bytes.byteLength };
}

export function createConfiguredWardrobeImageProcessor(options: {
  endpoint?: string;
  apiKey?: string;
  authToken?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  fetchImpl?: typeof fetch;
}): WardrobeImageProcessor | null {
  const endpoint = String(options.endpoint ?? "").trim();
  if (!endpoint) return null;
  return new HttpWardrobeImageProcessor({
    endpoint,
    apiKey: options.apiKey,
    authToken: options.authToken,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    fetchImpl: options.fetchImpl,
  });
}
