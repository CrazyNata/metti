import { AppError } from "./errors.ts";
import type {
  AuthContext,
  AuthenticatedUser,
  JsonObject,
  SupabaseConfig,
} from "./types.ts";

type FetchLike = typeof fetch;
type EnvReader = { get(name: string): string | undefined };

function asJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

export function getSupabaseConfig(env: EnvReader = Deno.env): SupabaseConfig {
  const url = String(env.get("SUPABASE_URL") ?? "").trim().replace(/\/$/, "");
  const publishableKey = String(
    env.get("SUPABASE_ANON_KEY") ??
      env.get("SUPABASE_PUBLISHABLE_KEY") ??
      (() => {
        try {
          return JSON.parse(env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}")
            ?.default ?? "";
        } catch (_) {
          return "";
        }
      })(),
  ).trim();

  if (!url || !publishableKey) {
    throw new AppError(
      "configuration_error",
      "Supabase environment is not configured.",
      500,
    );
  }

  return { url, publishableKey };
}

export function extractBearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match?.[1]) {
    throw new AppError(
      "authentication_required",
      "Authentication is required.",
      401,
    );
  }
  return match[1];
}

export async function authenticateRequest(
  request: Request,
  config: SupabaseConfig,
  fetchImpl: FetchLike = fetch,
): Promise<AuthContext> {
  const accessToken = extractBearerToken(request);
  const authorization = `Bearer ${accessToken}`;
  let response: Response;

  try {
    response = await fetchImpl(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.publishableKey,
        authorization,
        accept: "application/json",
      },
    });
  } catch (_) {
    throw new AppError(
      "data_access_error",
      "Не удалось проверить сессию пользователя.",
      502,
    );
  }

  if (!response.ok) {
    throw new AppError("invalid_session", "Invalid session.", 401);
  }

  const responseBody = await response.json().catch(() => null);
  const body = responseBody && typeof responseBody === "object" &&
      !Array.isArray(responseBody)
    ? responseBody as Record<string, unknown>
    : {};
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) throw new AppError("invalid_session", "Invalid session.", 401);

  const user: AuthenticatedUser = {
    id,
    ...(typeof body.email === "string" ? { email: body.email } : {}),
    ...(asJsonObject(body.user_metadata)
      ? { user_metadata: asJsonObject(body.user_metadata) }
      : {}),
  };

  return { accessToken, authorization, user };
}
