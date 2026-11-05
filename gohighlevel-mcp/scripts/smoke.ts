/**
 * Self-check against a local mock of the GoHighLevel API. No real data is touched.
 * Starts the built server over stdio, calls every tool family, and checks the
 * HTTP requests the server makes (path, Version header, auth, body).
 *
 * Run with: npm run build && npm run smoke
 * Live check (read-only calls against the real API): GHL_LIVE=1 GHL_API_TOKEN=... GHL_LOCATION_ID=... npm run smoke
 */
import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  version: string | undefined;
  auth: string | undefined;
  body: unknown;
}

const live = process.env.GHL_LIVE === "1";
const seen: Seen[] = [];

const routes: Record<string, (r: Seen) => unknown> = {
  "POST /contacts/search": () => ({
    total: 1,
    contacts: [{ id: "c1", firstName: "Jane", lastName: "Doe", phone: "+64215551234", email: "jane@example.co.nz", city: "Tauranga", tags: ["deck-quote"] }]
  }),
  "GET /contacts/c1": () => ({ contact: { id: "c1", firstName: "Jane", lastName: "Doe", phone: "+64215551234", email: "jane@example.co.nz" } }),
  "GET /contacts/dnd1": () => ({ contact: { id: "dnd1", firstName: "Quiet", phone: "+6421000000", dnd: true } }),
  "POST /contacts/": r => ({ contact: { id: "c2", ...(r.body as object) } }),
  "POST /contacts/c1/notes": () => ({ note: { id: "n1" } }),
  "POST /contacts/c1/tags": () => ({ tags: ["deck-quote", "site-visit-booked"] }),
  "GET /opportunities/pipelines": () => ({ pipelines: [{ id: "p1", name: "Jobs", stages: [{ id: "s1", name: "New Lead" }, { id: "s2", name: "Quote Sent" }] }] }),
  "GET /opportunities/search": () => ({
    opportunities: [{ id: "o1", name: "Jane Doe - Deck", pipelineId: "p1", pipelineStageId: "s1", status: "open", monetaryValue: 18500, contact: { id: "c1", name: "Jane Doe" } }],
    meta: { total: 1 }
  }),
  "PUT /opportunities/o1": r => ({ opportunity: { id: "o1", name: "Jane Doe - Deck", pipelineId: "p1", status: "open", monetaryValue: 18500, ...(r.body as object) } }),
  "GET /calendars/": () => ({ calendars: [{ id: "cal1", name: "Site Visits" }] }),
  "GET /calendars/events": () => ({ events: [{ id: "e1", title: "Site visit", startTime: "2026-11-12T09:00:00+13:00", endTime: "2026-11-12T10:00:00+13:00", appointmentStatus: "confirmed", contactId: "c1" }] }),
  "GET /calendars/cal1/free-slots": () => ({ "2026-11-12": { slots: ["2026-11-12T09:00:00+13:00", "2026-11-12T13:00:00+13:00"] }, traceId: "t" }),
  "POST /calendars/events/appointments": r => ({ id: "e2", ...(r.body as object) }),
  "GET /conversations/search": () => ({ total: 1, conversations: [{ id: "conv1", contactId: "c1", fullName: "Jane Doe", lastMessageBody: "Hi, when can you come?", lastMessageType: "TYPE_SMS", unreadCount: 1 }] }),
  "POST /conversations/messages": () => ({ messageId: "m1", conversationId: "conv1" })
};

const mock = createServer(async (req: IncomingMessage, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const url = new URL(req.url ?? "/", "http://mock");
  const raw = Buffer.concat(chunks).toString();
  const record: Seen = {
    method: req.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
    version: req.headers["version"] as string | undefined,
    auth: req.headers.authorization,
    body: raw ? JSON.parse(raw) : undefined
  };
  seen.push(record);
  const handler = routes[`${record.method} ${record.path}`];
  res.setHeader("Content-Type", "application/json");
  if (!handler) {
    res.statusCode = 404;
    res.end(JSON.stringify({ message: `mock has no route for ${record.method} ${record.path}` }));
    return;
  }
  res.end(JSON.stringify(handler(record)));
});

let baseUrl = "";
if (!live) {
  await new Promise<void>(resolve => mock.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...getDefaultEnvironment(),
      GHL_API_TOKEN: live ? (process.env.GHL_API_TOKEN ?? "") : "pit-test-token",
      GHL_LOCATION_ID: live ? (process.env.GHL_LOCATION_ID ?? "") : "loc1",
      ...(live ? {} : { GHL_API_BASE_URL: baseUrl })
    }
  })
);

type CallResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: unknown };
async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return (await client.callTool({ name, arguments: args })) as CallResult;
}
function textOf(r: CallResult): string {
  return r.content.map(c => c.text ?? "").join("\n");
}
function ok(r: CallResult, label: string): string {
  assert.ok(!r.isError, `${label} failed: ${textOf(r)}`);
  return textOf(r);
}
const last = () => seen[seen.length - 1];

const { tools } = await client.listTools();
const names = tools.map(t => t.name).sort();
console.error(`Tools (${names.length}): ${names.join(", ")}`);
assert.equal(names.length, 23);
for (const tool of tools) {
  assert.ok(tool.description && tool.annotations, `${tool.name} needs a description and annotations`);
}
assert.equal(tools.find(t => t.name === "ghl_send_message")?.annotations?.destructiveHint, true);

