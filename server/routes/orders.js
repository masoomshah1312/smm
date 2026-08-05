const express = require('express');
const db = require('../db');
const provider = require('../providerClient');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Place a new order
router.post('/', requireAuth, async (req, res) => {
  const { service_id, link, quantity } = req.body || {};
  if (!service_id || !link || !quantity) {
    return res.status(400).json({ error: 'service_id, link, and quantity are required' });
  }
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive number' });
  }

  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(service_id);
  if (!service) return res.status(404).json({ error: 'Service not found or unavailable' });
  if (service.min && qty < service.min) return res.status(400).json({ error: `Minimum quantity is ${service.min}` });
  if (service.max && qty > service.max) return res.status(400).json({ error: `Maximum quantity is ${service.max}` });

  const providerRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(service.provider_id);
  if (!providerRow || !providerRow.active) {
    return res.status(502).json({ error: 'The provider for this service is currently unavailable. Please try again shortly.' });
  }

  const pricePer1000 = service.provider_rate * (1 + service.markup_percent / 100);
  const charge = Number(((pricePer1000 * qty) / 1000).toFixed(5));

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.balance < charge) {
    return res.status(402).json({ error: 'Insufficient balance. Please add funds first.' });
  }

  // Deduct balance and record a pending order BEFORE calling the provider,
  // then reconcile if the provider call fails, so a crash mid-request can't
  // leave the user's balance in an inconsistent state relative to the order.
  const now = Date.now();
  const insertOrder = db.prepare(`
    INSERT INTO orders (user_id, service_id, provider_id, provider_order_id, link, quantity, charge, status, created_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, 'processing', ?)
  `);
  const deduct = db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?');
  const insertTx = db.prepare(`
    INSERT INTO transactions (user_id, type, amount, status, method, note, created_at)
    VALUES (?, 'order', ?, 'completed', 'system', ?, ?)
  `);

  let orderId;
  const runInsert = db.transaction(() => {
    deduct.run(charge, user.id);
    const info = insertOrder.run(user.id, service.id, providerRow.id, link, qty, charge, now);
    orderId = info.lastInsertRowid;
    insertTx.run(user.id, -charge, `Order #${orderId}: ${service.name}`, now);
  });
  runInsert();

  try {
    const result = await provider.addOrder(
      { api_url: providerRow.api_url, api_key: providerRow.api_key },
      { service: service.provider_service_id, link, quantity: qty }
    );
    db.prepare('UPDATE orders SET provider_order_id = ?, status = ? WHERE id = ?').run(
      String(result.order),
      'processing',
      orderId
    );
    res.json({ message: 'Order placed', order_id: orderId, provider_order_id: result.order });
  } catch (e) {
    // Provider call failed - refund the user and mark the order failed.
    const refund = db.transaction(() => {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(charge, user.id);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', orderId);
      db.prepare(
        `INSERT INTO transactions (user_id, type, amount, status, method, note, created_at)
         VALUES (?, 'refund', ?, 'completed', 'system', ?, ?)`
      ).run(user.id, charge, `Refund for failed order #${orderId}`, Date.now());
    });
    refund();
    res.status(502).json({ error: `Provider rejected the order (refunded): ${e.message}` });
  }
});

// List current user's orders
router.get('/', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, s.name AS service_name, s.category
       FROM orders o JOIN services s ON s.id = o.service_id
       WHERE o.user_id = ? ORDER BY o.created_at DESC`
    )
    .all(req.user.id);
  res.json({ orders: rows });
});

// Refresh a single order's status from the provider
router.post('/:id/refresh', requireAuth, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.provider_order_id) return res.status(400).json({ error: 'Order has no provider reference yet' });
  const providerRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(order.provider_id);
  if (!providerRow) return res.status(502).json({ error: 'This order\'s provider is no longer configured' });
  try {
    const status = await provider.getOrderStatus(
      { api_url: providerRow.api_url, api_key: providerRow.api_key },
      order.provider_order_id
    );
    db.prepare('UPDATE orders SET status = ?, start_count = ?, remains = ? WHERE id = ?').run(
      String(status.status || order.status).toLowerCase(),
      String(status.start_count ?? order.start_count ?? ''),
      String(status.remains ?? order.remains ?? ''),
      order.id
    );
    res.json({ message: 'Status refreshed', status });
  } catch (e) {
    res.status(502).json({ error: `Could not reach provider: ${e.message}` });
  }
});

// Admin: view all orders across all users
router.get('/admin/all', requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, s.name AS service_name, u.username, u.email
       FROM orders o
       JOIN services s ON s.id = o.service_id
       JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC LIMIT 500`
    )
    .all();
  res.json({ orders: rows });
});

module.exports = router;
