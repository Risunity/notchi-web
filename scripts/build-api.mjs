import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiFiles = [
  'claim-status.ts',
  'claim.ts',
  'redeem.ts',
  'assets.ts',
  'release-device.ts',
];

console.log('[build-api] Compiling src/server TypeScript to standalone JavaScript api/*.js...');

for (const file of apiFiles) {
  const entryPoint = path.resolve(rootDir, 'src', 'server', file);
  const outName = file.replace(/\.ts$/, '.js');
  const outFile = path.resolve(rootDir, 'api', outName);

  if (!fs.existsSync(entryPoint)) {
    console.warn(`[build-api] Skipped missing file: ${entryPoint}`);
    continue;
  }

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    outfile: outFile,
  });

  const size = fs.statSync(outFile).size;
  console.log(`[build-api] Compiled api/${outName} (${size} bytes)`);
}

console.log('[build-api] Done.');
