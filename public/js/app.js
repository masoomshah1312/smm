// ---------- State & API helper ----------
const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
};

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, type = 'ok') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}
function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

async function refreshMe() {
  if (!state.token) return;
  try {
    const { user } = await api('/auth/me');
    state.user = user;
    localStorage.setItem('user', JSON.stringify(user));
  } catch (e) {
    clearSession();
  }
}

// ---------- Router ----------
const app = document.getElementById('app');
let renderToken = 0; // guards against overlapping renders touching stale/detached DOM

function navigate(hash) {
  if (location.hash === hash) {
    // Hash isn't actually changing (e.g. clicking a nav item you're already
    // on), so the browser won't fire 'hashchange' - render manually instead.
    render();
  } else {
    location.hash = hash; // this alone will trigger render() via 'hashchange' below
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', async () => {
  await refreshMe();
  render();
});

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '') || (state.token ? 'buy' : 'login');
  const [route, queryStr] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));
  return { route: route || 'buy', query };
}

async function render() {
  const { route, query } = currentRoute();
  const myToken = ++renderToken;

  if (!state.token) {
    const authRoutes = { login: renderLogin, register: renderRegister, 'forgot-password': renderForgot, 'reset-password': renderReset };
    (authRoutes[route] || renderLogin)(query);
    return;
  }

  // Logged in: build the shell once, then render the active view inside it
  renderShell(route);
  const viewRoutes = {
    buy: renderBuyView,
    history: renderOrderHistoryView,
    wallet: renderWallet,
    account: renderAccount,
    admin: renderAdmin,
  };
  const viewFn = viewRoutes[route] || renderBuyView;
  try {
    await viewFn(query, myToken);
  } catch (e) {
    if (myToken !== renderToken) return; // a newer navigation happened - don't touch stale DOM
    document.getElementById('view').innerHTML = `<div class="card"><p class="error-text">${escapeHtml(e.message)}</p></div>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) { return `Rs ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 5, maximumFractionDigits: 5 })}`; }

// ---------- Auth views ----------
// ---------- Footer (branding + social links, admin-configurable) ----------
let _brandingCache = null;
async function getBranding() {
  if (_brandingCache) return _brandingCache;
  try {
    const res = await fetch('/api/public/branding');
    _brandingCache = await res.json();
  } catch (e) {
    _brandingCache = {};
  }
  return _brandingCache;
}
function footerPlaceholder() {
  return `<div id="site-footer"></div>`;
}
function buildFooterHtml(b) {
  const clean = (h) => (h || '').replace(/^@/, '').trim();
  const links = [];
  if (b.whatsapp_number) links.push(`<a href="https://wa.me/${clean(b.whatsapp_number)}" target="_blank" rel="noopener">💬 WhatsApp</a>`);
  if (b.instagram_handle) links.push(`<a href="https://instagram.com/${clean(b.instagram_handle)}" target="_blank" rel="noopener">📸 Instagram</a>`);
  if (b.tiktok_handle) links.push(`<a href="https://tiktok.com/@${clean(b.tiktok_handle)}" target="_blank" rel="noopener">🎵 TikTok</a>`);
  if (b.facebook_handle) links.push(`<a href="https://facebook.com/${clean(b.facebook_handle)}" target="_blank" rel="noopener">📘 Facebook</a>`);
  if (b.telegram_handle) links.push(`<a href="https://t.me/${clean(b.telegram_handle)}" target="_blank" rel="noopener">✈️ Telegram</a>`);
  return `
    <div style="text-align:center;padding:26px 16px 20px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);margin-top:28px;">
      <div style="font-family:var(--font-display);font-weight:700;color:var(--text);font-size:14px;margin-bottom:4px;">${escapeHtml(b.site_name || 'Vortex SMM')}</div>
      <div style="margin-bottom:12px;">${escapeHtml(b.tagline || '')}</div>
      ${links.length ? `<div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">${links.join('')}</div>` : ''}
    </div>
  `;
}
async function loadFooter() {
  const b = await getBranding();
  const el = document.getElementById('site-footer');
  if (!el) return; // already navigated away by the time this resolved
  el.innerHTML = buildFooterHtml(b);
}

function authFrame(title, bodyHtml) {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="brand"><span class="dot"></span> Vortex SMM</div>
        <h2 style="font-family:var(--font-display);font-size:17px;margin:0 0 18px;">${title}</h2>
        ${bodyHtml}
      </div>
    </div>
    ${footerPlaceholder()}`;
  loadFooter();
}

function renderLogin() {
  authFrame('👋 Welcome back', `
    <form id="f">
      <div class="field"><label>Username or email</label><input name="identifier" required autocomplete="username" /></div>
      <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password" /></div>
      <div id="err"></div>
      <button class="btn full" type="submit">Log in</button>
    </form>
    <div class="link-row"><a href="#/forgot-password">Forgot password?</a></div>
    <div class="link-row">New here? <a href="#/register">Create an account</a></div>
  `);
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: Object.fromEntries(fd) });
      setSession(token, user);
      navigate('#/buy');
    } catch (err) {
      document.getElementById('err').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  });
}

