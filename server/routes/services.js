const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { syncServicesFromProvider } = require('../serviceSync');

const router = express.Router();

function withCustomerPrice(service) {
  const price = service.provider_rate * (1 + service.markup_percent / 100);
  return { ...service, price_per_1000: Number(price.toFixed(5)) };
}

function normalizeKey(service) {
  // Two providers rarely use byte-identical names, but this catches the
  // common case (exact same name, different provider) so the customer sees
  // one option at the best price instead of confusing duplicates.
  return `${(service.name || '').trim().toLowerCase()}|${(service.category || '').trim().toLowerCase()}`;
}

// Public (logged-in) list of active services, with markup applied.
// When the same service (by name + category) is offered by more than one
// provider, only the cheapest one is shown - the customer never needs to
// know or care which provider actually fulfills it.
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY category, name').all();
  const priced = rows.map(withCustomerPrice);
  const cheapestByGroup = new Map();
  for (const s of priced) {
    const key = normalizeKey(s);
    const existing = cheapestByGroup.get(key);
    if (!existing || s.price_per_1000 < existing.price_per_1000) {
      cheapestByGroup.set(key, s);
    }
  }
  res.json({ services: [...cheapestByGroup.values()] });
});

// Admin: full raw list (every provider's version of every service, not just
// the cheapest), with provider names attached, so admin can see and manage
// the whole picture rather than the trimmed customer-facing view.
router.get('/admin/all', requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, p.name AS provider_name FROM services s
       JOIN providers p ON p.id = s.provider_id
       ORDER BY s.category, s.name`
    )
    .all();
  const priced = rows.map(withCustomerPrice);
  // Flag which row is currently the cheapest in its group, so the admin UI
  // can highlight it (the one actually shown to customers).
  const cheapestPriceByGroup = new Map();
  for (const s of priced) {
    const key = normalizeKey(s);
    if (!s.active) continue;
    const current = cheapestPriceByGroup.get(key);
    if (current === undefined || s.price_per_1000 < current) cheapestPriceByGroup.set(key, s.price_per_1000);
  }
  const withFlag = priced.map((s) => ({
    ...s,
    is_cheapest: s.active && cheapestPriceByGroup.get(normalizeKey(s)) === s.price_per_1000,
  }));
  res.json({ services: withFlag });
});

// Admin: manually trigger a sync of every active provider (this also
// happens automatically in the background - see scheduler.js - but this
// lets an admin force it right now)
router.post('/sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { count, errors } = await syncServicesFromProvider();
    let message = `Synced ${count} services from provider${count === 1 ? '' : 's'}`;
    if (errors && errors.length) message += `. Some providers had problems: ${errors.join(' | ')}`;
    res.json({ message, count, errors });
  } catch (e) {
    res.status(502).json({ error: `Could not sync: ${e.message}` });
  }
});

// Admin: update markup or active status for a service
router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const { markup_percent, active } = req.body || {};
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  db.prepare('UPDATE services SET markup_percent = COALESCE(?, markup_percent), active = COALESCE(?, active) WHERE id = ?').run(
    markup_percent ?? null,
    active === undefined ? null : (active ? 1 : 0),
    req.params.id
  );
  res.json({ message: 'Service updated' });
});

module.exports = router;
