#!/usr/bin/env node
// Sync <lastmod> in sitemap.xml to the date index.html actually last changed.
//
// The date comes from the last commit that touched index.html, not from "now".
// That distinction is the whole point: Google treats <lastmod> as a hint only for
// as long as it proves accurate, so stamping every build with the current date
// makes the signal worthless. A date that tracks real content changes keeps it.
//
// Usage:
//   node scripts/update-sitemap-lastmod.mjs                 # date from git history
//   node scripts/update-sitemap-lastmod.mjs --date 2026-09-10
//   node scripts/update-sitemap-lastmod.mjs --check         # report only, never write
//
// Writes `date=` and `changed=` to $GITHUB_OUTPUT when running in Actions.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITEMAP = 'sitemap.xml';
const SOURCE = 'index.html';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const dateFlag = args.indexOf('--date');

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function emit(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

// --- the target date -------------------------------------------------------
let target;
if (dateFlag !== -1) {
  target = args[dateFlag + 1];
  if (!DATE_RE.test(target || '')) fail('--date needs a YYYY-MM-DD value');
} else {
  // %cs = committer date, short (YYYY-MM-DD), already UTC-normalised by git
  target = execFileSync('git', ['log', '-1', '--format=%cs', '--', SOURCE], { encoding: 'utf8' }).trim();
  if (!DATE_RE.test(target)) {
    fail(`could not read a commit date for ${SOURCE} (got "${target}"). ` +
         'A shallow clone will do this — the workflow needs fetch-depth: 0.');
  }
}

// --- read and locate ------------------------------------------------------
if (!existsSync(SITEMAP)) fail(`${SITEMAP} not found (run this from the repo root)`);
const original = readFileSync(SITEMAP, 'utf8');

const urlCount = (original.match(/<url>/g) || []).length;
if (urlCount === 0) fail(`${SITEMAP} declares no <url> entry`);
if (urlCount > 1) {
  // Refusing here is deliberate. Stamping every URL with index.html's date would
  // assert change dates for pages that did not change, which is exactly the
  // unreliability that makes engines start ignoring <lastmod>. Map URLs to their
  // own source files before removing this guard.
  fail(`${SITEMAP} has ${urlCount} <url> entries; this script only handles a ` +
       'single-URL sitemap. Extend it with a per-URL source mapping first.');
}

const current = (original.match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1] ?? null;

// --- decide ---------------------------------------------------------------
emit('date', target);

if (current === target) {
  console.log(`unchanged: <lastmod> is already ${target}`);
  emit('changed', 'false');
  process.exit(0);
}

if (checkOnly) {
  console.log(`would change: <lastmod> ${current ?? '(absent)'} -> ${target}`);
  emit('changed', 'true');
  process.exit(0);
}

// Targeted string edit, never a re-serialisation: this preserves the file's
// existing indentation, attribute order and CRLF line endings untouched.
let updated;
if (current === null) {
  updated = original.replace(/(<\/loc>)/, `$1\n    <lastmod>${target}</lastmod>`);
  if (updated === original) fail('no </loc> to anchor a new <lastmod> to');
} else {
  updated = original.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${target}</lastmod>`);
}

writeFileSync(SITEMAP, updated);
console.log(`updated: <lastmod> ${current ?? '(absent)'} -> ${target}`);
emit('changed', 'true');
