// ../notchi-web-risu/src/lib/redis.ts
import { Redis } from "@upstash/redis";
var redisInstance = null;
function getRedis() {
  if (!redisInstance) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Upstash Redis URL and Token must be configured in environment (UPSTASH_REDIS_REST_URL / KV_REST_API_URL)"
      );
    }
    redisInstance = new Redis({
      url,
      token
    });
  }
  return redisInstance;
}

// ../notchi-web-risu/src/server/claim-status.ts
async function checkMilestoneAchieved(redis) {
  try {
    const headers = {
      "User-Agent": "Notchi-Milestone-Checker"
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const owner = process.env.GITHUB_OWNER || "Risunity";
    const pcRepo = process.env.GITHUB_REPO || "Notchi";
    const mobileRepo = process.env.MOBILE_GITHUB_REPO || "notchi-mobile";
    const [pcRes, mobileRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${pcRepo}/releases?per_page=100`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${mobileRepo}/releases?per_page=100`, { headers })
    ]);
    const countDownloads = async (res) => {
      if (!res.ok) return 0;
      const data = await res.json();
      if (!Array.isArray(data)) return 0;
      let sum = 0;
      for (const r of data) {
        for (const a of r.assets || []) {
          if (!a.name?.endsWith(".sha256") && !a.name?.endsWith(".md5")) {
            sum += a.download_count || 0;
          }
        }
      }
      return sum;
    };
    const total = await countDownloads(pcRes) + await countDownloads(mobileRes);
    if (total >= 100) {
      if (redis) {
        await redis.set("claims:open", "1");
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const redis = getRedis();
    const [isOpenVal, counterVal] = await Promise.all([
      redis.get("claims:open"),
      redis.get("claim:counter")
    ]);
    const isManualOpen = String(isOpenVal) === "1" || String(isOpenVal).toLowerCase() === "true";
    const isOpen = isManualOpen || await checkMilestoneAchieved(redis);
    const totalClaims = Number(counterVal) || 0;
    return res.status(200).json({
      status: "success",
      isOpen,
      totalClaims
    });
  } catch (err) {
    return res.status(200).json({
      status: "success",
      isOpen: false,
      totalClaims: 0,
      notice: err instanceof Error ? err.message : "Database unavailable"
    });
  }
}
export {
  handler as default
};
