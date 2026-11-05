import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type GhlClient, VERSION_CALENDARS } from "../api.js";
import { arr, compact, fitToLimit, formatWhen, READ_ONLY, type Rec, respond, responseFormatField, str, text, toDate, UPDATE, WRITE } from "../util.js";

const DAY_MS = 86_400_000;
const isoField = (what: string) => z.string().describe(`${what} in ISO 8601 with offset, e.g. 2026-11-12T09:00:00+13:00 (NZDT) or +12:00 (NZST)`);

export function registerCalendarTools(server: McpServer, ghl: GhlClient): void {
  const { locationId, timezone } = ghl.config;
  const v = { version: VERSION_CALENDARS };

  server.registerTool(
    "ghl_list_calendars",
    {
      title: "List calendars",
      description: "List the booking calendars in this sub-account with their IDs, e.g. 'Site Visits' or 'Measure & Quote'. Use the ID with the other calendar tools.",
      inputSchema: z.strictObject({ response_format: responseFormatField }),
      annotations: READ_ONLY
    },
    async ({ response_format }, ctx) => {
      const data = await ghl.request("/calendars/", { ...v, query: { locationId } }, ctx.mcpReq.signal);
      const calendars = arr(data.calendars);
      if (calendars.length === 0) return text("No calendars set up in this sub-account.");
      return respond(response_format, { calendars }, () =>
        ["# Calendars", "", ...calendars.map(c => `- ${str(c.name)} (${str(c.id)})${c.isActive === false ? " [inactive]" : ""}`)].join("\n")
      );
    }
  );

  server.registerTool(
    "ghl_list_calendar_events",
    {
      title: "List calendar events",
      description: `List booked appointments in a date range (max 31 days). Filter by calendar or team member.

Examples:
  - "What's on this week?" -> start/end covering this week
  - "Site visits tomorrow" -> calendar_id of the site visit calendar`,
      inputSchema: z
        .strictObject({
          start: isoField("Range start"),
          end: isoField("Range end"),
          calendar_id: z.string().optional().describe("Only this calendar"),
          user_id: z.string().optional().describe("Only this team member's events"),
          response_format: responseFormatField
        }),
      annotations: READ_ONLY
    },
    async ({ start, end, calendar_id, user_id, response_format }, ctx) => {
      const startMs = toDate(start, "start").getTime();
      const endMs = toDate(end, "end").getTime();
      if (endMs <= startMs) throw new Error("end must be after start.");
      if (endMs - startMs > 31 * DAY_MS) throw new Error("GoHighLevel allows at most 31 days per request. Split the range.");
      if (!calendar_id && !user_id) {
        // GoHighLevel needs a calendar, user or group: fan out over every calendar
        const cals = arr((await ghl.request("/calendars/", { ...v, query: { locationId } }, ctx.mcpReq.signal)).calendars);
        const results = await Promise.all(
          cals.map(c =>
            ghl.request("/calendars/events", { ...v, query: { locationId, calendarId: str(c.id), startTime: startMs, endTime: endMs } }, ctx.mcpReq.signal)
          )
        );
        return render(results.flatMap(r => arr(r.events)), response_format);
      }
      const data = await ghl.request(
        "/calendars/events",
        { ...v, query: { locationId, calendarId: calendar_id, userId: user_id, startTime: startMs, endTime: endMs } },
        ctx.mcpReq.signal
      );
      return render(arr(data.events), response_format);
    }
  );

  function render(events: Rec[], response_format: Parameters<typeof respond>[0]) {
    if (events.length === 0) return text("No appointments in that range.");
    events.sort((a, b) => new Date(str(a.startTime)).getTime() - new Date(str(b.startTime)).getTime());
    return fitToLimit(events, subset =>
      respond(response_format, { count: subset.length, total: events.length, events: subset }, () =>
        [
          `# Appointments (${subset.length}${subset.length < events.length ? ` of ${events.length}, narrow the range for the rest` : ""})`,
          "",
          ...subset.map(
            e =>
              `- ${formatWhen(e.startTime, timezone)} to ${formatWhen(e.endTime, timezone)}: ${str(e.title, "Appointment")} [${str(e.appointmentStatus, "status unknown")}]` +
              `${e.address ? ` at ${str(e.address)}` : ""} (event ${str(e.id)}, contact ${str(e.contactId, "none")})`
          )
        ].join("\n")
      )
    ).result;
  }

  server.registerTool(
    "ghl_get_free_slots",
    {
      title: "Get free booking slots",
      description: "Find open times on a calendar between two dates (max 31 days). Use before ghl_book_appointment to offer the client real options.",
      inputSchema: z.strictObject({
        calendar_id: z.string().min(1).describe("Calendar ID from ghl_list_calendars"),
        start: isoField("Search from"),
        end: isoField("Search until"),
        user_id: z.string().optional().describe("Only slots for this team member"),
        response_format: responseFormatField
      }),
      annotations: READ_ONLY
    },
    async ({ calendar_id, start, end, user_id, response_format }, ctx) => {
      const startMs = toDate(start, "start").getTime();
      const endMs = toDate(end, "end").getTime();
      if (endMs - startMs > 31 * DAY_MS) throw new Error("GoHighLevel allows at most 31 days per request. Split the range.");
      const data = await ghl.request(
        `/calendars/${encodeURIComponent(calendar_id)}/free-slots`,
        { ...v, query: { startDate: startMs, endDate: endMs, timezone, userId: user_id } },
        ctx.mcpReq.signal
      );
      // Response shape: { "2026-11-12": { slots: [iso, ...] }, ..., traceId }
      const days = Object.entries(data)
        .filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === "object" && value !== null)
        .map(([date, value]) => ({ date, slots: Array.isArray((value as Rec).slots) ? ((value as Rec).slots as string[]) : [] }));
      if (days.every(d => d.slots.length === 0)) return text("No free slots in that range. Try a wider range or another calendar.");
      return respond(response_format, { timezone, days }, () =>
        [
          `# Free slots (${timezone})`,
          ...days.filter(d => d.slots.length).map(d => `\n**${d.date}**: ${d.slots.map(s => formatWhen(s, timezone).split(", ").pop()).join(", ")}`)
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "ghl_book_appointment",
    {
      title: "Book appointment",
      description: `Book an appointment for a contact on a calendar, e.g. a measure and quote site visit.

Check ghl_get_free_slots first. GoHighLevel may send the client a confirmation automatically depending on the calendar's notification settings.`,
      inputSchema: z.strictObject({
        calendar_id: z.string().min(1).describe("Calendar ID from ghl_list_calendars"),
        contact_id: z.string().min(1).describe("Contact ID from ghl_search_contacts"),
        start: isoField("Start time"),
        end: isoField("End time").optional().describe("End time (ISO 8601). Defaults to the calendar's slot length if omitted"),
        title: z.string().max(200).optional().describe("Title, e.g. 'Site visit: deck quote'"),
        address: z.string().max(300).optional().describe("Site address for the visit"),
        assigned_user_id: z.string().optional().describe("Team member to assign"),
        status: z.enum(["new", "confirmed"]).default("confirmed").describe("Booking status")
      }),
      annotations: WRITE
    },
    async ({ calendar_id, contact_id, start, end, title, address, assigned_user_id, status }, ctx) => {
      const data = await ghl.request(
        "/calendars/events/appointments",
        {
          ...v,
          method: "POST",
          body: compact({
            calendarId: calendar_id,
            locationId,
            contactId: contact_id,
            startTime: toDate(start, "start").toISOString(),
            endTime: end ? toDate(end, "end").toISOString() : undefined,
            title,
            address,
            meetingLocationType: address ? "address" : undefined,
            assignedUserId: assigned_user_id,
            appointmentStatus: status
          })
        },
        ctx.mcpReq.signal
      );
      return text(
        `Appointment booked: ${str(data.title, title ?? "Appointment")} on ${formatWhen(data.startTime ?? start, timezone)} [${str(data.appointmentStatus, status)}] (event ${str(data.id, "id unknown")}).`
      );
    }
  );

  server.registerTool(
    "ghl_update_appointment",
    {
      title: "Update appointment",
      description: "Reschedule an appointment, change its title or address, or set its status (confirmed, cancelled, showed, noshow). Only passed fields change.",
      inputSchema: z.strictObject({
        event_id: z.string().min(1).describe("Appointment/event ID"),
        start: isoField("New start time").optional(),
        end: isoField("New end time").optional(),
        title: z.string().max(200).optional().describe("New title"),
        address: z.string().max(300).optional().describe("New address"),
        status: z.enum(["new", "confirmed", "cancelled", "showed", "noshow"]).optional().describe("New status")
      }),
      annotations: UPDATE
    },
    async ({ event_id, start, end, title, address, status }, ctx) => {
      const body = compact({
        startTime: start ? toDate(start, "start").toISOString() : undefined,
        endTime: end ? toDate(end, "end").toISOString() : undefined,
        title,
        address,
        appointmentStatus: status
      });
      if (Object.keys(body).length === 0) throw new Error("Nothing to update. Pass at least one field to change.");
      const data = await ghl.request(`/calendars/events/appointments/${encodeURIComponent(event_id)}`, { ...v, method: "PUT", body }, ctx.mcpReq.signal);
      return text(`Appointment updated: ${str(data.title, "Appointment")} on ${formatWhen(data.startTime, timezone)} [${str(data.appointmentStatus, status ?? "unchanged")}].`);
    }
  );
}
