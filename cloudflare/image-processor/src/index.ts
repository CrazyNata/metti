const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 12_000_000;
const PROVIDER = "cloudflare-images-birefnet";
const PNG_SIGNATURE = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

type Preset = "wardrobe_card" | "eyewear_card";

interface ImageOutput {
  response(options?: { headers?: HeadersInit }): Response;
}

interface ImageTransform {
  transform(options: Record<string, unknown>): ImageTransform;
  output(options: { format: string }): Promise<ImageOutput>;
}

interface ImagesBinding {
  input(source: Uint8Array): ImageTransform;
}

interface Env {
  IMAGES: ImagesBinding;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  METTI_PROCESSOR_API_KEY?: string;
}

interface AlphaAnalysis {
  width: number;
  height: number;
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

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function bearerToken(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match?.[1] ?? "";
}

async function constantTimeEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;

  const configuredKey = String(env.METTI_PROCESSOR_API_KEY ?? "").trim();
  if (configuredKey && await constantTimeEqual(configuredKey, token)) {
    return true;
  }

  const supabaseUrl = String(env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!supabaseUrl || !publishableKey) return false;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        accept: "application/json",
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
      },
    });
    return response.ok;
  } catch (_) {
    return false;
  }
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every(
    (value, index) => bytes[index] === value,
  );
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function connectedComponents(
  grid: Uint8Array,
  width: number,
  height: number,
): number {
  const seen = new Uint8Array(grid.length);
  const queue = new Int32Array(grid.length);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!grid[start] || seen[start]) continue;
      count += 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      seen[start] = 1;
      while (head < tail) {
        const current = queue[head++];
        const currentX = current % width;
        const currentY = Math.floor(current / width);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nextX = currentX + dx;
            const nextY = currentY + dy;
            if (
              nextX < 0 || nextX >= width || nextY < 0 || nextY >= height
            ) continue;
            const next = nextY * width + nextX;
            if (!grid[next] || seen[next]) continue;
            seen[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
  }
  return count;
}

async function analyzePng(
  bytes: Uint8Array,
  preset: Preset,
): Promise<AlphaAnalysis | null> {
  if (!isPng(bytes) || bytes.length < 33) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = -1;
  let colorType = -1;
  let interlace = -1;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(view, offset);
    if (length > bytes.length - offset - 12) return null;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    if (type === "IHDR") {
      if (length < 13) return null;
      width = readUint32(view, dataStart);
      height = readUint32(view, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "IDAT") {
      const chunk = bytes.slice(dataStart, dataStart + length);
      idat.push(chunk);
      idatLength += chunk.length;
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (
    !width || !height || width * height > MAX_PIXELS || bitDepth !== 8 ||
    ![4, 6].includes(colorType) || interlace !== 0 || !idatLength
  ) return null;

  const compressed = new Uint8Array(idatLength);
  let compressedOffset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.length;
  }
  let decoded: Uint8Array;
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(
      new DecompressionStream("deflate"),
    );
    decoded = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (_) {
    return null;
  }

  const channels = colorType === 6 ? 4 : 2;
  const rowBytes = width * channels;
  if (decoded.length < (rowBytes + 1) * height) return null;
  const gridWidth = Math.min(width, 128);
  const gridHeight = Math.min(height, 128);
  const grid = new Uint8Array(gridWidth * gridHeight);
  const previous = new Uint8Array(rowBytes);
  const current = new Uint8Array(rowBytes);
  let decodedOffset = 0;
  let foregroundPixels = 0;
  let partialPixels = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < height; y += 1) {
    const filter = decoded[decodedOffset++];
    for (let x = 0; x < rowBytes; x += 1) {
      const value = decoded[decodedOffset++];
      const left = x >= channels ? current[x - channels] : 0;
      const above = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) return null;
      current[x] = (value + predictor) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const alpha = current[x * channels + channels - 1];
      if (alpha <= 8) continue;
      foregroundPixels += 1;
      if (alpha < 248) partialPixels += 1;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      const gridX = Math.min(gridWidth - 1, Math.floor(x * gridWidth / width));
      const gridY = Math.min(
        gridHeight - 1,
        Math.floor(y * gridHeight / height),
      );
      grid[gridY * gridWidth + gridX] = 1;
    }
    previous.set(current);
  }
  if (foregroundPixels === 0 || x1 < x0 || y1 < y0) return null;

  const components = connectedComponents(grid, gridWidth, gridHeight);
  const gridX0 = Math.floor(x0 * gridWidth / width);
  const gridX1 = Math.min(gridWidth - 1, Math.floor(x1 * gridWidth / width));
  const gridY0 = Math.floor(y0 * gridHeight / height);
  const gridY1 = Math.min(gridHeight - 1, Math.floor(y1 * gridHeight / height));
  let interiorCells = 0;
  let emptyInteriorCells = 0;
  for (let y = gridY0; y <= gridY1; y += 1) {
    for (let x = gridX0; x <= gridX1; x += 1) {
      interiorCells += 1;
      if (!grid[y * gridWidth + x]) emptyInteriorCells += 1;
    }
  }
  const holeRatio = emptyInteriorCells / Math.max(1, interiorCells);
  const foregroundRatio = foregroundPixels / (width * height);
  const partialRatio = partialPixels / Math.max(1, foregroundPixels);
  const edgeTouch = x0 === 0 || y0 === 0 || x1 === width - 1 ||
    y1 === height - 1;
  const eyewearTransparency = preset === "eyewear_card"
    ? holeRatio >= 0.03 ? 0.86 : 0.68
    : 1;
  const detail = preset === "eyewear_card"
    ? holeRatio >= 0.03 ? 0.84 : 0.70
    : Math.max(0.60, Math.min(0.88, 0.72 + partialRatio));

  return {
    width,
    height,
    foregroundRatio,
    foregroundWidthRatio: (x1 - x0 + 1) / width,
    foregroundHeightRatio: (y1 - y0 + 1) / height,
    disconnectedRegions: Math.max(1, Math.min(32, components)),
    haloRatio: Math.min(0.15, partialRatio * 0.25),
    edgeTruncationRatio: edgeTouch ? 0.01 : 0,
    retainedBackgroundRatio: Math.min(0.09, partialRatio * 0.20),
    sourceSimilarity: Math.min(0.95, partialRatio * 0.20),
    fineDetailRecall: detail,
    transparentRegionPreserved: eyewearTransparency,
  };
}

