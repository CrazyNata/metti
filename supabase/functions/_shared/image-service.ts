import { AppError } from "./errors.ts";
import type {
  AuthenticatedUser,
  McpEmbeddedResource,
  McpImageContent,
  McpResourceLink,
  OpenAiFileInput,
  WardrobeImageInput,
} from "./types.ts";
import type { UserDataClient } from "./supabase-client.ts";

type FetchLike = typeof fetch;

export const WARDROBE_IMAGE_BUCKET = "wardrobe";
export const DEFAULT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_OPENAI_FILE_HOSTS = [
  "files.openai.com",
  "*.files.openai.com",
  "*.oaiusercontent.com",
  "*.chatgpt.com",
] as const;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

const EXTENSIONS: Record<SupportedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export interface ImageServiceOptions {
  fetchImpl?: FetchLike;
  allowedHosts?: string[];
  openAiFileHosts?: string[];
  maxBytes?: number;
  fetchTimeoutMs?: number;
  allowHttp?: boolean;
}

export interface PreparedImage {
  bytes: Uint8Array;
  contentType: SupportedImageMimeType;
  size: number;
}

export interface ImageResolution {
  file: PreparedImage | null;
  status: "attached" | "pending";
}

function normalizedMime(value: string | undefined): string {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function mimeFromFileName(value: string | undefined): string | undefined {
  const name = String(value ?? "").trim().toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  return undefined;
}

function supportedMime(
  value: string | undefined,
  field = "image",
): SupportedImageMimeType {
  const mime = normalizedMime(value);
  if (
    !SUPPORTED_IMAGE_MIME_TYPES.includes(mime as SupportedImageMimeType)
  ) {
    throw new AppError(
      "invalid_input",
      `${field} must use JPEG, PNG, WebP, HEIC or HEIF.`,
    );
  }
  return mime as SupportedImageMimeType;
}

function encodedLengthFor(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4 + 4;
}

function decodeBase64(value: string, maxBytes: number, field: string): Uint8Array {
  const encoded = value.replace(/\s+/g, "");
  if (!encoded || encoded.length > encodedLengthFor(maxBytes)) {
    throw new AppError("invalid_input", `${field} is too large.`);
  }
  if (
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new AppError("invalid_input", `${field} is not valid base64.`);
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch (_) {
    throw new AppError("invalid_input", `${field} is not valid base64.`);
  }
  if (binary.length === 0 || binary.length > maxBytes) {
    throw new AppError("invalid_input", `${field} is too large.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function startsWith(bytes: Uint8Array, values: number[]): boolean {
  return values.every((value, index) => bytes[index] === value);
}

function sniffMime(bytes: Uint8Array): SupportedImageMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) {
      return "image/heic";
    }
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

function assertContentMatchesMime(
  bytes: Uint8Array,
  contentType: SupportedImageMimeType,
): void {
  const detected = sniffMime(bytes);
  if (!detected) return;
  const heifFamily = (value: SupportedImageMimeType) =>
    value === "image/heic" || value === "image/heif";
  if (detected !== contentType && !(heifFamily(detected) && heifFamily(contentType))) {
    throw new AppError(
      "invalid_input",
      "The image content does not match its MIME type.",
    );
  }
}

function preparedImage(
  bytes: Uint8Array,
  mimeType: string | undefined,
  maxBytes: number,
  field = "image",
): PreparedImage {
  if (!bytes.length || bytes.byteLength > maxBytes) {
    throw new AppError("invalid_input", `${field} is too large or empty.`);
  }
  const contentType = supportedMime(mimeType, field);
  assertContentMatchesMime(bytes, contentType);
  return { bytes, contentType, size: bytes.byteLength };
}

function decodeDataUri(
  value: string,
  declaredMime: string | undefined,
  maxBytes: number,
): PreparedImage {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(value);
  if (!match) throw new AppError("invalid_input", "Image URI is invalid.");
  const contentType = supportedMime(declaredMime || match[1], "image");
  return preparedImage(
    decodeBase64(match[2], maxBytes, "image resource"),
    contentType,
    maxBytes,
  );
}

function normalizedHost(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    if (raw.includes("://")) return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
  return raw.replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }
  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return true;
  const [first, second] = numbers;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224;
}

function isBlockedHostname(value: string): boolean {
  const hostname = normalizedHost(value);
  if (!hostname) return true;
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "local" || hostname === "broadcasthost" ||
    isPrivateIpv4(hostname)
  ) return true;

  const ipv6 = hostname.replace(/^\[|\]$/g, "");
  if (!ipv6.includes(":")) return false;
  const lower = ipv6.toLowerCase();
  if (
    lower === "::" || lower === "::1" || lower.startsWith("fc") ||
    lower.startsWith("fd") || lower.startsWith("fe8") ||
    lower.startsWith("fe9") || lower.startsWith("fea") ||
    lower.startsWith("feb") || lower.startsWith("ff") ||
    lower.startsWith("100::")
  ) return true;
  const embeddedIpv4 = lower.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return embeddedIpv4 ? isPrivateIpv4(embeddedIpv4) : false;
}

function hostIsAllowed(hostname: string, allowedHosts: string[]): boolean {
  const host = normalizedHost(hostname);
  return allowedHosts.some((configured) => {
    const allowed = normalizedHost(configured);
    if (!allowed) return false;
    return allowed.startsWith("*.")
      ? host.endsWith(allowed.slice(1)) && host !== allowed.slice(2)
      : host === allowed;
  });
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) {
    throw new AppError("invalid_input", "Image exceeds the configured size limit.");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new AppError("invalid_input", "Image exceeds the configured size limit.");
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = new Uint8Array(next.value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError("invalid_input", "Image exceeds the configured size limit.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validStoragePath(path: string, userId: string): string {
  if (
    !path || path.length > 512 || path.includes("..") || path.includes("\\") ||
    path.includes("\0") || !path.startsWith(`${userId}/`)
  ) {
    throw new AppError(
      "invalid_input",
      "The image path must point to the authenticated user folder.",
    );
  }
  return path;
}

function validItemSegment(itemId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(itemId)) {
    throw new AppError("invalid_input", "itemId is invalid.");
  }
  return itemId;
}

export class ImageService {
  private readonly fetchImpl: FetchLike;
  private readonly allowedHosts: string[];
  private readonly openAiFileHosts: string[];
  private readonly maxBytes: number;
  private readonly fetchTimeoutMs: number;
  private readonly allowHttp: boolean;

  constructor(
    private readonly client: UserDataClient,
    private readonly user: AuthenticatedUser,
    options: ImageServiceOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowedHosts = (options.allowedHosts ?? []).map(normalizedHost).filter(
      Boolean,
    );
    this.openAiFileHosts = (
      options.openAiFileHosts ?? DEFAULT_OPENAI_FILE_HOSTS
    ).map(normalizedHost).filter(Boolean);
    this.maxBytes = options.maxBytes && options.maxBytes > 0
      ? Math.min(options.maxBytes, DEFAULT_IMAGE_MAX_BYTES)
      : DEFAULT_IMAGE_MAX_BYTES;
    this.fetchTimeoutMs = options.fetchTimeoutMs && options.fetchTimeoutMs > 0
      ? Math.min(options.fetchTimeoutMs, 60_000)
      : DEFAULT_IMAGE_FETCH_TIMEOUT_MS;
    this.allowHttp = options.allowHttp === true;
  }

  async resolve(input: WardrobeImageInput | undefined): Promise<ImageResolution> {
    if (!input) return { file: null, status: "pending" };
    if (input.type === "image") {
      const image = input as McpImageContent;
      return {
        file: preparedImage(
          decodeBase64(image.data, this.maxBytes, "image data"),
          image.mimeType,
          this.maxBytes,
        ),
        status: "attached",
      };
    }
    if (input.type === "resource") {
      const resource = (input as McpEmbeddedResource).resource;
      if (resource.blob !== undefined) {
        return {
          file: preparedImage(
            decodeBase64(resource.blob, this.maxBytes, "image resource"),
            resource.mimeType,
            this.maxBytes,
          ),
          status: "attached",
        };
      }
      if (resource.text !== undefined) {
        // Text resources may be legitimate MCP references, but this service
        // never treats text as image bytes and never fetches them.
        return { file: null, status: "pending" };
      }
      return this.resolveRemote(resource.uri, resource.mimeType);
    }
    const link = input as McpResourceLink;
    return this.resolveRemote(link.uri, link.mimeType);
  }

  async resolveOpenAiFile(input: OpenAiFileInput): Promise<ImageResolution> {
    const fileId = String(input.file_id ?? "").trim();
    if (!fileId || fileId.length > 256) {
      throw new AppError("invalid_input", "file.file_id is invalid.");
    }

    const downloadUrl = String(input.download_url ?? "").trim();
    const url = this.validateRemoteUri(downloadUrl);
    if (url.protocol !== "https:") {
      throw new AppError("invalid_input", "file.download_url must use HTTPS.");
    }

    return this.resolveRemote(
      url.toString(),
      input.mime_type ?? mimeFromFileName(input.file_name),
      this.openAiFileHosts,
    );
  }

  private async resolveRemote(
    uri: string,
    declaredMime?: string,
    allowedHosts = this.allowedHosts,
  ): Promise<ImageResolution> {
    const url = this.validateRemoteUri(uri);
    if (url.protocol === "data:") {
      return {
        file: decodeDataUri(uri, declaredMime, this.maxBytes),
        status: "attached",
      };
    }
    // An unconfigured host is deliberately a non-fatal fallback. The item can
    // still be created and the user can add the photo through the app later.
    if (!hostIsAllowed(url.hostname, allowedHosts)) {
      return { file: null, status: "pending" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) return { file: null, status: "pending" };

      if (declaredMime !== undefined) supportedMime(declaredMime, "image");
      const responseMime = normalizedMime(
        response.headers.get("content-type") ?? undefined,
      );
      const contentType = supportedMime(responseMime || declaredMime, "image");
      const bytes = await readLimitedBody(response, this.maxBytes);
      return {
        file: preparedImage(bytes, contentType, this.maxBytes),
        status: "attached",
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      return { file: null, status: "pending" };
    } finally {
      clearTimeout(timer);
    }
  }

  private validateRemoteUri(uri: string): URL {
    let url: URL;
    try {
      url = new URL(uri);
    } catch (_) {
      throw new AppError("invalid_input", "Image resource URI is invalid.");
    }
    if (url.protocol === "data:") return url;
    if (!url.hostname || !["https:", "http:"].includes(url.protocol)) {
      throw new AppError(
        "invalid_input",
        "Image resources must use an allowed HTTPS URI.",
      );
    }
    if (url.username || url.password || isBlockedHostname(url.hostname)) {
      throw new AppError("invalid_input", "Image resource URI is not allowed.");
    }
    if (url.protocol === "http:" && !this.allowHttp) {
      throw new AppError("invalid_input", "Image resources must use HTTPS.");
    }
    return url;
  }

  async uploadForItem(
    itemId: string,
    image: PreparedImage,
    existingPath?: string | null,
  ): Promise<string> {
    const safeItemId = validItemSegment(itemId);
    const path = existingPath
      ? validStoragePath(existingPath, this.user.id)
      : `${this.user.id}/${safeItemId}-${crypto.randomUUID()}.${
        EXTENSIONS[image.contentType]
      }`;
    await this.client.uploadObject(
      WARDROBE_IMAGE_BUCKET,
      path,
      image.bytes,
      image.contentType,
      Boolean(existingPath),
    );
    return path;
  }

  async removePath(path: string): Promise<void> {
    await this.client.removeObjects(
      WARDROBE_IMAGE_BUCKET,
      [validStoragePath(path, this.user.id)],
    );
  }
}
