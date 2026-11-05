# GoHighLevel MCP Server

Connects Claude to one GoHighLevel sub-account so it can work your leads, pipeline, calendar and client messages for you. Built for Topline Carpenters: times default to `Pacific/Auckland`, money shows in NZD, and NZ phone numbers like `021 555 1234` are converted to `+64` automatically.

## What Claude can do (23 tools)

| Area | Tools |
|---|---|
| Contacts | search, get, create, update, add/remove tags, read/add notes, create follow-up tasks, list a contact's appointments |
| Pipeline | list pipelines and stages, search, get, create and update opportunities (move stage, change value, mark won/lost) |
| Calendar | list calendars, list booked events, find free slots, book and update appointments |
| Messaging | search conversations, read a thread, send SMS or email |

### Messaging safety

`ghl_send_message` is two-step. The first call only returns a **preview** (who, which channel, the exact text, SMS segment count). Claude must show you the preview and get your OK before calling again with `confirm=true`. It also refuses to send to contacts with Do Not Disturb on, or with no phone/email on file.

## Setup

### 1. Create the Private Integration Token

In GoHighLevel, inside the sub-account: **Settings > Private Integrations > Create new integration**. Tick these scopes:

- `contacts.readonly`, `contacts.write`
- `opportunities.readonly`, `opportunities.write`
- `calendars.readonly`, `calendars/events.readonly`, `calendars/events.write`
- `conversations.readonly`, `conversations.write`, `conversations/message.readonly`, `conversations/message.write`

Copy the token (starts with `pit-`). Treat it like a password: never commit it or paste it in shared chats. If it has been exposed, rotate it from the same screen.

### 2. Find your Location ID

**Settings > Business Profile** shows the Location ID, or copy it from the sub-account URL: `app.gohighlevel.com/v2/location/<THIS-PART>/...`

### 3. Build

Needs Node.js 20.3 or newer.

```bash
npm install
npm run build
```

### 4. Add to Claude Desktop

Edit `claude_desktop_config.json` (Claude Desktop > Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "gohighlevel": {
      "command": "node",
      "args": ["C:/path/to/gohighlevel-mcp/dist/index.js"],
      "env": {
        "GHL_API_TOKEN": "pit-...",
        "GHL_LOCATION_ID": "your-location-id"
      }
    }
  }
}
```

Restart Claude Desktop. Or with Claude Code:

```bash
claude mcp add gohighlevel -e GHL_API_TOKEN=pit-... -e GHL_LOCATION_ID=your-location-id -- node /path/to/gohighlevel-mcp/dist/index.js
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GHL_API_TOKEN` | yes | Private Integration Token |
| `GHL_LOCATION_ID` | yes | Sub-account (location) ID |
| `GHL_TIMEZONE` | no | Defaults to `Pacific/Auckland` |
| `GHL_API_BASE_URL` | no | Testing only (points at a mock server) |

## Testing

```bash
npm run build && npm run smoke
```

Runs every tool family against a local mock of the GoHighLevel API and checks the exact requests (auth, `Version` headers, bodies, NZ phone conversion, the send preview never sending). No real data is touched.

Live read-only check against your real account:

```bash
GHL_LIVE=1 GHL_API_TOKEN=pit-... GHL_LOCATION_ID=... npm run smoke
```

## Things to try

- "Who enquired this week and hasn't had a reply?"
- "Move the Doe deck job to Quote Sent and add a note that the quote went out today."
- "Find a free site visit slot next Tuesday or Wednesday and book Jane in."
- "Draft a follow-up text to everyone in Quote Sent for more than 7 days." (you approve each one)