function renderRegister() {
  authFrame('✨ Create your account', `
    <form id="f">
      <div class="field"><label>Pick a username</label><input name="username" required autocomplete="username" /></div>
      <div class="field"><label>Email address</label><input name="email" type="email" required autocomplete="email" /></div>
      <div class="field"><label>Pick a password</label><input name="password" type="password" required minlength="8" autocomplete="new-password" /><div class="hint">At least 8 characters</div></div>
      <div id="err"></div>
      <button class="btn full" type="submit">Create account</button>
    </form>
    <div class="link-row">Already have an account? <a href="#/login">Log in</a></div>
  `);
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { token, user } = await api('/auth/register', { method: 'POST', body: Object.fromEntries(fd) });
      setSession(token, user);
      navigate('#/buy');
    } catch (err) {
      document.getElementById('err').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  });
}

function renderForgot() {
  authFrame('Reset your password', `
    <form id="f">
      <div class="field"><label>Account email</label><input name="email" type="email" required /></div>
      <div id="err"></div>
      <div id="ok"></div>
      <button class="btn full" type="submit">Send reset link</button>
    </form>
    <div class="link-row"><a href="#/login">Back to log in</a></div>
  `);
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { message } = await api('/auth/forgot-password', { method: 'POST', body: Object.fromEntries(fd) });
      document.getElementById('ok').innerHTML = `<p class="hint" style="color:var(--green)">${escapeHtml(message)}</p>`;
    } catch (err) {
      document.getElementById('err').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  });
}

function renderReset(query) {
  authFrame('Set a new password', `
    <form id="f">
      <div class="field"><label>New password</label><input name="password" type="password" required minlength="8" autocomplete="new-password" /></div>
      <div id="err"></div>
      <button class="btn full" type="submit">Update password</button>
    </form>
    <div class="link-row"><a href="#/login">Back to log in</a></div>
  `);
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token: query.token, password: fd.get('password') } });
      toast('Password updated. Please log in.');
      navigate('#/login');
    } catch (err) {
      document.getElementById('err').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  });
}

// ---------- Dashboard shell ----------
function renderShell(route) {
  const isAdmin = state.user?.role === 'admin';
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="dot"></span> Vortex SMM</div>
        <div class="nav-group">
          <div class="nav-item ${route === 'buy' ? 'active' : ''}" data-nav="buy"><span class="ic">🛒</span> Buy Now</div>
          <div class="nav-item ${route === 'history' ? 'active' : ''}" data-nav="history"><span class="ic">📋</span> My Orders</div>
          <div class="nav-item ${route === 'wallet' ? 'active' : ''}" data-nav="wallet"><span class="ic">💰</span> Add Money</div>
          <div class="nav-item ${route === 'account' ? 'active' : ''}" data-nav="account"><span class="ic">👤</span> My Account</div>
          ${isAdmin ? `<div class="nav-item ${route === 'admin' ? 'active' : ''}" data-nav="admin"><span class="ic">⚙️</span> Admin</div>` : ''}
        </div>
        <div class="sidebar-foot">
          <div class="nav-item" data-action="logout"><span class="ic">🚪</span> Log out</div>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <h1>${titleFor(route)}</h1>
          <div class="balance-pill"><span class="lbl">Balance</span> ${money(state.user?.balance)}</div>
        </div>
        <div class="content" id="view"></div>
        ${footerPlaceholder()}
      </div>
    </div>
  `;
  loadFooter();
  app.querySelectorAll('[data-nav]').forEach((el) =>
    el.addEventListener('click', () => { navigate(`#/${el.dataset.nav}`); })
  );
  app.querySelector('[data-action="logout"]').addEventListener('click', () => {
    clearSession();
    navigate('#/login');
  });
}
function titleFor(route) {
  return { buy: '🛒 Buy Now', history: '📋 My Orders', wallet: '💰 Add Money', account: '👤 My Account', admin: '⚙️ Admin' }[route] || 'Buy Now';
}

const STATUS_LABELS = {
  pending: { label: 'Waiting', emoji: '⏳' },
  processing: { label: 'In progress', emoji: '⚡' },
  in_progress: { label: 'In progress', emoji: '⚡' },
  completed: { label: 'Done', emoji: '✅' },
  partial: { label: 'Partly done', emoji: '⚠️' },
  failed: { label: 'Failed (refunded)', emoji: '❌' },
  canceled: { label: 'Cancelled', emoji: '❌' },
  rejected: { label: 'Rejected', emoji: '❌' },
};

function statusBadge(status) {
  const s = (status || 'pending').toLowerCase().replace(/\s+/g, '_');
  const info = STATUS_LABELS[s] || { label: status || 'Waiting', emoji: '⏳' };
  return `<span class="badge status-${s}"><span class="pulse"></span> ${info.emoji} ${escapeHtml(info.label)}</span>`;
}

// ---------- Buy Now page ----------
async function renderBuyView(query, token = renderToken) {
  const view = document.getElementById('view');
  view.innerHTML = `<div class="card"><p class="hint">Loading…</p></div>`;
  const { services } = await api('/services');
  if (token !== renderToken) return; // a newer navigation happened while we were loading
  renderNewOrderForm(view, services);
}