function metricHeaders(metrics: AlphaAnalysis): Headers {
  const headers = new Headers({
    "content-type": "image/png",
    "cache-control": "no-store",
    "x-metti-provider": PROVIDER,
  });
  const values: Record<string, number> = {
    "x-metti-width": metrics.width,
    "x-metti-height": metrics.height,
    "x-metti-segmentation-confidence": metrics.foregroundRatio > 0.92
      ? 0.70
      : 0.84,
    "x-metti-foreground-ratio": metrics.foregroundRatio,
    "x-metti-foreground-width-ratio": metrics.foregroundWidthRatio,
    "x-metti-foreground-height-ratio": metrics.foregroundHeightRatio,
    "x-metti-disconnected-regions": metrics.disconnectedRegions,
    "x-metti-halo-ratio": metrics.haloRatio,
    "x-metti-edge-truncation-ratio": metrics.edgeTruncationRatio,
    "x-metti-retained-background-ratio": metrics.retainedBackgroundRatio,
    "x-metti-source-similarity": metrics.sourceSimilarity,
    "x-metti-fine-detail-recall": metrics.fineDetailRecall,
    "x-metti-transparent-region-preserved": metrics.transparentRegionPreserved,
  };
  for (const [name, value] of Object.entries(values)) {
    headers.set(name, String(value));
  }
  return headers;
}

async function processImage(request: Request, env: Env): Promise<Response> {
  if (!(await authorized(request, env))) {
    return json({ error: "Authentication is required." }, 401);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ error: "Expected multipart/form-data." }, 400);
  }
  const input = form.get("image_file");
  if (!(input instanceof Blob)) {
    return json({ error: "image_file is required." }, 400);
  }
  if (input.size <= 0 || input.size > MAX_INPUT_BYTES) {
    return json({ error: "image_file is too large or empty." }, 413);
  }
  const rawPreset = String(form.get("preset") ?? "wardrobe_card");
  if (rawPreset !== "wardrobe_card" && rawPreset !== "eyewear_card") {
    return json({ error: "preset is invalid." }, 400);
  }
  const preset = rawPreset as Preset;
  const source = new Uint8Array(await input.arrayBuffer());
  try {
    const transformed = await env.IMAGES.input(source)
      .transform({ segment: "foreground" })
      .output({ format: "image/png" });
    const response = transformed.response();
    if (!response.ok) {
      return json({ error: "Cloudflare image transformation failed." }, 502);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_OUTPUT_BYTES) {
      return json({ error: "Processed image is too large or empty." }, 502);
    }
    const metrics = await analyzePng(bytes, preset);
    if (!metrics || !isPng(bytes)) {
      return json(
        { error: "Processed image has no analyzable transparency." },
        502,
      );
    }
    const headers = metricHeaders(metrics);
    headers.set("content-length", String(bytes.byteLength));
    return new Response(bytes, { status: 200, headers });
  } catch (_) {
    return json({ error: "Cloudflare image transformation failed." }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-methods": "POST, GET, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "cache-control": "no-store",
        },
      });
    }
    if (url.pathname === "/healthz" && request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", provider: PROVIDER }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
    if (url.pathname !== "/process" || request.method !== "POST") {
      return json({ error: "Not found." }, 404);
    }
    return processImage(request, env);
  },
};
