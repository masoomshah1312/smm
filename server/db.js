const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'panel.db'));
db.pragma('journal_mode = WAL');

// --- Migration: old single-provider schema -> multi-provider schema ---
// If a `services` table already exists from before this update, it won't
// have a provider_id column. Rename the old tables out of the way now so
// the fresh CREATE TABLE statements below can create the new-shaped ones;
// we copy the data back in further down.
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
const hasOldServicesTable =
  db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='services'`).get() &&
  !columnExists('services', 'provider_id');
if (hasOldServicesTable) {
  console.log('[migration] Upgrading services/orders tables for multi-provider support...');
  db.exec('ALTER TABLE services RENAME TO services_legacy');
  db.exec('ALTER TABLE orders RENAME TO orders_legacy');
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  reset_token TEXT,
  reset_token_expires INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL,
  provider_service_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  provider_rate REAL NOT NULL,
  markup_percent REAL NOT NULL DEFAULT 30,
  min INTEGER,
  max INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(provider_id) REFERENCES providers(id),
  UNIQUE(provider_id, provider_service_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  provider_id INTEGER,
  provider_order_id TEXT,
  link TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  charge REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  start_count TEXT,
  remains TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(service_id) REFERENCES services(id),
  FOREIGN KEY(provider_id) REFERENCES providers(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,          -- 'deposit' | 'order' | 'refund' | 'admin_adjust'
  amount REAL NOT NULL,        -- positive = credit, negative = debit
  status TEXT NOT NULL DEFAULT 'completed', -- 'pending' | 'completed' | 'rejected'
  method TEXT,                 -- 'jazzcash' | 'easypaisa' | 'other' | 'stripe' | 'system'
  note TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

if (hasOldServicesTable) {
  // Turn the old .env-configured single provider into row #1 in the new
  // providers table, then copy every old service/order across pointing at it.
  const legacyName = process.env.PROVIDER_API_URL ? 'Provider 1 (migrated)' : 'Unnamed provider (migrated)';
  const info = db
    .prepare('INSERT INTO providers (name, api_url, api_key, active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(legacyName, process.env.PROVIDER_API_URL || '', process.env.PROVIDER_API_KEY || '', Date.now());
  const legacyProviderId = info.lastInsertRowid;

  db.exec(`
    INSERT INTO services (id, provider_id, provider_service_id, name, category, provider_rate, markup_percent, min, max, active, updated_at)
    SELECT id, ${legacyProviderId}, provider_service_id, name, category, provider_rate, markup_percent, min, max, active, updated_at
    FROM services_legacy;

    INSERT INTO orders (id, user_id, service_id, provider_id, provider_order_id, link, quantity, charge, status, start_count, remains, created_at)
    SELECT id, user_id, service_id, ${legacyProviderId}, provider_order_id, link, quantity, charge, status, start_count, remains, created_at
    FROM orders_legacy;

    DROP TABLE services_legacy;
    DROP TABLE orders_legacy;
  `);
  console.log(`[migration] Done. Your existing provider is now "${legacyName}" in Admin -> Providers - edit its name/key there, and add any additional providers.`);
}

// Sensible defaults for a PKR panel. All editable later from Admin -> Payment settings.
const defaultSettings = {
  usd_to_pkr_rate: process.env.USD_TO_PKR_RATE || '278',        // used to convert provider rates (usually USD) into PKR at sync time
  jazzcash_number: '',
  jazzcash_title: '',
  easypaisa_number: '',
  easypaisa_title: '',
  qr_image_url: '',
  other_instructions: '',
  site_name: 'Vortex SMM',
  tagline: "Pakistan's Cheapest SMM Panel — Real Growth, Real Fast",
  whatsapp_number: '',
  instagram_handle: '',
  tiktok_handle: '',
  facebook_handle: '',
  telegram_handle: '',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) insertSetting.run(k, v);

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}
function getSettings(keys) {
  const out = {};
  for (const k of keys) out[k] = getSetting(k);
  return out;
}
function setSettings(obj) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) upsert.run(k, String(v ?? ''));
  });
  tx(Object.entries(obj));
}

// Fresh install (no legacy migration happened) but .env still has a provider
// configured the old way - import it as Provider 1 so nothing breaks.
if (!hasOldServicesTable) {
  const providerCount = db.prepare('SELECT COUNT(*) AS c FROM providers').get().c;
  if (providerCount === 0 && process.env.PROVIDER_API_URL && process.env.PROVIDER_API_KEY) {
    db.prepare('INSERT INTO providers (name, api_url, api_key, active, created_at) VALUES (?, ?, ?, 1, ?)').run(
      'Provider 1',
      process.env.PROVIDER_API_URL,
      process.env.PROVIDER_API_KEY,
      Date.now()
    );
    console.log('[bootstrap] Imported PROVIDER_API_URL/PROVIDER_API_KEY from .env as "Provider 1". Add more providers from Admin -> Providers.');
  }
}

// Bootstrap first admin account if the DB is empty
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (username, email, password_hash, balance, role, created_at)
     VALUES (?, ?, ?, 0, 'admin', ?)`
  ).run(username, email, hash, Date.now());
  console.log(`[bootstrap] Created first admin account -> email: ${email}  password: ${password}`);
  console.log('[bootstrap] Log in and change this password immediately.');
}

module.exports = db;
module.exports.getSetting = getSetting;
module.exports.getSettings = getSettings;
module.exports.setSettings = setSettings;
