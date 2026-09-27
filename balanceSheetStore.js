// balanceSheetStore.js
// Storage for the "Balance Sheet" feature. Intentionally separate from
// store.js/db.js (which handle loans in Postgres) - nothing here touches the
// loan tracker's data or code path.
//
// Two backends, chosen automatically based on env vars:
//
// 1. GitHub Gist backend (recommended on Render, and it's free) - used when
//    GITHUB_TOKEN and GIST_ID are both set. Every read/write goes to a JSON
//    file inside a GitHub Gist via the GitHub API, instead of Render's local
//    disk. Render's local disk is wiped on every redeploy/restart unless you
//    pay for a persistent disk - a Gist isn't on Render's disk at all, so it
//    is completely unaffected by that. This costs nothing: a personal access
//    token and a gist are both free, with no trial period or expiry.
//
//    Setup:
//      a. Go to https://gist.github.com, create a new gist, name the file
//         exactly "balance-sheet.json", put "[]" as its content, and save it
//         as a Secret gist. Copy the gist's ID from the URL
//         (github.com/<you>/<GIST_ID>).
//      b. Go to https://github.com/settings/tokens -> "Generate new token"
//         (classic) -> tick only the "gist" scope -> generate, and copy the
//         token (starts with ghp_ or github_pat_).
//      c. On Render: your service -> Environment -> add GITHUB_TOKEN and
//         GIST_ID with those two values. Redeploy.
//
// 2. Local JSON file backend (fallback) - used when the two env vars above
//    aren't set. Data is stored in data/balance-sheet.json on local disk.
//    Fine for local development. On Render WITHOUT the Gist backend
//    configured, this file is wiped on every redeploy/restart (Render's
//    filesystem is ephemeral by default) - so for the hosted app, set up the
//    Gist backend above instead of relying on this fallback.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_FILENAME = process.env.GIST_FILENAME || 'balance-sheet.json';
const USE_GIST = Boolean(GITHUB_TOKEN && GIST_ID);

const DATA_DIR = process.env.BALANCE_SHEET_DATA_DIR || path.join(__dirname, 'data');
const FILE_PATH = path.join(DATA_DIR, 'balance-sheet.json');

if (USE_GIST) {
  console.log('[balanceSheetStore] Using GitHub Gist backend (persists across Render redeploys/restarts).');
} else {
  console.warn(
    '[balanceSheetStore] GITHUB_TOKEN/GIST_ID not set - falling back to a local JSON file.\n' +
    '  On Render (or any host with an ephemeral filesystem) this file is wiped on every\n' +
    '  redeploy/restart. See the comment at the top of balanceSheetStore.js to set up\n' +
    '  the free GitHub Gist backend instead.'
  );
}

const GIST_API_URL = `https://api.github.com/gists/${GIST_ID}`;
const GIST_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'loan-tracker-balance-sheet',
};

// Serializes reads+writes so two near-simultaneous requests can never
// interleave their read-modify-write cycle and clobber each other's changes
// (whether that's two writes to the same local file, or two PATCHes racing
// against the same gist).
let writeChain = Promise.resolve();
function serialize(fn) {
  const run = writeChain.then(fn, fn);
  // Swallow errors here so one failed write doesn't wedge the whole chain for
  // subsequent calls; the actual error still propagates to the caller below.
  writeChain = run.catch(() => {});
  return run;
}

// --- GitHub Gist backend ---

