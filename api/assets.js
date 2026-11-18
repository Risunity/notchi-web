// ../notchi-web-risu/src/server/assets.ts
import fs from "node:fs";
import path from "node:path";
import { get as getBlob } from "@vercel/blob";

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

// ../notchi-web-risu/src/lib/entitlement.ts
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
function verifyEntitlement(token, keyPem) {
  try {
    const parts = (token || "").trim().split(".");
    if (parts.length !== 2) return null;
    const data = Buffer.from(parts[0], "base64url");
    const signature = Buffer.from(parts[1], "base64url");
    const cleanKey = normalizeKey(keyPem);
    let publicKey;
    try {
      publicKey = createPublicKey(cleanKey);
    } catch {
      publicKey = createPublicKey(createPrivateKey(cleanKey));
    }
    const isValid = verify(null, data, publicKey, signature);
    if (!isValid) return null;
    const payload = JSON.parse(data.toString("utf8"));
    if (payload.v !== 1 || !payload.code || !payload.bg_id) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// ../notchi-web-risu/src/lib/security.ts
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

// ../notchi-web-risu/src/server/assets.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const downloadType = urlObj.searchParams.get("download");
    const queryToken = urlObj.searchParams.get("token");
    const authHeader = String(req.headers.authorization || req.headers.Authorization || "");
    let token = "";
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    } else if (queryToken) {
      token = queryToken.trim();
    }
    if (!token) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Bearer entitlement token is required in Authorization header or token query parameter."
      });
    }
    const keyPem = process.env.ENTITLEMENT_PRIVATE_KEY || process.env.ENTITLEMENT_PUBLIC_KEY;
    if (!keyPem) {
      throw new Error("Entitlement verification key is not configured on the server");
    }
    const payload = verifyEntitlement(token, keyPem);
    if (!payload || !payload.bg_id) {
      return res.status(401).json({
        error: "invalid_entitlement",
        message: "The provided entitlement token is invalid or corrupted."
      });
    }
    const redis = getRedis();
    if (downloadType === "expand" || downloadType === "compact") {
      const filename = `${payload.bg_id}_${downloadType}.png`;
      const localFilePath = path.resolve("rewards-src", filename);
      if (fs.existsSync(localFilePath)) {
        const fileBuf = fs.readFileSync(localFilePath);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Content-Length", String(fileBuf.length));
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.writeHead(200);
        return res.end(fileBuf);
      }
      const bgMeta = await redis.hgetall(`bg:${payload.bg_id}`);
      const blobUrl = downloadType === "expand" ? bgMeta?.url_expand : bgMeta?.url_compact;
      if (!blobUrl) {
        return res.status(404).json({
          error: "asset_not_found",
          message: `Asset for ${payload.bg_id} (${downloadType}) is not registered in storage.`
        });
      }
      try {
        const blobResp = await getBlob(blobUrl, {
          access: "private",
          token: process.env.BLOB_READ_WRITE_TOKEN
        });
        if (!blobResp || blobResp.statusCode !== 200 || !blobResp.stream) {
          return res.status(502).json({
            error: "blob_fetch_failed",
            message: "Failed to retrieve asset from private storage."
          });
        }
        res.setHeader("Content-Type", blobResp.blob.contentType || "image/png");
        if (blobResp.blob.size) {
          res.setHeader("Content-Length", String(blobResp.blob.size));
        }
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.writeHead(200);
        for await (const chunk of blobResp.stream) {
          res.write(chunk);
        }
        return res.end();
      } catch (blobErr) {
        console.error("[api/assets] Blob stream error:", blobErr);
        return res.status(502).json({
          error: "storage_error",
          message: "Error streaming asset from storage."
        });
      }
    }
    const clientIp = getClientIp(req.headers);
    const ipHash = hashIp(clientIp);
    const rateLimit = await checkRateLimit(redis, `rl:assets:${ipHash}`, 60, 3600);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "rate_limited",
        message: "Asset download rate limit reached. Please try again later."
      });
    }
    const proto = req.headers["x-forwarded-proto"] || (String(req.headers.host || "").includes("localhost") ? "http" : "https");
    const host = req.headers.host || "localhost:4321";
    const baseUrl = `${proto}://${host}`;
    const expandUrl = `${baseUrl}/api/assets?download=expand&token=${encodeURIComponent(token)}`;
    const compactUrl = `${baseUrl}/api/assets?download=compact&token=${encodeURIComponent(token)}`;
    return res.status(200).json({
      success: true,
      bgId: payload.bg_id,
      rarity: payload.rarity,
      expand: expandUrl,
      compact: compactUrl
    });
  } catch (err) {
    console.error("[api/assets] Internal error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : "Failed to retrieve reward assets"
    });
  }
}
export {
  handler as default
};
