const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// Whether card top-ups are available (frontend uses this to show/hide the option)
router.get('/methods', requireAuth, (req, res) => {
  res.json({ stripe_enabled: Boolean(stripe) });
});

// Payment details customers should send money to (JazzCash / Easypaisa / other),
// configured by the admin in Admin -> Payment settings.
router.get('/payment-info', requireAuth, (req, res) => {
  const info = db.getSettings([
    'jazzcash_number',
    'jazzcash_title',
    'easypaisa_number',
    'easypaisa_title',
    'qr_image_url',
    'other_instructions',
  ]);
  res.json(info);
});

// Start a Stripe Checkout session to add funds by card
router.post('/checkout', requireAuth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Card payments are not configured on this panel yet' });
  const { amount } = req.body || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 1) {
    return res.status(400).json({ error: 'Enter an amount of at least $1' });
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Account balance top-up' },
            unit_amount: Math.round(amt * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { user_id: String(req.user.id) },
      success_url: `${process.env.FRONTEND_URL}/#/wallet?status=success`,
      cancel_url: `${process.env.FRONTEND_URL}/#/wallet?status=cancelled`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(502).json({ error: `Could not start checkout: ${e.message}` });
  }
});

// Stripe webhook - credits the user's balance once payment is confirmed.
// NOTE: this must receive the RAW body. It is exported separately (see
// `router.webhookHandler` below) and mounted directly in server.js with
// express.raw(), BEFORE express.json() and before this router is mounted.
async function handleStripeWebhook(req, res) {
  if (!stripe) return res.status(400).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook signature verification failed: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = Number(session.metadata?.user_id);
    const amount = (session.amount_total || 0) / 100;
    if (userId && amount > 0) {
      const tx = db.transaction(() => {
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
        db.prepare(
          `INSERT INTO transactions (user_id, type, amount, status, method, note, created_at)
           VALUES (?, 'deposit', ?, 'completed', 'stripe', ?, ?)`
        ).run(userId, amount, `Stripe checkout ${session.id}`, Date.now());
      });
      tx();
    }
  }
  res.json({ received: true });
}

// Manual top-up request (JazzCash, Easypaisa, or other) - goes to admin for approval
router.post('/manual-request', requireAuth, (req, res) => {
  const { amount, method, sender_number, note } = req.body || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Enter a valid amount' });
  }
  const validMethods = ['jazzcash', 'easypaisa', 'other'];
  const m = validMethods.includes(method) ? method : 'other';
  const fullNote = [
    sender_number ? `From: ${sender_number}` : null,
    note || null,
  ].filter(Boolean).join(' — ');
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount, status, method, note, created_at)
     VALUES (?, 'deposit', ?, 'pending', ?, ?, ?)`
  ).run(req.user.id, amt, m, fullNote, Date.now());
  res.json({ message: 'Top-up request submitted. An admin will review and approve it shortly.' });
});

// Current user's transaction history
router.get('/transactions', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(req.user.id);
  res.json({ transactions: rows });
});

// --- Admin ---

// List pending manual top-up requests
router.get('/admin/pending', requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.username, u.email FROM transactions t
       JOIN users u ON u.id = t.user_id
       WHERE t.type = 'deposit' AND t.status = 'pending' ORDER BY t.created_at ASC`
    )
    .all();
  res.json({ requests: rows });
});

// Approve or reject a manual top-up request
router.post('/admin/pending/:id/:action', requireAuth, requireAdmin, (req, res) => {
  const { id, action } = req.params;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const txRow = db.prepare(`SELECT * FROM transactions WHERE id = ? AND status = 'pending'`).get(id);
  if (!txRow) return res.status(404).json({ error: 'Request not found or already handled' });

  const run = db.transaction(() => {
    if (action === 'approve') {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(txRow.amount, txRow.user_id);
      db.prepare(`UPDATE transactions SET status = 'completed' WHERE id = ?`).run(txRow.id);
    } else {
      db.prepare(`UPDATE transactions SET status = 'rejected' WHERE id = ?`).run(txRow.id);
    }
  });
  run();
  res.json({ message: `Request ${action}d` });
});

// Directly adjust a user's balance (grants, corrections)
router.post('/admin/adjust', requireAuth, requireAdmin, (req, res) => {
  const { user_id, amount, note } = req.body || {};
  const amt = Number(amount);
  if (!user_id || !Number.isFinite(amt) || amt === 0) {
    return res.status(400).json({ error: 'user_id and a non-zero amount are required' });
  }
  const run = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, user_id);
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount, status, method, note, created_at)
       VALUES (?, 'admin_adjust', ?, 'completed', 'manual', ?, ?)`
    ).run(user_id, amt, note || 'Admin balance adjustment', Date.now());
  });
  run();
  res.json({ message: 'Balance adjusted' });
});

router.webhookHandler = handleStripeWebhook;
module.exports = router;