// ---------- My Orders (history) page ----------
async function renderOrderHistoryView(query, token = renderToken) {
  const view = document.getElementById('view');
  view.innerHTML = `<div class="card"><p class="hint">Loading…</p></div>`;
  const { orders } = await api('/orders');
  if (token !== renderToken) return;
  renderOrderHistory(view, orders);
}

function renderNewOrderForm(container, services) {
  if (!services.length) {
    container.innerHTML = `<div class="card"><div class="empty">😴 Nothing to order yet. Check back soon!</div></div>`;
    return;
  }
  const categories = [...new Set(services.map((s) => s.category || 'General'))];
  container.innerHTML = `
    <div class="card">
      <h2>🛒 Start a new order</h2>
      <p class="sub">Pick what you want, paste your link, choose how many — that's it.</p>
      <form id="orderForm">
        <div class="field">
          <label>1️⃣ What do you want?</label>
          <select name="service_id" id="serviceSelect">
            ${categories.map((cat) => `
              <optgroup label="${escapeHtml(cat)}">
                ${services.filter((s) => (s.category || 'General') === cat).map((s) =>
                  `<option value="${s.id}" data-price="${s.price_per_1000}" data-min="${s.min}" data-max="${s.max}">${escapeHtml(s.name)} — ${money(s.price_per_1000)} per 1,000 (min ${s.min || 1}, max ${s.max || '∞'})</option>`
                ).join('')}
              </optgroup>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>2️⃣ Paste the link</label>
          <input name="link" type="url" placeholder="https://instagram.com/yourpage" required />
        </div>
        <div class="field">
          <label>3️⃣ How many?</label>
          <div class="stepper">
            <button type="button" id="qtyMinus">−</button>
            <input name="quantity" id="qtyInput" type="number" min="1" required />
            <button type="button" id="qtyPlus">+</button>
          </div>
          <div class="hint" id="minMaxHint"></div>
        </div>
        <div class="field">
          <div class="price-preview" id="pricePreview">Rs 0 <span>you'll pay this much</span></div>
        </div>
        <div id="err"></div>
        <button class="btn full" type="submit">✅ Place Order</button>
      </form>
    </div>
  `;

  const select = document.getElementById('serviceSelect');
  const qtyInput = document.getElementById('qtyInput');
  const preview = document.getElementById('pricePreview');
  const minMaxHint = document.getElementById('minMaxHint');
  let step = 100;

  function currentMinMax() {
    const opt = select.options[select.selectedIndex];
    return { min: Number(opt.dataset.min) || 1, max: Number(opt.dataset.max) || Infinity };
  }

  function updatePreview() {
    const opt = select.options[select.selectedIndex];
    const price = Number(opt.dataset.price || 0);
    const { min, max } = currentMinMax();
    minMaxHint.textContent = `Smallest order: ${min} · Biggest order: ${isFinite(max) ? max : '∞'}`;
    const qty = Number(qtyInput.value || 0);
    const charge = Number(((price * qty) / 1000).toFixed(5));
    preview.innerHTML = `${money(charge)} <span>you'll pay this much</span>`;
  }
  select.addEventListener('change', () => {
    const { min } = currentMinMax();
    qtyInput.value = min;
    updatePreview();
  });
  qtyInput.addEventListener('input', updatePreview);
  document.getElementById('qtyMinus').addEventListener('click', () => {
    const { min } = currentMinMax();
    qtyInput.value = Math.max(min, Number(qtyInput.value || 0) - step);
    updatePreview();
  });
  document.getElementById('qtyPlus').addEventListener('click', () => {
    const { max } = currentMinMax();
    qtyInput.value = Math.min(max, Number(qtyInput.value || 0) + step);
    updatePreview();
  });
  qtyInput.value = currentMinMax().min;
  updatePreview();

  document.getElementById('orderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/orders', { method: 'POST', body: Object.fromEntries(fd) });
      await refreshMe();
      toast('🎉 Order placed!');
      navigate('#/history');
    } catch (err) {
      document.getElementById('err').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
      btn.disabled = false;
    }
  });
}

function renderOrderHistory(container, orders) {
  if (!orders.length) {
    container.innerHTML = `<div class="card"><div class="empty">📭 No orders yet. Tap "New Order" to get started!</div></div>`;
    return;
  }
  container.innerHTML = `
    <div class="list">
      ${orders.map((o) => `
        <div class="list-item">
          <div class="icon-circle">🛒</div>
          <div class="info">
            <div class="title">${escapeHtml(o.service_name)}</div>
            <div class="meta">#${o.id} · ${o.quantity} ordered ${o.remains && o.remains !== '0' ? `· ${o.remains} left to deliver` : ''}</div>
          </div>
          <div class="right">
            <div class="amount">${money(o.charge)}</div>
            ${statusBadge(o.status)}
          </div>
        </div>
      `).join('')}
    </div>
    <div style="text-align:center;margin-top:14px;">
      <button class="btn secondary small" id="refreshAllBtn">🔄 Refresh statuses</button>
    </div>
  `;
  document.getElementById('refreshAllBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Refreshing…';
    await Promise.allSettled(orders.map((o) => api(`/orders/${o.id}/refresh`, { method: 'POST' })));
    render();
  });
}
function truncate(str, n) { return str.length > n ? str.slice(0, n) + '…' : str; }

