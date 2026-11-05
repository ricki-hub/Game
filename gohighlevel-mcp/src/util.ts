/**
 * Shared helpers: NZ-friendly phone and date handling, output formatting.
 */
import * as z from "zod/v4";
import { CHARACTER_LIMIT } from "./api.js";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

export const responseFormatField = z
  .enum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("'markdown' for a readable summary (default), 'json' for the full structured data");

export type Rec = Record<string, unknown>;

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Rec;
}

/** Return Markdown, or the data as JSON text plus structuredContent. */
export function respond(format: ResponseFormat, data: Rec, markdown: () => string): ToolResult {
  if (format === ResponseFormat.JSON) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
  }
  return { content: [{ type: "text", text: markdown() }] };
}

export function text(message: string): ToolResult {
  return { content: [{ type: "text", text: message }] };
}

/**
 * Render a page of items, halving it until the output fits CHARACTER_LIMIT.
 * Returns how many items were kept so callers can point at the next page.
 */
export function fitToLimit<T>(items: T[], render: (subset: T[]) => ToolResult): { result: ToolResult; kept: number } {
  let subset = items;
  let result = render(subset);
  while (subset.length > 1 && result.content[0].text.length > CHARACTER_LIMIT) {
    subset = subset.slice(0, Math.ceil(subset.length / 2));
    result = render(subset);
  }
  return { result, kept: subset.length };
}

/**
 * Normalise NZ phone numbers to E.164, which GoHighLevel needs for SMS.
 * "021 123 4567" -> "+64211234567", "07 578 1234" -> "+6475781234". Already-international numbers pass through.
 */
export function normalisePhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("64")) return `+${digits}`;
  if (digits.startsWith("0")) return `+64${digits.slice(1)}`;
  return `+64${digits}`;
}

/** Parse an ISO date/time, or throw a message the model can act on. */
export function toDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} "${value}" is not a valid date. Use ISO 8601 with an offset, e.g. 2026-11-12T09:00:00+13:00.`);
  }
  return date;
}

/** Format a timestamp (ms, seconds or ISO string) for a person in the configured timezone. */
export function formatWhen(value: unknown, timezone: string): string {
  if (value === undefined || value === null || value === "") return "unknown";
  let date: Date;
  if (typeof value === "number") date = new Date(value < 1e12 ? value * 1000 : value);
  else if (typeof value === "string" && /^\d+$/.test(value)) date = new Date(Number(value));
  else date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-NZ", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
}

export function nzd(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "not set";
  return n.toLocaleString("en-NZ", { style: "currency", currency: "NZD" });
}

export function str(value: unknown, fallback = ""): string {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

export function arr(value: unknown): Rec[] {
  return Array.isArray(value) ? (value as Rec[]) : [];
}

/** Drop undefined fields so PUT requests only change what was asked. */
export function compact<T extends Rec>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
export const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
