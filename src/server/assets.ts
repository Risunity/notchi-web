import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { get as getBlob } from '@vercel/blob';
import { getRedis } from '../lib/redis.ts';
import { verifyEntitlement } from '../lib/entitlement.ts';
import { getClientIp, hashIp, checkRateLimit } from '../lib/security.ts';

interface ExtendedRequest extends IncomingMessage {
  headers: Record<string, string | string[] | undefined>;
}

interface ExtendedResponse extends ServerResponse {
  status: (statusCode: number) => ExtendedResponse;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => this;
}

export default async function handler(req: ExtendedRequest, res: ExtendedResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const downloadType = urlObj.searchParams.get('download'); // 'expand' | 'compact'
    const queryToken = urlObj.searchParams.get('token');

    // Extract Bearer token from Authorization header or ?token= query param
    const authHeader = String(req.headers.authorization || req.headers.Authorization || '');
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (queryToken) {
      token = queryToken.trim();
    }

    if (!token) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Bearer entitlement token is required in Authorization header or token query parameter.',
      });
    }

    const keyPem = process.env.ENTITLEMENT_PRIVATE_KEY || process.env.ENTITLEMENT_PUBLIC_KEY;
    if (!keyPem) {
      throw new Error('Entitlement verification key is not configured on the server');
    }

    const payload = verifyEntitlement(token, keyPem);
    if (!payload || !payload.bg_id) {
      return res.status(401).json({
        error: 'invalid_entitlement',
        message: 'The provided entitlement token is invalid or corrupted.',
      });
    }

    const redis = getRedis();

    // 1. Direct asset download handling (proxy from private Blob or local disk)
    if (downloadType === 'expand' || downloadType === 'compact') {
      const filename = `${payload.bg_id}_${downloadType}.png`;
      const localFilePath = path.resolve('rewards-src', filename);

      // A. Fast-path: local rewards-src if available (e.g. during local dev)
      if (fs.existsSync(localFilePath)) {
        const fileBuf = fs.readFileSync(localFilePath);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', String(fileBuf.length));
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.writeHead(200);
        return res.end(fileBuf);
      }

      // B. Fetch from private Vercel Blob using server token
      const bgMeta = await redis.hgetall<Record<string, string>>(`bg:${payload.bg_id}`);
      const blobUrl = downloadType === 'expand' ? bgMeta?.url_expand : bgMeta?.url_compact;

      if (!blobUrl) {
        return res.status(404).json({
          error: 'asset_not_found',
          message: `Asset for ${payload.bg_id} (${downloadType}) is not registered in storage.`,
        });
      }

      try {
        const blobResp = await getBlob(blobUrl, {
          access: 'private',
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });

        if (!blobResp || blobResp.statusCode !== 200 || !blobResp.stream) {
          return res.status(502).json({
            error: 'blob_fetch_failed',
            message: 'Failed to retrieve asset from private storage.',
          });
        }

        res.setHeader('Content-Type', blobResp.blob.contentType || 'image/png');
        if (blobResp.blob.size) {
          res.setHeader('Content-Length', String(blobResp.blob.size));
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.writeHead(200);

        for await (const chunk of blobResp.stream) {
          res.write(chunk);
        }
        return res.end();
      } catch (blobErr) {
        console.error('[api/assets] Blob stream error:', blobErr);
        return res.status(502).json({
          error: 'storage_error',
          message: 'Error streaming asset from storage.',
        });
      }
    }

    // 2. Metadata URL response (returns authenticated proxy download URLs)
    const clientIp = getClientIp(req.headers);
    const ipHash = hashIp(clientIp);
    const rateLimit = await checkRateLimit(redis, `rl:assets:${ipHash}`, 60, 3600);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Asset download rate limit reached. Please try again later.',
      });
    }

    const proto = req.headers['x-forwarded-proto'] || (String(req.headers.host || '').includes('localhost') ? 'http' : 'https');
    const host = req.headers.host || 'localhost:4321';
    const baseUrl = `${proto}://${host}`;

    const expandUrl = `${baseUrl}/api/assets?download=expand&token=${encodeURIComponent(token)}`;
    const compactUrl = `${baseUrl}/api/assets?download=compact&token=${encodeURIComponent(token)}`;

    return res.status(200).json({
      success: true,
      bgId: payload.bg_id,
      rarity: payload.rarity,
      expand: expandUrl,
      compact: compactUrl,
    });
  } catch (err) {
    console.error('[api/assets] Internal error:', err);
    return res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Failed to retrieve reward assets',
    });
  }
}
