// src/lib/redis.ts
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

// src/lib/gacha.ts
import { randomInt } from "node:crypto";

// src/lib/rewards-catalog.ts
var REWARDS_CATALOG = [
  // --- 1. LEGENDARY (Limit 7 di dunia) ---
  {
    id: "bg_07",
    name: "The Deadline Cat",
    rarity: "legendary",
    weight: 50,
    // 5%
    quota: 7,
    // Terbatas hanya 7 kali klaim!
    description: "A legendary determined cat racing against the clock, granted exclusively to the first 7 achievers.",
    badgeId: "badge_deadline_cat",
    previewColor: "linear-gradient(135deg, #b45309, #09090b)",
    image: "/images/rewards/bg_07_teaser.webp"
  },
  // --- 2. EPIC (7.5% per item -> Total 15%) ---
  {
    id: "bg_01",
    name: "Ripple Wings",
    rarity: "epic",
    weight: 75,
    // 7.5%
    description: "Dynamic flowing wing motifs with subtle ambient illumination crafted for Notchi overlay.",
    badgeId: "badge_ripple_wings",
    previewColor: "linear-gradient(135deg, #1e1b4b, #09090b)",
    image: "/images/rewards/bg_01_teaser.webp"
  },
  {
    id: "bg_05",
    name: "Misty Meadows",
    rarity: "epic",
    weight: 75,
    // 7.5%
    description: "Soft rolling meadows veiled in early dawn fog, blending calm nature tones with modern elegance.",
    badgeId: "badge_misty_meadows",
    previewColor: "linear-gradient(135deg, #064e3b, #09090b)",
    image: "/images/rewards/bg_05_teaser.webp"
  },
  // --- 3. RARE (15% per item -> Total 30%) ---
  {
    id: "bg_02",
    name: "Midnight Bloom",
    rarity: "rare",
    weight: 150,
    // 15%
    description: "Dark floral botanical aesthetic with layered nocturnal accents for a clean, sleek desktop look.",
    badgeId: "badge_midnight_bloom",
    previewColor: "linear-gradient(135deg, #1e1b4b, #09090b)",
    image: "/images/rewards/bg_02_teaser.webp"
  },
  {
    id: "bg_06",
    name: "The Silent Chorus",
    rarity: "rare",
    weight: 150,
    // 15%
    description: "An enigmatic twilight silhouette resonating in muted harmony across your notch perimeter.",
    badgeId: "badge_silent_chorus",
    previewColor: "linear-gradient(135deg, #312e81, #09090b)",
    image: "/images/rewards/bg_06_teaser.webp"
  },
  // --- 4. COMMON (25% per item -> Total 50%) ---
  {
    id: "bg_03",
    name: "Feline Brotherhood",
    rarity: "common",
    weight: 250,
    // 25%
    description: "A heartwarming trio of loyal feline companions resting in quiet harmony, bringing warm ambient charm to your desktop.",
    badgeId: "badge_feline_brotherhood",
    previewColor: "linear-gradient(135deg, #334155, #09090b)",
    image: "/images/rewards/bg_03_teaser.webp"
  },
  {
    id: "bg_04",
    name: "Nightmare Cloud",
    rarity: "common",
    weight: 250,
    // 25%
    description: "Surreal dark cloud formations draped in midnight mist for a deep atmospheric presence.",
    badgeId: "badge_nightmare_cloud",
    previewColor: "linear-gradient(135deg, #18181b, #09090b)",
    image: "/images/rewards/bg_04_teaser.webp"
  }
];

// src/lib/gacha.ts
function pickWeightedItem(candidates) {
  if (candidates.length === 0) {
    throw new Error("No candidate rewards available");
  }
  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return candidates[0];
  }
  const roll = randomInt(0, totalWeight);
  let cumulative = 0;
  for (const item of candidates) {
    cumulative += item.weight;
    if (roll < cumulative) {
      return item;
    }
  }
  return candidates[candidates.length - 1];
}
async function rollGachaReward(redis) {
  let candidates = [...REWARDS_CATALOG];
  while (candidates.length > 0) {
    const selected = pickWeightedItem(candidates);
    if (!selected.quota || selected.quota <= 0) {
      return selected;
    }
    const count = await redis.incr(`bg:${selected.id}:count`);
    if (count <= selected.quota) {
      return selected;
    }
    await redis.decr(`bg:${selected.id}:count`);
    candidates = candidates.filter((item) => item.id !== selected.id);
  }
  return REWARDS_CATALOG[0];
}

