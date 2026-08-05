const express = require('express');
const db = require('../db');
const provider = require('../providerClient');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// List all users
router.get('/users', (req, res) => {
  const rows = db
    .prepare('SELECT id, username, email, balance, role, created_at FROM users ORDER BY created_at DESC')
    .all();
  res.json({ users: rows });
});

// Promote/demote a user, or disable by role change
router.patch('/users/:id', (req, res) => {
  const { role } = req.body || {};
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'User updated' });
});

// Permanently delete a user and everything tied to them (orders, transactions).
// This cannot be undone - the frontend confirms with the admin before calling it.
router.delete('/users/:id', (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account while logged in as it" });
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.role === 'admin') {
    const adminCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c;
    if (adminCount <= 1) {
      return res.status(400).json({ error: "Can't delete the last remaining admin account" });
    }
  }

  const run = db.transaction(() => {
    db.prepare('DELETE FROM transactions WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  });
  run();
  res.json({ message: `Deleted ${target.username} and all their data` });
});

// Check your balance with EVERY configured provider (so you know when to
// top up before customers' orders on that provider start failing)
router.get('/provider-balance', async (req, res) => {
  const providers = db.prepare('SELECT * FROM providers WHERE active = 1').all();
  const results = [];
  for (const p of providers) {
    try {
      const balance = await provider.getBalance({ api_url: p.api_url, api_key: p.api_key });
      results.push({ provider_id: p.id, provider_name: p.name, balance, error: null });
    } catch (e) {
      results.push({ provider_id: p.id, provider_name: p.name, balance: null, error: e.message });
    }
  }
  res.json({ balances: results });
});

// --- Providers ---

router.get('/providers', (req, res) => {
  const rows = db.prepare('SELECT id, name, api_url, active, created_at FROM providers ORDER BY created_at').all();
  // Never send api_key back to the browser once saved - only show whether one is set
  const withKeyFlag = rows.map((p) => ({ ...p, has_key: true }));
  res.json({ providers: withKeyFlag });
});

router.post('/providers', (req, res) => {
  const { name, api_url, api_key } = req.body || {};
  if (!name || !api_url || !api_key) {
    return res.status(400).json({ error: 'Name, API URL, and API key are all required' });
  }
  const info = db
    .prepare('INSERT INTO providers (name, api_url, api_key, active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(name, api_url, api_key, Date.now());
  res.json({ message: 'Provider added', id: info.lastInsertRowid });
});

router.patch('/providers/:id', (req, res) => {
  const { name, api_url, api_key, active } = req.body || {};
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Provider not found' });
  db.prepare(
    `UPDATE providers SET
      name = COALESCE(?, name),
      api_url = COALESCE(?, api_url),
      api_key = COALESCE(?, api_key),
      active = COALESCE(?, active)
     WHERE id = ?`
  ).run(name ?? null, api_url ?? null, api_key || null, active === undefined ? null : (active ? 1 : 0), req.params.id);
  res.json({ message: 'Provider updated' });
});

router.delete('/providers/:id', (req, res) => {
  const id = Number(req.params.id);
  const serviceCount = db.prepare('SELECT COUNT(*) AS c FROM services WHERE provider_id = ?').get(id).c;
  if (serviceCount > 0) {
    return res.status(400).json({
      error: `This provider still has ${serviceCount} synced service(s) tied to it. Deactivate it instead, or remove its services first.`,
    });
  }
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  res.json({ message: 'Provider removed' });
});

// View current payment + branding settings
router.get('/settings', (req, res) => {
  const info = db.getSettings([
    'usd_to_pkr_rate',
    'jazzcash_number',
    'jazzcash_title',
    'easypaisa_number',
    'easypaisa_title',
    'qr_image_url',
    'other_instructions',
    'site_name',
    'tagline',
    'whatsapp_number',
    'instagram_handle',
    'tiktok_handle',
    'facebook_handle',
    'telegram_handle',
  ]);
  // This one comes from .env, not the settings table, since it's a
  // deployment-level setting rather than something changed day-to-day.
  info.service_sync_minutes = Number(process.env.SERVICE_SYNC_MINUTES) || 10;
  res.json(info);
});

// Update payment/branding settings. Only known keys are accepted.
router.patch('/settings', (req, res) => {
  const allowed = [
    'usd_to_pkr_rate',
    'jazzcash_number',
    'jazzcash_title',
    'easypaisa_number',
    'easypaisa_title',
    'qr_image_url',
    'other_instructions',
    'site_name',
    'tagline',
    'whatsapp_number',
    'instagram_handle',
    'tiktok_handle',
    'facebook_handle',
    'telegram_handle',
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  }
  db.setSettings(updates);
  res.json({ message: 'Settings updated' });
});

module.exports = router;