// ---- Read-only calls (also run in live mode) ----
const search = ok(await call("ghl_search_contacts", { query: live ? "" : "Jane", limit: 5 }), "search contacts");
const pipelines = ok(await call("ghl_list_pipelines", {}), "list pipelines");
ok(await call("ghl_search_opportunities", { status: "open", limit: 5 }), "search opportunities");
ok(await call("ghl_list_calendars", {}), "list calendars");
ok(await call("ghl_search_conversations", { limit: 5 }), "search conversations");

if (live) {
  console.error("\n--- Live read-only results ---\n" + search.slice(0, 1500) + "\n\n" + pipelines.slice(0, 1500));
  await client.close();
  console.error("\nLive smoke test passed (read-only).");
  process.exit(0);
}

// ---- Mock-only checks of the wire format ----
assert.ok(search.includes("Jane Doe (c1)"));
const contactSearch = seen.find(s => s.path === "/contacts/search")!;
assert.equal(contactSearch.auth, "Bearer pit-test-token");
assert.equal(contactSearch.version, "2021-07-28");
assert.deepEqual(contactSearch.body, { locationId: "loc1", page: 1, pageLimit: 5, query: "Jane" });
assert.ok(pipelines.includes("Quote Sent (s2)"));
assert.equal(seen.find(s => s.path === "/opportunities/search")!.query.get("location_id"), "loc1");
assert.equal(seen.find(s => s.path === "/calendars/")!.version, "2021-04-15");
assert.equal(seen.find(s => s.path === "/conversations/search")!.version, "2021-04-15");

// NZ phone normalisation on create
ok(await call("ghl_create_contact", { first_name: "Sam", phone: "021 555 9876", city: "Papamoa" }), "create contact");
assert.deepEqual(last().body, { locationId: "loc1", country: "NZ", firstName: "Sam", phone: "+64215559876", city: "Papamoa" });

ok(await call("ghl_add_contact_note", { contact_id: "c1", body: "Measured deck, 6x4m" }), "add note");
ok(await call("ghl_add_contact_tags", { contact_id: "c1", tags: ["site-visit-booked"] }), "add tags");
assert.deepEqual(last().body, { tags: ["site-visit-booked"] });

const moved = ok(await call("ghl_update_opportunity", { opportunity_id: "o1", stage_id: "s2" }), "move opportunity");
assert.deepEqual(last().body, { pipelineStageId: "s2" });
assert.ok(moved.includes("Jobs > Quote Sent"), moved);

const events = ok(await call("ghl_list_calendar_events", { start: "2026-11-09T00:00:00+13:00", end: "2026-11-16T00:00:00+13:00" }), "list events");
assert.ok(events.includes("Site visit"));
const eventsReq = seen.find(s => s.path === "/calendars/events")!;
assert.equal(eventsReq.query.get("calendarId"), "cal1");
assert.equal(eventsReq.query.get("startTime"), String(Date.parse("2026-11-09T00:00:00+13:00")));

const slots = ok(await call("ghl_get_free_slots", { calendar_id: "cal1", start: "2026-11-12T00:00:00+13:00", end: "2026-11-13T00:00:00+13:00" }), "free slots");
assert.ok(slots.includes("2026-11-12"), slots);
assert.equal(last().query.get("timezone"), "Pacific/Auckland");

ok(
  await call("ghl_book_appointment", { calendar_id: "cal1", contact_id: "c1", start: "2026-11-12T09:00:00+13:00", title: "Site visit", address: "1 Example St, Tauranga" }),
  "book appointment"
);
assert.equal((last().body as { startTime: string }).startTime, "2026-11-11T20:00:00.000Z");

// ---- Send safety: preview never sends ----
const before = seen.filter(s => s.path === "/conversations/messages").length;
const preview = ok(await call("ghl_send_message", { contact_id: "c1", channel: "SMS", message: "Hi Jane, Ricki here. Can we pop round Thursday 9am?" }), "preview");
assert.ok(preview.startsWith("PREVIEW ONLY"), preview);
assert.equal(seen.filter(s => s.path === "/conversations/messages").length, before, "preview must not send");

const sent = ok(await call("ghl_send_message", { contact_id: "c1", channel: "SMS", message: "Hi Jane, Ricki here.", confirm: true }), "send");
assert.ok(sent.includes("Sent SMS"));
assert.deepEqual(last().body, { type: "SMS", contactId: "c1", message: "Hi Jane, Ricki here." });
assert.equal(last().version, "2021-04-15");

// DND contacts are blocked before anything is sent
const dnd = await call("ghl_send_message", { contact_id: "dnd1", channel: "SMS", message: "hello", confirm: true });
assert.equal(dnd.isError, true);
assert.ok(textOf(dnd).includes("Do Not Disturb"));

// Email without subject is rejected
assert.equal((await call("ghl_send_message", { contact_id: "c1", channel: "Email", message: "hi" })).isError, true);

// ---- Errors the model can act on ----
const notFound = await call("ghl_get_contact", { contact_id: "missing" });
assert.equal(notFound.isError, true);
assert.ok(textOf(notFound).includes("Not found"), textOf(notFound));
assert.equal((await call("ghl_search_contacts", { limit: 500 })).isError, true, "limit over 100 should be rejected");
assert.equal((await call("ghl_list_calendar_events", { start: "2026-11-01T00:00:00Z", end: "2026-12-20T00:00:00Z" })).isError, true, "range over 31 days");

await client.close();
mock.close();
console.error("Smoke test passed.");