// ---------- Wallet view ----------
async function renderWallet(query, token = renderToken) {
  const view = document.getElementById('view');
  view.innerHTML = `<div class="card"><p class="hint">Loading…</p></div>`;

  const [{ stripe_enabled }, { transactions }, payInfo] = await Promise.all([
    api('/wallet/methods'),
    api('/wallet/transactions'),
    api('/wallet/payment-info'),
  ]);
  if (token !== renderToken) return;

  if (query.status === 'success') toast('Payment received — your balance will update shortly.');
  if (query.status === 'cancelled') toast('Checkout cancelled.', 'err');

  const hasJazzCash = payInfo.jazzcash_number;
  const hasEasypaisa = payInfo.easypaisa_number;

  view.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2><span class="step-num">1</span>&nbsp; Send money</h2>
        <p class="sub">Send the amount you want to add to one of these:</p>
        ${hasJazzCash ? `
          <div style="margin-bottom:14px;padding:14px;border:1px solid var(--border);border-radius:12px;">
            <div style="font-weight:700;margin-bottom:4px;">📱 JazzCash</div>
            <div class="mono" style="font-size:16px;">${escapeHtml(payInfo.jazzcash_number)}</div>
            ${payInfo.jazzcash_title ? `<div class="hint">Name: ${escapeHtml(payInfo.jazzcash_title)}</div>` : ''}
          </div>` : ''}
        ${hasEasypaisa ? `
          <div style="margin-bottom:14px;padding:14px;border:1px solid var(--border);border-radius:12px;">
            <div style="font-weight:700;margin-bottom:4px;">📱 Easypaisa</div>
            <div class="mono" style="font-size:16px;">${escapeHtml(payInfo.easypaisa_number)}</div>
            ${payInfo.easypaisa_title ? `<div class="hint">Name: ${escapeHtml(payInfo.easypaisa_title)}</div>` : ''}
          </div>` : ''}
        ${payInfo.qr_image_url ? `
          <div style="margin-bottom:14px;">
            <div class="hint" style="margin-bottom:6px;">Or scan this:</div>
            <img src="${escapeHtml(payInfo.qr_image_url)}" alt="Payment QR code" style="max-width:180px;border-radius:12px;border:1px solid var(--border);" />
          </div>` : ''}
        ${payInfo.other_instructions ? `<p class="hint">${escapeHtml(payInfo.other_instructions)}</p>` : ''}
        ${!hasJazzCash && !hasEasypaisa && !payInfo.qr_image_url ? `<p class="hint">Payment details aren't set up yet — check back soon.</p>` : ''}
      </div>
      <div class="card">
        <h2><span class="step-num">2</span>&nbsp; Tell us you sent it</h2>
        <p class="sub">We'll add it to your balance as soon as we see it.</p>
        <form id="manualForm">
          <div class="field">
            <label>I sent it with</label>
            <select name="method">
              <option value="jazzcash">📱 JazzCash</option>
              <option value="easypaisa">📱 Easypaisa</option>
              <option value="other">💳 Other</option>
            </select>
          </div>
          <div class="field"><label>How much did you send? (PKR)</label><input name="amount" type="number" min="1" step="1" required placeholder="1000" /></div>
          <div class="field"><label>Your phone number</label><input name="sender_number" placeholder="03xxxxxxxxx" /></div>
          <div class="field"><label>Transaction ID (optional)</label><textarea name="note" rows="2" placeholder="Found in your JazzCash/Easypaisa app after sending"></textarea></div>
          <div id="manualErr"></div>
          <button class="btn full" type="submit">✅ I've Sent The Money</button>
        </form>
        ${stripe_enabled ? `
          <details style="margin-top:16px;">
            <summary class="hint" style="cursor:pointer;">Pay by card instead</summary>
            <form id="stripeForm" style="margin-top:10px;">
              <div class="field"><label>Amount (PKR)</label><input name="amount" type="number" min="50" step="1" required /></div>
              <div id="stripeErr"></div>
              <button class="btn secondary" type="submit">Continue to checkout</button>
            </form>
          </details>` : ''}
      </div>
    </div>
    <div class="card">
      <h2><span class="step-num">3</span>&nbsp; Your history</h2>
      ${transactions.length ? `
        <div class="list">
          ${transactions.map((t) => `
            <div class="list-item">
              <div class="icon-circle">${t.amount >= 0 ? '💰' : '🛒'}</div>
              <div class="info">
                <div class="title">${escapeHtml(t.method || t.type)}</div>
                <div class="meta">${new Date(t.created_at).toLocaleDateString()} ${t.note ? `· ${escapeHtml(truncate(t.note, 30))}` : ''}</div>
              </div>
              <div class="right">
                <div class="amount" style="color:${t.amount >= 0 ? 'var(--green)' : 'var(--red)'}">${t.amount >= 0 ? '+' : ''}${money(t.amount)}</div>
                ${statusBadge(t.status)}
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<div class="empty">🕐 No transactions yet.</div>`}
    </div>
  `;

  const stripeForm = document.getElementById('stripeForm');
  if (stripeForm) {
    stripeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const { url } = await api('/wallet/checkout', { method: 'POST', body: Object.fromEntries(fd) });
        window.location.href = url;
      } catch (err) {
        document.getElementById('stripeErr').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
      }
    });
  }
  document.getElementById('manualForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { message } = await api('/wallet/manual-request', { method: 'POST', body: Object.fromEntries(fd) });
      toast(message);
      render();
    } catch (err) {
      document.getElementById('manualErr').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  });
}

