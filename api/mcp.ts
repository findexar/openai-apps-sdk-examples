import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServer } from '../pizzaz_server_node/src/http'; // adjust path if different
const handler = createServer();
export default (req: VercelRequest, res: VercelResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return handler(req, res);
};
