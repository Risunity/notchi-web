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

// src/lib/code.ts
function normalizeClaimCode(input) {
  return (input || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}
function isValidCodeFormat(code) {
  const normalized = normalizeClaimCode(code);
  const regex = /^NOTCHI-[2-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[2-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;
  return regex.test(normalized);
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

// src/lib/entitlement.ts
import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
function normalizeKey(keyStr) {
  let trimmed = (keyStr || "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  trimmed = trimmed.replace(/\\n/g, "\n");
  if (trimmed.startsWith("-----BEGIN")) {
    return trimmed;
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8").replace(/\\n/g, "\n");
    if (decoded.includes("-----BEGIN")) {
      return decoded;
    }
  } catch {
  }
  return trimmed;
}
function createEntitlement(payload, privateKeyPem) {
  const cleanKey = normalizeKey(privateKeyPem);
  const json = JSON.stringify(payload);
  const data = Buffer.from(json, "utf8");
  const privateKey = createPrivateKey(cleanKey);
  const signature = sign(null, data, privateKey);
  return `${data.toString("base64url")}.${signature.toString("base64url")}`;
}

// src/server/redeem.ts
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
    const codeRaw = String(body.code || "");
    const deviceHash = String(body.deviceHash || "").trim();
    if (!codeRaw || !deviceHash) {
      return res.status(400).json({
        error: "invalid_request",
        message: "Claim code and deviceHash are required."
      });
    }
    if (!isValidCodeFormat(codeRaw)) {
      return res.status(400).json({
        error: "invalid_code_format",
        message: "Invalid claim code format. Example: NOTCHI-XXXX-XXXX"
      });
    }
    const normalizedCode = normalizeClaimCode(codeRaw);
    const redis = getRedis();
    const clientIp = getClientIp(req.headers);
    const ipHash = hashIp(clientIp);
    const rateLimit = await checkRateLimit(redis, `rl:redeem:${ipHash}`, 30, 3600);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "rate_limited",
        message: "Too many redemption attempts. Please try again later."
      });
    }
    const claimData = await redis.hgetall(`claim:${normalizedCode}`);
    if (!claimData || !claimData.bg_id) {
      return res.status(404).json({
        error: "code_not_found",
        message: "Claim code does not exist or has expired."
      });
    }
    const devicesKey = `claim:${normalizedCode}:devices`;
    const isAlreadyRegistered = await redis.sismember(devicesKey, deviceHash);
    if (!isAlreadyRegistered) {
      const currentDeviceCount = await redis.scard(devicesKey);
      if (currentDeviceCount >= 3) {
        return res.status(403).json({
          error: "device_limit",
          message: "Maximum limit of 3 devices has been reached for this claim code."
        });
      }
      await redis.sadd(devicesKey, deviceHash);
    }
    const privateKey = process.env.ENTITLEMENT_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("ENTITLEMENT_PRIVATE_KEY is not configured on the server");
    }
    const entitlement = createEntitlement(
      {
        v: 1,
        code: normalizedCode,
        claim_number: Number(claimData.claim_number) || 0,
        bg_id: claimData.bg_id,
        badge_id: claimData.badge_id || "",
        rarity: claimData.rarity || "common",
        device_hash: deviceHash,
        issued_at: Math.floor(Date.now() / 1e3)
      },
      privateKey
    );
    return res.status(200).json({
      success: true,
      entitlement,
      claimNumber: Number(claimData.claim_number) || 0,
      rarity: claimData.rarity,
      bgId: claimData.bg_id,
      badgeId: claimData.badge_id
    });
  } catch (err) {
    console.error("[api/redeem] Internal error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : "Failed to redeem reward code"
    });
  }
}
export {
  handler as default
};