// ---------- Account view ----------
async function renderAccount() {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>👤 Your info</h2>
        <div class="field"><label>Username</label><input value="${escapeHtml(state.user.username)}" disabled /></div>
        <div class="field"><label>Email</label><input value="${escapeHtml(state.user.email)}" disabled /></div>
      </div>
      <div class="card">
        <h2>🔒 Change password</h2>
        <form id="pwForm">
          <div class="field"><label>Current password</label><input name="currentPassword" type="password" required /></div>
          <div class="field"><label>New password</label><input name="newPassword" type="password" required minlength="8" /></div>
          <div id="err"></div>
          <button class="btn full" type="submit">Update password</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { message } = await api('/auth/change-password', { method: 'POST', body: Object.fromEntries(fd) });
      toast(message);
      e.target.reset();
    } catch (err) {
      document.getElementById('err').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  });
}

// ---------- Admin view ----------
async function renderAdmin(query, token = renderToken) {
  const view = document.getElementById('view');
  const activeTab = query.tab || 'users';
  const tabs = [
    ['users', '👥 Users'],
    ['topups', '💵 Pending Top-ups'],
    ['branding', '🌐 Branding'],
    ['payments', '⚙️ Payment Settings'],
    ['providers', '🏭 Providers'],
    ['services', '🛠️ Services'],
    ['orders', '📦 All Orders'],
  ];
  view.innerHTML = `
    <div class="tabs">
      ${tabs.map(([key, label]) => `<div class="tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</div>`).join('')}
    </div>
    <div id="tab-body"><div class="card"><p class="hint">Loading…</p></div></div>
  `;
  view.querySelectorAll('[data-tab]').forEach((el) =>
    el.addEventListener('click', () => { navigate(`#/admin?tab=${el.dataset.tab}`); })
  );

  const body = document.getElementById('tab-body');
  if (activeTab === 'users') return renderAdminUsers(body, token);
  if (activeTab === 'topups') return renderAdminTopups(body, token);
  if (activeTab === 'branding') return renderAdminBranding(body, token);
  if (activeTab === 'payments') return renderAdminPaymentSettings(body, token);
  if (activeTab === 'services') return renderAdminServices(body, token);
  if (activeTab === 'orders') return renderAdminOrders(body, token);
  if (activeTab === 'providers') return renderAdminProviders(body, token);
}

async function renderAdminUsers(container, token = renderToken) {
  const { users } = await api('/admin/users');
  if (token !== renderToken) return;
  container.innerHTML = `
    <div class="card" style="padding:0;overflow:auto;">
      <table>
        <thead><tr><th>Username</th><th>Email</th><th>Balance</th><th>Role</th><th>Adjust balance</th><th></th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td>${escapeHtml(u.username)}</td>
              <td>${escapeHtml(u.email)}</td>
              <td class="mono">${money(u.balance)}</td>
              <td>
                <select data-role="${u.id}">
                  <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
                </select>
              </td>
              <td>
                <form class="adjust-form" data-user="${u.id}" style="display:flex;gap:6px;">
                  <input name="amount" type="number" step="0.01" placeholder="+10 / -10" style="width:100px;background:var(--ink);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 8px;" />
                  <button class="btn secondary small" type="submit">Apply</button>
                </form>
              </td>
              <td><button class="btn danger small" data-delete-user="${u.id}" data-username="${escapeHtml(u.username)}">Delete</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  container.querySelectorAll('[data-role]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      try {
        await api(`/admin/users/${sel.dataset.role}`, { method: 'PATCH', body: { role: sel.value } });
        toast('Role updated');
      } catch (e) { toast(e.message, 'err'); }
    })
  );
  container.querySelectorAll('.adjust-form').forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(new FormData(f).get('amount'));
      if (!amount) return;
      try {
        await api('/wallet/admin/adjust', { method: 'POST', body: { user_id: Number(f.dataset.user), amount } });
        toast('Balance adjusted');
        renderAdminUsers(container);
      } catch (err) { toast(err.message, 'err'); }
    })
  );
  container.querySelectorAll('[data-delete-user]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const username = btn.dataset.username;
      if (!confirm(`Permanently delete "${username}" and all their orders and transactions? This can't be undone.`)) return;
      try {
        const { message } = await api(`/admin/users/${btn.dataset.deleteUser}`, { method: 'DELETE' });
        toast(message);
        renderAdminUsers(container);
      } catch (err) { toast(err.message, 'err'); }
    })
  );
}

