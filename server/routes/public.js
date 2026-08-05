const express = require('express');
const db = require('../db');

const router = express.Router();

// No auth required - this powers the footer on the login/register screens too
router.get('/branding', (req, res) => {
  res.json(
    db.getSettings([
      'site_name',
      'tagline',
      'whatsapp_number',
      'instagram_handle',
      'tiktok_handle',
      'facebook_handle',
      'telegram_handle',
    ])
  );
});

module.exports = router;
