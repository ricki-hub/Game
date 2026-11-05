import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { GhlClient } from "../api.js";
import { arr, compact, fitToLimit, formatWhen, nzd, READ_ONLY, type Rec, respond, responseFormatField, str, text, UPDATE, WRITE } from "../util.js";

const STATUSES = ["open", "won", "lost", "abandoned"] as const;
const opportunityId = z.string().min(1).describe("Opportunity ID (from ghl_search_opportunities)");

export function registerOpportunityTools(server: McpServer, ghl: GhlClient): void {
  const { locationId, timezone } = ghl.config;

  /** Pipeline and stage names, cached briefly so opportunity listings can show names instead of IDs. */
  let stageCache: { at: number; pipelines: Rec[] } | undefined;
  async function getPipelines(signal: AbortSignal): Promise<Rec[]> {
    if (stageCache && Date.now() - stageCache.at < 5 * 60_000) return stageCache.pipelines;
    const data = await ghl.request("/opportunities/pipelines", { query: { locationId } }, signal);
    stageCache = { at: Date.now(), pipelines: arr(data.pipelines) };
    return stageCache.pipelines;
  }
  function stageLabel(pipelines: Rec[], pipelineId: unknown, stageId: unknown): string {
    const pipeline = pipelines.find(p => p.id === pipelineId);
    const stage = arr(pipeline?.stages).find(s => s.id === stageId);
    return `${str(pipeline?.name, "Unknown pipeline")} > ${str(stage?.name, "Unknown stage")}`;
  }
  function formatOpportunity(o: Rec, pipelines: Rec[]): string {
    const contact = (o.contact ?? {}) as Rec;
    const lines = [`## ${str(o.name, "(unnamed)")} (${str(o.id)})`];
    lines.push(`- Stage: ${stageLabel(pipelines, o.pipelineId, o.pipelineStageId)}`);
    lines.push(`- Status: ${str(o.status, "unknown")}`);
    lines.push(`- Value: ${nzd(o.monetaryValue)}`);
    if (contact.name || o.contactId) lines.push(`- Contact: ${str(contact.name, "")} (${str(contact.id ?? o.contactId)})`);
    if (o.updatedAt) lines.push(`- Last updated: ${formatWhen(o.updatedAt, timezone)}`);
    return lines.join("\n");
  }

  server.registerTool(
    "ghl_list_pipelines",
    {
      title: "List pipelines and stages",
      description: "List every sales pipeline with its stages and IDs. Call this before creating or moving an opportunity so you use the right pipeline_id and stage_id.",
      inputSchema: z.strictObject({ response_format: responseFormatField }),
      annotations: READ_ONLY
    },
    async ({ response_format }, ctx) => {
      stageCache = undefined;
      const pipelines = await getPipelines(ctx.mcpReq.signal);
      if (pipelines.length === 0) return text("No pipelines exist in this sub-account yet.");
      return respond(response_format, { pipelines }, () =>
        [
          "# Pipelines",
          ...pipelines.map(p =>
            [`\n## ${str(p.name)} (${str(p.id)})`, ...arr(p.stages).map((s, i) => `${i + 1}. ${str(s.name)} (${str(s.id)})`)].join("\n")
          )
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "ghl_search_opportunities",
    {
      title: "Search opportunities",
      description: `Search deals/jobs in the pipeline. Filter by pipeline, stage, status, contact or free text.

Examples:
  - "What jobs are open?" -> status="open"
  - "Show everything in Quote Sent" -> stage_id from ghl_list_pipelines
  - "Any deals for Jane Doe?" -> contact_id from ghl_search_contacts`,
      inputSchema: z.strictObject({
        query: z.string().max(200).optional().describe("Free text matched against opportunity and contact details"),
        pipeline_id: z.string().optional().describe("Only this pipeline"),
        stage_id: z.string().optional().describe("Only this pipeline stage"),
        status: z.enum([...STATUSES, "all"]).default("all").describe("open, won, lost, abandoned or all"),
        contact_id: z.string().optional().describe("Only this contact's opportunities"),
        limit: z.number().int().min(1).max(100).default(20).describe("Results per page (max 100)"),
        page: z.number().int().min(1).default(1).describe("Page number, starting at 1"),
        response_format: responseFormatField
      }),
      annotations: READ_ONLY
    },
    async ({ query, pipeline_id, stage_id, status, contact_id, limit, page, response_format }, ctx) => {
      const [data, pipelines] = await Promise.all([
        ghl.request(
          "/opportunities/search",
          {
            query: {
              location_id: locationId,
              q: query,
              pipeline_id,
              pipeline_stage_id: stage_id,
              status,
              contact_id,
              limit,
              page
            }
          },
          ctx.mcpReq.signal
        ),
        getPipelines(ctx.mcpReq.signal)
      ]);
      const opportunities = arr(data.opportunities);
      const meta = (data.meta ?? {}) as Rec;
      const total = typeof meta.total === "number" ? meta.total : opportunities.length;
      if (opportunities.length === 0) return text("No opportunities match those filters.");
      const totalValue = opportunities.reduce((sum, o) => sum + (Number(o.monetaryValue) || 0), 0);
      return fitToLimit(opportunities, subset => {
        const hasMore = page * limit < total;
        return respond(response_format, { total, page, count: subset.length, has_more: hasMore, opportunities: subset }, () => {
          const lines = [`# Opportunities`, `Page ${page}, showing ${subset.length} of ${total}. Value on this page: ${nzd(totalValue)}.`, ""];
          lines.push(subset.map(o => formatOpportunity(o, pipelines)).join("\n\n"));
          if (hasMore) lines.push("", `More results: call again with page=${page + 1}.`);
          return lines.join("\n");
        });
      }).result;
    }
  );

  server.registerTool(
    "ghl_get_opportunity",
    {
      title: "Get opportunity",
      description: "Get one opportunity (deal/job) by ID, with its stage, value, status and contact.",
      inputSchema: z.strictObject({ opportunity_id: opportunityId, response_format: responseFormatField }),
      annotations: READ_ONLY
    },
    async ({ opportunity_id, response_format }, ctx) => {
      const [data, pipelines] = await Promise.all([
        ghl.request(`/opportunities/${encodeURIComponent(opportunity_id)}`, {}, ctx.mcpReq.signal),
        getPipelines(ctx.mcpReq.signal)
      ]);
      const opportunity = (data.opportunity ?? data) as Rec;
      return respond(response_format, { opportunity }, () => formatOpportunity(opportunity, pipelines));
    }
  );

  server.registerTool(
    "ghl_create_opportunity",
    {
      title: "Create opportunity",
      description: `Create a new opportunity (deal/job) for a contact in a pipeline stage.

Get pipeline_id and stage_id from ghl_list_pipelines and contact_id from ghl_search_contacts first.
Example: "Add a $18,500 deck job for Jane Doe in New Lead" -> name="Jane Doe - Deck", value=18500`,
      inputSchema: z.strictObject({
        contact_id: z.string().min(1).describe("Contact the job is for"),
        name: z.string().min(1).max(200).describe("Opportunity name, e.g. 'Jane Doe - Deck, Papamoa'"),
        pipeline_id: z.string().min(1).describe("Pipeline ID"),
        stage_id: z.string().min(1).describe("Stage ID within that pipeline"),
        value: z.number().min(0).optional().describe("Value in NZD (excluding GST unless your pipeline uses incl.)"),
        status: z.enum(STATUSES).default("open").describe("Usually 'open'"),
        assigned_to: z.string().optional().describe("GoHighLevel user ID of the owner (optional)")
      }),
      annotations: WRITE
    },
    async ({ contact_id, name, pipeline_id, stage_id, value, status, assigned_to }, ctx) => {
      const data = await ghl.request(
        "/opportunities/",
        {
          method: "POST",
          body: compact({
            locationId,
            contactId: contact_id,
            name,
            pipelineId: pipeline_id,
            pipelineStageId: stage_id,
            monetaryValue: value,
            status,
            assignedTo: assigned_to
          })
        },
        ctx.mcpReq.signal
      );
      const pipelines = await getPipelines(ctx.mcpReq.signal);
      return text(`Opportunity created.\n\n${formatOpportunity((data.opportunity ?? data) as Rec, pipelines)}`);
    }
  );

  server.registerTool(
    "ghl_update_opportunity",
    {
      title: "Update opportunity",
      description: `Move an opportunity to another stage, change its value or name, or mark it won, lost or abandoned. Only the fields you pass change.

Examples:
  - "Move the Doe deck to Quote Sent" -> stage_id (from ghl_list_pipelines)
  - "Mark it won" -> status="won"`,
      inputSchema: z.strictObject({
        opportunity_id: opportunityId,
        stage_id: z.string().optional().describe("New stage ID"),
        pipeline_id: z.string().optional().describe("New pipeline ID (only when moving to a stage in a different pipeline)"),
        status: z.enum(STATUSES).optional().describe("open, won, lost or abandoned"),
        value: z.number().min(0).optional().describe("New value in NZD"),
        name: z.string().min(1).max(200).optional().describe("New name"),
        assigned_to: z.string().optional().describe("New owner's user ID")
      }),
      annotations: UPDATE
    },
    async ({ opportunity_id, stage_id, pipeline_id, status, value, name, assigned_to }, ctx) => {
      const body = compact({ pipelineStageId: stage_id, pipelineId: pipeline_id, status, monetaryValue: value, name, assignedTo: assigned_to });
      if (Object.keys(body).length === 0) throw new Error("Nothing to update. Pass at least one field to change.");
      const data = await ghl.request(`/opportunities/${encodeURIComponent(opportunity_id)}`, { method: "PUT", body }, ctx.mcpReq.signal);
      const pipelines = await getPipelines(ctx.mcpReq.signal);
      return text(`Opportunity updated.\n\n${formatOpportunity((data.opportunity ?? data) as Rec, pipelines)}`);
    }
  );
}
