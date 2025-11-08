import { SNOWFLAKE_API_BASE, SNOWFLAKE_API_KEY } from "./config";

type Primitive = string | number | boolean;

export type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | Record<string, unknown> | null;
  searchParams?: Record<string, Primitive | undefined>;
};

function joinPath(base: string, path: string): string {
  if (!base) {
    throw new Error("VITE_SNOWFLAKE_API_BASE is not configured.");
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedBase = base;
  if (!path) return normalizedBase;
  const needsSlash = !path.startsWith("/");
  const suffix = needsSlash ? `/${path}` : path;
  return `${normalizedBase}${suffix}`;
}

function addSearchParams(url: string, params?: Record<string, Primitive | undefined>): string {
  if (!params) return url;
  const qp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    qp.append(key, String(value));
  });
  const query = qp.toString();
  if (!query) return url;
  return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

async function readErrorPayload(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text || resp.statusText;
  } catch {
    return resp.statusText;
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const url = addSearchParams(joinPath(SNOWFLAKE_API_BASE, path), options.searchParams);
  const headers = new Headers(options.headers);

  let body: BodyInit | undefined;
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody) {
    if (options.body instanceof FormData || options.body instanceof Blob) {
      body = options.body;
    } else if (typeof options.body === "string") {
      body = options.body;
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    } else {
      body = JSON.stringify(options.body);
      headers.set("Content-Type", "application/json");
    }
  }

  if (SNOWFLAKE_API_KEY && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${SNOWFLAKE_API_KEY}`);
  }

  const response = await fetch(url, {
    method: options.method ?? (hasBody ? "POST" : "GET"),
    headers,
    body,
  });

  if (!response.ok) {
    const detail = await readErrorPayload(response);
    throw new Error(detail || `Snowflake API error (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
