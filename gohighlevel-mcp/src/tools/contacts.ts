import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { GhlClient } from "../api.js";
import {
  arr,
  compact,
  fitToLimit,
  formatWhen,
  normalisePhone,
  READ_ONLY,
  type Rec,
  respond,
  responseFormatField,
  str,
  text,
  toDate,
  UPDATE,
  WRITE
} from "../util.js";

const contactId = z.string().min(1).describe("GoHighLevel contact ID (from ghl_search_contacts)");

function contactName(c: Rec): string {
  return str(c.contactName) || [str(c.firstName), str(c.lastName)].filter(Boolean).join(" ") || str(c.name) || "(no name)";
}

export function formatContact(c: Rec, timezone: string): string {
  const lines = [`## ${contactName(c)} (${str(c.id)})`];
  if (c.companyName) lines.push(`- Company: ${str(c.companyName)}`);
  if (c.email) lines.push(`- Email: ${str(c.email)}`);
  if (c.phone) lines.push(`- Phone: ${str(c.phone)}`);
  const address = [c.address1, c.city, c.postalCode].map(v => str(v)).filter(Boolean).join(", ");
  if (address) lines.push(`- Address: ${address}`);
  const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
  if (tags.length) lines.push(`- Tags: ${tags.join(", ")}`);
  if (c.source) lines.push(`- Source: ${str(c.source)}`);
  if (c.dnd) lines.push("- Do Not Disturb: ON (messages may be blocked)");
  if (c.dateAdded) lines.push(`- Added: ${formatWhen(c.dateAdded, timezone)}`);
  return lines.join("\n");
}

const contactFields = {
  first_name: z.string().max(100).optional().describe("First name"),
  last_name: z.string().max(100).optional().describe("Last name"),
  email: z.email().optional().describe("Email address"),
  phone: z.string().max(30).optional().describe("Phone number. NZ formats like '021 123 4567' are converted to +64 automatically"),
  company_name: z.string().max(200).optional().describe("Business name"),
  address1: z.string().max(200).optional().describe("Street address, e.g. '1 Hanlen Ave'"),
  city: z.string().max(100).optional().describe("Town or city, e.g. 'Tauranga'"),
  postal_code: z.string().max(10).optional().describe("Postcode, e.g. '3118'"),
  source: z.string().max(100).optional().describe("Lead source, e.g. 'Website', 'Referral', 'Builders Crack'"),
  tags: z.array(z.string().min(1)).max(50).optional().describe("Tags to set on the contact")
};

type ContactFields = { [K in keyof typeof contactFields]?: z.infer<(typeof contactFields)[K]> };

function toContactBody(f: ContactFields): Rec {
  return compact({
    firstName: f.first_name,
    lastName: f.last_name,
    email: f.email,
    phone: f.phone ? normalisePhone(f.phone) : undefined,
    companyName: f.company_name,
    address1: f.address1,
    city: f.city,
    postalCode: f.postal_code,
    source: f.source,
    tags: f.tags
  });
}

