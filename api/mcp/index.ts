// api/mcp/index.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse';
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from '@modelcontextprotocol/sdk/types';

const ROOT_DIR = process.cwd();
const ASSETS_DIR = path.resolve(ROOT_DIR, 'assets');

function readWidgetHtml(name: string): string {
  if (!fs.existsSync(ASSETS_DIR)) throw new Error(`Missing assets at ${ASSETS_DIR}`);
  const direct = path.join(ASSETS_DIR, `${name}.html`);
  if (fs.existsSync(direct)) return fs.readFileSync(direct, 'utf8');
  const candidates = fs.readdirSync(ASSETS_DIR).filter(f => f.startsWith(`${name}-`) && f.endsWith('.html')).sort();
  const last = candidates[candidates.length - 1];
  if (!last) throw new Error(`No HTML for ${name} in ${ASSETS_DIR}`);
  return fs.readFileSync(path.join(ASSETS_DIR, last), 'utf8');
}

type PizzazWidget = { id:string; title:string; templateUri:string; invoking:string; invoked:string; html:string; responseText:string; };
const meta = (w:PizzazWidget) => ({
  'openai/outputTemplate': w.templateUri,
  'openai/toolInvocation/invoking': w.invoking,
  'openai/toolInvocation/invoked': w.invoked,
  'openai/widgetAccessible': true,
  'openai/resultCanProduceWidget': true,
} as const);

const widgets: PizzazWidget[] = [
  { id:'pizza-map', title:'Show Pizza Map',      templateUri:'ui://widget/pizza-map.html',      invoking:'Hand-tossing a map',   invoked:'Served a fresh map',      html: readWidgetHtml('pizzaz'),            responseText:'Rendered a pizza map!' },
  { id:'pizza-carousel', title:'Show Pizza Carousel', templateUri:'ui://widget/pizza-carousel.html', invoking:'Carousel some spots', invoked:'Served a fresh carousel', html: readWidgetHtml('pizzaz-carousel'), responseText:'Rendered a pizza carousel!' },
  { id:'pizza-albums', title:'Show Pizza Album', templateUri:'ui://widget/pizza-albums.html',    invoking:'Hand-tossing an album', invoked:'Served a fresh album',    html: readWidgetHtml('pizzaz-albums'),   responseText:'Rendered a pizza album!' },
  { id:'pizza-list', title:'Show Pizza List',    templateUri:'ui://widget/pizza-list.html',      invoking:'Hand-tossing a list',  invoked:'Served a fresh list',     html: readWidgetHtml('pizzaz-list'),     responseText:'Rendered a pizza list!' },
];

const byId  = new Map(widgets.map(w => [w.id, w]));
const byUri = new Map(widgets.map(w => [w.templateUri, w]));

const toolInputSchema = { type:'object', properties:{ pizzaTopping:{ type:'string', description:'Topping to mention' } }, required:['pizzaTopping'], additionalProperties:false } as const;
const toolInputParser = z.object({ pizzaTopping: z.string() });

const tools: Tool[] = widgets.map(w => ({ name:w.id, title:w.title, description:w.title, inputSchema:toolInputSchema, _meta: meta(w), annotations:{ destructiveHint:false, openWorldHint:false, readOnlyHint:true }}));
const resources: Resource[] = widgets.map(w => ({ uri:w.templateUri, name:w.title, description:`${w.title} widget markup`, mimeType:'text/html+skybridge', _meta: meta(w) }));
const resourceTemplates: ResourceTemplate[] = widgets.map(w => ({ uriTemplate:w.templateUri, name:w.title, description:`${w.title} widget markup`, mimeType:'text/html+skybridge', _meta: meta(w) }));

function createPizzazServer(): Server {
  const server = new Server({ name:'pizzaz-node', version:'0.1.0' }, { capabilities:{ resources:{}, tools:{} }});
  server.setRequestHandler(ListResourcesRequestSchema, async (_: ListResourcesRequest) => ({ resources }));
  server.setRequestHandler(ReadResourceRequestSchema,  async (r: ReadResourceRequest) => {
    const w = byUri.get(r.params.uri); if (!w) throw new Error(`Unknown resource: ${r.params.uri}`);
    return { contents:[{ uri:w.templateUri, mimeType:'text/html+skybridge', text:w.html, _meta: meta(w) }] };
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_: ListResourceTemplatesRequest) => ({ resourceTemplates }));
  server.setRequestHandler(ListToolsRequestSchema,             async (_: ListToolsRequest) => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema,              async (r: CallToolRequest) => {
    const w = byId.get(r.params.name); if (!w) throw new Error(`Unknown tool: ${r.params.name}`);
    const args = toolInputParser.parse(r.params.arguments ?? {});
    return { content:[{ type:'text', text:w.responseText }], structuredContent:{ pizzaTopping: args.pizzaTopping }, _meta: meta(w) };
  });
  return server;
}

// shared across GET and POST (and used by messages.ts if you keep it)
const sessions = new Map<string, { server: Server; transport: SSEServerTransport }>();
export { sessions };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    // Start SSE session
    const transport = new SSEServerTransport('/api/mcp/messages', res);
    const server = createPizzazServer();
    const id = transport.sessionId;

    sessions.set(id, { server, transport });
    transport.onerror  = (e) => console.error('SSE transport error', e);
    transport.onclose  = () => { /* no server.close() here, see finally */ };

    try {
      await server.connect(transport);   // resolves when SSE closes
    } catch (e) {
      console.error('Failed to start SSE session', e);
      if (!res.headersSent) res.status(500).end('Failed to establish SSE connection');
    } finally {
      sessions.delete(id);
      try { await server.close(); } catch {}
    }
    return;
  }

  if (req.method === 'POST') {
    // Support POST /mcp as well (ChatGPT sometimes uses this)
    const sessionId = (req.query.sessionId as string) || '';
    if (!sessionId) return res.status(400).end('Missing sessionId');

    const session = sessions.get(sessionId);
    if (!session) return res.status(404).end('Unknown session');

    try {
      await session.transport.handlePostMessage(req as any, res as any);
    } catch (e) {
      console.error('Failed to process message', e);
      if (!res.headersSent) res.status(500).end('Failed to process message');
    }
    return;
  }

  return res.status(405).end('Method Not Allowed');
}