async function renderAdminTopups(container, token = renderToken) {
  const { requests } = await api('/wallet/admin/pending');
  if (token !== renderToken) return;
  if (!requests.length) {
    container.innerHTML = `<div class="card"><div class="empty">No pending top-up requests.</div></div>`;
    return;
  }
  container.innerHTML = `
    <div class="card" style="padding:0;overflow:auto;">
      <table>
        <thead><tr><th>Date</th><th>User</th><th>Method</th><th>Amount</th><th>Note</th><th></th></tr></thead>
        <tbody>
          ${requests.map((r) => `
            <tr>
              <td class="mono">${new Date(r.created_at).toLocaleString()}</td>
              <td>${escapeHtml(r.username)} <span class="hint">(${escapeHtml(r.email)})</span></td>
              <td>${escapeHtml(r.method || '—')}</td>
              <td class="mono">${money(r.amount)}</td>
              <td>${escapeHtml(r.note || '')}</td>
              <td style="display:flex;gap:6px;">
                <button class="btn small" data-approve="${r.id}">Approve</button>
                <button class="btn danger small" data-reject="${r.id}">Reject</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  container.querySelectorAll('[data-approve]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/wallet/admin/pending/${btn.dataset.approve}/approve`, { method: 'POST' });
      toast('Approved'); renderAdminTopups(container);
    })
  );
  container.querySelectorAll('[data-reject]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/wallet/admin/pending/${btn.dataset.reject}/reject`, { method: 'POST' });
      toast('Rejected'); renderAdminTopups(container);
    })
  );
}

async function renderAdminServices(container, token = renderToken) {
  const { services } = await api('/services/admin/all');
  if (token !== renderToken) return; // a newer navigation happened while we were loading - don't touch a detached container
  const minutes = Number(await getAutoSyncMinutes());
  container.innerHTML = `
    <div class="card">
      <h2>Provider sync</h2>
      <p class="sub">Pulls the latest service list and rates from every active provider. Your markup and active flags are kept. This also runs automatically every ${minutes} minutes in the background. When two providers offer the same service (same name + category), customers automatically see whichever is cheapest — marked ⭐ below.</p>
      <button class="btn" id="syncBtn">Sync from providers now</button>
      <div id="syncMsg" class="hint" style="margin-top:10px;"></div>
    </div>
    <div class="card" style="padding:0;overflow:auto;">
      <table>
        <thead><tr><th></th><th>Service</th><th>Provider</th><th>Category</th><th>Provider rate /1k</th><th>Markup %</th><th>Your price /1k</th><th>Min</th><th>Max</th><th>Active</th></tr></thead>
        <tbody>
          ${services.map((s) => `
            <tr>
              <td>${s.is_cheapest ? '⭐' : ''}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.provider_name)}</td>
              <td>${escapeHtml(s.category || '')}</td>
              <td class="mono">${money(s.provider_rate)}</td>
              <td><input data-markup="${s.id}" type="number" value="${s.markup_percent}" style="width:70px;background:var(--ink);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 8px;" /></td>
              <td class="mono">${money(s.price_per_1000)}</td>
              <td class="mono">${s.min || 1}</td>
              <td class="mono">${s.max || '∞'}</td>
              <td><input data-active="${s.id}" type="checkbox" ${s.active ? 'checked' : ''} /></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  // Query within `container`, not the whole document - this container is
  // guaranteed to still be the live, attached one at this point (we already
  // bailed out above if a newer render had started).
  container.querySelector('#syncBtn').addEventListener('click', async () => {
    const btn = container.querySelector('#syncBtn');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
      const { message } = await api('/services/sync', { method: 'POST' });
      container.querySelector('#syncMsg').textContent = message;
      renderAdminServices(container);
    } catch (e) {
      container.querySelector('#syncMsg').innerHTML = `<span class="error-text">${escapeHtml(e.message)}</span>`;
    } finally {
      if (container.querySelector('#syncBtn')) {
        container.querySelector('#syncBtn').disabled = false;
        container.querySelector('#syncBtn').textContent = 'Sync from provider now';
      }
    }
  });
  container.querySelectorAll('[data-markup]').forEach((inp) =>
    inp.addEventListener('change', async () => {
      try {
        await api(`/services/${inp.dataset.markup}`, { method: 'PATCH', body: { markup_percent: Number(inp.value) } });
        toast('Markup updated');
        renderAdminServices(container);
      } catch (e) { toast(e.message, 'err'); }
    })
  );
  container.querySelectorAll('[data-active]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      try {
        await api(`/services/${cb.dataset.active}`, { method: 'PATCH', body: { active: cb.checked } });
        toast('Service updated');
      } catch (e) { toast(e.message, 'err'); }
    })
  );
}
// Cached so we don't re-fetch this on every keystroke/render - it rarely changes
let _autoSyncMinutesCache = null;
async function getAutoSyncMinutes() {
  if (_autoSyncMinutesCache) return _autoSyncMinutesCache;
  try {
    const { service_sync_minutes } = await api('/admin/settings');
    _autoSyncMinutesCache = service_sync_minutes || 10;
  } catch (e) {
    _autoSyncMinutesCache = 10;
  }
  return _autoSyncMinutesCache;
}

