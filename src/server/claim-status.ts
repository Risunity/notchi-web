import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRedis } from '../lib/redis.ts';

interface ExtendedRequest extends IncomingMessage {
  query?: Record<string, string>;
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

    const owner = process.env.GITHUB_OWNER || 'Risunity';
    const pcRepo = process.env.GITHUB_REPO || 'Notchi';
    const mobileRepo = process.env.MOBILE_GITHUB_REPO || 'notchi-mobile';

    const [pcRes, mobileRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${pcRepo}/releases?per_page=100`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${mobileRepo}/releases?per_page=100`, { headers }),
    ]);

    const countDownloads = async (res: Response) => {
      if (!res.ok) return 0;
      const data = await res.json();
      if (!Array.isArray(data)) return 0;
      let sum = 0;
      for (const r of data) {
        for (const a of (r.assets || [])) {
          if (!a.name?.endsWith('.sha256') && !a.name?.endsWith('.md5')) {
            sum += (a.download_count || 0);
          }
        }
      }
      return sum;
    };

    const total = (await countDownloads(pcRes)) + (await countDownloads(mobileRes));

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const redis = getRedis();
    const [isOpenVal, counterVal] = await Promise.all([
      redis.get<string>('claims:open'),
      redis.get<string | number>('claim:counter'),
    ]);

    const isManualOpen = String(isOpenVal) === '1' || String(isOpenVal).toLowerCase() === 'true';
    const isOpen = isManualOpen || (await checkMilestoneAchieved(redis));
    const totalClaims = Number(counterVal) || 0;

    return res.status(200).json({
      status: 'success',
      isOpen,
      totalClaims,
    });
  } catch (err) {
    // If Redis is not yet configured or fails, fallback to closed state gracefully
    return res.status(200).json({
      status: 'success',
      isOpen: false,
      totalClaims: 0,
      notice: err instanceof Error ? err.message : 'Database unavailable',
    });
  }
}
