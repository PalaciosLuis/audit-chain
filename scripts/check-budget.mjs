#!/usr/bin/env node
/**
 * Bundle budget gate.
 *
 * Gzips every file in the production build and fails when any of the budgets is
 * exceeded. It is deliberately dependency-free so it can run on a clean checkout
 * with nothing but Node.
 *
 *   initial JS   < 60 KB gzip
 *   CSS          < 20 KB gzip
 *   single asset < 200 KB raw
 *   whole dist   < 400 KB raw
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve(process.cwd(), 'dist');

const KB = 1024;
const LIMITS = {
  initialJsGzip: 60 * KB,
  cssGzip: 20 * KB,
  singleAssetRaw: 200 * KB,
  distTotalRaw: 400 * KB,
};

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function formatKb(bytes) {
  return `${(bytes / KB).toFixed(2)} KB`;
}

if (!statSync(DIST, { throwIfNoEntry: false })) {
  console.error(`No build output found at ${DIST}. Run "pnpm build" first.`);
  process.exit(1);
}

const assets = collectFiles(DIST).map((file) => {
  const raw = readFileSync(file);
  const gzip = gzipSync(raw, { level: 9 }).length;
  const path = relative(DIST, file);
  const ext = path.slice(path.lastIndexOf('.'));
  return { path, raw: raw.length, gzip, ext };
});

const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);

const escalated = (assets, key) => assets.reduce((max, item) => Math.max(max, item[key]), 0);

const jsAssets = assets.filter((asset) => asset.ext === '.js' || asset.ext === '.mjs');
const cssAssets = assets.filter((asset) => asset.ext === '.css');

const metrics = {
  initialJsGzip: sum(jsAssets, 'gzip'),
  cssGzip: sum(cssAssets, 'gzip'),
  singleAssetRaw: escalated(assets, 'raw'),
  distTotalRaw: sum(assets, 'raw'),
};

const largest = assets.reduce((max, asset) => (asset.raw > max.raw ? asset : max), {
  path: '-',
  raw: 0,
  gzip: 0,
  ext: '',
});

const rows = [
  {
    label: 'Initial JS (gzip)',
    measured: metrics.initialJsGzip,
    limit: LIMITS.initialJsGzip,
    detail: formatKb(metrics.initialJsGzip),
  },
  {
    label: 'CSS (gzip)',
    measured: metrics.cssGzip,
    limit: LIMITS.cssGzip,
    detail: formatKb(metrics.cssGzip),
  },
  {
    label: 'Largest single asset (raw)',
    measured: metrics.singleAssetRaw,
    limit: LIMITS.singleAssetRaw,
    detail: `${largest.path} · ${formatKb(metrics.singleAssetRaw)}`,
  },
  {
    label: 'Whole dist (raw)',
    measured: metrics.distTotalRaw,
    limit: LIMITS.distTotalRaw,
    detail: formatKb(metrics.distTotalRaw),
  },
];

const labelWidth = Math.max(...rows.map((row) => row.label.length), 'Metric'.length) + 2;
const detailWidth = Math.max(...rows.map((row) => row.detail.length), 'Measured'.length) + 2;

console.log('\nBundle budget');
console.log('-'.repeat(labelWidth + detailWidth + 16));
console.log(
  `${'Metric'.padEnd(labelWidth)}${'Measured'.padEnd(detailWidth)}${'Limit'.padEnd(14)}Result`,
);
console.log('-'.repeat(labelWidth + detailWidth + 16));

let failed = false;
for (const row of rows) {
  const ok = row.measured < row.limit;
  failed = failed || !ok;
  console.log(
    `${row.label.padEnd(labelWidth)}${row.detail.padEnd(detailWidth)}${formatKb(row.limit).padEnd(
      14,
    )}${ok ? 'OK' : 'FAIL'}`,
  );
}
console.log('-'.repeat(labelWidth + detailWidth + 16));

if (failed) {
  console.error('\nBundle budget exceeded.');
  process.exit(1);
}

console.log('\nBundle budget OK.\n');