async function renderAdminBranding(container, token = renderToken) {
  const s = await api('/admin/settings');
  if (token !== renderToken) return;
  container.innerHTML = `
    <div class="card">
      <h2>🌐 Site name &amp; tagline</h2>
      <p class="sub">Shown in the sidebar, browser tab, and footer.</p>
      <form id="brandForm">
        <div class="field"><label>Site name</label><input name="site_name" value="${escapeHtml(s.site_name)}" placeholder="Vortex SMM" /></div>
        <div class="field"><label>Tagline</label><input name="tagline" value="${escapeHtml(s.tagline)}" placeholder="Pakistan's Cheapest SMM Panel — Real Growth, Real Fast" /></div>
        <div id="brandErr"></div>
        <button class="btn" type="submit">Save</button>
      </form>
    </div>
    <div class="card">
      <h2>📱 Social &amp; contact links</h2>
      <p class="sub">Shown as icons in the footer on every page. Leave blank to hide any of them.</p>
      <form id="socialForm">
        <div class="grid-2">
          <div class="field"><label>WhatsApp number</label><input name="whatsapp_number" value="${escapeHtml(s.whatsapp_number)}" placeholder="923001234567 (country code, no +)" /></div>
          <div class="field"><label>Instagram username</label><input name="instagram_handle" value="${escapeHtml(s.instagram_handle)}" placeholder="vortexsmm" /></div>
          <div class="field"><label>TikTok username</label><input name="tiktok_handle" value="${escapeHtml(s.tiktok_handle)}" placeholder="vortexsmm" /></div>
          <div class="field"><label>Facebook page</label><input name="facebook_handle" value="${escapeHtml(s.facebook_handle)}" placeholder="vortexsmm" /></div>
          <div class="field"><label>Telegram username</label><input name="telegram_handle" value="${escapeHtml(s.telegram_handle)}" placeholder="vortexsmm" /></div>
        </div>
        <div id="socialErr"></div>
        <button class="btn" type="submit">Save</button>
      </form>
    </div>
  `;
  const saveHandler = (formId, errId) => async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/admin/settings', { method: 'PATCH', body: Object.fromEntries(fd) });
      _brandingCache = null; // force the footer to pick up the change next time it loads
      toast('Saved');
    } catch (err) {
      container.querySelector(`#${errId}`).innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  };
  container.querySelector('#brandForm').addEventListener('submit', saveHandler('brandForm', 'brandErr'));
  container.querySelector('#socialForm').addEventListener('submit', saveHandler('socialForm', 'socialErr'));
}

async function renderAdminPaymentSettings(container, token = renderToken) {
  const s = await api('/admin/settings');
  if (token !== renderToken) return;
  container.innerHTML = `
    <div class="card">
      <h2>JazzCash &amp; Easypaisa</h2>
      <p class="sub">These are shown to customers on the Add funds page so they know where to send money.</p>
      <form id="payForm">
        <div class="grid-2">
          <div class="field"><label>JazzCash number</label><input name="jazzcash_number" value="${escapeHtml(s.jazzcash_number)}" placeholder="03xxxxxxxxx" /></div>
          <div class="field"><label>JazzCash account title</label><input name="jazzcash_title" value="${escapeHtml(s.jazzcash_title)}" placeholder="Your name" /></div>
          <div class="field"><label>Easypaisa number</label><input name="easypaisa_number" value="${escapeHtml(s.easypaisa_number)}" placeholder="03xxxxxxxxx" /></div>
          <div class="field"><label>Easypaisa account title</label><input name="easypaisa_title" value="${escapeHtml(s.easypaisa_title)}" placeholder="Your name" /></div>
        </div>
        <div class="field"><label>QR code image URL (optional)</label><input name="qr_image_url" value="${escapeHtml(s.qr_image_url)}" placeholder="https://..." /></div>
        <div class="field"><label>Other instructions (bank transfer, etc.)</label><textarea name="other_instructions" rows="2">${escapeHtml(s.other_instructions)}</textarea></div>
        <div class="field">
          <label>USD → PKR rate</label>
          <input name="usd_to_pkr_rate" type="number" step="0.01" value="${escapeHtml(s.usd_to_pkr_rate)}" />
          <div class="hint">Used to convert your provider's rates (usually USD) into PKR when you sync services.</div>
        </div>
        <div id="payErr"></div>
        <button class="btn" type="submit">Save settings</button>
      </form>
    </div>
  `;
  document.getElementById('payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/admin/settings', { method: 'PATCH', body: Object.fromEntries(fd) });
      toast('Payment settings saved');
    } catch (err) {
      document.getElementById('payErr').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  });
}