async function readRawFromGist() {
  const res = await fetch(GIST_API_URL, { headers: GIST_HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub Gist read failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const gist = await res.json();
  const file = gist.files && gist.files[GIST_FILENAME];
  if (!file) return []; // gist exists but doesn't have this file yet - treat as empty

  // Gist API truncates file content over ~1MB and gives a raw_url instead -
  // won't happen for a personal balance sheet, but handled just in case.
  let content = file.content;
  if (file.truncated) {
    const rawRes = await fetch(file.raw_url, { headers: GIST_HEADERS });
    content = await rawRes.text();
  }

  try {
    const parsed = JSON.parse(content || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[balanceSheetStore] gist file contains invalid JSON, starting from an empty list:', err.message);
    return [];
  }
}

async function writeRawToGist(rows) {
  const res = await fetch(GIST_API_URL, {
    method: 'PATCH',
    headers: { ...GIST_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: JSON.stringify(rows, null, 2) } },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub Gist write failed (${res.status}): ${body.slice(0, 300)}`);
  }
}

// --- Local JSON file backend (fallback) ---

async function ensureFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(FILE_PATH, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(FILE_PATH, '[]\n', 'utf8');
  }
}

async function readRawFromFile() {
  await ensureFile();
  const text = await fsp.readFile(FILE_PATH, 'utf8');
  try {
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[balanceSheetStore] balance-sheet.json is corrupted, starting from an empty list:', err.message);
    return [];
  }
}

// Atomic-ish write: write to a temp file then rename over the real one, so a
// crash mid-write can't leave behind a half-written / corrupted JSON file.
async function writeRawToFile(rows) {
  await ensureFile();
  const tmpPath = `${FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  await fsp.rename(tmpPath, FILE_PATH);
}

// --- Backend-agnostic read/write ---

function readRaw() {
  return USE_GIST ? readRawFromGist() : readRawFromFile();
}
function writeRaw(rows) {
  return USE_GIST ? writeRawToGist(rows) : writeRawToFile(rows);
}

function toNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

// Normalizes a "list" field (sourcesOfCredit / todaysTransactions / otherStoredSources)
// into a clean array of { label, amount } objects, dropping empty rows.
function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      label: String((item && item.label) || '').trim(),
      amount: toNumber(item && item.amount, 0),
    }))
    .filter((item) => item.label || item.amount);
}

function sanitizeEntry(input, existing = {}) {
  const entry = { ...existing };

  if ('date' in input) entry.date = String(input.date).slice(0, 10);
  if ('presentOnHand' in input) entry.presentOnHand = toNumber(input.presentOnHand, existing.presentOnHand || 0);
  if ('debit' in input) entry.debit = toNumber(input.debit, existing.debit || 0);
  if ('credit' in input) entry.credit = toNumber(input.credit, existing.credit || 0);
  if ('sourcesOfCredit' in input) entry.sourcesOfCredit = normalizeList(input.sourcesOfCredit);
  if ('todaysTransactions' in input) entry.todaysTransactions = normalizeList(input.todaysTransactions);
  if ('otherStoredSources' in input) entry.otherStoredSources = normalizeList(input.otherStoredSources);

  // Total including receivables is always derived, never taken from the
  // client: debit is money owed TO you (a receivable), credit is money you
  // owe / have taken on - so it's present-on-hand plus what's owed to you,
  // minus what you owe out.
  entry.totalIncludingReceivables = Math.round(((entry.presentOnHand || 0) + (entry.debit || 0) - (entry.credit || 0)) * 100) / 100;

  return entry;
}

async function listEntries() {
  const rows = await readRaw();
  return rows.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function addEntry(input) {
  return serialize(async () => {
    const rows = await readRaw();

    const base = sanitizeEntry(input, {
      presentOnHand: 0,
      debit: 0,
      credit: 0,
      totalIncludingReceivables: 0,
      sourcesOfCredit: [],
      todaysTransactions: [],
      otherStoredSources: [],
    });

    const now = new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      date: base.date || now.slice(0, 10),
      presentOnHand: base.presentOnHand,
      debit: base.debit,
      credit: base.credit,
      totalIncludingReceivables: base.totalIncludingReceivables,
      sourcesOfCredit: base.sourcesOfCredit,
      todaysTransactions: base.todaysTransactions,
      otherStoredSources: base.otherStoredSources,
      createdAt: now,
      updatedAt: now,
    };

    rows.push(entry);
    await writeRaw(rows);
    return entry;
  });
}

async function updateEntry(id, updates) {
  return serialize(async () => {
    const rows = await readRaw();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const updated = sanitizeEntry(updates, rows[idx]);
    updated.id = rows[idx].id;
    updated.createdAt = rows[idx].createdAt;
    updated.updatedAt = new Date().toISOString();

    rows[idx] = updated;
    await writeRaw(rows);
    return updated;
  });
}

async function deleteEntry(id) {
  return serialize(async () => {
    const rows = await readRaw();
    const next = rows.filter((r) => r.id !== id);
    const removed = next.length !== rows.length;
    if (removed) await writeRaw(next);
    return removed;
  });
}

module.exports = { listEntries, addEntry, updateEntry, deleteEntry, USE_GIST, FILE_PATH };

