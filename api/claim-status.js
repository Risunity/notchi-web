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
function getRewardById(id) {
  return REWARDS_CATALOG.find((item) => item.id === id);
}

// src/server/claim-status.ts
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
    const [isOpenVal, counterVal, rawHistory] = await Promise.all([
      redis.get("claims:open"),
      redis.get("claim:counter"),
      redis.lrange("claims:history", 0, 49)
    ]);
    const isManualOpen = String(isOpenVal) === "1" || String(isOpenVal).toLowerCase() === "true";
    const isOpen = isManualOpen || await checkMilestoneAchieved(redis);
    const totalClaims = Number(counterVal) || 0;
    const claimsHistory = (rawHistory || []).map((item) => {
      try {
        const parsed = typeof item === "string" ? JSON.parse(item) : item;
        const catalogItem = getRewardById(parsed.bgId);
        return {
          claimNumber: Number(parsed.claimNumber) || 0,
          bgId: String(parsed.bgId),
          bgName: catalogItem?.name || String(parsed.bgId),
          badgeId: String(parsed.badgeId),
          rarity: catalogItem?.rarity || parsed.rarity || "common",
          previewColor: catalogItem?.previewColor || "linear-gradient(135deg, #1e1b4b, #09090b)",
          image: catalogItem?.image || "",
          createdAt: String(parsed.createdAt || "")
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
    return res.status(200).json({
      status: "success",
      isOpen,
      totalClaims,
      claimsHistory
    });
  } catch (err) {
    return res.status(200).json({
      status: "success",
      isOpen: false,
      totalClaims: 0,
      claimsHistory: [],
      notice: err instanceof Error ? err.message : "Database unavailable"
    });
  }
}
export {
  handler as default
};
