import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRedis } from '../src/lib/redis.ts';
import { rollGachaReward } from '../src/lib/gacha.ts';
import { generateClaimCode } from '../src/lib/code.ts';
import { getClientIp, hashIp, checkRateLimit, verifyTurnstileToken } from '../src/lib/security.ts';

interface ExtendedRequest extends IncomingMessage {
  body?: unknown;
}

interface ExtendedResponse extends ServerResponse {
  status: (statusCode: number) => ExtendedResponse;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => this;
}

async function checkMilestoneAchieved(redis?: ReturnType<typeof getRedis>): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Notchi-Milestone-Checker',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch('https://api.github.com/repos/Risunity/Notchi/releases?per_page=100', { headers });
    if (!res.ok) return false;
    const data = await res.json();
    if (!Array.isArray(data)) return false;
    let total = 0;
    for (const r of data) {
      for (const a of (r.assets || [])) {
        if (!a.name?.endsWith('.sha256') && !a.name?.endsWith('.md5')) {
          total += (a.download_count || 0);
        }
      }
    }
    if (total >= 100) {
      if (redis) {
        // Begitu target 100 tercapai, kunci status claims:open = '1' permanen di Redis
        await redis.set('claims:open', '1');
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default async function handler(req: ExtendedRequest, res: ExtendedResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = req.body;
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody || {};
    const turnstileToken = String(body.turnstileToken || '');

    const redis = getRedis();

    // 1. Check if claims are open
    const isOpenVal = await redis.get<string | number>('claims:open');
    const isManualOpen = String(isOpenVal) === '1' || String(isOpenVal).toLowerCase() === 'true';
    const isOpen = isManualOpen || (await checkMilestoneAchieved(redis));
    if (!isOpen) {
      return res.status(403).json({
        error: 'claims_closed',
        message: 'Reward claims are currently closed until the 100 downloads milestone is achieved.',
      });
    }

    // 2. Client IP & Turnstile verification
    const clientIp = getClientIp(req.headers);
    const ipHash = hashIp(clientIp);

    const isHuman = await verifyTurnstileToken(turnstileToken, clientIp);
    if (!isHuman) {
      return res.status(400).json({
        error: 'invalid_captcha',
        message: 'Anti-bot verification failed. Please try again.',
      });
    }

    // 3. Enforce strictly 1 claim per user/network permanently
    const alreadyClaimed = await redis.exists(`claimed:ip:${ipHash}`);
    if (alreadyClaimed) {
      return res.status(403).json({
        error: 'already_claimed',
        message: 'You have already claimed a reward code. Only 1 claim is allowed per user/network.',
      });
    }

    // Rate limit per IP to deter automated flooding (10 attempts per minute)
    const rateLimit = await checkRateLimit(redis, `rl:claim:${ipHash}`, 10, 60);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Please wait a moment before trying again.',
      });
    }

    // 4. Roll for Gacha Reward with atomic quota check
    const reward = await rollGachaReward(redis);

    // 5. Increment global claim counter
    const claimNumber = await redis.incr('claim:counter');

    // 6. Generate unique claim code (with collision retry)
    let code = generateClaimCode();
    let attempts = 0;
    while (attempts < 5) {
      const exists = await redis.exists(`claim:${code}`);
      if (!exists) break;
      code = generateClaimCode();
      attempts += 1;
    }

    // 7. Store claim details in Redis hash
    await redis.hset(`claim:${code}`, {
      claim_number: claimNumber,
      bg_id: reward.id,
      badge_id: reward.badgeId,
      rarity: reward.rarity,
      created_at: new Date().toISOString(),
      ip_hash: ipHash,
    });

    // Mark IP as claimed permanently (1 claim per user/network)
    await redis.set(`claimed:ip:${ipHash}`, code);

    // 8. Fetch preview URL if uploaded to Blob
    const bgMeta = await redis.hgetall<Record<string, string>>(`bg:${reward.id}`);
    const previewUrl = bgMeta?.url_compact || bgMeta?.url_expand || null;

    return res.status(200).json({
      success: true,
      code,
      claimNumber,
      bg: {
        id: reward.id,
        name: reward.name,
        rarity: reward.rarity,
        description: reward.description,
        previewColor: reward.previewColor,
        previewUrl,
      },
    });
  } catch (err) {
    console.error('[api/claim] Internal error:', err);
    return res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Failed to process reward claim',
    });
  }
}
