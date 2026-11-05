#!/usr/bin/env node
/**
 * GoHighLevel MCP server (stdio).
 * Gives Claude access to contacts, pipelines, calendars and client messaging in one GoHighLevel sub-account.
 *
 * Required env: GHL_API_TOKEN (Private Integration Token), GHL_LOCATION_ID (sub-account ID)
 * Optional env: GHL_TIMEZONE (default Pacific/Auckland)
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { GhlClient, loadConfig } from "./api.js";
import { registerCalendarTools } from "./tools/calendars.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerConversationTools } from "./tools/conversations.js";
import { registerOpportunityTools } from "./tools/opportunities.js";

const ghl = new GhlClient(loadConfig());

function createServer(): McpServer {
  const server = new McpServer(
    { name: "gohighlevel-mcp-server", version: "1.0.0" },
    {
      instructions:
        "Tools for one GoHighLevel sub-account (a New Zealand building business). Times default to Pacific/Auckland and money is NZD. " +
        "Find IDs with the search/list tools before writing. ghl_send_message must be previewed and explicitly approved by the user before sending."
    }
  );
  registerContactTools(server, ghl);
  registerOpportunityTools(server, ghl);
  registerCalendarTools(server, ghl);
  registerConversationTools(server, ghl);
  return server;
}

serveStdio(createServer);
console.error("gohighlevel-mcp-server running on stdio");
