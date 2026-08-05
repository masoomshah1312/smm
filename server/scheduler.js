// Periodically asks the provider "what's the status of these orders now?"
// for every order that isn't finished yet, and updates our database. It also
// periodically re-syncs the service catalog (names/rates/limits) from the
// provider. Both run inside the Node process itself - no OS-level cron needed.
const db = require('./db');
const provider = require('./providerClient');
const { syncServicesFromProvider } = require('./serviceSync');

const FINAL_STATUSES = ['completed', 'failed', 'canceled', 'cancelled', 'rejected'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyStatus(orderId, s) {
  db.prepare('UPDATE orders SET status = ?, start_count = ?, remains = ? WHERE id = ?').run(
    String(s.status || 'pending').toLowerCase(),
    String(s.start_count ?? ''),
    String(s.remains ?? ''),
    orderId
  );
}

async function refreshActiveOrders() {
  const orders = db
    .prepare(
      `SELECT id, provider_order_id, provider_id FROM orders
       WHERE provider_order_id IS NOT NULL AND provider_id IS NOT NULL
       AND status NOT IN (${FINAL_STATUSES.map(() => '?').join(',')})`
    )
    .all(...FINAL_STATUSES);

  if (!orders.length) return { checked: 0, updated: 0 };

  // Different orders can belong to different providers, and each provider
  // needs its own credentials - group by provider_id and check each
  // provider's batch separately.
  const byProvider = new Map();
  for (const o of orders) {
    if (!byProvider.has(o.provider_id)) byProvider.set(o.provider_id, []);
    byProvider.get(o.provider_id).push(o);
  }

  let updated = 0;
  const chunkSize = 100; // most providers cap batch status checks around this size
  for (const [providerId, providerOrders] of byProvider) {
    const providerRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId);
    if (!providerRow) continue;
    const providerConfig = { api_url: providerRow.api_url, api_key: providerRow.api_key };

    for (let i = 0; i < providerOrders.length; i += chunkSize) {
      const chunk = providerOrders.slice(i, i + chunkSize);
      try {
        const result = await provider.getMultiStatus(providerConfig, chunk.map((o) => o.provider_order_id));
        for (const o of chunk) {
          const s = result[o.provider_order_id];
          if (!s) continue;
          applyStatus(o.id, s);
          updated++;
        }
      } catch (e) {
        // Provider doesn't support batch status (or the call failed) - fall
        // back to checking orders one at a time, with a small delay so we
        // don't hammer their API.
        for (const o of chunk) {
          try {
            const s = await provider.getOrderStatus(providerConfig, o.provider_order_id);
            applyStatus(o.id, s);
            updated++;
          } catch (err) {
            console.error(`[scheduler] Could not check order ${o.id}: ${err.message}`);
          }
          await sleep(150);
        }
      }
    }
  }
  return { checked: orders.length, updated };
}

let running = false;
let syncing = false;

function start() {
  const providerCount = db.prepare('SELECT COUNT(*) AS c FROM providers WHERE active = 1').get().c;
  if (providerCount === 0) {
    console.log('[scheduler] No providers configured yet - automatic status refresh and service sync are paused until Admin -> Providers has at least one.');
    return;
  }
  const statusMinutes = Number(process.env.STATUS_REFRESH_MINUTES) || 10;
  const syncMinutes = Number(process.env.SERVICE_SYNC_MINUTES) || 10;
  console.log(`[scheduler] Order statuses will auto-refresh every ${statusMinutes} minute(s).`);
  console.log(`[scheduler] Service catalog will auto-sync every ${syncMinutes} minute(s).`);

  const statusTick = async () => {
    if (running) return; // don't overlap runs if one is still in progress
    running = true;
    try {
      const { checked, updated } = await refreshActiveOrders();
      if (checked) console.log(`[scheduler] Checked ${checked} active order(s), updated ${updated}.`);
    } catch (e) {
      console.error('[scheduler] Status refresh cycle failed:', e.message);
    } finally {
      running = false;
    }
  };

  const syncTick = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const { count } = await syncServicesFromProvider();
      console.log(`[scheduler] Auto-synced ${count} services from provider.`);
    } catch (e) {
      console.error('[scheduler] Service sync failed:', e.message);
    } finally {
      syncing = false;
    }
  };

  setInterval(statusTick, statusMinutes * 60 * 1000);
  setInterval(syncTick, syncMinutes * 60 * 1000);
  // Run both once shortly after boot rather than waiting a full interval
  setTimeout(statusTick, 15 * 1000);
  setTimeout(syncTick, 20 * 1000);
}

module.exports = { start, refreshActiveOrders };
