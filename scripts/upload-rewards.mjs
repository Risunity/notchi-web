#!/usr/bin/env node

/**
 * Upload reward assets (expand & compact WebP) from rewards-src/ to Vercel Blob (private)
 * and register the blob paths in Upstash Redis (hash bg:{id}).
 *
 * Usage:
 *   node --env-file=.env.local scripts/upload-rewards.mjs
 *
 * Requirements (env):
 *   - BLOB_READ_WRITE_TOKEN
 *   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN)
 */

import fs from 'node:fs';
import path from 'node:path';
import { put } from '@vercel/blob';
import { Redis } from '@upstash/redis';

const SOURCE_DIR = path.resolve(process.cwd(), 'rewards-src');

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!blobToken) {
  console.error('Error: BLOB_READ_WRITE_TOKEN environment variable is missing.');
  process.exit(1);
}

if (!redisUrl || !redisToken) {
  console.error('Error: Redis REST URL or token is missing.');
  process.exit(1);
}

if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`Error: Source directory "${SOURCE_DIR}" does not exist.`);
  process.exit(1);
}

const redis = new Redis({ url: redisUrl, token: redisToken });

async function uploadFile(fileName) {
  const filePath = path.join(SOURCE_DIR, fileName);
  if (!fs.existsSync(filePath)) return null;

  const fileBuffer = fs.readFileSync(filePath);
  console.log(`Uploading ${fileName} to Vercel Blob (private)...`);

  const blob = await put(`rewards/${fileName}`, fileBuffer, {
    access: 'private',
    contentType: 'image/webp',
    allowOverwrite: true,
    token: blobToken,
  });

  return blob.pathname;
}

async function main() {
  console.log('Starting Notchi Rewards Assets Upload...\n');

  for (let i = 1; i <= 7; i++) {
    const bgId = `bg_0${i}`;
    const expandFile = `${bgId}_expand.webp`;
    const compactFile = `${bgId}_compact.webp`;

    console.log(`--- Processing [${bgId}] ---`);
    const pathExpand = await uploadFile(expandFile);
    const pathCompact = await uploadFile(compactFile);

    if (!pathExpand && !pathCompact) {
      console.log(`Skipped ${bgId}: no files found in ${SOURCE_DIR}\n`);
      continue;
    }

    const payload = {};
    if (pathExpand) payload.path_expand = pathExpand;
    if (pathCompact) payload.path_compact = pathCompact;

    await redis.hset(`bg:${bgId}`, payload);
    console.log(`Saved ${bgId} to Redis:`, payload, '\n');
  }

  console.log('Upload script finished successfully!');
}

main().catch((err) => {
  console.error('Script failed with error:', err);
  process.exit(1);
});