export function registerContactTools(server: McpServer, ghl: GhlClient): void {
  const { locationId, timezone } = ghl.config;

  server.registerTool(
    "ghl_search_contacts",
    {
      title: "Search contacts",
      description: `Search GoHighLevel contacts by name, email, phone or company. Returns one page of matches with IDs.

Use this first to find a contact ID before reading, updating, messaging or booking.
Examples:
  - "Find the Smith job in Waihi Beach" -> query="Smith"
  - "Who is 021 555 1234?" -> query="0215551234"
Leave query empty to list the most recent contacts.`,
      inputSchema: z.strictObject({
        query: z.string().max(200).default("").describe("Text to match against name, email, phone or company. Empty lists recent contacts"),
        limit: z.number().int().min(1).max(100).default(20).describe("Contacts per page (max 100)"),
        page: z.number().int().min(1).default(1).describe("Page number, starting at 1"),
        response_format: responseFormatField
      }),
      annotations: READ_ONLY
    },
    async ({ query, limit, page, response_format }, ctx) => {
      const data = await ghl.request(
        "/contacts/search",
        { method: "POST", body: compact({ locationId, page, pageLimit: limit, query: query || undefined }) },
        ctx.mcpReq.signal
      );
      const contacts = arr(data.contacts);
      const total = typeof data.total === "number" ? data.total : contacts.length;
      if (contacts.length === 0) return text(query ? `No contacts match '${query}'. Try part of the name, the email or the phone number.` : "No contacts found.");
      const { result, kept } = fitToLimit(contacts, subset => {
        const hasMore = page * limit < total || subset.length < contacts.length;
        return respond(response_format, { total, page, count: subset.length, has_more: hasMore, contacts: subset }, () => {
          const lines = [`# Contacts${query ? ` matching '${query}'` : ""}`, `Page ${page}, showing ${subset.length} of ${total}.`, ""];
          lines.push(subset.map(c => formatContact(c, timezone)).join("\n\n"));
          if (hasMore) lines.push("", `More results: call again with page=${page + 1}.`);
          return lines.join("\n");
        });
      });
      if (kept < contacts.length) result.content[0].text += `\n\n(Output trimmed to ${kept} contacts to fit; use a smaller limit to page through.)`;
      return result;
    }
  );

  server.registerTool(
    "ghl_get_contact",
    {
      title: "Get contact",
      description: "Get the full record for one contact, including custom fields, tags and DND status. Use ghl_search_contacts to find the ID.",
      inputSchema: z.strictObject({ contact_id: contactId, response_format: responseFormatField }),
      annotations: READ_ONLY
    },
    async ({ contact_id, response_format }, ctx) => {
      const data = await ghl.request(`/contacts/${encodeURIComponent(contact_id)}`, {}, ctx.mcpReq.signal);
      const contact = (data.contact ?? data) as Rec;
      return respond(response_format, { contact }, () => formatContact(contact, timezone));
    }
  );

  server.registerTool(
    "ghl_create_contact",
    {
      title: "Create contact",
      description: `Create a new contact (lead or client) in GoHighLevel. Provide at least a name plus a phone or email.

Check ghl_search_contacts first so you don't create a duplicate.
Example: a new enquiry from Jane Doe, 021 555 1234, deck quote in Mount Maunganui -> first_name="Jane", last_name="Doe", phone="021 555 1234", city="Mount Maunganui", tags=["deck-quote"]`,
      inputSchema: z.strictObject(contactFields),
      annotations: WRITE
    },
    async (fields, ctx) => {
      if (!fields.phone && !fields.email) throw new Error("Give at least a phone or an email so the contact can be reached.");
      const data = await ghl.request("/contacts/", { method: "POST", body: { locationId, country: "NZ", ...toContactBody(fields) } }, ctx.mcpReq.signal);
      const contact = (data.contact ?? data) as Rec;
      return text(`Created contact.\n\n${formatContact(contact, timezone)}`);
    }
  );

  server.registerTool(
    "ghl_update_contact",
    {
      title: "Update contact",
      description: "Update fields on an existing contact. Only the fields you pass are changed. Note: passing tags here REPLACES all tags; use ghl_add_contact_tags to add without removing.",
      inputSchema: z.strictObject({ contact_id: contactId, ...contactFields }),
      annotations: UPDATE
    },
    async ({ contact_id, ...fields }, ctx) => {
      const body = toContactBody(fields);
      if (Object.keys(body).length === 0) throw new Error("Nothing to update. Pass at least one field to change.");
      const data = await ghl.request(`/contacts/${encodeURIComponent(contact_id)}`, { method: "PUT", body }, ctx.mcpReq.signal);
      const contact = (data.contact ?? data) as Rec;
      return text(`Updated contact.\n\n${formatContact(contact, timezone)}`);
    }
  );

  server.registerTool(
    "ghl_add_contact_tags",
    {
      title: "Add tags to contact",
      description: "Add tags to a contact without removing existing ones. Tags often trigger GoHighLevel workflows, so add only the tags asked for.",
      inputSchema: z.strictObject({
        contact_id: contactId,
        tags: z.array(z.string().min(1)).min(1).max(20).describe("Tags to add, e.g. ['quote-sent']")
      }),
      annotations: UPDATE
    },
    async ({ contact_id, tags }, ctx) => {
      const data = await ghl.request(`/contacts/${encodeURIComponent(contact_id)}/tags`, { method: "POST", body: { tags } }, ctx.mcpReq.signal);
      const now = Array.isArray(data.tags) ? (data.tags as string[]).join(", ") : tags.join(", ");
      return text(`Tags added. Contact tags are now: ${now}`);
    }
  );

  server.registerTool(
    "ghl_remove_contact_tags",
    {
      title: "Remove tags from contact",
      description: "Remove specific tags from a contact. Other tags are kept.",
      inputSchema: z.strictObject({
        contact_id: contactId,
        tags: z.array(z.string().min(1)).min(1).max(20).describe("Tags to remove")
      }),
      annotations: { ...UPDATE, destructiveHint: true }
    },
    async ({ contact_id, tags }, ctx) => {
      await ghl.request(`/contacts/${encodeURIComponent(contact_id)}/tags`, { method: "DELETE", body: { tags } }, ctx.mcpReq.signal);
      return text(`Removed tags: ${tags.join(", ")}`);
    }
  );

  server.registerTool(
    "ghl_list_contact_notes",
    {
      title: "List contact notes",
      description: "Read all notes on a contact, newest first. Good for catching up on a job's history before calling a client.",
      inputSchema: z.strictObject({ contact_id: contactId, response_format: responseFormatField }),
      annotations: READ_ONLY
    },
    async ({ contact_id, response_format }, ctx) => {
      const data = await ghl.request(`/contacts/${encodeURIComponent(contact_id)}/notes`, {}, ctx.mcpReq.signal);
      const notes = arr(data.notes).sort((a, b) => str(b.dateAdded).localeCompare(str(a.dateAdded)));
      if (notes.length === 0) return text("This contact has no notes.");
      return fitToLimit(notes, subset =>
        respond(response_format, { count: subset.length, total: notes.length, notes: subset }, () =>
          [`# Notes (${subset.length} of ${notes.length})`, "", ...subset.map(n => `### ${formatWhen(n.dateAdded, timezone)} (${str(n.id)})\n${str(n.body)}`)].join("\n")
        )
      ).result;
    }
  );

  server.registerTool(
    "ghl_add_contact_note",
    {
      title: "Add note to contact",
      description: "Add a note to a contact's record, e.g. a call summary, site visit findings or a quote follow-up.",
      inputSchema: z.strictObject({
        contact_id: contactId,
        body: z.string().min(1).max(10_000).describe("The note text")
      }),
      annotations: WRITE
    },
    async ({ contact_id, body }, ctx) => {
      const data = await ghl.request(`/contacts/${encodeURIComponent(contact_id)}/notes`, { method: "POST", body: { body } }, ctx.mcpReq.signal);
      const note = (data.note ?? data) as Rec;
      return text(`Note added (${str(note.id, "id unknown")}).`);
    }
  );

  server.registerTool(
    "ghl_create_contact_task",
    {
      title: "Create task for contact",
      description: "Create a follow-up task on a contact, e.g. 'Call back about deck quote' due Friday.",
      inputSchema: z.strictObject({
        contact_id: contactId,
        title: z.string().min(1).max(200).describe("Task title"),
        due: z.string().describe("Due date/time in ISO 8601, e.g. 2026-11-12T09:00:00+13:00"),
        body: z.string().max(5000).optional().describe("Task details"),
        assigned_to: z.string().optional().describe("GoHighLevel user ID to assign to (optional)")
      }),
      annotations: WRITE
    },
    async ({ contact_id, title, due, body, assigned_to }, ctx) => {
      const dueDate = toDate(due, "due").toISOString();
      const data = await ghl.request(
        `/contacts/${encodeURIComponent(contact_id)}/tasks`,
        { method: "POST", body: compact({ title, body, dueDate, completed: false, assignedTo: assigned_to }) },
        ctx.mcpReq.signal
      );
      const task = (data.task ?? data) as Rec;
      return text(`Task created: "${title}" due ${formatWhen(dueDate, timezone)} (${str(task.id, "id unknown")}).`);
    }
  );

  server.registerTool(
    "ghl_list_contact_appointments",
    {
      title: "List contact appointments",
      description: "List all appointments booked for one contact (past and upcoming).",
      inputSchema: z.strictObject({ contact_id: contactId, response_format: responseFormatField }),
      annotations: READ_ONLY
    },
    async ({ contact_id, response_format }, ctx) => {
      const data = await ghl.request(`/contacts/${encodeURIComponent(contact_id)}/appointments`, { version: "2021-07-28" }, ctx.mcpReq.signal);
      const events = arr(data.events);
      if (events.length === 0) return text("No appointments for this contact.");
      return respond(response_format, { count: events.length, events }, () =>
        [
          `# Appointments (${events.length})`,
          "",
          ...events.map(e => `- ${formatWhen(e.startTime, timezone)}: ${str(e.title, "Appointment")} [${str(e.appointmentStatus, "status unknown")}] (${str(e.id)})`)
        ].join("\n")
      );
    }
  );
}
