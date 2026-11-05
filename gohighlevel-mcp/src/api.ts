/**
 * GoHighLevel API v2 client. Every tool goes through apiRequest so auth,
 * version headers, timeouts and error messages live in one place.
 */
export const DEFAULT_API_BASE_URL = "https://services.leadconnectorhq.com";

/** GoHighLevel versions its API per module. Calendars and conversations use the older date. */
export const VERSION_DEFAULT = "2021-07-28";
export const VERSION_CALENDARS = "2021-04-15";
export const VERSION_CONVERSATIONS = "2021-04-15";

export const CHARACTER_LIMIT = 25_000;
const TIMEOUT_MS = 30_000;

export interface Config {
  token: string;
  locationId: string;
  timezone: string;
  baseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.GHL_API_TOKEN?.trim();
  const locationId = env.GHL_LOCATION_ID?.trim();
  const missing = [!token && "GHL_API_TOKEN", !locationId && "GHL_LOCATION_ID"].filter(Boolean);
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(", ")}.\n` +
        "GHL_API_TOKEN is the Private Integration Token (Settings > Private Integrations in your sub-account).\n" +
        "GHL_LOCATION_ID is the sub-account ID (Settings > Business Profile, or the ID in the sub-account URL)."
    );
    process.exit(1);
  }
  return { token: token!, locationId: locationId!, timezone: env.GHL_TIMEZONE?.trim() || "Pacific/Auckland",
    // Override only for testing against a mock server
    baseUrl: env.GHL_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    detail: string
  ) {
    super(httpErrorMessage(status, detail));
  }
}

function httpErrorMessage(status: number, detail: string): string {
  const suffix = detail ? ` GoHighLevel said: ${detail}` : "";
  switch (status) {
    case 400:
    case 422:
      return `GoHighLevel rejected the request as invalid. Check the IDs, dates and field values.${suffix}`;
    case 401:
      return `GoHighLevel rejected the token. Check GHL_API_TOKEN is a current Private Integration Token (they can be rotated or revoked).${suffix}`;
    case 403:
      return `Permission denied. The Private Integration Token is missing the scope for this action, or the record belongs to another sub-account. Edit the integration's scopes in GoHighLevel.${suffix}`;
    case 404:
      return `Not found. Check the ID; use the matching search or list tool to find valid IDs.${suffix}`;
    case 429:
      return `GoHighLevel rate limit hit. Wait about 10 seconds and try again, and avoid large bursts of calls.${suffix}`;
    default:
      return status >= 500
        ? `GoHighLevel had a server error (HTTP ${status}). Try again shortly.${suffix}`
        : `GoHighLevel returned HTTP ${status}.${suffix}`;
  }
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Query;
  body?: unknown;
  version?: string;
}

export class GhlClient {
  constructor(readonly config: Config) {}

  async request<T = Record<string, unknown>>(path: string, options: RequestOptions, signal: AbortSignal): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Version: options.version ?? VERSION_DEFAULT,
          Accept: "application/json",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {})
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error("GoHighLevel did not respond within 30 seconds. Try again, or narrow the request.");
      }
      throw new Error(`Could not reach GoHighLevel (${(error as Error).message}). Check the internet connection.`);
    }

    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, extractDetail(text));
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text } as T;
    }
  }
}

function extractDetail(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    const message = parsed.message ?? parsed.error;
    if (Array.isArray(message)) return message.join("; ");
    if (typeof message === "string") return message;
  } catch {
    // not JSON
  }
  return text.slice(0, 300);
}
