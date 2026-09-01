import { AppError } from "./errors.ts";
import type { SupabaseConfig } from "./types.ts";

type FetchLike = typeof fetch;

export interface UserDataClient {
  listRows<T>(table: string, query: URLSearchParams): Promise<T[]>;
  insertRow<T>(table: string, payload: unknown): Promise<T>;
  updateRows<T>(
    table: string,
    query: URLSearchParams,
    payload: unknown,
  ): Promise<T[]>;
  upsertRow<T>(
    table: string,
    query: URLSearchParams,
    payload: unknown,
  ): Promise<T>;
  uploadObject(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    upsert?: boolean,
  ): Promise<void>;
  removeObjects(bucket: string, paths: string[]): Promise<void>;
  createSignedUrls(
    bucket: string,
    paths: string[],
    expiresIn: number,
  ): Promise<Map<string, string>>;
}

function pathWithQuery(path: string, query?: URLSearchParams): string {
  const queryString = query?.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function parseSignedUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  return value;
}

export class SupabaseRestClient implements UserDataClient {
  constructor(
    private readonly config: SupabaseConfig,
    private readonly accessToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("apikey", this.config.publishableKey);
    headers.set("authorization", `Bearer ${this.accessToken}`);
    headers.set("accept", "application/json");
    if (options.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.url}${path}`, {
        ...options,
        headers,
      });
    } catch (_) {
      throw new AppError(
        "data_access_error",
        "Не удалось обратиться к хранилищу данных.",
        502,
      );
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (_) {
        body = text;
      }
    }

    if (!response.ok) {
      const status = response.status === 401
        ? 401
        : response.status >= 500
        ? 502
        : 400;
      const message = response.status === 401
        ? "Invalid session."
        : "Не удалось выполнить операцию с данными.";
      throw new AppError(
        response.status === 401 ? "invalid_session" : "data_access_error",
        message,
        status,
      );
    }

    return body as T;
  }

  listRows<T>(table: string, query: URLSearchParams): Promise<T[]> {
    return this.request<T[]>(pathWithQuery(`/rest/v1/${table}`, query), {
      method: "GET",
    });
  }

  async insertRow<T>(table: string, payload: unknown): Promise<T> {
    const body = await this.request<T[] | T>(`/rest/v1/${table}`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    return Array.isArray(body) ? body[0] as T : body as T;
  }

  async updateRows<T>(
    table: string,
    query: URLSearchParams,
    payload: unknown,
  ): Promise<T[]> {
    return this.request<T[]>(pathWithQuery(`/rest/v1/${table}`, query), {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
  }

  async upsertRow<T>(
    table: string,
    query: URLSearchParams,
    payload: unknown,
  ): Promise<T> {
    const body = await this.request<T[] | T>(
      pathWithQuery(`/rest/v1/${table}`, query),
      {
        method: "POST",
        headers: {
          prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(payload),
      },
    );
    return Array.isArray(body) ? body[0] as T : body as T;
  }

  async uploadObject(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    upsert = false,
  ): Promise<void> {
    const uploadBody = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(uploadBody).set(bytes);
    await this.request<unknown>(
      `/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/")
        .map(encodeURIComponent).join("/")}`,
      {
        method: "POST",
        headers: {
          "content-type": contentType,
          "cache-control": "3600",
          "x-upsert": String(upsert),
        },
        body: new Blob([uploadBody], { type: contentType }),
      },
    );
  }

  async removeObjects(bucket: string, paths: string[]): Promise<void> {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) return;
    await this.request<unknown>(
      `/storage/v1/object/remove/${encodeURIComponent(bucket)}`,
      {
        method: "POST",
        body: JSON.stringify({ prefixes: uniquePaths }),
      },
    );
  }

  async createSignedUrls(
    bucket: string,
    paths: string[],
    expiresIn: number,
  ): Promise<Map<string, string>> {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    const result = new Map<string, string>();
    if (!uniquePaths.length) return result;

    try {
      const body = await this.request<unknown>(
        `/storage/v1/object/sign/${encodeURIComponent(bucket)}`,
        {
          method: "POST",
          body: JSON.stringify({ expiresIn, paths: uniquePaths }),
        },
      );
      const rows = Array.isArray(body) ? body : [];
      rows.forEach((row) => {
        if (!row || typeof row !== "object") return;
        const value = row as Record<string, unknown>;
        const path = typeof value.path === "string" ? value.path : "";
        const url = parseSignedUrl(value.signedURL ?? value.signedUrl);
        if (path && url) result.set(path, this.absoluteStorageUrl(url));
      });
      if (result.size) return result;
    } catch (_) {
      // Older Storage API versions may not support the batch form; use one-by-one below.
    }

    await Promise.all(uniquePaths.map(async (path) => {
      try {
        const body = await this.request<Record<string, unknown>>(
          `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${
            path.split("/").map(encodeURIComponent).join("/")
          }`,
          { method: "POST", body: JSON.stringify({ expiresIn }) },
        );
        const url = parseSignedUrl(body?.signedURL ?? body?.signedUrl);
        if (url) result.set(path, this.absoluteStorageUrl(url));
      } catch (_) {
        // A missing/private image should not make the whole wardrobe unavailable.
      }
    }));

    return result;
  }

  private absoluteStorageUrl(value: string): string {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return value;
    }
    const path = value.startsWith("/") ? value : `/${value}`;
    return `${this.config.url}${
      path.startsWith("/storage/v1/") ? path : `/storage/v1${path}`
    }`;
  }
}
