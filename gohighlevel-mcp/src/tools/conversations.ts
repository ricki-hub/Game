import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type GhlClient, VERSION_CONVERSATIONS } from "../api.js";
import { arr, compact, fitToLimit, formatWhen, READ_ONLY, type Rec, respond, responseFormatField, str, text } from "../util.js";

export function registerConversationTools(server: McpServer, ghl: GhlClient): void {
  const { locationId, timezone } = ghl.config;
  const v = { version: VERSION_CONVERSATIONS };

  server.registerTool(
    "ghl_search_conversations",
    {
      title: "Search conversations",
      description: `Find conversation threads (SMS, email, Facebook, etc.), newest first. Filter by contact or unread status.

Examples:
  - "Any unread messages?" -> status="unread"
  - "Show my chat with Jane" -> contact_id from ghl_search_contacts`,
      inputSchema: z.strictObject({
        contact_id: z.string().optional().describe("Only this contact's conversations"),
        query: z.string().max(200).optional().describe("Free text to match"),
        status: z.enum(["all", "read", "unread", "starred"]).default("all").describe("Filter by read status"),
        limit: z.number().int().min(1).max(100).default(20).describe("Conversations to return"),
        response_format: responseFormatField
      }),
      annotations: READ_ONLY
    },
    async ({ contact_id, query, status, limit, response_format }, ctx) => {
      const data = await ghl.request(
        "/conversations/search",
        { ...v, query: { locationId, contactId: contact_id, query, status, limit, sort: "desc", sortBy: "last_message_date" } },
        ctx.mcpReq.signal
      );
      const conversations = arr(data.conversations);
      if (conversations.length === 0) return text("No conversations match.");
      return fitToLimit(conversations, subset =>
        respond(response_format, { total: data.total ?? conversations.length, count: subset.length, conversations: subset }, () =>
          [
            "# Conversations",
            "",
            ...subset.map(
              c =>
                `- **${str(c.fullName ?? c.contactName, "Unknown")}** (${str(c.lastMessageType, "message").replace("TYPE_", "")}, ${formatWhen(c.lastMessageDate, timezone)})` +
                `${Number(c.unreadCount) > 0 ? ` [${str(c.unreadCount)} unread]` : ""}: ${str(c.lastMessageBody).slice(0, 140)}\n  conversation ${str(c.id)}, contact ${str(c.contactId)}`
            )
          ].join("\n")
        )
      ).result;
    }
  );

  server.registerTool(
    "ghl_get_conversation_messages",
    {
      title: "Get conversation messages",
      description: "Read the messages in one conversation thread, oldest to newest, so you can see what was said before replying.",
      inputSchema: z.strictObject({
        conversation_id: z.string().min(1).describe("Conversation ID from ghl_search_conversations"),
        limit: z.number().int().min(1).max(100).default(30).describe("How many recent messages"),
        response_format: responseFormatField
      }),
      annotations: READ_ONLY
    },
    async ({ conversation_id, limit, response_format }, ctx) => {
      const data = await ghl.request(`/conversations/${encodeURIComponent(conversation_id)}/messages`, { ...v, query: { limit } }, ctx.mcpReq.signal);
      const container = (data.messages ?? {}) as Rec;
      const messages = (Array.isArray(data.messages) ? arr(data.messages) : arr(container.messages)).slice().reverse();
      if (messages.length === 0) return text("No messages in this conversation.");
      return fitToLimit(messages, subset =>
        respond(response_format, { count: subset.length, messages: subset }, () =>
          [
            "# Messages",
            "",
            ...subset.map(
              m =>
                `**${m.direction === "outbound" ? "Us" : "Client"}** (${str(m.messageType, "message").replace("TYPE_", "")}, ${formatWhen(m.dateAdded, timezone)}): ${str(m.body, "(no text)")}`
            )
          ].join("\n\n")
        )
      ).result;
    }
  );

  server.registerTool(
    "ghl_send_message",
    {
      title: "Send SMS or email to a contact",
      description: `Send an SMS or email to a contact through GoHighLevel. This reaches a real client.

SAFETY: this is a two-step tool.
  1. Call with confirm=false (the default). Nothing is sent; you get a preview.
  2. Show the preview to the user, and only after they explicitly approve it, call again with the same content and confirm=true.
Never set confirm=true on the first call or without the user's approval in this conversation.

Email requires a subject. Contacts with Do Not Disturb on will not receive messages.`,
      inputSchema: z.strictObject({
        contact_id: z.string().min(1).describe("Contact ID from ghl_search_contacts"),
        channel: z.enum(["SMS", "Email"]).describe("SMS or Email"),
        message: z.string().min(1).max(5000).describe("Message text. For SMS keep it short (160 chars is one segment)"),
        subject: z.string().max(200).optional().describe("Email subject (required for Email)"),
        confirm: z.boolean().default(false).describe("false = preview only. true = actually send. Only true after the user approved the preview")
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ contact_id, channel, message, subject, confirm }, ctx) => {
      if (channel === "Email" && !subject) throw new Error("An email needs a subject. Add one and preview again.");

      const contactData = await ghl.request(`/contacts/${encodeURIComponent(contact_id)}`, {}, ctx.mcpReq.signal);
      const contact = (contactData.contact ?? contactData) as Rec;
      const name = str(contact.contactName) || [str(contact.firstName), str(contact.lastName)].filter(Boolean).join(" ") || "(no name)";
      const destination = channel === "SMS" ? str(contact.phone) : str(contact.email);
      if (!destination) throw new Error(`${name} has no ${channel === "SMS" ? "phone number" : "email address"} on file. Update the contact first.`);
      if (contact.dnd) throw new Error(`${name} has Do Not Disturb turned on, so GoHighLevel will block this message. Check with the user before changing that.`);

      if (!confirm) {
        return text(
          [
            "PREVIEW ONLY. Nothing has been sent.",
            "",
            `To: ${name} (${destination}) via ${channel}`,
            ...(subject ? [`Subject: ${subject}`] : []),
            "Message:",
            message,
            "",
            channel === "SMS" ? `Length: ${message.length} characters (${Math.ceil(message.length / 160)} SMS segment(s)).` : "",
            "Show this to the user. If they approve, call ghl_send_message again with confirm=true and exactly the same content."
          ]
            .filter(line => line !== "")
            .join("\n")
        );
      }

      const data = await ghl.request(
        "/conversations/messages",
        {
          ...v,
          method: "POST",
          body: compact({
            type: channel,
            contactId: contact_id,
            message: channel === "SMS" ? message : undefined,
            html: channel === "Email" ? message.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("") : undefined,
            subject: channel === "Email" ? subject : undefined
          })
        },
        ctx.mcpReq.signal
      );
      return text(`Sent ${channel} to ${name} (${destination}). Message ID: ${str(data.messageId ?? data.emailMessageId, "unknown")}, conversation ${str(data.conversationId, "unknown")}.`);
    }
  );

}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
