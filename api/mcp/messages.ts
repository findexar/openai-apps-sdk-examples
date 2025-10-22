import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sessions } from './index';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

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
}
