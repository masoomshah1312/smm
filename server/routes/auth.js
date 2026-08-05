const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { sendPasswordReset } = require('../mailer');
const { requireAuth } = require('../middleware/auth');
const {
  registerLimiter,
  loginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} = require('../middleware/rateLimiters');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

router.post('/register', registerLimiter, (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are all required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const existing = db
    .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
    .get(email, username);
  if (existing) {
    return res.status(409).json({ error: 'That username or email is already registered' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, balance, role, created_at)
       VALUES (?, ?, ?, 0, 'user', ?)`
    )
    .run(username, email, hash, Date.now());
  const user = { id: info.lastInsertRowid, username, role: 'user' };
  res.json({ token: signToken(user), user: { id: user.id, username, email, balance: 0, role: 'user' } });
});

router.post('/login', loginLimiter, (req, res) => {
  const { identifier, password } = req.body || {}; // identifier = username or email
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }
  const user = db
    .prepare('SELECT * FROM users WHERE email = ? OR username = ?')
    .get(identifier, identifier);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username/email or password' });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, username: user.username, email: user.email, balance: user.balance, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, email, balance, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Always respond success, whether or not the email exists, to avoid leaking
  // which emails are registered.
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 60 * 60 * 1000; // 1 hour
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(
      token,
      expires,
      user.id
    );
    const resetLink = `${process.env.FRONTEND_URL}/#/reset-password?token=${token}`;
    try {
      await sendPasswordReset(user.email, resetLink);
    } catch (e) {
      console.error('Failed to send reset email:', e.message);
    }
  }
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

router.post('/reset-password', resetPasswordLimiter, (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_token_expires || user.reset_token_expires < Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(
    hash,
    user.id
  );
  res.json({ message: 'Password updated. You can log in now.' });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ message: 'Password changed' });
});

module.exports = router;