async function renderAdminOrders(container, token = renderToken) {
  const { orders } = await api('/orders/admin/all');
  if (token !== renderToken) return;
  if (!orders.length) {
    container.innerHTML = `<div class="card"><div class="empty">No orders yet.</div></div>`;
    return;
  }
  container.innerHTML = `
    <div class="card" style="padding:0;overflow:auto;">
      <table>
        <thead><tr><th>#</th><th>User</th><th>Service</th><th>Qty</th><th>Charge</th><th>Status</th></tr></thead>
        <tbody>
          ${orders.map((o) => `
            <tr>
              <td class="mono">${o.id}</td>
              <td>${escapeHtml(o.username)}</td>
              <td>${escapeHtml(o.service_name)}</td>
              <td class="mono">${o.quantity}</td>
              <td class="mono">${money(o.charge)}</td>
              <td>${statusBadge(o.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function renderAdminProviders(container, token = renderToken) {
  const { providers } = await api('/admin/providers');
  if (token !== renderToken) return;
  container.innerHTML = `
    <div class="card">
      <h2>➕ Add a provider</h2>
      <p class="sub">Add every SMM provider account you resell from. When two providers offer the same service, customers automatically see whichever one is cheapest.</p>
      <form id="addProviderForm">
        <div class="field"><label>Name (just for your reference)</label><input name="name" placeholder="e.g. mksmmpanel" required /></div>
        <div class="field"><label>API URL</label><input name="api_url" placeholder="https://provider.com/api/v2" required /></div>
        <div class="field"><label>API key</label><input name="api_key" placeholder="your provider API key" required /></div>
        <div id="addProviderErr"></div>
        <button class="btn" type="submit">Add provider</button>
      </form>
    </div>
    <div class="card">
      <h2>Your providers</h2>
      <div id="providersList">${providers.length ? '' : '<div class="empty">No providers yet — add one above.</div>'}</div>
    </div>
    <div class="card">
      <h2>💰 Provider balances</h2>
      <p class="sub">Your balance with each provider — top up before it hits zero or customer orders on that provider will start failing.</p>
      <div id="balancesBox" class="hint">Checking…</div>
    </div>
  `;

  const list = container.querySelector('#providersList');
  providers.forEach((p) => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:14px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;';
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;">${escapeHtml(p.name)} ${p.active ? '' : '<span class="badge">inactive</span>'}</div>
          <div class="hint mono">${escapeHtml(p.api_url)}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn secondary small" data-edit="${p.id}">Edit</button>
          <button class="btn ${p.active ? 'secondary' : ''} small" data-toggle="${p.id}" data-active="${p.active}">${p.active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn danger small" data-delete="${p.id}" data-name="${escapeHtml(p.name)}">Delete</button>
        </div>
      </div>
      <form data-edit-form="${p.id}" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
        <div class="field"><label>Name</label><input name="name" value="${escapeHtml(p.name)}" /></div>
        <div class="field"><label>API URL</label><input name="api_url" value="${escapeHtml(p.api_url)}" /></div>
        <div class="field"><label>New API key (leave blank to keep the current one)</label><input name="api_key" placeholder="••••••••" /></div>
        <button class="btn small" type="submit">Save changes</button>
      </form>
    `;
    list.appendChild(row);
  });

  container.querySelector('#addProviderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/admin/providers', { method: 'POST', body: Object.fromEntries(fd) });
      toast('Provider added');
      renderAdminProviders(container);
    } catch (err) {
      container.querySelector('#addProviderErr').innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
  });
  container.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const form = container.querySelector(`[data-edit-form="${btn.dataset.edit}"]`);
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    })
  );
  container.querySelectorAll('[data-edit-form]').forEach((form) =>
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      if (!body.api_key) delete body.api_key; // keep existing key if left blank
      try {
        await api(`/admin/providers/${form.dataset.editForm}`, { method: 'PATCH', body });
        toast('Provider updated');
        renderAdminProviders(container);
      } catch (err) { toast(err.message, 'err'); }
    })
  );
  container.querySelectorAll('[data-toggle]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const nowActive = btn.dataset.active === '1' || btn.dataset.active === 'true';
      try {
        await api(`/admin/providers/${btn.dataset.toggle}`, { method: 'PATCH', body: { active: !nowActive } });
        renderAdminProviders(container);
      } catch (err) { toast(err.message, 'err'); }
    })
  );
  container.querySelectorAll('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm(`Remove provider "${btn.dataset.name}"?`)) return;
      try {
        await api(`/admin/providers/${btn.dataset.delete}`, { method: 'DELETE' });
        toast('Provider removed');
        renderAdminProviders(container);
      } catch (err) { toast(err.message, 'err'); }
    })
  );

  // Balances load separately since they require live calls to each provider
  try {
    const { balances } = await api('/admin/provider-balance');
    if (token !== renderToken) return;
    const box = container.querySelector('#balancesBox');
    if (!balances.length) {
      box.innerHTML = 'No active providers to check.';
    } else {
      box.innerHTML = balances.map((b) => b.error
        ? `<div style="margin-bottom:8px;"><strong>${escapeHtml(b.provider_name)}:</strong> <span class="error-text">${escapeHtml(b.error)}</span></div>`
        : `<div class="price-preview" style="margin-bottom:10px;">${money(b.balance.balance)} <span>${escapeHtml(b.balance.currency || '')} — ${escapeHtml(b.provider_name)}</span></div>`
      ).join('');
    }
  } catch (e) {
    if (token !== renderToken) return;
    container.querySelector('#balancesBox').innerHTML = `<span class="error-text">${escapeHtml(e.message)}</span>`;
  }
}
