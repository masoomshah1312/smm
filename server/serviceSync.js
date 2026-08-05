const db = require('./db');
const provider = require('./providerClient');

// Pulls the latest service list + rates from EVERY active provider and
// upserts them locally. Existing per-service markup_percent and active flags
// are kept - only name/category/provider_rate/min/max get refreshed.
async function syncServicesFromProvider() {
  const providers = db.prepare('SELECT * FROM providers WHERE active = 1').all();
  if (!providers.length) {
    throw new Error('No providers configured yet. Add one from Admin -> Providers.');
  }

  const defaultMarkup = Number(process.env.DEFAULT_MARKUP_PERCENT || 30);
  // Most providers quote rates in USD. Convert to PKR here so everything
  // downstream (markup, order pricing, display) is in PKR. Adjust the rate
  // from Admin -> Payment settings if a provider bills differently or the
  // market rate moves.
  const usdToPkr = Number(db.getSetting('usd_to_pkr_rate')) || 278;

  const upsert = db.prepare(`
    INSERT INTO services (provider_id, provider_service_id, name, category, provider_rate, markup_percent, min, max, active, updated_at)
    VALUES (@provider_id, @provider_service_id, @name, @category, @provider_rate, @markup_percent, @min, @max, 1, @updated_at)
    ON CONFLICT(provider_id, provider_service_id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      provider_rate = excluded.provider_rate,
      min = excluded.min,
      max = excluded.max,
      updated_at = excluded.updated_at
  `);

  let totalCount = 0;
  const errors = [];
  const now = Date.now();

  for (const p of providers) {
    try {
      const providerServices = await provider.getServices({ api_url: p.api_url, api_key: p.api_key });
      const tx = db.transaction((list) => {
        for (const s of list) {
          upsert.run({
            provider_id: p.id,
            provider_service_id: String(s.service),
            name: s.name,
            category: s.category || 'General',
            provider_rate: Number(s.rate) * usdToPkr,
            markup_percent: defaultMarkup,
            min: Number(s.min) || 0,
            max: Number(s.max) || 0,
            updated_at: now,
          });
        }
      });
      tx(providerServices);
      totalCount += providerServices.length;
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
    }
  }

  if (errors.length && totalCount === 0) {
    // Every provider failed - surface it as a real error
    throw new Error(errors.join(' | '));
  }
  return { count: totalCount, errors };
}

module.exports = { syncServicesFromProvider };