// src/lib/code.ts
import { randomInt as randomInt2 } from "node:crypto";
var CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
function generateClaimCode() {
  const seg1 = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt2(0, CODE_ALPHABET.length)]).join("");
  const seg2 = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt2(0, CODE_ALPHABET.length)]).join("");
  return `NOTCHI-${seg1}-${seg2}`;
}

// src/lib/security.ts
import { createHmac } from "node:crypto";
function getClientIp(headers) {
  const getHeader = (name) => {
    if (headers instanceof Headers) {
      return headers.get(name) || void 0;
    }
    const val = headers[name] || headers[name.toLowerCase()];
    if (Array.isArray(val)) return val[0];
    return val;
  };
  const forwarded = getHeader("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return getHeader("cf-connecting-ip") || getHeader("x-real-ip") || "127.0.0.1";
}
function hashIp(ip, salt = process.env.IP_HASH_SALT || "notchi-default-salt") {
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}
async function checkRateLimit(redis, key, maxLimit, ttlSeconds) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ttlSeconds);
  }
  const remaining = Math.max(0, maxLimit - count);
  return {
    allowed: count <= maxLimit,
    remaining
  };
}
async function verifyTurnstileToken(token, clientIp) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    return true;
  }
  if (!token || token === "dev-bypass") return false;
  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (clientIp) formData.append("remoteip", clientIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json.success);
  } catch (err) {
    console.error("[security] Turnstile verification error:", err);
    return false;
  }
}

// src/server/claim.ts
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const rawBody = req.body;
    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody || {};
    const turnstileToken = String(body.turnstileToken || "");
    const redis = getRedis();
    const isOpenVal = await redis.get("claims:open");
    const isManualOpen = String(isOpenVal) === "1" || String(isOpenVal).toLowerCase() === "true";
    const isOpen = isManualOpen || await checkMilestoneAchieved(redis);
    if (!isOpen) {
      return res.status(403).json({
        error: "claims_closed",
        message: "Reward claims are currently closed until the 100 downloads milestone is achieved."
      });
    }
    const clientIp = getClientIp(req.headers);
    const ipHash = hashIp(clientIp);
    const isHuman = await verifyTurnstileToken(turnstileToken, clientIp);
    if (!isHuman) {
      return res.status(400).json({
        error: "invalid_captcha",
        message: "Anti-bot verification failed. Please try again."
      });
    }
    const alreadyClaimed = await redis.exists(`claimed:ip:${ipHash}`);
    if (alreadyClaimed) {
      return res.status(403).json({
        error: "already_claimed",
        message: "You have already claimed a reward code. Only 1 claim is allowed per user/network."
      });
    }
    const rateLimit = await checkRateLimit(redis, `rl:claim:${ipHash}`, 10, 60);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "rate_limited",
        message: "Too many requests. Please wait a moment before trying again."
      });
    }
    const reward = await rollGachaReward(redis);
    const claimNumber = await redis.incr("claim:counter");
    let code = generateClaimCode();
    let attempts = 0;
    while (attempts < 5) {
      const exists = await redis.exists(`claim:${code}`);
      if (!exists) break;
      code = generateClaimCode();
      attempts += 1;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    await redis.hset(`claim:${code}`, {
      claim_number: claimNumber,
      bg_id: reward.id,
      badge_id: reward.badgeId,
      rarity: reward.rarity,
      created_at: nowIso,
      ip_hash: ipHash
    });
    await redis.lpush(
      "claims:history",
      JSON.stringify({
        claimNumber,
        bgId: reward.id,
        badgeId: reward.badgeId,
        rarity: reward.rarity,
        createdAt: nowIso
      })
    );
    await redis.ltrim("claims:history", 0, 99);
    await redis.set(`claimed:ip:${ipHash}`, code);
    const bgMeta = await redis.hgetall(`bg:${reward.id}`);
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
        previewUrl
      }
    });
  } catch (err) {
    console.error("[api/claim] Internal error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : "Failed to process reward claim"
    });
  }
}
export {
  handler as default
};
