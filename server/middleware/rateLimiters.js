const rateLimit = require('express-rate-limit');

// Applies to POST /auth/register - slows down mass account creation from one IP
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network. Please try again later.' },
});

// Applies to POST /auth/login - slows down password guessing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

// Applies to POST /auth/forgot-password - slows down email-bombing / enumeration
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

// Applies to POST /auth/reset-password - slows down brute-forcing reset tokens
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please request a new reset link.' },
});

module.exports = { registerLimiter, loginLimiter, forgotPasswordLimiter, resetPasswordLimiter };
