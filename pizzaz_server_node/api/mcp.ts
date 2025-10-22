// Minimal Vercel adapter: turn the Node MCP server into a serverless function
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServer } from '../pizzaz_server_node/src/http'; // entry that creates the HTTP handler

// If the example exports a Fastify/Express instance instead, adapt like:
//   export default (req, res) => app.server.emit('request', req, res);

const handler = createServer(); // should be (req, res) => void
export default (req: VercelRequest, res: VercelResponse) => handler(req, res);
