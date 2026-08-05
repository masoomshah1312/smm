// Thin client for the "standard" SMM provider API that the vast majority of
// providers (JAP, SMM Kings, SMM Coder, Attpanel, etc.) implement.
// Docs pattern: POST {url} with form fields: key, action, and action-specific params.
//
// Every function here takes a `providerConfig` object ({ api_url, api_key })
// as its first argument, since a panel can now have multiple providers
// configured at once (see Admin -> Providers).
const fetch = require('node-fetch');

async function call(providerConfig, params) {
  const { api_url, api_key } = providerConfig || {};
  if (!api_url || !api_key) {
    throw new Error('This provider is not fully configured (missing API URL or key).');
  }
  const body = new URLSearchParams({ key: api_key, ...params });
  const res = await fetch(api_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Provider API HTTP error: ${res.status}`);
  }
  const data = await res.json();
  if (data && data.error) {
    throw new Error(`Provider API error: ${data.error}`);
  }
  return data;
}

module.exports = {
  // Returns array of { service, name, category, rate, min, max, ... }
  getServices: (providerConfig) => call(providerConfig, { action: 'services' }),

  // Places an order. Returns { order: <provider_order_id> }
  addOrder: (providerConfig, { service, link, quantity }) =>
    call(providerConfig, { action: 'add', service, link, quantity }),

  // Returns { charge, start_count, status, remains, currency }
  getOrderStatus: (providerConfig, orderId) => call(providerConfig, { action: 'status', order: orderId }),

  // Batch status check, comma separated provider order ids
  getMultiStatus: (providerConfig, orderIds) => call(providerConfig, { action: 'status', orders: orderIds.join(',') }),

  // Returns { balance, currency } - your balance with the provider
  getBalance: (providerConfig) => call(providerConfig, { action: 'balance' }),
};
