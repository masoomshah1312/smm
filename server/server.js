require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

require('./db'); // initializes DB + bootstraps first admin

const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const orderRoutes = require('./routes/orders');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');

const app = express();

// If you put this behind nginx (recommended - see README), this makes
// Express read the real visitor IP from X-Forwarded-For instead of seeing
// every request as coming from nginx itself. Without this, rate limiting
// would apply to "everyone" as a single IP instead of per-visitor.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // the frontend loads Google Fonts + inline scripts; CSP is safe to tighten later if you lock that down
}));
app.use(cors());

// Stripe webhook needs the RAW body, so mount it before express.json()
app.post('/api/wallet/webhook', express.raw({ type: 'application/json' }), walletRoutes.webhookHandler);

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);

// Serve the frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SMM panel server running on http://localhost:${PORT}`);
  require('./scheduler').start();
});
