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

// src/server/release-device.ts
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
        message: "Invalid claim code format."
      });
    }
    const normalizedCode = normalizeClaimCode(codeRaw);
    const redis = getRedis();
    const removedCount = await redis.srem(`claim:${normalizedCode}:devices`, deviceHash);
    return res.status(200).json({
      success: true,
      released: removedCount > 0
    });
  } catch (err) {
    console.error("[api/release-device] Internal error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : "Failed to release device"
    });
  }
}
export {
  handler as default
};
