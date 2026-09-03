import { AppError, publicErrorPayload, toAppError } from "../_shared/errors.ts";
import { authenticateRequest, getSupabaseConfig } from "../_shared/auth.ts";
import {
  DEFAULT_IMAGE_MAX_BYTES,
  imageServiceOptionsFromEnv,
} from "../_shared/image-service.ts";
import { createApplicationServices } from "../_shared/services.ts";
import { SupabaseRestClient } from "../_shared/supabase-client.ts";
import type {
  WardrobeItemInput,
  WardrobeItemUpdate,
} from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type, accept",
  "Access-Control-Allow-Methods": "POST, PATCH, OPTIONS",
};

const MAX_MULTIPART_REQUEST_BYTES = DEFAULT_IMAGE_MAX_BYTES + 512 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseItem(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return objectValue(JSON.parse(value));
    } catch (_) {
      throw new AppError("invalid_input", "Поле item должно быть JSON.");
    }
  }
  const result = objectValue(value);
  if (!Object.keys(result).length) {
    throw new AppError("invalid_input", "Данные вещи не переданы.");
  }
  return { ...result };
}

function fileMimeType(file: File): string {
  const declared = String(file.type ?? "").split(";", 1)[0].trim()
    .toLowerCase();
  if (declared) return declared;
  const name = String(file.name ?? "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  return "";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

function withoutTransportFields(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...value };
  // Ownership and storage paths are server concerns. The endpoint accepts
  // only the same domain fields that WardrobeService already validates.
  delete result.user_id;
  delete result.userId;
  delete result.id;
  delete result.itemId;
  delete result.item_id;
  delete result.image;
  delete result.imageFile;
  return result;
}

interface ParsedRequest {
  item: Record<string, unknown>;
  itemId?: string;
  file?: File;
}

async function parseRequest(request: Request): Promise<ParsedRequest> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_MULTIPART_REQUEST_BYTES) {
    throw new AppError("invalid_input", "Фотография слишком большая.", 413);
  }

  const contentType = String(request.headers.get("content-type") ?? "")
    .toLowerCase();
  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const item = parseItem(form.get("item"));
    const rawItemId = form.get("item_id") ?? form.get("itemId");
    const itemId = typeof rawItemId === "string" ? rawItemId.trim() : "";
    const rawFile = form.get("image");
    if (rawFile !== null && typeof rawFile === "string") {
      throw new AppError("invalid_input", "Поле image должно быть файлом.");
    }
    if (rawFile && rawFile.size > DEFAULT_IMAGE_MAX_BYTES) {
      throw new AppError(
        "invalid_input",
        "Фотография должна быть меньше 5 МБ.",
      );
    }
    return {
      item: withoutTransportFields(item),
      ...(itemId ? { itemId } : {}),
      ...(rawFile ? { file: rawFile } : {}),
    };
  }

  const body = await request.json().catch(() => {
    throw new AppError("invalid_input", "Тело запроса должно быть JSON.");
  });
  const record = objectValue(body);
  const item = parseItem(record.item ?? record);
  const rawItemId = record.itemId ?? record.item_id;
  return {
    item: withoutTransportFields(item),
    ...(typeof rawItemId === "string" && rawItemId.trim()
      ? { itemId: rawItemId.trim() }
      : {}),
  };
}

async function imageInput(file: File): Promise<{
  type: "image";
  data: string;
  mimeType: string;
}> {
  const mimeType = fileMimeType(file);
  if (!mimeType) {
    throw new AppError(
      "invalid_input",
      "У фотографии должно быть расширение JPEG, PNG, WebP, HEIC или HEIF.",
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.byteLength > DEFAULT_IMAGE_MAX_BYTES) {
    throw new AppError("invalid_input", "Фотография должна быть меньше 5 МБ.");
  }
  return { type: "image", data: bytesToBase64(bytes), mimeType };
}

async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST" && request.method !== "PATCH") {
    return json({ error: "Method not allowed." }, 405);
  }

  const config = getSupabaseConfig();
  const auth = await authenticateRequest(request, config);
  const parsed = await parseRequest(request);
  const input = parsed.item;
  if (parsed.file) {
    if (input.image !== undefined || input.imageFile !== undefined) {
      throw new AppError(
        "invalid_input",
        "Передайте фотографию только в поле image.",
      );
    }
    input.image = await imageInput(parsed.file);
  }

  const services = createApplicationServices(
    new SupabaseRestClient(
      config,
      auth.accessToken,
    ),
    auth.user,
    {
      image: {
        ...imageServiceOptionsFromEnv(
          Deno.env,
          "https://metti-image-processor.road-guide-natasha7261.workers.dev/process",
        ),
        processorAuthToken: auth.accessToken,
      },
      wardrobe: { imageOrigin: "app" },
    },
  );

  if (request.method === "POST") {
    if (parsed.itemId) {
      throw new AppError("invalid_input", "POST не принимает item_id.");
    }
    return json(
      await services.wardrobe.add(input as unknown as WardrobeItemInput),
    );
  }

  if (!parsed.itemId) {
    throw new AppError("invalid_input", "Для PATCH нужен item_id.");
  }
  return json(
    await services.wardrobe.update(
      parsed.itemId,
      input as unknown as WardrobeItemUpdate,
    ),
  );
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    const safe = toAppError(error);
    return json(publicErrorPayload(safe), safe.status);
  }
});
