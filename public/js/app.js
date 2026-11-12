const state = {
  user: null,
  products: [],
  suppliers: [],
  customers: [],
};

// ---------- Theme toggle (day/night mode) ----------
const THEME_KEY = 'pitchstock-theme';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
applyTheme(localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// ---------- Year era preference (พ.ศ. / ค.ศ.) ----------
const YEAR_ERA_KEY = 'pitchstock-year-era';
function getYearEra() { return localStorage.getItem(YEAR_ERA_KEY) || 'be'; }
function applyYearEra(era) {
  const btn = document.getElementById('era-toggle');
  if (btn) btn.textContent = era === 'be' ? 'พ.ศ.' : 'ค.ศ.';
}
applyYearEra(getYearEra());
document.getElementById('era-toggle').addEventListener('click', () => {
  const next = getYearEra() === 'be' ? 'ce' : 'be';
  localStorage.setItem(YEAR_ERA_KEY, next);
  applyYearEra(next);
  route();
});

const ROLE_LABEL = {
  admin: 'ผู้ดูแลระบบ',
  editor: 'กรอก + แก้ไข',
  creator: 'กรอกได้อย่างเดียว',
  viewer: 'ดูอย่างเดียว',
  staff: 'พนักงาน (เดิม)',
};
function canCreate() { return ['admin', 'editor', 'creator'].includes(state.user.role); }
function canEdit() { return ['admin', 'editor'].includes(state.user.role); }
// Hides any element carrying data-requires="create"/"edit" that the current user isn't allowed
// to use. Call once after a page's HTML is written into the DOM. Backend enforces the real
// boundary (403s on disallowed writes) — this only keeps the UI from offering actions that
// would fail, so a page render is enough; no need to re-run after re-renders within the page.
function applyPermissionGates(root) {
  if (!canCreate()) {
    root.querySelectorAll('[data-requires="create"]').forEach((el) => el.remove());
  }
  if (!canEdit()) {
    root.querySelectorAll('[data-requires="edit"]').forEach((el) => el.remove());
  }
}
const TYPE_LABEL = { IN: 'รับเข้า', OUT: 'เบิกออก', ADJUST: 'ปรับปรุง' };
const PURPOSE_LABEL = { sale: 'ขาย', trial: 'ทดลอง/ตัวอย่าง', claim: 'เคลม', gift: 'แถมให้ลูกค้า' };
const EXPIRY_STATUS_LABEL = { expired: 'หมดอายุ', critical: 'ใกล้หมดอายุมาก', warning: 'เฝ้าระวัง', ok: 'ปกติ', none: 'ไม่ระบุ' };
const ALERT_TYPE_LABEL = { low_stock: 'สต็อกต่ำ', expired: 'หมดอายุ', expiring_soon: 'ใกล้หมดอายุ' };

// ---------- API helper ----------
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error((data && data.error) || `คำขอล้มเหลว (${res.status})`);
  }
  return data;
}

// ---------- Login / session ----------
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const user = await api('POST', '/api/login', { username, password });
    state.user = user;
    onLoggedIn();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  state.user = null;
  showLogin();
});

async function onLoggedIn() {
  document.getElementById('user-name').textContent = `${state.user.displayName} (${ROLE_LABEL[state.user.role] || state.user.role})`;
  document.getElementById('nav-users').classList.toggle('hidden', state.user.role !== 'admin');
  showApp();
  await loadProducts();
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

async function loadProducts() {
  state.products = await api('GET', '/api/products');
}

// ---------- Router ----------
const routes = {
  dashboard: renderDashboard,
  inventory: renderInventory,
  orders: renderOrders,
  receive: renderReceive,
  issue: renderIssue,
  history: renderHistory,
  claims: renderClaims,
  products: renderProducts,
  'demand-planning': renderDemandPlanning,
  customers: renderCustomers,
  users: renderUsers,
  account: renderAccount,
  'expiry-calc': renderExpiryCalc,
};

function route() {
  const hash = location.hash.replace('#/', '') || 'dashboard';
  const viewName = hash.split('?')[0];
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === viewName);
  });
  closeMobileNav();
  const container = document.getElementById('view');
  const fn = routes[viewName] || renderDashboard;
  container.innerHTML = '<p class="muted">กำลังโหลด…</p>';
  fn(container).catch((err) => {
    container.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
  });
}
window.addEventListener('hashchange', route);

// ---------- Mobile nav toggle ----------
function closeMobileNav() {
  document.getElementById('nav').classList.remove('open');
  document.getElementById('nav-toggle').setAttribute('aria-expanded', 'false');
}
document.getElementById('nav-toggle').addEventListener('click', () => {
  const nav = document.getElementById('nav');
  const open = nav.classList.toggle('open');
  document.getElementById('nav-toggle').setAttribute('aria-expanded', String(open));
});

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function fmtDate(d) {
  if (!d) return '—';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d;
  const [, y, mo, day] = m;
  const year = getYearEra() === 'be' ? Number(y) + 543 : Number(y);
  const yy = String(year).slice(-2).padStart(2, '0');
  return `${day}/${mo}/${yy}`;
}
function fmtNum(n) {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
// Native <input type="date"> always shows/parses using the browser's OS locale (mm/dd/yyyy on
// most Windows setups), which we can't override directly. Instead we keep the native input as
// the source of truth (hidden, used only to open the real calendar picker) and pair it with a
// visible text field that displays/accepts dd/mm/yyyy in the user's chosen year era. Overriding
// the native input's `value` property means existing code that reads/sets `.value` by id keeps
// working unchanged.
function enhanceDateInput(nativeInput) {
  if (!nativeInput || nativeInput.dataset.dateEnhanced) return;
  nativeInput.dataset.dateEnhanced = '1';

  const wrap = document.createElement('span');
  wrap.className = 'date-field';
  nativeInput.insertAdjacentElement('beforebegin', wrap);

  const display = document.createElement('input');
  display.type = 'text';
  display.className = 'date-display';
  display.placeholder = 'วว/ดด/ปปปป';
  display.inputMode = 'numeric';
  display.autocomplete = 'off';

  const pickWrap = document.createElement('span');
  pickWrap.className = 'date-pick-wrap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'date-pick-btn';
  btn.title = 'เปิดปฏิทิน';
  btn.textContent = '📅';
  btn.tabIndex = -1;

  wrap.appendChild(display);
  wrap.appendChild(pickWrap);
  pickWrap.appendChild(nativeInput);
  pickWrap.appendChild(btn);
  nativeInput.classList.add('date-native-hidden');
  nativeInput.tabIndex = -1;

  if (nativeInput.disabled) { display.disabled = true; btn.disabled = true; }

  const proto = Object.getPrototypeOf(nativeInput);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');

  function isoToDisplay(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const [, y, mo, d] = m;
    const year = getYearEra() === 'be' ? Number(y) + 543 : Number(y);
    return `${d}/${mo}/${year}`;
  }
  function displayToIso(str) {
    const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    let year = Number(m[3]);
    if (getYearEra() === 'be') year -= 543;
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || year < 1000) return null;
    return `${year}-${mo}-${d}`;
  }

  function syncFromNative() { display.value = isoToDisplay(desc.get.call(nativeInput)); }
  syncFromNative();

  Object.defineProperty(nativeInput, 'value', {
    get() { return desc.get.call(nativeInput); },
    set(v) { desc.set.call(nativeInput, v); syncFromNative(); },
    configurable: true,
  });

  nativeInput.addEventListener('input', syncFromNative);
  nativeInput.addEventListener('change', syncFromNative);

  display.addEventListener('input', () => {
    const iso = displayToIso(display.value);
    if (iso !== null) {
      desc.set.call(nativeInput, iso);
      nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
      nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  display.addEventListener('blur', syncFromNative);

  btn.addEventListener('click', () => {
    if (nativeInput.disabled) return;
    if (typeof nativeInput.showPicker === 'function') {
      try { nativeInput.showPicker(); return; } catch { /* fall through */ }
    }
    nativeInput.focus();
  });

  if (nativeInput.form) {
    nativeInput.form.addEventListener('reset', () => setTimeout(syncFromNative, 0));
  }
}
function enhanceDateInputs(root) {
  (root || document).querySelectorAll('input[type="date"]:not([data-date-enhanced])').forEach(enhanceDateInput);
}

function formatMonthLabel(yyyyMM) {
  const [y, m] = yyyyMM.split('-').map(Number);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const year = getYearEra() === 'be' ? y + 543 : y;
  return `${months[m - 1]} ${year}`;
}
function niceMax(value) {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const frac = value / base;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return niceFrac * base;
}

// ---------- Outflow trend chart (dashboard) ----------
const TREND_W = 760;
const TREND_H = 200;
const TREND_PAD = { l: 44, r: 12, t: 16, b: 28 };

function trendScales(series) {
  const plotW = TREND_W - TREND_PAD.l - TREND_PAD.r;
  const plotH = TREND_H - TREND_PAD.t - TREND_PAD.b;
  const n = series.length;
  const maxVal = Math.max(...series.map((d) => d.quantity), 0);
  const yMax = niceMax(maxVal || 1);
  const baselineY = TREND_PAD.t + plotH;
  const xAt = (i) => (n > 1 ? TREND_PAD.l + (i / (n - 1)) * plotW : TREND_PAD.l + plotW / 2);
  const yAt = (v) => baselineY - (v / yMax) * plotH;
  return { plotW, plotH, n, yMax, baselineY, xAt, yAt };
}

function buildTrendChartHTML(series) {
  const { plotW, n, yMax, baselineY, xAt, yAt } = trendScales(series);
  const points = series.map((d, i) => [xAt(i), yAt(d.quantity)]);
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[n - 1][0].toFixed(1)} ${baselineY} L ${points[0][0].toFixed(1)} ${baselineY} Z`;

  const ticks = [0, yMax / 2, yMax];
  const gridlines = ticks.map((t) => {
    const y = yAt(t);
    return `<line x1="${TREND_PAD.l}" y1="${y.toFixed(1)}" x2="${TREND_W - TREND_PAD.r}" y2="${y.toFixed(1)}" class="trend-grid" />
      <text x="${TREND_PAD.l - 8}" y="${(y + 4).toFixed(1)}" class="trend-tick" text-anchor="end">${fmtNum(t)}</text>`;
  }).join('');

  const labelCount = Math.min(6, n);
  const labelIdxs = new Set();
  for (let k = 0; k < labelCount; k++) {
    labelIdxs.add(Math.round((k / (labelCount - 1 || 1)) * (n - 1)));
  }
  const xLabels = [...labelIdxs].map((i) => `<text x="${xAt(i).toFixed(1)}" y="${TREND_H - 6}" class="trend-tick" text-anchor="middle">${formatMonthLabel(series[i].month)}</text>`).join('');

  const last = points[n - 1];
  const lastVal = series[n - 1].quantity;
  const labelY = Math.max(TREND_PAD.t + 8, last[1] - 10);

  return `
    <svg viewBox="0 0 ${TREND_W} ${TREND_H}" class="trend-svg" id="trend-svg">
      ${gridlines}
      <line x1="${TREND_PAD.l}" y1="${baselineY}" x2="${TREND_W - TREND_PAD.r}" y2="${baselineY}" class="trend-baseline" />
      <path d="${areaPath}" class="trend-area"></path>
      <path d="${linePath}" class="trend-line"></path>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" class="trend-endpoint"></circle>
      <text x="${(last[0] - 4).toFixed(1)}" y="${labelY.toFixed(1)}" class="trend-endlabel" text-anchor="end">${fmtNum(lastVal)}</text>
      ${xLabels}
      <line x1="0" y1="${TREND_PAD.t}" x2="0" y2="${baselineY}" class="trend-crosshair hidden" id="trend-crosshair" />
      <circle cx="0" cy="0" r="4" class="trend-hoverdot hidden" id="trend-hoverdot"></circle>
      <rect x="${TREND_PAD.l}" y="${TREND_PAD.t}" width="${plotW}" height="${TREND_H - TREND_PAD.t - TREND_PAD.b}" class="trend-hitlayer" id="trend-hitlayer"></rect>
    </svg>
    <div class="trend-tooltip hidden" id="trend-tooltip"></div>
  `;
}

function buildTrendTableHTML(series, unit) {
  const rows = series.slice().reverse().map((d) => `
    <tr><td>${formatMonthLabel(d.month)}</td><td class="right">${fmtNum(d.quantity)}</td></tr>
  `).join('');
  const unitLabel = unit ? ` (${escapeHtml(unit)})` : '';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>เดือน</th><th class="right">ปริมาณเบิกออก${unitLabel}</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="2" class="muted">ไม่มีการเบิกออกในช่วงนี้</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function attachTrendInteractivity(container, series, unit) {
  const svg = container.querySelector('#trend-svg');
  const hitlayer = container.querySelector('#trend-hitlayer');
  const crosshair = container.querySelector('#trend-crosshair');
  const hoverdot = container.querySelector('#trend-hoverdot');
  const tooltip = container.querySelector('#trend-tooltip');
  if (!svg || !hitlayer) return;

  const { plotW, n, xAt, yAt } = trendScales(series);

  function handleMove(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    let idx = Math.round(((svgP.x - TREND_PAD.l) / plotW) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    const x = xAt(idx);
    const y = yAt(series[idx].quantity);

    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.classList.remove('hidden');
    hoverdot.setAttribute('cx', x);
    hoverdot.setAttribute('cy', y);
    hoverdot.classList.remove('hidden');

    const unitSuffix = unit ? ` ${escapeHtml(unit)}` : '';
    tooltip.innerHTML = `<span class="val">${fmtNum(series[idx].quantity)}${unitSuffix}</span><span class="lbl">${formatMonthLabel(series[idx].month)}</span>`;
    tooltip.classList.remove('hidden');

    const containerRect = container.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const pxX = svgRect.left - containerRect.left + (x / TREND_W) * svgRect.width;
    const pxY = svgRect.top - containerRect.top + (y / TREND_H) * svgRect.height;
    let left = pxX + 12;
    if (left + 130 > containerRect.width) left = pxX - 132;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(0, pxY - 36)}px`;
  }

  hitlayer.addEventListener('pointermove', (e) => handleMove(e.clientX, e.clientY));
  hitlayer.addEventListener('pointerleave', () => {
    crosshair.classList.add('hidden');
    hoverdot.classList.add('hidden');
    tooltip.classList.add('hidden');
  });
}

function productOptions(products) {
  return products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.sku_code)})</option>`).join('');
}

// Cascading "supplier -> product" pickers, so staff narrow down from ~4 suppliers
// instead of scrolling a flat list of dozens of SKUs.
function brandFilterOptionsHTML(products) {
  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort();
  return `<option value="">ทั้งหมด</option>${brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}`;
}

function wireSupplierProductCascade(supplierSelect, productSelect, products, { includeAllProducts } = {}) {
  function render() {
    const brand = supplierSelect.value;
    const filtered = brand ? products.filter((p) => p.brand === brand) : products;
    const prevValue = productSelect.value;
    productSelect.innerHTML = (includeAllProducts ? '<option value="">ทั้งหมด</option>' : '') + productOptions(filtered);
    if ([...productSelect.options].some((o) => o.value === prevValue)) {
      productSelect.value = prevValue;
    } else if (productSelect.dispatchEvent) {
      productSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  supplierSelect.addEventListener('change', render);
  render();
}
function supplierOptions(suppliers) {
  return suppliers.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
}
async function loadSuppliers() {
  state.suppliers = await api('GET', '/api/suppliers');
}
function customerOptions(customers) {
  return customers.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
}
async function loadCustomers() {
  state.customers = await api('GET', '/api/customers');
}

// Type-to-filter combobox layered over a hidden native <select> (id="X"), driven by a text
// input (id="X-search") and a dropdown list (id="X-list") already present in the markup.
// Keeps using select.value / select.innerHTML / 'change' events everywhere else in the app —
// call select._syncSearchable() after any code sets select.value or rebuilds its options directly.
function wireSearchableSelect(selectId, { newNameInputId, includeEmptyOption } = {}) {
  const select = document.getElementById(selectId);
  const input = document.getElementById(`${selectId}-search`);
  const list = document.getElementById(`${selectId}-list`);
  let activeIndex = -1;

  function optionsData() {
    return [...select.options].map((o) => ({ value: o.value, label: o.textContent }));
  }
  function syncInputFromSelect() {
    const opt = select.options[select.selectedIndex];
    input.value = opt && opt.value ? opt.textContent : '';
  }
  function closeList() {
    list.classList.add('hidden');
    activeIndex = -1;
  }
  function highlight() {
    list.querySelectorAll('.ss-item[data-value]').forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  }
  function pick(value) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (value === '__new__' && newNameInputId && input.value.trim()) {
      const nameInput = document.getElementById(newNameInputId);
      if (nameInput) nameInput.value = input.value.trim();
    }
    syncInputFromSelect();
    closeList();
  }
  function renderList(filter) {
    const q = filter.trim().toLowerCase();
    const emptyOpt = includeEmptyOption ? optionsData().find((o) => o.value === '') : null;
    const all = optionsData().filter((o) => o.value !== '');
    const addNew = all.find((o) => o.value === '__new__');
    const regular = all.filter((o) => o.value !== '__new__');
    const matched = q ? regular.filter((o) => o.label.toLowerCase().includes(q)) : regular;
    const emptyRow = emptyOpt ? `<div class="ss-item" data-value="">${escapeHtml(emptyOpt.label)}</div>` : '';
    const rows = matched.map((o) => `<div class="ss-item" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`).join('');
    const addRow = addNew ? `<div class="ss-item ss-item-add" data-value="${escapeHtml(addNew.value)}">${escapeHtml(addNew.label)}</div>` : '';
    list.innerHTML = emptyRow + rows || addRow ? emptyRow + rows + addRow : '<div class="ss-item muted">ไม่พบรายการที่ตรงกัน</div>';
    activeIndex = -1;
    list.classList.remove('hidden');
    list.querySelectorAll('.ss-item[data-value]').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(el.dataset.value);
      });
    });
  }

  input.addEventListener('focus', () => renderList(input.value));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('.ss-item[data-value]')];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.classList.contains('hidden')) { renderList(input.value); return; }
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlight();
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        pick(items[activeIndex].dataset.value);
      }
    } else if (e.key === 'Escape') {
      closeList();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      closeList();
      syncInputFromSelect();
    }, 120);
  });

  syncInputFromSelect();
  select._syncSearchable = syncInputFromSelect;
}

// ---------- Dashboard ----------
const FORECAST_STATUS = {
  urgent: { badge: 'expired', label: 'ด่วน' },
  order_soon: { badge: 'critical', label: 'สั่งซื้อเร็วๆ นี้' },
  no_usage_data: { badge: 'none', label: 'ไม่มีข้อมูลการใช้' },
  ok: { badge: 'ok', label: 'ปกติ' },
};

// Same ordering convention as groupByBrand (Domino/General/Weber/Rynan first, then the rest
// alphabetically) — kept separate since forecast rows carry supplierName, not brand.
function groupForecastBySupplier(products) {
  const groups = new Map();
  for (const p of products) {
    const key = p.supplierName || 'อื่นๆ';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const ordered = [];
  for (const b of BRAND_ORDER) {
    if (groups.has(b)) { ordered.push([b, groups.get(b)]); groups.delete(b); }
  }
  const rest = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return [...ordered, ...rest];
}

function buildForecastTableHTML(products) {
  const rows = products.map((p) => {
    const st = FORECAST_STATUS[p.status] || FORECAST_STATUS.ok;
    const expiredNote = p.expiredQty > 0
      ? `<br><span class="muted" style="color:var(--danger)">หมดอายุแล้ว ${fmtNum(p.expiredQty)} ${escapeHtml(p.unit)}</span>`
      : '';
    const onOrderCell = p.onOrderQty > 0
      ? `${fmtNum(p.onOrderQty)} ${escapeHtml(p.unit)}<br><span class="muted">คาดว่าจะถึง ${fmtDate(p.nextExpectedDate)}</span>`
      : '<span class="muted">—</span>';
    const shiftLabel = p.usageShiftPct === null ? 'เริ่มมีการใช้' : `${p.usageShiftPct >= 0 ? '+' : ''}${Math.round(p.usageShiftPct * 100)}%`;
    const shiftCell = p.usageShift
      ? `<span class="badge ${p.usageShift === 'up' ? 'warning' : 'none'}" title="เทียบยอดใช้ 30 วันล่าสุดกับ 30 วันก่อนหน้า — สัญญาณว่าดีมานด์เปลี่ยน ควรทบทวน safety stock ของสินค้านี้">${p.usageShift === 'up' ? '▲' : '▼'} ${shiftLabel}</span>`
      : '<span class="muted">—</span>';
    const daysOfCoverLabel = p.daysOfCover !== null
      ? `<br><span class="muted" style="font-size:11.5px">คงเหลือใช้ได้อีก ${Math.round(p.daysOfCover)} วัน${p.daysOfCover < p.leadTimeDays ? ' <span style="color:var(--danger)">(ก่อนของใหม่จะมาถึง)</span>' : ''}</span>`
      : '';
    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong><br><span class="muted">${escapeHtml(p.skuCode)}</span></td>
        <td>${escapeHtml(p.supplierName || '—')}</td>
        <td class="right">${fmtNum(p.avgMonthlyUsage)} ${escapeHtml(p.unit)}${p.usageSource === 'estimated' ? ' <span class="muted">(ประมาณ)</span>' : ''}</td>
        <td>${shiftCell}</td>
        <td class="right">${fmtNum(p.safetyStock)} ${escapeHtml(p.unit)}</td>
        <td class="right">${fmtNum(p.leadTimeDemand)} ${escapeHtml(p.unit)}<br><span class="muted">${p.leadTimeDays} วัน</span></td>
        <td class="right">${fmtNum(p.onHandTotal)} ${escapeHtml(p.unit)}${expiredNote}</td>
        <td class="right">${onOrderCell}</td>
        <td class="right"><strong>${fmtNum(p.suggestedOrderQty)} ${escapeHtml(p.unit)}</strong></td>
        <td><span class="badge ${st.badge}">${st.label}</span>${daysOfCoverLabel}</td>
      </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>สินค้า</th><th>ซัพพลายเออร์</th><th class="right">ใช้เฉลี่ย/เดือน</th>
            <th>ดีมานด์เปลี่ยนแปลง</th>
            <th class="right">Safety stock (เป้าสต็อก)</th><th class="right">ปริมาณที่จะใช้ระหว่างรอของมาส่ง<br><span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(ระยะเวลาส่งของ × อัตราการใช้เฉลี่ย)</span></th>
            <th class="right">คงเหลือทั้งหมด</th><th class="right">สั่งซื้อไปแล้ว (กำลังมา)</th>
            <th class="right">แนะนำสั่งซื้อ</th><th>สถานะ</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="10" class="muted">ไม่มีสินค้าให้พยากรณ์</td></tr>'}</tbody>
      </table>
    </div>`;
}

async function renderDashboard(container) {
  const d = await api('GET', '/api/inventory/dashboard');
  await loadProducts();
  const brands = [...new Set(state.products.map((p) => p.brand).filter(Boolean))].sort();
  const alertRows = d.alerts.length
    ? d.alerts.map((a) => `
        <tr>
          <td><span class="badge ${a.type === 'expired' ? 'expired' : a.type === 'expiring_soon' ? 'critical' : 'low'}">${ALERT_TYPE_LABEL[a.type] || a.type}</span></td>
          <td>${escapeHtml(a.product)} <span class="muted">(${escapeHtml(a.skuCode)})</span></td>
          <td>${escapeHtml(a.detail)}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="muted">ไม่มีการแจ้งเตือน — ทุกอย่างเรียบร้อยดี</td></tr>';

  const txnRows = d.recentTransactions.length
    ? d.recentTransactions.map((t) => `
        <tr>
          <td>${fmtDate(t.transaction_date)}</td>
          <td>${TYPE_LABEL[t.type] || t.type}${t.type === 'OUT' && t.purpose && t.purpose !== 'sale' ? ` <span class="badge critical">${PURPOSE_LABEL[t.purpose] || t.purpose}</span>` : ''}</td>
          <td>${escapeHtml(t.product_name)}</td>
          <td class="right">${fmtNum(t.quantity)}</td>
          <td>${escapeHtml(t.counterparty || '')}</td>
          <td>${escapeHtml(t.user_name || '')}</td>
        </tr>`).join('')
    : '<tr><td colspan="6" class="muted">ยังไม่มีรายการเคลื่อนไหว</td></tr>';

  container.innerHTML = `
    <h2>แดชบอร์ด</h2>
    <div class="stat-row">
      <div class="stat-tile"><div class="num">${d.totalSkus}</div><div class="label">SKU ที่ใช้งานอยู่</div></div>
      <div class="stat-tile ${d.lowStockCount ? 'danger' : ''}"><div class="num">${d.lowStockCount}</div><div class="label">สต็อกต่ำ</div></div>
      <div class="stat-tile ${d.expiringSoonCount ? 'warning' : ''}"><div class="num">${d.expiringSoonCount}</div><div class="label">ใกล้หมดอายุ ≤30 วัน</div></div>
      <div class="stat-tile ${d.expiredCount ? 'danger' : ''}"><div class="num">${d.expiredCount}</div><div class="label">ล็อตที่หมดอายุ</div></div>
    </div>
    <div class="card">
      <div class="chart-header">
        <h3>แนวโน้มการเบิกออก</h3>
        <div class="chart-controls">
          <select id="trend-supplier">${brandFilterOptionsHTML(state.products)}</select>
          <select id="trend-product">
            <option value="">ทั้งหมด</option>
            ${productOptions(state.products)}
          </select>
          <select id="trend-range">
            <option value="6" selected>6 เดือนล่าสุด</option>
            <option value="12">12 เดือนล่าสุด</option>
            <option value="24">24 เดือนล่าสุด</option>
          </select>
          <button type="button" id="trend-table-toggle" class="secondary">ดูแบบตาราง</button>
        </div>
      </div>
      <div id="trend-body" style="position:relative"><p class="muted">กำลังโหลด…</p></div>
    </div>
    <div class="chart-header">
      <h3>พยากรณ์การสั่งซื้อ</h3>
      <div class="chart-controls">
        <select id="forecast-supplier">
          <option value="">ซัพพลายเออร์ทั้งหมด</option>
          ${brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}
        </select>
      </div>
    </div>
    <p class="muted">แนะนำสั่งซื้อ = เติมสต็อกให้ถึง safety stock (จุดสั่งซื้อ) บวกปริมาณที่จะใช้ระหว่างรอของมาส่ง (ระยะเวลาส่งของ × อัตราการใช้เฉลี่ย) หักด้วยยอดคงเหลือทั้งหมดและยอดที่สั่งซื้อไปแล้วแต่ยังไม่เข้าคลัง ตั้งค่าจุดสั่งซื้อและระยะเวลาส่งของแต่ละสินค้าได้ที่หน้า "สินค้า" เพื่อความแม่นยำ — ตารางด้านล่างแยกตามซัพพลายเออร์</p>
    <div class="stat-row" id="forecast-stats"></div>
    <div id="forecast-body"><p class="muted">กำลังโหลด…</p></div>
    <div class="card">
      <h3>การแจ้งเตือน</h3>
      <div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>สินค้า</th><th>รายละเอียด</th></tr></thead>
      <tbody>${alertRows}</tbody></table></div>
    </div>
    <div class="card">
      <h3>กิจกรรมล่าสุด</h3>
      <div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ประเภท</th><th>สินค้า</th><th class="right">จำนวน</th><th>ลูกค้า/ซัพพลายเออร์</th><th>โดย</th></tr></thead>
      <tbody>${txnRows}</tbody></table></div>
    </div>
  `;

  let trendShowTable = false;
  let trendMonths = 6;
  let trendProductId = '';

  async function loadAndRenderTrend() {
    const query = new URLSearchParams({ months: trendMonths });
    if (trendProductId) query.set('productId', trendProductId);
    const trend = await api('GET', `/api/inventory/outflow-trend?${query.toString()}`);
    const body = document.getElementById('trend-body');
    if (trendShowTable) {
      body.innerHTML = buildTrendTableHTML(trend.series, trend.unit);
    } else {
      body.innerHTML = buildTrendChartHTML(trend.series);
      attachTrendInteractivity(body, trend.series, trend.unit);
    }
  }

  document.getElementById('trend-product').addEventListener('change', (e) => {
    trendProductId = e.target.value;
    loadAndRenderTrend();
  });
  wireSupplierProductCascade(
    document.getElementById('trend-supplier'),
    document.getElementById('trend-product'),
    state.products,
    { includeAllProducts: true }
  );
  document.getElementById('trend-range').addEventListener('change', (e) => {
    trendMonths = Number(e.target.value);
    loadAndRenderTrend();
  });
  document.getElementById('trend-table-toggle').addEventListener('click', (e) => {
    trendShowTable = !trendShowTable;
    e.target.textContent = trendShowTable ? 'ดูแบบกราฟ' : 'ดูแบบตาราง';
    loadAndRenderTrend();
  });

  await loadAndRenderTrend();

  const forecast = await api('GET', '/api/inventory/reorder-forecast');
  document.getElementById('forecast-stats').innerHTML = `
    <div class="stat-tile ${forecast.summary.urgentCount ? 'danger' : ''}"><div class="num">${forecast.summary.urgentCount}</div><div class="label">ด่วน — ต้องสั่งซื้อทันที</div></div>
    <div class="stat-tile ${forecast.summary.orderSoonCount ? 'warning' : ''}"><div class="num">${forecast.summary.orderSoonCount}</div><div class="label">ควรสั่งซื้อเร็วๆ นี้</div></div>
    <div class="stat-tile ${forecast.summary.expiredCount ? 'warning' : ''}"><div class="num">${forecast.summary.expiredCount}</div><div class="label">มีสต็อกหมดอายุค้างอยู่</div></div>
    <div class="stat-tile ${forecast.summary.shiftCount ? 'warning' : ''}"><div class="num">${forecast.summary.shiftCount}</div><div class="label">ดีมานด์เปลี่ยนกะทันหัน — ควรทบทวน safety stock</div></div>
  `;

  function renderForecastTable() {
    const supplierFilter = document.getElementById('forecast-supplier').value;
    const filtered = supplierFilter
      ? forecast.products.filter((p) => p.supplierName === supplierFilter)
      : forecast.products;
    const sections = groupForecastBySupplier(filtered).map(([supplier, group]) => `
      <div class="card">
        <h3>${escapeHtml(supplier)} <span class="muted" style="font-weight:400;font-size:13px">(${group.length} SKU)</span></h3>
        ${buildForecastTableHTML(group)}
      </div>`).join('');
    document.getElementById('forecast-body').innerHTML = sections || '<div class="card"><p class="muted">ไม่มีสินค้าให้พยากรณ์</p></div>';
  }

  document.getElementById('forecast-supplier').addEventListener('change', renderForecastTable);
  renderForecastTable();
}

// ---------- Inventory ----------
function daysUntilLabel(days) {
  if (days === null || days === undefined) return '—';
  if (days < 0) return `หมดอายุแล้ว ${Math.abs(days)} วัน`;
  if (days === 0) return 'หมดอายุวันนี้';
  return `อีก ${days} วัน`;
}

const BRAND_ORDER = ['Domino', 'General', 'Weber', 'Rynan'];

function groupByBrand(inv) {
  const groups = new Map();
  for (const p of inv) {
    const brand = p.brand || 'อื่นๆ';
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand).push(p);
  }
  const ordered = [];
  for (const b of BRAND_ORDER) {
    if (groups.has(b)) { ordered.push([b, groups.get(b)]); groups.delete(b); }
  }
  const rest = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return [...ordered, ...rest];
}

function buildInventoryBrandSectionHTML(brand, products) {
  const isAdmin = state.user.role === 'admin';
  const lowCount = products.filter((p) => p.lowStock).length;
  const expiringCount = products.filter((p) => p.expiryStatus === 'critical' || p.expiryStatus === 'expired').length;
  const colCount = isAdmin ? 6 : 5;

  const rows = products.map((p) => {
    const hasBatches = p.batches.length > 0;
    const rowId = `inv-row-${p.id}`;
    const batchRows = p.batches.map((b) => `
      <tr class="batch-subtable hidden" data-parent="${rowId}">
        <td></td>
        <td class="muted">ล็อต ${escapeHtml(b.batchNumber || String(b.id))} <span class="muted">${escapeHtml(b.supplier || '')}</span></td>
        <td>${daysUntilLabel(b.daysUntilExpiry)} <span class="muted">${b.expirationDate ? `(${fmtDate(b.expirationDate)})` : ''}</span> <span class="badge ${b.status}">${EXPIRY_STATUS_LABEL[b.status] || b.status}</span></td>
        <td class="right">${fmtNum(b.quantityRemaining)}</td>
        <td data-requires="edit"><button type="button" class="secondary ibe-toggle" data-batch-id="${b.id}" style="font-size:12.5px;padding:6px 10px">แก้ไข</button></td>
        ${isAdmin ? `<td class="right muted">${b.unitCost != null ? fmtNum(b.unitCost) : '—'}</td>` : ''}
      </tr>
      <tr class="hidden inv-edit-row" data-parent="${rowId}" id="batch-edit-${b.id}">
        <td colspan="${colCount}">
          <form class="inv-batch-edit-form stack" data-batch-id="${b.id}" style="max-width:640px;margin:8px 0">
            <div class="form-row">
              <label class="field">หมายเลขล็อต
                <input type="text" class="ibe-batch-number" value="${escapeHtml(b.batchNumber || '')}">
              </label>
              <label class="field">ซัพพลายเออร์
                <input type="text" class="ibe-supplier" value="${escapeHtml(b.supplier || '')}">
              </label>
            </div>
            <div class="form-row">
              <label class="field">วันหมดอายุ
                <input type="date" class="ibe-expiry" value="${b.expirationDate || ''}">
              </label>
              <label class="field">วันที่รับเข้า
                <input type="date" class="ibe-received" value="${b.receivedDate || ''}">
              </label>
            </div>
            <label class="field">จำนวนที่รับเข้า (ทั้งหมด)
              <input type="number" class="ibe-qty" step="any" min="0.01" value="${b.quantityReceived}" required>
            </label>
            <label class="field">หมายเหตุ
              <textarea class="ibe-note" rows="2">${escapeHtml(b.note || '')}</textarea>
            </label>
            <div class="form-row">
              <button type="submit" class="primary">บันทึกการแก้ไข</button>
              <button type="button" class="secondary ibe-cancel">ยกเลิก</button>
              <button type="button" class="secondary ibe-delete">ลบล็อตนี้</button>
            </div>
            <div class="ibe-msg"></div>
          </form>
        </td>
      </tr>`).join('');

    return `
      <tr class="${hasBatches ? 'inv-toggle-row' : ''}" ${hasBatches ? `data-toggle="${rowId}"` : ''}>
        <td>${hasBatches ? '<span class="inv-chevron">▸</span> ' : ''}<strong>${escapeHtml(p.name)}</strong><br><span class="muted">${escapeHtml(p.skuCode)}</span></td>
        <td>${hasBatches ? `${p.batches.length} ล็อต` : '<span class="muted">ไม่มีล็อต</span>'}</td>
        <td>${hasBatches ? daysUntilLabel(p.batches[0].daysUntilExpiry) : '—'} <span class="muted">${p.nearestExpiry ? `(${fmtDate(p.nearestExpiry)})` : ''}</span> ${hasBatches ? `<span class="badge ${p.expiryStatus}">${EXPIRY_STATUS_LABEL[p.expiryStatus] || p.expiryStatus}</span>` : ''}</td>
        <td class="right"><strong>${fmtNum(p.totalQuantity)}</strong> ${escapeHtml(p.unit)} ${p.lowStock ? '<span class="badge low">ต่ำ</span>' : ''}</td>
        <td class="muted right">จุดสั่งซื้อ @ ${fmtNum(p.reorderLevel)}</td>
        ${isAdmin ? '<td></td>' : ''}
      </tr>
      ${batchRows}
    `;
  }).join('');

  return `
    <div class="card">
      <div class="chart-header">
        <h3>${escapeHtml(brand)}</h3>
        <div class="muted">
          ${products.length} SKU
          ${lowCount ? ` · <span class="badge low">ต่ำ</span> ${lowCount}` : ''}
          ${expiringCount ? ` · <span class="badge critical">ใกล้หมด/หมดอายุ</span> ${expiringCount}` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>สินค้า</th><th>ล็อต</th><th>วันหมดอายุที่ใกล้ที่สุด</th><th class="right">คงเหลือ</th><th class="right">จุดสั่งซื้อ</th>${isAdmin ? '<th class="right">ต้นทุน/หน่วย</th>' : ''}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderInventory(container) {
  async function load() {
    const inv = await api('GET', '/api/inventory');
    const sections = groupByBrand(inv)
      .map(([brand, products]) => buildInventoryBrandSectionHTML(brand, products))
      .join('');

    container.innerHTML = `
      <div class="chart-header">
        <h2>คลังสินค้า</h2>
        <button type="button" id="inv-export-csv" class="secondary no-print">ส่งออก CSV</button>
      </div>
      ${sections || '<div class="card"><p class="muted">ยังไม่มีสินค้า</p></div>'}
    `;

    container.querySelectorAll('.inv-toggle-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.toggle;
        const expanding = row.classList.toggle('expanded');
        container.querySelectorAll(`.batch-subtable[data-parent="${id}"]`).forEach((r) => r.classList.toggle('hidden', !expanding));
        if (!expanding) {
          container.querySelectorAll(`.inv-edit-row[data-parent="${id}"]`).forEach((r) => r.classList.add('hidden'));
        }
      });
    });

    document.getElementById('inv-export-csv').addEventListener('click', () => {
      window.open('/api/inventory/export.csv', '_blank');
    });

    container.querySelectorAll('.ibe-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = document.getElementById(`batch-edit-${btn.dataset.batchId}`);
        if (row) row.classList.toggle('hidden');
      });
    });

    container.querySelectorAll('.inv-batch-edit-form').forEach((form) => {
      form.addEventListener('click', (e) => e.stopPropagation());
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = form.querySelector('.ibe-msg');
        msg.innerHTML = '';
        try {
          await api('PATCH', `/api/batches/${form.dataset.batchId}`, {
            batchNumber: form.querySelector('.ibe-batch-number').value || null,
            expirationDate: form.querySelector('.ibe-expiry').value || null,
            quantity: Number(form.querySelector('.ibe-qty').value),
            supplier: form.querySelector('.ibe-supplier').value || null,
            receivedDate: form.querySelector('.ibe-received').value || null,
            note: form.querySelector('.ibe-note').value || null,
          });
          await load();
        } catch (err) {
          msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
        }
      });
      form.querySelector('.ibe-cancel').addEventListener('click', () => {
        form.closest('tr').classList.add('hidden');
      });
      form.querySelector('.ibe-delete').addEventListener('click', async () => {
        if (!confirm('ลบล็อตนี้ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้')) return;
        const msg = form.querySelector('.ibe-msg');
        msg.innerHTML = '';
        try {
          await api('DELETE', `/api/batches/${form.dataset.batchId}`);
          await load();
        } catch (err) {
          msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
        }
      });
    });

    applyPermissionGates(container);
    enhanceDateInputs(container);
  }

  await load();
}

// ---------- Receive stock (inflow) ----------
function getHashQuery() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

async function renderReceive(container) {
  if (!canCreate()) {
    container.innerHTML = '<h2>รับสินค้าเข้า</h2><p class="msg error">คุณมีสิทธิ์ดูข้อมูลอย่างเดียว ไม่สามารถบันทึกรับสินค้าเข้าได้</p>';
    return;
  }
  await loadProducts();
  const claimId = getHashQuery().get('claimId');
  const claim = claimId ? await api('GET', `/api/claims/${claimId}`) : null;
  const poId = getHashQuery().get('poId');
  const po = poId ? await api('GET', `/api/purchase-orders/${poId}`) : null;

  container.innerHTML = `
    <h2>รับสินค้าเข้า</h2>
    ${claim ? `
      <div class="msg success" style="margin-bottom:16px">
        กำลังรับคืนเข้าคลังจากรายการเคลม #${claim.id} —
        ${CLAIM_TYPE_LABEL[claim.type] || claim.type} จาก ${escapeHtml(claim.counterparty || '—')}:
        ${escapeHtml(claim.product_name)} จำนวน ${fmtNum(claim.quantity)} ${escapeHtml(claim.unit)}
        (กรอกจำนวนและวันหมดอายุจากล็อตเดิมให้แล้ว ตรวจสอบก่อนบันทึก —
        ถ้าบางส่วนรับเข้าคลังไม่ได้ เช่น น้ำหนักหมึกต่ำหรือหมดอายุแล้ว ให้ปรับจำนวนลง และแก้วันหมดอายุถ้าไม่ตรงกับสภาพจริง)
      </div>
    ` : ''}
    ${po ? `
      <div class="msg success" style="margin-bottom:16px">
        กำลังรับเข้าคลังจากรายการสั่งซื้อ #${po.id} — ${escapeHtml(po.product_name)}
        จำนวน ${fmtNum(po.quantity)} ${escapeHtml(po.unit)} จาก ${escapeHtml(po.supplier || '—')}
        (แบบฟอร์มด้านล่างกรอกข้อมูลเบื้องต้นให้แล้ว ตรวจสอบและระบุวันหมดอายุ/ล็อตก่อนบันทึก)
      </div>
    ` : ''}
    <form id="receive-form" class="stack card">
      <div class="form-row">
        <label class="field">ซัพพลายเออร์
          <select id="rf-product-supplier">${brandFilterOptionsHTML(state.products)}</select>
        </label>
        <label class="field">สินค้า
          <select id="rf-product" required>${productOptions(state.products)}</select>
        </label>
      </div>
      <div class="form-row">
        <label class="field">หมายเลขล็อต
          <input type="text" id="rf-batch" placeholder="ไม่บังคับ">
        </label>
        <label class="field">วันหมดอายุ
          <input type="date" id="rf-expiry">
        </label>
      </div>
      <div class="form-row">
        <label class="field">จำนวน
          <input type="number" id="rf-qty" step="any" min="0.01" required>
        </label>
        <label class="field">วันที่รับสินค้า
          <input type="date" id="rf-date" value="${new Date().toISOString().slice(0, 10)}">
        </label>
      </div>
      ${claim ? '<p class="muted" style="margin-top:-8px">ปรับจำนวนลงได้หากบางส่วนรับเข้าคลังไม่ได้ (เช่น น้ำหนักหมึกต่ำ หรือหมดอายุแล้ว) — ระบุเหตุผลในช่องหมายเหตุด้านล่างด้วย จะถูกบันทึกไว้ในรายการเคลมนี้</p>' : ''}
      <label class="field">หมายเหตุ
        <textarea id="rf-note" rows="2"></textarea>
      </label>
      <button type="submit" class="primary">บันทึกรับสินค้าเข้า</button>
      <div id="rf-msg"></div>
    </form>
  `;

  wireSupplierProductCascade(
    document.getElementById('rf-product-supplier'),
    document.getElementById('rf-product'),
    state.products
  );

  if (claim) {
    const claimProduct = state.products.find((p) => p.id === claim.product_id);
    if (claimProduct && claimProduct.brand) {
      document.getElementById('rf-product-supplier').value = claimProduct.brand;
      document.getElementById('rf-product-supplier').dispatchEvent(new Event('change'));
    }
    document.getElementById('rf-product').value = claim.product_id;
    document.getElementById('rf-qty').value = claim.quantity;
    document.getElementById('rf-expiry').value = claim.expiration_date || '';
    document.getElementById('rf-batch').value = `รับคืน ${fmtDate(new Date().toISOString().slice(0, 10))}`;
    const noteParts = [
      `รับคืนจากลูกค้า ${claim.counterparty || ''}`,
      `(อ้างอิงเคลม #${claim.id})`,
    ];
    if (claim.details) noteParts.push(`— ${claim.details}`);
    document.getElementById('rf-note').value = noteParts.join(' ');
  }

  if (po) {
    const poProduct = state.products.find((p) => p.id === po.product_id);
    if (poProduct && poProduct.brand) {
      document.getElementById('rf-product-supplier').value = poProduct.brand;
      document.getElementById('rf-product-supplier').dispatchEvent(new Event('change'));
    }
    document.getElementById('rf-product').value = po.product_id;
    document.getElementById('rf-qty').value = po.quantity;
    document.getElementById('rf-note').value = `รับเข้าตามรายการสั่งซื้อ #${po.id}`;
  }

  document.getElementById('receive-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('rf-msg');
    msg.innerHTML = '';
    try {
      const productId = Number(document.getElementById('rf-product').value);
      const product = state.products.find((p) => p.id === productId);
      const supplierValue = document.getElementById('rf-product-supplier').value || (product && product.brand) || null;
      const result = await api('POST', '/api/batches', {
        productId,
        batchNumber: document.getElementById('rf-batch').value || null,
        expirationDate: document.getElementById('rf-expiry').value || null,
        quantity: Number(document.getElementById('rf-qty').value),
        supplier: supplierValue,
        receivedDate: document.getElementById('rf-date').value || null,
        note: document.getElementById('rf-note').value || null,
      });
      if (claim) {
        await api('PATCH', `/api/claims/${claim.id}`, {
          status: 'resolved',
          resolutionNote: document.getElementById('rf-note').value || null,
        });
        msg.innerHTML = '<p class="msg success">รับสินค้าเข้าคลังเรียบร้อยแล้ว และอัปเดตสถานะเคลมเป็น "เสร็จสิ้น" แล้ว — <a href="#/claims">กลับไปหน้าเคลม/ตีกลับ</a></p>';
      } else if (po) {
        await api('PATCH', `/api/purchase-orders/${po.id}`, {
          status: 'received',
          batchId: result.batchId,
        });
        msg.innerHTML = '<p class="msg success">รับสินค้าเข้าคลังเรียบร้อยแล้ว และอัปเดตสถานะรายการสั่งซื้อเป็น "รับแล้ว" แล้ว — <a href="#/orders">กลับไปหน้าสั่งซื้อ</a></p>';
      } else {
        msg.innerHTML = '<p class="msg success">รับสินค้าเข้าคลังเรียบร้อยแล้ว</p>';
      }
      e.target.reset();
      document.getElementById('rf-date').value = new Date().toISOString().slice(0, 10);
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });
  enhanceDateInputs(container);
}

// ---------- Issue stock (outflow) ----------
async function renderIssue(container) {
  if (!canCreate()) {
    container.innerHTML = '<h2>เบิกสินค้าออก (ขายให้ลูกค้า)</h2><p class="msg error">คุณมีสิทธิ์ดูข้อมูลอย่างเดียว ไม่สามารถบันทึกเบิกสินค้าออกได้</p>';
    return;
  }
  await loadProducts();
  await loadCustomers();
  container.innerHTML = `
    <h2>เบิกสินค้าออก (ขายให้ลูกค้า)</h2>
    <div class="card">
      <label class="field">รูปแบบการเบิกออก</label>
      <div class="tab-toggle" id="if-mode-toggle">
        <button type="button" class="tab-toggle-btn active" data-mode="normal">เบิกออกปกติ</button>
        <button type="button" class="tab-toggle-btn" data-mode="convert">เบิกออกแบบแปลงหมึกเป็นเบอร์อื่น</button>
      </div>
    </div>
    <div id="issue-mode-normal">
    <form id="issue-form" class="stack card">
      <div class="form-row">
        <label class="field">ซัพพลายเออร์
          <select id="if-product-supplier">${brandFilterOptionsHTML(state.products)}</select>
        </label>
        <label class="field">สินค้า
          <select id="if-product" required>${productOptions(state.products)}</select>
        </label>
      </div>
      <label class="field">ล็อตที่จะตัด
        <select id="if-batch"><option value="">อัตโนมัติ (FIFO/FEFO — หมดอายุเร็วสุด/รับเข้าก่อนสุด)</option></select>
      </label>
      <div class="form-row">
        <label class="field">จำนวน
          <input type="number" id="if-qty" step="any" min="0.01" required>
        </label>
        <label class="field">วันที่
          <input type="date" id="if-date" value="${new Date().toISOString().slice(0, 10)}">
        </label>
      </div>
      <div class="form-row">
        <label class="field">วัตถุประสงค์
          <select id="if-purpose">
            <option value="sale">ขายให้ลูกค้า</option>
            <option value="trial">ให้ทดลอง/ตัวอย่าง</option>
            <option value="claim">เคลม</option>
            <option value="gift">แถมให้ลูกค้า</option>
          </select>
        </label>
        <label class="field">ลูกค้า
          <div class="searchable-select">
            <input type="text" class="ss-input" id="if-customer-search" placeholder="พิมพ์เพื่อค้นหาลูกค้า..." autocomplete="off">
            <div class="ss-list hidden" id="if-customer-list"></div>
            <select id="if-customer" class="hidden">
              <option value="">— ไม่ระบุ —</option>
              ${customerOptions(state.customers)}
              <option value="__new__">+ เพิ่มลูกค้าใหม่…</option>
            </select>
          </div>
        </label>
      </div>
      <div class="form-row hidden" id="if-new-customer-row">
        <label class="field">ชื่อลูกค้าใหม่
          <input type="text" id="if-new-customer-name">
        </label>
        <button type="button" id="if-add-customer-btn" class="secondary" style="align-self:flex-end">เพิ่มลูกค้า</button>
      </div>
      <div id="if-customer-msg"></div>
      <label class="field">เลขใบเบิกสินค้า
        <input type="text" id="if-req-no" placeholder="ไม่บังคับ">
      </label>
      <label class="field">หมายเหตุ
        <textarea id="if-note" rows="2"></textarea>
      </label>
      <div id="if-preview"></div>
      <button type="submit" class="primary">ยืนยันการเบิกออก</button>
      <div id="if-msg"></div>
    </form>
    </div>
  `;

  document.querySelectorAll('#if-mode-toggle .tab-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll('#if-mode-toggle .tab-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('issue-mode-normal').classList.toggle('hidden', mode !== 'normal');
      document.getElementById('issue-mode-convert').classList.toggle('hidden', mode !== 'convert');
    });
  });

  let issueBatches = [];
  async function refreshIssueBatches() {
    const productId = document.getElementById('if-product').value;
    const batchSelect = document.getElementById('if-batch');
    batchSelect.innerHTML = '<option value="">อัตโนมัติ (FIFO/FEFO — หมดอายุเร็วสุด/รับเข้าก่อนสุด)</option>';
    issueBatches = [];
    if (!productId) return;
    issueBatches = (await api('GET', `/api/batches/product/${productId}`)).filter((b) => b.quantity_remaining > 0);
    batchSelect.innerHTML += issueBatches
      .map((b) => `<option value="${b.id}">${escapeHtml(b.batch_number || `ล็อต ${b.id}`)} — เหลือ ${fmtNum(b.quantity_remaining)} — หมดอายุ ${fmtDate(b.expiration_date)} — รับเข้า ${fmtDate(b.received_date)}</option>`)
      .join('');
  }

  async function preview() {
    const productId = document.getElementById('if-product').value;
    const qty = Number(document.getElementById('if-qty').value);
    const selectedBatchId = document.getElementById('if-batch').value;
    const previewEl = document.getElementById('if-preview');
    if (!productId) { previewEl.innerHTML = ''; return; }

    if (selectedBatchId) {
      // Manual override — user picked a specific lot instead of letting FIFO/FEFO decide.
      const batch = issueBatches.find((b) => String(b.id) === selectedBatchId);
      if (!batch) { previewEl.innerHTML = ''; return; }
      const allocated = qty ? Math.min(batch.quantity_remaining, qty) : batch.quantity_remaining;
      const shortfall = qty ? Math.max(0, qty - batch.quantity_remaining) : 0;
      previewEl.innerHTML = `
        <div class="card">
          <p><span class="badge warning">เลือกล็อตเอง</span>
             ${qty ? (shortfall ? `<span class="badge expired">ขาด ${fmtNum(shortfall)}</span>` : '<span class="badge ok">เพียงพอ</span>') : ''}
             คงเหลือในล็อตนี้: ${fmtNum(batch.quantity_remaining)}</p>
          <table><thead><tr><th>ล็อต</th><th>วันหมดอายุ</th><th class="right">จะใช้</th></tr></thead>
          <tbody><tr><td>ล็อต ${escapeHtml(batch.batch_number || batch.id)}</td><td>${fmtDate(batch.expiration_date)}</td><td class="right">${fmtNum(allocated)}</td></tr></tbody></table>
        </div>`;
      return;
    }

    if (!qty) {
      // No quantity yet — just show which lots exist for this product, in the order FEFO would take them.
      try {
        const batches = (await api('GET', `/api/batches/product/${productId}`)).filter((b) => b.quantity_remaining > 0);
        const rows = batches.map((b) => `
          <tr>
            <td>ล็อต ${escapeHtml(b.batch_number || b.id)}</td>
            <td>${fmtDate(b.expiration_date)}</td>
            <td class="right">${fmtNum(b.quantity_remaining)}</td>
          </tr>`).join('');
        previewEl.innerHTML = `
          <div class="card">
            <p class="muted">ล็อตที่มีอยู่สำหรับสินค้านี้ (เรียงลำดับที่จะถูกตัดก่อน — หมดอายุเร็วสุด/รับเข้าก่อนสุด) — กรอกจำนวนเพื่อดูว่าจะตัดจากล็อตไหนบ้าง</p>
            <table><thead><tr><th>ล็อต</th><th>วันหมดอายุ</th><th class="right">คงเหลือ</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">ไม่มีสต็อกคงเหลือ</td></tr>'}</tbody></table>
          </div>`;
      } catch (err) {
        previewEl.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
      }
      return;
    }

    try {
      const p = await api('GET', `/api/outflow/preview?productId=${productId}&quantity=${qty}`);
      const rows = p.allocation.map((a) => `
        <tr data-batch-id="${a.batchId}">
          <td>ล็อต ${escapeHtml(a.batchNumber || a.batchId)}</td>
          <td class="if-exp-cell">
            <span class="if-exp-display">${fmtDate(a.expirationDate)}</span>
            ${canEdit() ? '<button type="button" class="secondary if-edit-exp">แก้ไขวันหมดอายุ</button>' : ''}
          </td>
          <td class="right">${fmtNum(a.allocated)}</td>
        </tr>
      `).join('');
      previewEl.innerHTML = `
        <div class="card">
          <p>${p.fulfillable ? '<span class="badge ok">เพียงพอ</span>' : `<span class="badge expired">ขาด ${fmtNum(p.shortfall)}</span>`}
             คงเหลือทั้งหมด: ${fmtNum(p.totalAvailable)}</p>
          <p class="muted">หากล็อตใดหมดอายุแล้วแต่ตรวจสอบแล้วว่ายังส่งให้ลูกค้าได้ ให้กด "แก้ไขวันหมดอายุ" เพื่อปรับก่อนยืนยันการเบิกออก</p>
          <table><thead><tr><th>ล็อต</th><th>วันหมดอายุ</th><th class="right">จะใช้</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">ไม่มีสต็อกคงเหลือ</td></tr>'}</tbody></table>
        </div>`;

      previewEl.querySelectorAll('.if-edit-exp').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cell = btn.closest('.if-exp-cell');
          const batchId = btn.closest('tr').dataset.batchId;
          cell.innerHTML = `
            <input type="date" class="if-exp-input">
            <button type="button" class="secondary if-save-exp">บันทึก</button>
          `;
          enhanceDateInputs(cell);
          const saveBtn = cell.querySelector('.if-save-exp');
          saveBtn.addEventListener('click', async () => {
            const newDate = cell.querySelector('.if-exp-input').value;
            try {
              await api('PATCH', `/api/batches/${batchId}/expiration`, { expirationDate: newDate || null, reason: 'แก้ไขก่อนส่งให้ลูกค้า' });
              await preview();
            } catch (err) {
              alert(err.message);
            }
          });
        });
      });
    } catch (err) {
      previewEl.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  }

  document.getElementById('if-product').addEventListener('change', async () => {
    await refreshIssueBatches();
    await preview();
  });
  document.getElementById('if-batch').addEventListener('change', preview);
  document.getElementById('if-qty').addEventListener('input', preview);
  wireSupplierProductCascade(
    document.getElementById('if-product-supplier'),
    document.getElementById('if-product'),
    state.products
  );
  if (state.products.length) {
    await refreshIssueBatches();
    await preview();
  }

  wireSearchableSelect('if-customer', { newNameInputId: 'if-new-customer-name' });
  document.getElementById('if-customer').addEventListener('change', (e) => {
    document.getElementById('if-new-customer-row').classList.toggle('hidden', e.target.value !== '__new__');
    if (e.target.value === '__new__') document.getElementById('if-new-customer-name').focus();
  });

  document.getElementById('if-add-customer-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('if-new-customer-name');
    const customerMsg = document.getElementById('if-customer-msg');
    const name = nameInput.value.trim();
    customerMsg.innerHTML = '';
    if (!name) return;
    try {
      await api('POST', '/api/customers', { name });
      await loadCustomers();
      const select = document.getElementById('if-customer');
      select.innerHTML = `<option value="">— ไม่ระบุ —</option>${customerOptions(state.customers)}<option value="__new__">+ เพิ่มลูกค้าใหม่…</option>`;
      select.value = name;
      select._syncSearchable();
      document.getElementById('if-new-customer-row').classList.add('hidden');
      nameInput.value = '';
    } catch (err) {
      customerMsg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  document.getElementById('issue-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('if-msg');
    msg.innerHTML = '';
    const customerValue = document.getElementById('if-customer').value;
    if (customerValue === '__new__') {
      msg.innerHTML = '<p class="msg error">กรุณากด "เพิ่มลูกค้า" ก่อน หรือเลือกลูกค้าที่มีอยู่แล้ว</p>';
      return;
    }
    try {
      const purpose = document.getElementById('if-purpose').value;
      const result = await api('POST', '/api/outflow', {
        productId: Number(document.getElementById('if-product').value),
        quantity: Number(document.getElementById('if-qty').value),
        customer: customerValue || null,
        transactionDate: document.getElementById('if-date').value || null,
        note: document.getElementById('if-note').value || null,
        purpose,
        requisitionNo: document.getElementById('if-req-no').value || null,
        batchId: document.getElementById('if-batch').value || null,
      });
      const purposeNote = purpose === 'trial' ? ' (บันทึกเป็นรายการให้ทดลอง/ตัวอย่าง)' : '';
      msg.innerHTML = `<p class="msg success">เบิกออกสำเร็จ จาก ${result.allocation.length} ล็อต${purposeNote}</p>`;
      e.target.reset();
      document.getElementById('if-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('if-new-customer-row').classList.add('hidden');
      await refreshIssueBatches();
      await preview();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  // ---- Convert ink to another SKU (also a form of issuing stock out) ----
  container.insertAdjacentHTML('beforeend', `
    <div id="issue-mode-convert" class="card hidden">
      <h3>เบิกออกแบบแปลงหมึกเป็นเบอร์อื่น</h3>
      <p class="muted">ใช้เมื่อนำหมึกเบอร์หนึ่งไปแปลง/บรรจุใหม่เป็นอีกเบอร์หนึ่งก่อนส่งให้ลูกค้า —
        ถ้าระบุ "ลูกค้า" ระบบจะตัดสต็อกจากสินค้าต้นทางแล้วถือว่าส่งให้ลูกค้าทันที
        (ไม่สร้างล็อต/สต็อกค้างในสินค้าปลายทาง) แต่ถ้าไม่ระบุลูกค้า (แปลงเก็บไว้ในคลังก่อน)
        ระบบจะสร้างล็อตใหม่ให้สินค้าปลายทางตามปกติ</p>
      <form id="conv-form" class="stack">
        <div class="form-row">
          <label class="field">ซัพพลายเออร์ต้นทาง
            <select id="cv-source-supplier">${brandFilterOptionsHTML(state.products)}</select>
          </label>
          <label class="field">สินค้าต้นทาง (ของเดิม)
            <select id="cv-source-product" required>${productOptions(state.products)}</select>
          </label>
        </div>
        <label class="field">ล็อตต้นทาง (ถ้าระบุ)
          <select id="cv-source-batch"><option value="">— อัตโนมัติ (FEFO) —</option></select>
        </label>
        <div class="form-row">
          <label class="field">จำนวนที่แปลง
            <input type="number" id="cv-qty" step="any" min="0.01" required>
          </label>
          <label class="field">วันที่แปลง
            <input type="date" id="cv-date" value="${new Date().toISOString().slice(0, 10)}">
          </label>
        </div>
        <div class="form-row">
          <label class="field">ซัพพลายเออร์ปลายทาง
            <select id="cv-dest-supplier">${brandFilterOptionsHTML(state.products)}</select>
          </label>
          <label class="field">สินค้าปลายทาง (เบอร์ใหม่)
            <select id="cv-dest-product" required>${productOptions(state.products)}</select>
          </label>
        </div>
        <div class="form-row align-end">
          <label class="field">วันหมดอายุใหม่ (ถ้าไม่ระบุจะใช้ของล็อตเดิม)
            <input type="date" id="cv-dest-expiry">
          </label>
          <label class="field">หมายเลขล็อตใหม่ (ไม่บังคับ)
            <input type="text" id="cv-dest-batch" placeholder="สร้างอัตโนมัติถ้าไม่ระบุ">
          </label>
        </div>
        <label class="field">ลูกค้า (ไม่บังคับ)
          <div class="searchable-select">
            <input type="text" class="ss-input" id="cv-customer-search" placeholder="พิมพ์เพื่อค้นหาลูกค้า..." autocomplete="off">
            <div class="ss-list hidden" id="cv-customer-list"></div>
            <select id="cv-customer" class="hidden">
              <option value="">— ไม่ระบุ —</option>
              ${customerOptions(state.customers)}
              <option value="__new__">+ เพิ่มลูกค้าใหม่…</option>
            </select>
          </div>
        </label>
        <div class="form-row hidden" id="cv-new-customer-row">
          <label class="field">ชื่อลูกค้าใหม่
            <input type="text" id="cv-new-customer-name">
          </label>
          <button type="button" id="cv-add-customer-btn" class="secondary" style="align-self:flex-end">เพิ่มลูกค้า</button>
        </div>
        <div id="cv-customer-msg"></div>
        <label class="field">หมายเหตุ
          <textarea id="cv-note" rows="2"></textarea>
        </label>
        <button type="submit" class="primary">แปลงหมึก</button>
        <div id="cv-msg"></div>
      </form>
    </div>
  `);

  async function refreshSourceBatches() {
    const productId = document.getElementById('cv-source-product').value;
    const batchSelect = document.getElementById('cv-source-batch');
    batchSelect.innerHTML = '<option value="">— อัตโนมัติ (FEFO) —</option>';
    if (!productId) return;
    const batches = await api('GET', `/api/batches/product/${productId}`);
    batchSelect.innerHTML += batches
      .filter((b) => b.quantity_remaining > 0)
      .map((b) => `<option value="${b.id}">${escapeHtml(b.batch_number || `ล็อต ${b.id}`)} — เหลือ ${fmtNum(b.quantity_remaining)} (${fmtDate(b.expiration_date)})</option>`)
      .join('');
  }
  document.getElementById('cv-source-product').addEventListener('change', refreshSourceBatches);
  wireSupplierProductCascade(
    document.getElementById('cv-source-supplier'),
    document.getElementById('cv-source-product'),
    state.products
  );
  wireSupplierProductCascade(
    document.getElementById('cv-dest-supplier'),
    document.getElementById('cv-dest-product'),
    state.products
  );
  if (state.products.length) await refreshSourceBatches();

  wireSearchableSelect('cv-customer', { newNameInputId: 'cv-new-customer-name' });
  document.getElementById('cv-customer').addEventListener('change', (e) => {
    document.getElementById('cv-new-customer-row').classList.toggle('hidden', e.target.value !== '__new__');
    if (e.target.value === '__new__') document.getElementById('cv-new-customer-name').focus();
  });

  document.getElementById('cv-add-customer-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('cv-new-customer-name');
    const customerMsg = document.getElementById('cv-customer-msg');
    const name = nameInput.value.trim();
    customerMsg.innerHTML = '';
    if (!name) return;
    try {
      await api('POST', '/api/customers', { name });
      await loadCustomers();
      const select = document.getElementById('cv-customer');
      select.innerHTML = `<option value="">— ไม่ระบุ —</option>${customerOptions(state.customers)}<option value="__new__">+ เพิ่มลูกค้าใหม่…</option>`;
      select.value = name;
      select._syncSearchable();
      document.getElementById('cv-new-customer-row').classList.add('hidden');
      nameInput.value = '';
    } catch (err) {
      customerMsg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  document.getElementById('conv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('cv-msg');
    msg.innerHTML = '';
    const customerValue = document.getElementById('cv-customer').value;
    if (customerValue === '__new__') {
      msg.innerHTML = '<p class="msg error">กรุณากด "เพิ่มลูกค้า" ก่อน หรือเลือกลูกค้าที่มีอยู่แล้ว</p>';
      return;
    }
    try {
      const result = await api('POST', '/api/outflow/convert', {
        sourceProductId: Number(document.getElementById('cv-source-product').value),
        sourceBatchId: document.getElementById('cv-source-batch').value || null,
        quantity: Number(document.getElementById('cv-qty').value),
        destProductId: Number(document.getElementById('cv-dest-product').value),
        destExpirationDate: document.getElementById('cv-dest-expiry').value || null,
        destBatchNumber: document.getElementById('cv-dest-batch').value || null,
        conversionDate: document.getElementById('cv-date').value || null,
        note: document.getElementById('cv-note').value || null,
        customer: customerValue || null,
      });
      msg.innerHTML = result.shippedDirectly
        ? '<p class="msg success">แปลงหมึกและส่งให้ลูกค้าเรียบร้อยแล้ว (ตัดสต็อกจากสินค้าต้นทางโดยตรง ไม่มีสต็อกค้างในสินค้าปลายทาง)</p>'
        : '<p class="msg success">แปลงหมึกเรียบร้อยแล้ว</p>';
      e.target.reset();
      document.getElementById('cv-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('cv-new-customer-row').classList.add('hidden');
      await refreshSourceBatches();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });
  enhanceDateInputs(container);
}

// ---------- History ----------
async function renderHistory(container) {
  await loadCustomers();
  const salespeople = [...new Set(state.customers.map((c) => c.assigned_to).filter(Boolean))].sort();

  container.innerHTML = `
    <h2>ประวัติการเคลื่อนไหว</h2>
    <div class="card">
      <div class="filters">
        <label class="field">ซัพพลายเออร์
          <select id="hf-supplier">${brandFilterOptionsHTML(state.products)}</select>
        </label>
        <label class="field">สินค้า
          <select id="hf-product"><option value="">ทั้งหมด</option>${productOptions(state.products)}</select>
        </label>
        <label class="field">ประเภท
          <select id="hf-type">
            <option value="">ทั้งหมด</option>
            <option value="IN">รับเข้า</option>
            <option value="OUT">เบิกออก</option>
            <option value="ADJUST">ปรับปรุง</option>
          </select>
        </label>
        <label class="field">วัตถุประสงค์
          <select id="hf-purpose">
            <option value="">ทั้งหมด</option>
            <option value="sale">ขาย</option>
            <option value="trial">ทดลอง/ตัวอย่าง</option>
            <option value="claim">เคลม</option>
            <option value="gift">แถมให้ลูกค้า</option>
          </select>
        </label>
        <label class="field">ลูกค้า
          <div class="searchable-select">
            <input type="text" class="ss-input" id="hf-customer-search" placeholder="พิมพ์เพื่อค้นหาลูกค้า..." autocomplete="off">
            <div class="ss-list hidden" id="hf-customer-list"></div>
            <select id="hf-customer" class="hidden">
              <option value="">ทั้งหมด</option>
              ${customerOptions(state.customers)}
            </select>
          </div>
        </label>
        <label class="field">พนักงานขายที่ดูแล
          <select id="hf-salesperson"><option value="">ทั้งหมด</option>${salespeople.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>
        </label>
        <label class="field">เลขใบเบิก
          <input type="search" id="hf-req-no" placeholder="ค้นหาเลขใบเบิก..." autocomplete="off">
        </label>
        <label class="field">จาก <input type="date" id="hf-from"></label>
        <label class="field">ถึง <input type="date" id="hf-to"></label>
        <button id="hf-apply" class="secondary">กรอง</button>
        <button id="hf-export" class="secondary">ส่งออก CSV</button>
      </div>
      <div class="table-wrap" id="hf-table"><p class="muted">กำลังโหลด…</p></div>
    </div>
  `;

  function currentQuery() {
    const params = new URLSearchParams();
    const productId = document.getElementById('hf-product').value;
    const type = document.getElementById('hf-type').value;
    const purpose = document.getElementById('hf-purpose').value;
    const customer = document.getElementById('hf-customer').value;
    const salesperson = document.getElementById('hf-salesperson').value;
    const from = document.getElementById('hf-from').value;
    const to = document.getElementById('hf-to').value;
    const reqNo = document.getElementById('hf-req-no').value.trim();
    if (reqNo) params.set('requisitionNo', reqNo);
    if (productId) params.set('productId', productId);
    if (type) params.set('type', type);
    if (purpose) params.set('purpose', purpose);
    if (customer) params.set('customer', customer);
    if (salesperson) params.set('salesperson', salesperson);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }

  async function load() {
    const rows = await api('GET', `/api/transactions?${currentQuery()}`);
    const colCount = 11;

    const outProductIds = [...new Set(rows.filter((t) => t.type === 'OUT' && canEdit()).map((t) => t.product_id))];
    const batchesByProduct = {};
    await Promise.all(outProductIds.map(async (pid) => {
      batchesByProduct[pid] = await api('GET', `/api/batches/product/${pid}`);
    }));

    const body = rows.map((t) => {
      const rowEditable = (t.type === 'IN' || t.type === 'OUT') && canEdit();
      const editRowId = `hf-edit-${t.id}`;
      const mainRow = `
      <tr class="${rowEditable ? 'inv-toggle-row' : ''}" ${rowEditable ? `data-toggle="${editRowId}"` : ''}>
        <td>${fmtDate(t.transaction_date)}</td>
        <td>${TYPE_LABEL[t.type] || t.type}${t.type === 'OUT' && t.purpose && t.purpose !== 'sale' ? ` <span class="badge critical">${PURPOSE_LABEL[t.purpose] || t.purpose}</span>` : ''}</td>
        <td>${escapeHtml(t.product_name)} <span class="muted">(${escapeHtml(t.sku_code)})</span></td>
        <td class="muted">${escapeHtml(t.batch_number || '')}</td>
        <td>${fmtDate(t.expiration_date)}</td>
        <td class="right">${fmtNum(t.quantity)} ${escapeHtml(t.unit)}</td>
        <td>${escapeHtml(t.counterparty || '')}</td>
        <td class="muted">${escapeHtml(t.requisition_no || '')}</td>
        <td class="muted">${escapeHtml(t.user_name || '')}</td>
        <td class="muted">${escapeHtml(t.note || '')}</td>
        <td>${rowEditable ? '<span class="inv-chevron">▸</span> แก้ไข' : ''}</td>
      </tr>`;
      if (!rowEditable) return mainRow;
      const editRow = `
      <tr class="hidden" data-parent="${editRowId}">
        <td colspan="${colCount}">
          <form class="hf-edit-form stack" data-id="${t.id}" data-type="${t.type}" data-batch-id="${t.batch_id}" style="max-width:640px;margin:8px 0">
            ${t.type === 'IN' ? `
            <div class="form-row">
              <label class="field">หมายเลขล็อต
                <input type="text" class="hfe-batch-number" value="${escapeHtml(t.batch_number || '')}">
              </label>
              <label class="field">วันหมดอายุ
                <input type="date" class="hfe-expiry" value="${t.expiration_date || ''}">
              </label>
            </div>` : ''}
            ${t.type === 'OUT' ? `
            <label class="field">ล็อต
              <select class="hfe-batch">
                ${(batchesByProduct[t.product_id] || []).map((b) => `<option value="${b.id}" ${b.id === t.batch_id ? 'selected' : ''}>${escapeHtml(b.batch_number || `ล็อต ${b.id}`)} — เหลือ ${fmtNum(b.quantity_remaining)} (${fmtDate(b.expiration_date)})</option>`).join('')}
              </select>
            </label>` : ''}
            <div class="form-row">
              <label class="field">จำนวน
                <input type="number" class="hfe-qty" step="any" min="0.01" value="${t.quantity}" required>
              </label>
              <label class="field">วันที่
                <input type="date" class="hfe-date" value="${t.transaction_date}" required>
              </label>
            </div>
            <div class="form-row">
              <label class="field">${t.type === 'IN' ? 'ซัพพลายเออร์' : 'ลูกค้า'}
                <input type="text" class="hfe-counterparty" value="${escapeHtml(t.counterparty || '')}">
              </label>
              ${t.type === 'OUT' ? `
              <label class="field">เลขใบเบิกสินค้า
                <input type="text" class="hfe-req-no" value="${escapeHtml(t.requisition_no || '')}">
              </label>` : ''}
            </div>
            ${t.type === 'OUT' ? `
            <label class="field">วัตถุประสงค์
              <select class="hfe-purpose">
                <option value="sale" ${t.purpose === 'sale' ? 'selected' : ''}>ขายให้ลูกค้า</option>
                <option value="trial" ${t.purpose === 'trial' ? 'selected' : ''}>ให้ทดลอง/ตัวอย่าง</option>
                <option value="claim" ${t.purpose === 'claim' ? 'selected' : ''}>เคลม</option>
                <option value="gift" ${t.purpose === 'gift' ? 'selected' : ''}>แถมให้ลูกค้า</option>
              </select>
            </label>` : ''}
            <label class="field">หมายเหตุ
              <textarea class="hfe-note" rows="2">${escapeHtml(t.note || '')}</textarea>
            </label>
            <div class="form-row">
              <button type="submit" class="primary">บันทึกการแก้ไข</button>
              <button type="button" class="secondary hfe-cancel">ยกเลิก</button>
              <button type="button" class="secondary hfe-delete">ลบรายการนี้</button>
            </div>
            <div class="hfe-msg"></div>
          </form>
        </td>
      </tr>`;
      return mainRow + editRow;
    }).join('');
    document.getElementById('hf-table').innerHTML = `
      <table>
        <thead><tr><th>วันที่</th><th>ประเภท</th><th>สินค้า</th><th>ล็อต</th><th>วันหมดอายุ</th><th class="right">จำนวน</th><th>ลูกค้า/ซัพพลายเออร์</th><th>เลขใบเบิก</th><th>โดย</th><th>หมายเหตุ</th><th></th></tr></thead>
        <tbody>${body || `<tr><td colspan="${colCount}" class="muted">ไม่พบรายการที่ตรงกัน</td></tr>`}</tbody>
      </table>`;

    document.querySelectorAll('#hf-table .inv-toggle-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.toggle;
        const expanding = row.classList.toggle('expanded');
        document.querySelectorAll(`#hf-table [data-parent="${id}"]`).forEach((r) => r.classList.toggle('hidden', !expanding));
      });
    });
    document.querySelectorAll('#hf-table .hfe-cancel').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        tr.classList.add('hidden');
        const toggleRow = document.querySelector(`#hf-table .inv-toggle-row[data-toggle="${tr.dataset.parent}"]`);
        if (toggleRow) toggleRow.classList.remove('expanded');
      });
    });
    document.querySelectorAll('#hf-table .hf-edit-form').forEach((form) => {
      form.addEventListener('click', (e) => e.stopPropagation());
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const msg = form.querySelector('.hfe-msg');
        msg.innerHTML = '';
        const { id, type, batchId } = form.dataset;
        try {
          if (type === 'IN') {
            await api('PATCH', `/api/batches/${batchId}`, {
              batchNumber: form.querySelector('.hfe-batch-number').value || null,
              expirationDate: form.querySelector('.hfe-expiry').value || null,
              quantity: Number(form.querySelector('.hfe-qty').value),
              supplier: form.querySelector('.hfe-counterparty').value || null,
              receivedDate: form.querySelector('.hfe-date').value || null,
              note: form.querySelector('.hfe-note').value || null,
            });
          } else {
            const lotSelect = form.querySelector('.hfe-batch');
            await api('PATCH', `/api/transactions/${id}`, {
              quantity: Number(form.querySelector('.hfe-qty').value),
              transactionDate: form.querySelector('.hfe-date').value || null,
              counterparty: form.querySelector('.hfe-counterparty').value || null,
              note: form.querySelector('.hfe-note').value || null,
              purpose: form.querySelector('.hfe-purpose').value,
              requisitionNo: form.querySelector('.hfe-req-no').value || null,
              batchId: lotSelect ? lotSelect.value : undefined,
            });
          }
          await load();
        } catch (err) {
          msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
        }
      });
      form.querySelector('.hfe-delete').addEventListener('click', async () => {
        const msg = form.querySelector('.hfe-msg');
        msg.innerHTML = '';
        const { id, type, batchId } = form.dataset;
        const label = type === 'IN' ? 'รายการรับสินค้าเข้า' : 'รายการเบิกสินค้าออก';
        if (!confirm(`ลบ${label}นี้ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`)) return;
        try {
          if (type === 'IN') {
            await api('DELETE', `/api/batches/${batchId}`);
          } else {
            await api('DELETE', `/api/transactions/${id}`);
          }
          await load();
        } catch (err) {
          msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
        }
      });
    });
    enhanceDateInputs(container);
  }

  document.getElementById('hf-apply').addEventListener('click', load);
  document.getElementById('hf-req-no').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); load(); }
  });
  document.getElementById('hf-export').addEventListener('click', () => {
    window.open(`/api/transactions/export.csv?${currentQuery()}`, '_blank');
  });
  wireSupplierProductCascade(
    document.getElementById('hf-supplier'),
    document.getElementById('hf-product'),
    state.products,
    { includeAllProducts: true }
  );
  wireSearchableSelect('hf-customer', { includeEmptyOption: true });

  await load();
}

// ---------- Claims / returns ----------
const CLAIM_TYPE_LABEL = { customer_reject: 'ลูกค้าตีกลับ', supplier_claim: 'เคลมซัพพลายเออร์' };
const CLAIM_CATEGORY_LABEL = {
  defective: 'สินค้าชำรุด/เสีย',
  expired: 'สินค้าหมดอายุ',
  wrong_item: 'ส่งผิดรุ่น/ผิดสี',
  damaged_packaging: 'บรรจุภัณฑ์เสียหาย',
  quality_issue: 'ปัญหาคุณภาพงานพิมพ์',
  other: 'อื่นๆ',
};

function claimCategoryOptions() {
  return Object.entries(CLAIM_CATEGORY_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
}

// Claims only have two effective states: "ดำเนินการ" (open, the only manual state) and "เสร็จสิ้น"
// (closed — reached only via "รับคืนเข้าคลัง" or "ปฏิเสธทั้งหมด"), so open/closed claims render as
// two separate tables rather than exposing a status picker.
function buildClaimsTableHTML(claims, { showActions }) {
  const rows = claims.map((c) => `
    <tr>
      <td>${fmtDate(c.claim_date)}</td>
      <td>${escapeHtml(c.product_name)} <span class="muted">(${escapeHtml(c.sku_code)})</span></td>
      <td class="muted">${escapeHtml(c.batch_number || '—')}</td>
      <td class="right">${fmtNum(c.quantity)} ${escapeHtml(c.unit)}</td>
      <td>${escapeHtml(c.counterparty || '—')}</td>
      <td class="muted">${CLAIM_CATEGORY_LABEL[c.category] || c.category}<br>${escapeHtml(c.details || '')}</td>
      <td class="muted">${escapeHtml(c.user_name || '')}</td>
      <td data-requires="edit"><input type="text" class="cl-resolution" data-id="${c.id}" value="${escapeHtml(c.resolution_note || '')}" placeholder="เหตุผล เช่น น้ำหนักหมึกต่ำ/หมดอายุ"></td>
      ${showActions ? `
      <td data-requires="create" style="white-space:nowrap">
        <a href="#/receive?claimId=${c.id}" class="secondary" style="display:inline-block;text-decoration:none;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12.5px;white-space:nowrap;margin-bottom:4px">รับคืนเข้าคลัง</a>
        <button type="button" class="secondary cl-reject" data-id="${c.id}" data-qty="${c.quantity}" data-unit="${escapeHtml(c.unit)}" style="display:block;width:100%;font-size:12.5px;padding:6px 10px">ปฏิเสธทั้งหมด</button>
      </td>` : ''}
    </tr>`).join('');

  const colCount = showActions ? 9 : 8;
  const emptyText = showActions ? 'ไม่มีรายการที่กำลังดำเนินการ' : 'ยังไม่มีรายการที่เสร็จสิ้น';

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>วันที่</th><th>สินค้า</th><th>ล็อต</th><th class="right">จำนวน</th>
            <th>ลูกค้า</th><th>สาเหตุ</th><th>บันทึกโดย</th><th>หมายเหตุ</th>${showActions ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="${colCount}" class="muted">${emptyText}</td></tr>`}</tbody>
      </table>
    </div>`;
}

async function renderClaims(container) {
  await loadProducts();
  await loadCustomers();
  container.innerHTML = `
    <h2>เคลม/ตีกลับจากลูกค้า</h2>
    <p class="muted">
      <strong>ข้อควรทราบ:</strong> การบันทึกเคลม/ตีกลับ ไม่ได้ปรับจำนวนสต็อกอัตโนมัติ —
      เป็นการบันทึกติดตามเรื่องแยกต่างหาก เมื่อดำเนินการเสร็จแล้ว ให้กดปุ่ม "รับคืนเข้าคลัง"
      หากมีสินค้าที่รับกลับเข้าคลังได้ (ระบุเหตุผลในช่องหมายเหตุของฟอร์มรับสินค้าเข้า หากรับคืนไม่ครบ)
      หรือกด "ปฏิเสธทั้งหมด" หากไม่มีสินค้าคืนเข้าคลังเลย — รายการจะย้ายไปตารางที่เสร็จสิ้นแล้วด้านล่าง
    </p>
    <div class="card" data-requires="create">
      <h3>บันทึกรายการใหม่</h3>
      <form id="cf-form" class="stack">
        <div class="form-row">
          <label class="field">ซัพพลายเออร์
            <select id="cf-product-supplier">${brandFilterOptionsHTML(state.products)}</select>
          </label>
          <label class="field">สินค้า
            <select id="cf-product" required>${productOptions(state.products)}</select>
          </label>
        </div>
        <label class="field">ล็อต
          <select id="cf-batch" required><option value="">— เลือกล็อต —</option></select>
        </label>
        <div class="form-row">
          <label class="field">จำนวน
            <input type="number" id="cf-qty" step="any" min="0.01" required>
          </label>
          <label class="field">วันที่
            <input type="date" id="cf-date" value="${new Date().toISOString().slice(0, 10)}">
          </label>
        </div>
        <label class="field">ลูกค้า
          <div class="searchable-select">
            <input type="text" class="ss-input" id="cf-customer-search" placeholder="พิมพ์เพื่อค้นหาลูกค้า..." autocomplete="off">
            <div class="ss-list hidden" id="cf-customer-list"></div>
            <select id="cf-customer" class="hidden">
              <option value="">— ไม่ระบุ —</option>
              ${customerOptions(state.customers)}
              <option value="__new__">+ เพิ่มลูกค้าใหม่…</option>
            </select>
          </div>
        </label>
        <div class="form-row hidden" id="cf-new-customer-row">
          <label class="field">ชื่อลูกค้าใหม่
            <input type="text" id="cf-new-customer-name">
          </label>
          <button type="button" id="cf-add-customer-btn" class="secondary" style="align-self:flex-end">เพิ่มลูกค้า</button>
        </div>
        <div id="cf-customer-msg"></div>
        <label class="field">สาเหตุ
          <select id="cf-category">${claimCategoryOptions()}</select>
        </label>
        <label class="field">รายละเอียดเพิ่มเติม
          <textarea id="cf-details" rows="2"></textarea>
        </label>
        <button type="submit" class="primary">บันทึกรายการ</button>
        <div id="cf-msg"></div>
      </form>
    </div>
    <div class="card">
      <h3>รายการที่กำลังดำเนินการ</h3>
      <div class="table-wrap" id="cl-table"><p class="muted">กำลังโหลด…</p></div>
    </div>
    <div class="card">
      <h3>รายการที่เสร็จสิ้นแล้ว</h3>
      <div class="table-wrap" id="cl-table-done"><p class="muted">กำลังโหลด…</p></div>
    </div>
  `;

  document.getElementById('cf-product').addEventListener('change', async (e) => {
    const batchSelect = document.getElementById('cf-batch');
    batchSelect.innerHTML = '<option value="">— เลือกล็อต —</option>';
    if (!e.target.value) return;
    const batches = await api('GET', `/api/batches/product/${e.target.value}`);
    batchSelect.innerHTML += batches.map((b) => `<option value="${b.id}">${escapeHtml(b.batch_number || `ล็อต ${b.id}`)} — เหลือ ${fmtNum(b.quantity_remaining)}</option>`).join('');
  });
  wireSupplierProductCascade(
    document.getElementById('cf-product-supplier'),
    document.getElementById('cf-product'),
    state.products
  );
  if (state.products.length) document.getElementById('cf-product').dispatchEvent(new Event('change'));

  wireSearchableSelect('cf-customer', { newNameInputId: 'cf-new-customer-name' });
  document.getElementById('cf-customer').addEventListener('change', (e) => {
    document.getElementById('cf-new-customer-row').classList.toggle('hidden', e.target.value !== '__new__');
    if (e.target.value === '__new__') document.getElementById('cf-new-customer-name').focus();
  });

  document.getElementById('cf-add-customer-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('cf-new-customer-name');
    const customerMsg = document.getElementById('cf-customer-msg');
    const name = nameInput.value.trim();
    customerMsg.innerHTML = '';
    if (!name) return;
    try {
      await api('POST', '/api/customers', { name });
      await loadCustomers();
      const select = document.getElementById('cf-customer');
      select.innerHTML = `<option value="">— ไม่ระบุ —</option>${customerOptions(state.customers)}<option value="__new__">+ เพิ่มลูกค้าใหม่…</option>`;
      select.value = name;
      select._syncSearchable();
      document.getElementById('cf-new-customer-row').classList.add('hidden');
      nameInput.value = '';
    } catch (err) {
      customerMsg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  document.getElementById('cf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('cf-msg');
    msg.innerHTML = '';
    const customerValue = document.getElementById('cf-customer').value;
    if (customerValue === '__new__') {
      msg.innerHTML = '<p class="msg error">กรุณากด "เพิ่มลูกค้า" ก่อน หรือเลือกลูกค้าที่มีอยู่แล้ว</p>';
      return;
    }
    try {
      await api('POST', '/api/claims', {
        type: 'customer_reject',
        productId: Number(document.getElementById('cf-product').value),
        batchId: document.getElementById('cf-batch').value || null,
        quantity: Number(document.getElementById('cf-qty').value),
        claimDate: document.getElementById('cf-date').value || null,
        counterparty: customerValue || null,
        category: document.getElementById('cf-category').value,
        details: document.getElementById('cf-details').value || null,
      });
      msg.innerHTML = '<p class="msg success">บันทึกรายการเรียบร้อยแล้ว</p>';
      e.target.reset();
      document.getElementById('cf-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('cf-new-customer-row').classList.add('hidden');
      await loadClaims();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  function wireResolutionInputs(root) {
    root.querySelectorAll('.cl-resolution').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/claims/${input.dataset.id}`, { resolutionNote: input.value });
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  async function loadClaims() {
    const claims = await api('GET', '/api/claims');
    const active = claims.filter((c) => c.status !== 'resolved');
    const done = claims.filter((c) => c.status === 'resolved');
    const activeTable = document.getElementById('cl-table');
    const doneTable = document.getElementById('cl-table-done');
    activeTable.innerHTML = buildClaimsTableHTML(active, { showActions: true });
    doneTable.innerHTML = buildClaimsTableHTML(done, { showActions: false });

    wireResolutionInputs(activeTable);
    wireResolutionInputs(doneTable);

    activeTable.querySelectorAll('.cl-reject').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reason = prompt('เหตุผลที่ปฏิเสธทั้งหมด (ไม่มีสินค้าคืนเข้าคลัง):', '');
        if (reason === null) return;
        try {
          await api('PATCH', `/api/claims/${btn.dataset.id}`, {
            status: 'resolved',
            resolutionNote: reason.trim() || 'ปฏิเสธทั้งหมด',
          });
          await loadClaims();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    applyPermissionGates(container);
  }

  await loadClaims();
  enhanceDateInputs(container);
}

// ---------- Purchase orders (ordered, not yet arrived) ----------
const PO_STATUS_LABEL = { pending: 'รอสินค้าเข้า', received: 'รับแล้ว', cancelled: 'ยกเลิก' };

function poStatusOptions(selected) {
  return Object.entries(PO_STATUS_LABEL)
    .map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
}

function buildOrdersTableHTML(orders) {
  const rows = orders.map((o) => `
    <tr>
      <td>${fmtDate(o.order_date)}</td>
      <td>${escapeHtml(o.product_name)} <span class="muted">(${escapeHtml(o.sku_code)})</span></td>
      <td>${escapeHtml(o.supplier || '—')}</td>
      <td class="right">${fmtNum(o.quantity)} ${escapeHtml(o.unit)}</td>
      <td data-requires="edit"><input type="date" class="po-expected" data-id="${o.id}" value="${o.expected_date || ''}" ${o.status !== 'pending' ? 'disabled' : ''}></td>
      <td data-requires="edit"><select class="po-status" data-id="${o.id}" ${o.status === 'received' ? 'disabled' : ''}>${poStatusOptions(o.status)}</select></td>
      <td data-requires="edit"><input type="text" class="po-note" data-id="${o.id}" value="${escapeHtml(o.note || '')}" placeholder="หมายเหตุ" ${o.status !== 'pending' ? 'disabled' : ''}></td>
      <td class="muted">${escapeHtml(o.user_name || '')}</td>
      <td data-requires="create">${o.status === 'pending' ? `<a href="#/receive?poId=${o.id}" class="secondary" style="display:inline-block;text-decoration:none;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12.5px;white-space:nowrap">รับเข้าคลัง</a>` : '<span class="muted">—</span>'}</td>
    </tr>`).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>วันที่สั่ง</th><th>สินค้า</th><th>ซัพพลายเออร์</th><th class="right">จำนวน</th>
            <th>คาดว่าจะถึง</th><th>สถานะ</th><th>หมายเหตุ</th><th>บันทึกโดย</th><th></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="9" class="muted">ยังไม่มีรายการสั่งซื้อ</td></tr>'}</tbody>
      </table>
    </div>`;
}

async function renderOrders(container) {
  await loadProducts();
  container.innerHTML = `
    <h2>สั่งซื้อ (ของที่สั่งไปแล้วกำลังเข้า)</h2>
    <p class="muted">บันทึกรายการที่สั่งซื้อจากซัพพลายเออร์ไว้ล่วงหน้า เพื่อติดตามว่าอะไรกำลังจะเข้าคลัง
      เมื่อของมาถึงจริง กดปุ่ม "รับเข้าคลัง" เพื่อไปหน้ารับสินค้าเข้าพร้อมข้อมูลกรอกให้อัตโนมัติ</p>
    <div class="card" data-requires="create">
      <h3>สั่งซื้อรายการใหม่</h3>
      <form id="of-form" class="stack">
        <div class="form-row">
          <label class="field">ซัพพลายเออร์
            <select id="of-product-supplier">${brandFilterOptionsHTML(state.products)}</select>
          </label>
          <label class="field">สินค้า
            <select id="of-product" required>${productOptions(state.products)}</select>
          </label>
        </div>
        <div class="form-row">
          <label class="field">จำนวนที่สั่ง
            <input type="number" id="of-qty" step="any" min="0.01" required>
          </label>
          <label class="field">วันที่สั่งซื้อ
            <input type="date" id="of-date" value="${new Date().toISOString().slice(0, 10)}">
          </label>
        </div>
        <label class="field">คาดว่าจะถึง (ไม่บังคับ)
          <input type="date" id="of-expected">
        </label>
        <label class="field">หมายเหตุ
          <textarea id="of-note" rows="2"></textarea>
        </label>
        <button type="submit" class="primary">บันทึกรายการสั่งซื้อ</button>
        <div id="of-msg"></div>
      </form>
    </div>
    <div class="card">
      <div class="filters">
        <label class="field">สถานะ
          <select id="off-status">
            <option value="">ทั้งหมด</option>
            ${Object.entries(PO_STATUS_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </label>
        <button id="off-apply" class="secondary">กรอง</button>
      </div>
      <div class="table-wrap" id="of-table"><p class="muted">กำลังโหลด…</p></div>
    </div>
  `;

  wireSupplierProductCascade(
    document.getElementById('of-product-supplier'),
    document.getElementById('of-product'),
    state.products
  );

  document.getElementById('of-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('of-msg');
    msg.innerHTML = '';
    try {
      const productId = Number(document.getElementById('of-product').value);
      const product = state.products.find((p) => p.id === productId);
      const supplierValue = document.getElementById('of-product-supplier').value || (product && product.brand) || null;
      await api('POST', '/api/purchase-orders', {
        productId,
        quantity: Number(document.getElementById('of-qty').value),
        orderDate: document.getElementById('of-date').value || null,
        expectedDate: document.getElementById('of-expected').value || null,
        supplier: supplierValue,
        note: document.getElementById('of-note').value || null,
      });
      msg.innerHTML = '<p class="msg success">บันทึกรายการสั่งซื้อเรียบร้อยแล้ว</p>';
      e.target.reset();
      document.getElementById('of-date').value = new Date().toISOString().slice(0, 10);
      await loadOrders();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  async function loadOrders() {
    const params = new URLSearchParams();
    const status = document.getElementById('off-status').value;
    if (status) params.set('status', status);
    const orders = await api('GET', `/api/purchase-orders?${params.toString()}`);
    document.getElementById('of-table').innerHTML = buildOrdersTableHTML(orders);

    document.querySelectorAll('.po-status').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/purchase-orders/${sel.dataset.id}`, { status: sel.value });
          await loadOrders();
        } catch (err) {
          alert(err.message);
        }
      });
    });
    document.querySelectorAll('.po-expected').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/purchase-orders/${input.dataset.id}`, { expectedDate: input.value });
        } catch (err) {
          alert(err.message);
        }
      });
    });
    document.querySelectorAll('.po-note').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/purchase-orders/${input.dataset.id}`, { note: input.value });
        } catch (err) {
          alert(err.message);
        }
      });
    });
    applyPermissionGates(container);
    enhanceDateInputs(container);
  }

  document.getElementById('off-apply').addEventListener('click', loadOrders);
  await loadOrders();
}

// ---------- Products ----------
// Domino/General/Rynan/Weber always appear even with zero current SKUs (they're the standing
// distributor list); anything else found on real products is appended alphabetically after.
function orderedBrandList(products) {
  const known = new Set([...BRAND_ORDER, ...products.map((p) => p.brand).filter(Boolean)]);
  const ordered = BRAND_ORDER.filter((b) => known.has(b));
  const rest = [...known].filter((b) => !BRAND_ORDER.includes(b)).sort();
  return [...ordered, ...rest];
}

async function renderProducts(container) {
  const products = await api('GET', '/api/products?includeArchived=1');
  const editable = canEdit();
  const brands = orderedBrandList(products);
  const brandRowOptionsHTML = (selected) => brands.map((b) => `<option value="${escapeHtml(b)}" ${b === selected ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');

  function buildRow(p) {
    return `
    <tr>
      <td>${editable ? `<input type="text" class="pf-sku" data-id="${p.id}" value="${escapeHtml(p.sku_code)}" style="min-width:110px">` : escapeHtml(p.sku_code)}</td>
      <td>${editable ? `<input type="text" class="pf-name" data-id="${p.id}" value="${escapeHtml(p.name)}" style="min-width:160px">` : escapeHtml(p.name)}</td>
      <td>${editable ? `<select class="pf-row-brand" data-id="${p.id}" style="min-width:110px"><option value="">— ไม่ระบุ —</option>${brandRowOptionsHTML(p.brand)}</select>` : escapeHtml(p.brand || '')}</td>
      <td>${editable ? `<input type="text" class="pf-unit" data-id="${p.id}" value="${escapeHtml(p.unit)}" style="width:70px">` : escapeHtml(p.unit)}</td>
      <td data-requires="edit">
        <input type="number" class="pf-reorder-level" data-id="${p.id}" value="${p.reorder_level}" step="any" min="0" style="width:80px">
        <br><a href="#/demand-planning?productId=${p.id}" style="font-size:12px">ดูลูกค้า →</a>
      </td>
      <td data-requires="edit"><input type="number" class="pf-leadtime" data-id="${p.id}" value="${p.lead_time_days}" min="0" style="width:70px"></td>
      <td>${p.archived ? '<span class="badge low">เก็บถาวร</span>' : '<span class="badge ok">ใช้งานอยู่</span>'}</td>
      <td style="white-space:nowrap">${editable ? `
        <button class="secondary toggle-archive" data-id="${p.id}" data-archived="${p.archived}">${p.archived ? 'เลิกเก็บถาวร' : 'เก็บถาวร'}</button>
        <button type="button" class="secondary pf-delete-btn" data-id="${p.id}" data-name="${escapeHtml(p.name)}">ลบ</button>
      ` : ''}</td>
    </tr>`;
  }

  const THEAD = '<thead><tr><th>รหัส SKU</th><th>ชื่อ</th><th>ซัพพลายเออร์</th><th>หน่วย</th><th>จุดสั่งซื้อ</th><th>ระยะเวลาส่งของ (วัน)</th><th>สถานะ</th><th></th></tr></thead>';
  const sections = groupByBrand(products).map(([brand, group]) => `
    <div class="card">
      <h3>${escapeHtml(brand)} <span class="muted" style="font-weight:400;font-size:13px">(${group.length} SKU)</span></h3>
      <div class="table-wrap">
        <table>
          ${THEAD}
          <tbody>${group.map(buildRow).join('')}</tbody>
        </table>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <h2>สินค้า</h2>
    <div class="card" data-requires="create">
      <h3>เพิ่ม SKU หมึกใหม่</h3>
      <form id="pf-form" class="stack">
        <div class="form-row">
          <label class="field">รหัส SKU <input type="text" id="pf-sku" required></label>
          <label class="field">ชื่อ <input type="text" id="pf-name" required></label>
        </div>
        <div class="form-row">
          <label class="field">ซัพพลายเออร์
            <div class="searchable-select">
              <input type="text" class="ss-input" id="pf-brand-search" placeholder="เลือกซัพพลายเออร์" autocomplete="off">
              <div class="ss-list hidden" id="pf-brand-list"></div>
              <select id="pf-brand" class="hidden">
                <option value="">— ไม่ระบุ —</option>
                ${brandRowOptionsHTML(null)}
                <option value="__new__">+ เพิ่มซัพพลายเออร์ใหม่…</option>
              </select>
            </div>
          </label>
          <label class="field">หน่วย <input type="text" id="pf-unit" value="ตลับ"></label>
        </div>
        <div class="form-row hidden" id="pf-new-brand-row">
          <label class="field">ชื่อซัพพลายเออร์ใหม่ <input type="text" id="pf-new-brand-name"></label>
        </div>
        <div class="form-row">
          <label class="field">จุดสั่งซื้อ <input type="number" id="pf-reorder" step="any" value="0"></label>
          <label class="field">ระยะเวลาส่งของจากซัพพลายเออร์ (วัน) <input type="number" id="pf-leadtime" min="0" value="30"></label>
        </div>
        <button type="submit" class="primary">เพิ่มสินค้า</button>
        <div id="pf-msg"></div>
      </form>
    </div>
    <p class="muted">จุดสั่งซื้อและระยะเวลาส่งของจะถูกใช้ในการพยากรณ์การสั่งซื้อที่แดชบอร์ด — การแก้ไขจะถูกบันทึกอัตโนมัติ — ตารางด้านล่างแยกตามซัพพลายเออร์</p>
    ${sections || '<div class="card"><p class="muted">ยังไม่มีสินค้า</p></div>'}
  `;

  wireSearchableSelect('pf-brand', { newNameInputId: 'pf-new-brand-name' });
  document.getElementById('pf-brand').addEventListener('change', (e) => {
    document.getElementById('pf-new-brand-row').classList.toggle('hidden', e.target.value !== '__new__');
    if (e.target.value === '__new__') document.getElementById('pf-new-brand-name').focus();
  });

  function resolveNewProductBrand() {
    const sel = document.getElementById('pf-brand').value;
    if (sel === '__new__') return document.getElementById('pf-new-brand-name').value.trim() || null;
    return sel || null;
  }

  document.getElementById('pf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pf-msg');
    msg.innerHTML = '';
    try {
      await api('POST', '/api/products', {
        skuCode: document.getElementById('pf-sku').value.trim(),
        name: document.getElementById('pf-name').value.trim(),
        brand: resolveNewProductBrand(),
        unit: document.getElementById('pf-unit').value || 'unit',
        reorderLevel: Number(document.getElementById('pf-reorder').value) || 0,
        leadTimeDays: Number(document.getElementById('pf-leadtime').value) || 30,
      });
      msg.innerHTML = '<p class="msg success">เพิ่มสินค้าเรียบร้อยแล้ว</p>';
      await loadProducts();
      route();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  container.querySelectorAll('.pf-leadtime').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/products/${input.dataset.id}/forecast-settings`, { leadTimeDays: Number(input.value) || 0 });
      } catch (err) {
        alert(err.message);
      }
    });
  });
  container.querySelectorAll('.pf-reorder-level').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/products/${input.dataset.id}/forecast-settings`, { reorderLevel: Number(input.value) || 0 });
      } catch (err) {
        alert(err.message);
      }
    });
  });

  container.querySelectorAll('.toggle-archive').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const archived = btn.dataset.archived === '1';
      await api('PUT', `/api/products/${btn.dataset.id}`, { archived: !archived });
      await loadProducts();
      route();
    });
  });

  // Brand determines which section a row lives in, so re-render the whole page on change
  // (unlike sku/name/unit below, which can just keep whatever the input already shows).
  container.querySelectorAll('.pf-row-brand').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api('PUT', `/api/products/${select.dataset.id}`, { brand: select.value || null });
        await loadProducts();
        route();
      } catch (err) {
        alert(err.message);
        route();
      }
    });
  });

  const PF_FIELD_BY_CLASS = { 'pf-sku': 'skuCode', 'pf-name': 'name', 'pf-unit': 'unit' };
  container.querySelectorAll('.pf-sku, .pf-name, .pf-unit').forEach((input) => {
    input.addEventListener('change', async () => {
      const field = PF_FIELD_BY_CLASS[[...input.classList].find((c) => PF_FIELD_BY_CLASS[c])];
      try {
        await api('PUT', `/api/products/${input.dataset.id}`, { [field]: input.value });
        await loadProducts();
      } catch (err) {
        alert(err.message);
        route();
      }
    });
  });

  container.querySelectorAll('.pf-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`ลบสินค้า "${btn.dataset.name}" ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`)) return;
      try {
        await api('DELETE', `/api/products/${btn.dataset.id}`);
        await loadProducts();
        route();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  applyPermissionGates(container);
}

// ---------- Safety stock / demand planning ----------
// Per-product worksheet: which customers are driving a product's usage, at what rate, so staff
// can see the "why" behind safety stock instead of guessing a single number — see conversation
// re: painpoints when a customer switches SKU or a new customer starts buying.
async function renderDemandPlanning(container) {
  await loadCustomers();
  const preselectId = getHashQuery().get('productId') || '';

  container.innerHTML = `
    <h2>คำนวณ Safety Stock</h2>
    <div class="card">
      <div class="filters">
        <label class="field">สินค้า
          <select id="dp-product"><option value="">— เลือกสินค้า —</option>${productOptions(state.products)}</select>
        </label>
      </div>
      <div id="dp-body"><p class="muted">เลือกสินค้าเพื่อดูรายละเอียดลูกค้าและอัตราการใช้</p></div>
    </div>
  `;

  const productSelect = document.getElementById('dp-product');
  if (preselectId) productSelect.value = preselectId;
  productSelect.addEventListener('change', loadWorksheet);
  if (preselectId) await loadWorksheet();

  async function loadWorksheet() {
    const productId = productSelect.value;
    const body = document.getElementById('dp-body');
    if (!productId) { body.innerHTML = '<p class="muted">เลือกสินค้าเพื่อดูรายละเอียดลูกค้าและอัตราการใช้</p>'; return; }
    body.innerHTML = '<p class="muted">กำลังโหลด…</p>';
    try {
      const data = await api('GET', `/api/demand/${productId}`);
      renderWorksheet(body, data);
    } catch (err) {
      body.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  }

  function renderWorksheet(body, data) {
    const { product, rows, totalMonthlyUsage } = data;
    const rowsHtml = rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.customerName)}${r.assignedTo ? `<br><span class="muted">พนักงานขาย: ${escapeHtml(r.assignedTo)}</span>` : ''}</td>
        <td class="right">${r.actualMonthlyUsage > 0 ? `${fmtNum(r.actualMonthlyUsage)} ${escapeHtml(product.unit)}` : '<span class="muted">— ยังไม่มีประวัติ</span>'}</td>
        <td class="right" data-requires="edit">
          <input type="number" class="dp-override" data-customer="${escapeHtml(r.customerName)}" step="any" min="0"
            placeholder="${r.actualMonthlyUsage > 0 ? Math.round(r.actualMonthlyUsage) : '0'}"
            value="${r.overrideMonthlyUsage != null ? r.overrideMonthlyUsage : ''}" style="width:100px">
        </td>
        <td class="right">
          <strong>${fmtNum(r.effectiveMonthlyUsage)} ${escapeHtml(product.unit)}</strong>
          ${r.overrideMonthlyUsage != null && r.actualMonthlyUsage > 0 ? ' <span class="badge warning">ปรับเอง</span>' : ''}
          ${r.overrideMonthlyUsage != null && r.actualMonthlyUsage === 0 ? ' <span class="badge none">คาดการณ์</span>' : ''}
        </td>
        <td data-requires="edit">${r.estimateId ? `<button type="button" class="secondary dp-clear" data-id="${r.estimateId}">ล้างค่า</button>` : ''}</td>
      </tr>`).join('');

    body.innerHTML = `
      <p class="muted">รายชื่อลูกค้าที่เบิก "${escapeHtml(product.name)}" ในช่วง 90 วันล่าสุด พร้อมอัตราการใช้เฉลี่ยต่อเดือน — ปรับตัวเลขในช่อง "คาดการณ์เอง" ได้ถ้าคิดว่าลูกค้ารายนั้นจะสั่งมากขึ้น/น้อยลง หรือเพิ่มลูกค้าใหม่ที่ยังไม่มีประวัติด้านล่าง แล้วกดใช้ยอดรวมเป็น safety stock</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ลูกค้า</th><th class="right">การใช้จริง/เดือน (90 วันล่าสุด)</th><th class="right" data-requires="edit">คาดการณ์เอง/เดือน</th><th class="right">ใช้คำนวณ</th><th data-requires="edit"></th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="5" class="muted">ยังไม่มีประวัติลูกค้าสำหรับสินค้านี้ — เพิ่มลูกค้าคาดการณ์ได้ด้านล่าง</td></tr>'}</tbody>
          <tfoot><tr>
            <td colspan="2" class="right"><strong>รวมคาดการณ์การใช้/เดือน</strong></td>
            <td data-requires="edit"></td>
            <td class="right"><strong>${fmtNum(totalMonthlyUsage)} ${escapeHtml(product.unit)}</strong></td>
            <td data-requires="edit"></td>
          </tr></tfoot>
        </table>
      </div>
      <div class="card" data-requires="edit" style="margin-top:14px">
        <h3>เพิ่มลูกค้าใหม่ (คาดการณ์)</h3>
        <div class="form-row">
          <label class="field">ชื่อลูกค้า
            <input type="text" id="dp-new-name" list="dp-customer-list" placeholder="พิมพ์ชื่อลูกค้า" autocomplete="off">
            <datalist id="dp-customer-list">${state.customers.map((c) => `<option value="${escapeHtml(c.name)}">`).join('')}</datalist>
          </label>
          <label class="field">คาดการณ์การใช้/เดือน
            <input type="number" id="dp-new-qty" step="any" min="0">
          </label>
          <button type="button" id="dp-add-btn" class="secondary" style="align-self:flex-end">เพิ่ม</button>
        </div>
        <div id="dp-add-msg"></div>
      </div>
      <div class="card" data-requires="edit" style="margin-top:14px">
        <p>Safety stock ปัจจุบันของ "${escapeHtml(product.name)}": <strong>${fmtNum(product.reorderLevel)} ${escapeHtml(product.unit)}</strong></p>
        <button type="button" id="dp-apply-btn" class="primary">ใช้ยอดรวม ${fmtNum(totalMonthlyUsage)} ${escapeHtml(product.unit)} เป็น Safety Stock ใหม่</button>
        <div id="dp-apply-msg"></div>
      </div>
    `;

    body.querySelectorAll('.dp-override').forEach((input) => {
      input.addEventListener('change', async () => {
        const val = input.value.trim();
        try {
          if (val === '') {
            const row = rows.find((r) => r.customerName === input.dataset.customer);
            if (row && row.estimateId) await api('DELETE', `/api/demand/estimate/${row.estimateId}`);
          } else {
            await api('PUT', `/api/demand/${product.id}/customer`, {
              customerName: input.dataset.customer,
              predictedMonthlyUsage: Number(val),
            });
          }
          await loadWorksheet();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    body.querySelectorAll('.dp-clear').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('DELETE', `/api/demand/estimate/${btn.dataset.id}`);
          await loadWorksheet();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    const addBtn = document.getElementById('dp-add-btn');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const msg = document.getElementById('dp-add-msg');
      msg.innerHTML = '';
      const name = document.getElementById('dp-new-name').value.trim();
      const qty = Number(document.getElementById('dp-new-qty').value);
      if (!name || !qty || qty <= 0) {
        msg.innerHTML = '<p class="msg error">กรุณากรอกชื่อลูกค้าและจำนวนที่มากกว่า 0</p>';
        return;
      }
      try {
        await api('PUT', `/api/demand/${product.id}/customer`, { customerName: name, predictedMonthlyUsage: qty });
        await loadWorksheet();
      } catch (err) {
        msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
      }
    });

    const applyBtn = document.getElementById('dp-apply-btn');
    if (applyBtn) applyBtn.addEventListener('click', async () => {
      const msg = document.getElementById('dp-apply-msg');
      msg.innerHTML = '';
      const newLevel = Math.round(totalMonthlyUsage);
      if (!confirm(`ตั้งค่า Safety Stock ของ "${product.name}" เป็น ${fmtNum(newLevel)} ${product.unit} ใช่หรือไม่?`)) return;
      try {
        await api('PATCH', `/api/products/${product.id}/forecast-settings`, { reorderLevel: newLevel });
        await loadProducts();
        msg.innerHTML = '<p class="msg success">อัปเดต Safety Stock เรียบร้อยแล้ว</p>';
      } catch (err) {
        msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
      }
    });

    applyPermissionGates(body);
  }
}

// ---------- Customers ----------
async function renderCustomers(container) {
  const customers = await api('GET', '/api/customers?includeArchived=1');
  const editable = canEdit();

  const rows = customers.map((c) => `
    <tr>
      <td>${editable ? `<input type="text" class="cu-name" data-id="${c.id}" value="${escapeHtml(c.name)}" style="min-width:180px">` : escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone || '')}</td>
      <td>${escapeHtml(c.contact_person || '')}</td>
      <td class="muted">${escapeHtml(c.address || '')}</td>
      <td>${editable ? `<input type="text" class="cu-assigned" data-id="${c.id}" value="${escapeHtml(c.assigned_to || '')}" placeholder="ไม่ระบุ">` : escapeHtml(c.assigned_to || '')}</td>
      <td>${c.archived ? '<span class="badge low">เก็บถาวร</span>' : '<span class="badge ok">ใช้งานอยู่</span>'}</td>
      <td data-requires="edit" style="white-space:nowrap">
        <button class="secondary toggle-customer-archive" data-id="${c.id}" data-archived="${c.archived}">${c.archived ? 'เลิกเก็บถาวร' : 'เก็บถาวร'}</button>
        <button type="button" class="secondary cu-delete-btn" data-id="${c.id}" data-name="${escapeHtml(c.name)}">ลบ</button>
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <h2>ลูกค้า</h2>
    <div class="card" data-requires="create">
      <h3>เพิ่มลูกค้าใหม่</h3>
      <form id="cu-form" class="stack">
        <div class="form-row">
          <label class="field">ชื่อลูกค้า/บริษัท <input type="text" id="cu-name" required></label>
          <label class="field">เบอร์โทร <input type="text" id="cu-phone"></label>
        </div>
        <div class="form-row">
          <label class="field">ผู้ติดต่อ <input type="text" id="cu-contact"></label>
          <label class="field">พนักงานขายที่ดูแล <input type="text" id="cu-assigned-new" placeholder="ไม่บังคับ"></label>
        </div>
        <label class="field">ที่อยู่ <textarea id="cu-address" rows="2"></textarea></label>
        <label class="field">หมายเหตุ <textarea id="cu-note" rows="2"></textarea></label>
        <button type="submit" class="primary">เพิ่มลูกค้า</button>
        <div id="cu-msg"></div>
      </form>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ชื่อลูกค้า/บริษัท</th><th>เบอร์โทร</th><th>ผู้ติดต่อ</th><th>ที่อยู่</th><th>พนักงานขายที่ดูแล</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">ยังไม่มีลูกค้า</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('cu-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('cu-msg');
    msg.innerHTML = '';
    try {
      await api('POST', '/api/customers', {
        name: document.getElementById('cu-name').value.trim(),
        phone: document.getElementById('cu-phone').value || null,
        contactPerson: document.getElementById('cu-contact').value || null,
        address: document.getElementById('cu-address').value || null,
        assignedTo: document.getElementById('cu-assigned-new').value || null,
        note: document.getElementById('cu-note').value || null,
      });
      msg.innerHTML = '<p class="msg success">เพิ่มลูกค้าเรียบร้อยแล้ว</p>';
      route();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  container.querySelectorAll('.cu-assigned').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/customers/${input.dataset.id}`, { assignedTo: input.value || null });
      } catch (err) {
        alert(err.message);
      }
    });
  });

  container.querySelectorAll('.cu-name').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/customers/${input.dataset.id}`, { name: input.value });
      } catch (err) {
        alert(err.message);
        route();
      }
    });
  });

  container.querySelectorAll('.toggle-customer-archive').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const archived = btn.dataset.archived === '1';
      await api('PATCH', `/api/customers/${btn.dataset.id}`, { archived: !archived });
      route();
    });
  });

  container.querySelectorAll('.cu-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`ลบลูกค้า "${btn.dataset.name}" ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`)) return;
      try {
        await api('DELETE', `/api/customers/${btn.dataset.id}`);
        route();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  applyPermissionGates(container);
}

// ---------- Users (admin) ----------
async function renderUsers(container) {
  if (state.user.role !== 'admin') {
    container.innerHTML = '<p class="msg error">ต้องใช้สิทธิ์ผู้ดูแลระบบ</p>';
    return;
  }
  const users = await api('GET', '/api/users');
  const roleOptions = (selected) => `
    <option value="admin" ${selected === 'admin' ? 'selected' : ''}>ผู้ดูแลระบบ</option>
    <option value="editor" ${selected === 'editor' ? 'selected' : ''}>กรอก + แก้ไข</option>
    <option value="creator" ${selected === 'creator' ? 'selected' : ''}>กรอกได้อย่างเดียว</option>
    <option value="viewer" ${selected === 'viewer' ? 'selected' : ''}>ดูอย่างเดียว</option>`;
  const rows = users.map((u) => {
    const isSelf = u.id === state.user.id;
    const pwRowId = `uf-pw-${u.id}`;
    return `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td><select class="uf-role-select" data-id="${u.id}" ${isSelf ? 'disabled title="แก้ไขบทบาทของตัวเองไม่ได้"' : ''}>${roleOptions(u.role)}</select></td>
      <td>${u.active ? '<span class="badge ok">ใช้งานอยู่</span>' : '<span class="badge low">ปิดใช้งาน</span>'}</td>
      <td style="white-space:nowrap">
        <button class="secondary toggle-active" data-id="${u.id}" data-active="${u.active}" ${isSelf ? 'disabled title="ปิดใช้งานบัญชีตัวเองไม่ได้"' : ''}>${u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
        <button type="button" class="secondary uf-reset-pw-btn" data-target="${pwRowId}">รีเซ็ตรหัสผ่าน</button>
        <button type="button" class="secondary uf-delete-btn" data-id="${u.id}" data-username="${escapeHtml(u.username)}" ${isSelf ? 'disabled title="ลบบัญชีตัวเองไม่ได้"' : ''}>ลบ</button>
      </td>
    </tr>
    <tr class="hidden" id="${pwRowId}">
      <td colspan="4">
        <div class="form-row" style="align-items:flex-end;max-width:420px">
          <label class="field">ตั้งรหัสผ่านใหม่ให้ ${escapeHtml(u.username)} (อย่างน้อย 6 ตัวอักษร)
            <input type="password" class="uf-new-pw" minlength="6">
          </label>
          <button type="button" class="primary uf-save-pw-btn" data-id="${u.id}">บันทึก</button>
        </div>
        <div class="uf-pw-msg"></div>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <h2>บัญชีพนักงาน</h2>
    <p class="muted">
      <strong>สิทธิ์การใช้งาน:</strong> ผู้ดูแลระบบ — ทำได้ทุกอย่างรวมถึงจัดการบัญชีผู้ใช้ ·
      กรอก + แก้ไข — เพิ่มและแก้ไขข้อมูลได้ทุกส่วน (ยกเว้นจัดการบัญชีผู้ใช้) ·
      กรอกได้อย่างเดียว — เพิ่มข้อมูลใหม่ได้ แต่แก้ไขรายการเดิมไม่ได้ ·
      ดูอย่างเดียว — ดูข้อมูลได้อย่างเดียว เพิ่ม/แก้ไขไม่ได้
    </p>
    <div class="card">
      <h3>เพิ่มบัญชีพนักงาน</h3>
      <form id="uf-form" class="stack">
        <div class="form-row">
          <label class="field">ชื่อผู้ใช้ <input type="text" id="uf-username" required></label>
          <label class="field">รหัสผ่าน <input type="password" id="uf-password" minlength="6" required></label>
        </div>
        <label class="field">บทบาท
          <select id="uf-role">${roleOptions('creator')}</select>
        </label>
        <button type="submit" class="primary">สร้างบัญชี</button>
        <div id="uf-msg"></div>
      </form>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ชื่อผู้ใช้</th><th>บทบาท</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('uf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('uf-msg');
    msg.innerHTML = '';
    try {
      await api('POST', '/api/users', {
        username: document.getElementById('uf-username').value.trim(),
        password: document.getElementById('uf-password').value,
        role: document.getElementById('uf-role').value,
      });
      msg.innerHTML = '<p class="msg success">สร้างบัญชีเรียบร้อยแล้ว</p>';
      route();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  container.querySelectorAll('.uf-role-select').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/users/${select.dataset.id}/role`, { role: select.value });
      } catch (err) {
        alert(err.message);
        route();
      }
    });
  });

  container.querySelectorAll('.toggle-active').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const active = btn.dataset.active === '1';
      await api('PUT', `/api/users/${btn.dataset.id}/active`, { active: !active });
      route();
    });
  });

  container.querySelectorAll('.uf-reset-pw-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.target).classList.toggle('hidden');
    });
  });

  container.querySelectorAll('.uf-save-pw-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const input = row.querySelector('.uf-new-pw');
      const msg = row.querySelector('.uf-pw-msg');
      msg.innerHTML = '';
      try {
        await api('PATCH', `/api/users/${btn.dataset.id}/password`, { newPassword: input.value });
        msg.innerHTML = '<p class="msg success">ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว</p>';
        input.value = '';
      } catch (err) {
        msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
      }
    });
  });

  container.querySelectorAll('.uf-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`ลบบัญชี "${btn.dataset.username}" ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`)) return;
      try {
        await api('DELETE', `/api/users/${btn.dataset.id}`);
        route();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// ---------- Account ----------
// ---------- คำนวณวันหมดอายุ (expiry calculator, browser-only, nothing is saved) ----------
const EXPIRY_MIN_MONTHS = 4;


// Local calendar date at noon (avoids any day-boundary drift when adding days).
function calDate(y, m, d) { return new Date(y, m - 1, d, 12); }
function todayCal() { const n = new Date(); return calDate(n.getFullYear(), n.getMonth() + 1, n.getDate()); }
function addDaysCal(dt, n) { return calDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate() + n); }
// Same day N months later; clamps to the month's last day (31 Oct + 4 months → 28/29 Feb).
function addMonthsCal(dt, n) {
  const y = dt.getFullYear(); const m = dt.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(dt.getDate(), last), 12);
}
function daysBetweenCal(a, b) { return Math.round((b - a) / 86400000); }
// This page writes dates the way labels do, in ค.ศ.: with a day "13/03/27", month only "4/27".
function fmtCalDay(dt) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${p(dt.getFullYear() % 100)}`;
}
function fmtCalMonth(dt) {
  return `${dt.getMonth() + 1}/${String(dt.getFullYear() % 100).padStart(2, '0')}`;
}
// A month-only label means the 1st of that month, so the month-only version of a date is the
// first month whose 1st is on or after it (13/03/27 → 4/27; 01/04/27 → 4/27).
function monthOnOrAfter(dt) {
  return dt.getDate() === 1 ? dt : calDate(dt.getFullYear(), dt.getMonth() + 2, 1);
}

// Year as printed on labels: 4 digits (≥2400 = พ.ศ.) or 2 digits (00–49 = ค.ศ. 20xx, 50–99 = พ.ศ. 25xx).
function expiryYear(s) {
  const n = Number(s);
  if (s.length === 4) return n >= 2400 ? n - 543 : n;
  return n >= 50 ? 2500 + n - 543 : 2000 + n;
}

// Accepts d/m/yy, d/m/yyyy, m/yy, m/yyyy (separators / - . or space), or yyyy-mm-dd.
// Returns { date, dayGiven } or { error }.
function parseExpiryInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return { error: '' };
  let y; let m; let d; let dayGiven = true;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) { y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3]); if (y >= 2400) y -= 543; }
  else if ((mt = s.match(/^(\d{1,2})\s*[/\-. ]\s*(\d{1,2})\s*[/\-. ]\s*(\d{2}|\d{4})$/))) {
    d = Number(mt[1]); m = Number(mt[2]); y = expiryYear(mt[3]);
  } else if ((mt = s.match(/^(\d{1,2})\s*[/\-. ]\s*(\d{2}|\d{4})$/))) {
    m = Number(mt[1]); y = expiryYear(mt[2]); d = 1; dayGiven = false;
  } else {
    return { error: 'รูปแบบไม่ถูกต้อง — กรอกเป็น วัน/เดือน/ปี (เช่น 15/3/26) หรือ เดือน/ปี (เช่น 3/26)' };
  }
  if (m < 1 || m > 12) return { error: 'เดือนต้องอยู่ระหว่าง 1–12' };
  const last = new Date(y, m, 0).getDate();
  if (d < 1 || d > last) return { error: `เดือนนี้มีแค่ ${last} วัน` };
  return { date: calDate(y, m, d), dayGiven };
}

async function renderExpiryCalc(container) {
  const today = todayCal();
  const target = addMonthsCal(today, EXPIRY_MIN_MONTHS);
  container.innerHTML = `
    <h2>คำนวณวันหมดอายุ</h2>
    <div class="card stack" style="max-width:640px">
      <label class="field">วันหมดอายุบนฉลาก
        <input type="text" id="exp-input" inputmode="numeric" autocomplete="off" placeholder="เช่น 15/3/26 หรือ 3/26">
      </label>
      <p class="muted" style="margin:0">วันนี้: <strong>${escapeHtml(fmtCalDay(today))}</strong> · ครบ ${EXPIRY_MIN_MONTHS} เดือนจากวันนี้ = <strong>${escapeHtml(fmtCalDay(target))}</strong></p>
      <div id="exp-result" aria-live="polite"></div>
      <div id="exp-extend" class="hidden stack">
        <label class="field">ต้องการบวกอีกกี่วัน
          <input type="number" id="exp-add" min="0" step="1" inputmode="numeric">
        </label>
        <div id="exp-new"></div>
      </div>
    </div>
    <div class="card" style="max-width:640px;margin-top:14px">
      <strong>หมายเหตุ</strong>
      <ul style="margin:8px 0 0;padding-left:20px" class="muted">
        <li>ถ้ากรอกแค่เดือน/ปี (เช่น 3/26) ระบบจะนับว่าหมดอายุ <strong>วันที่ 1 ของเดือนนั้น</strong> (3/26 = 01/03/26) ตามที่ลูกค้านับ</li>
        <li>เกณฑ์ ${EXPIRY_MIN_MONTHS} เดือน นับตามปฏิทินจากวันนี้ (วันที่เดียวกันในอีก ${EXPIRY_MIN_MONTHS} เดือน)</li>
        <li>ปี 2 หลัก: 00–49 อ่านเป็น ค.ศ. 20xx (26 = 2026), 50–99 อ่านเป็น พ.ศ. 25xx (69 = 2569) · ปี 4 หลักกรอกได้ทั้ง ค.ศ. และ พ.ศ.</li>
        <li>หน้านี้คำนวณอย่างเดียว ไม่ได้บันทึกหรือแก้ข้อมูลในระบบ</li>
      </ul>
    </div>`;

  const input = document.getElementById('exp-input');
  const result = document.getElementById('exp-result');
  const extend = document.getElementById('exp-extend');
  const addInput = document.getElementById('exp-add');
  const newBox = document.getElementById('exp-new');
  let current = null;

  function renderNew() {
    if (!current) return;
    const n = Math.max(0, Math.floor(Number(addInput.value) || 0));
    const newDate = addDaysCal(current, n);
    const ok = newDate >= target;
    const stillShort = daysBetweenCal(newDate, target);
    const monthDate = monthOnOrAfter(newDate);
    const monthAdd = daysBetweenCal(current, monthDate);
    newBox.innerHTML = `
      <div class="exp-new-box ${ok ? 'is-ok' : 'is-short'}">
        <div class="exp-new-label">วันหมดอายุใหม่ ${n ? `(บวก ${n} วัน)` : '(ไม่ต้องบวก)'}</div>
        <div class="exp-new-options">
          <div>
            <div class="exp-new-kind">แบบมีวัน</div>
            <div class="exp-new-date">${escapeHtml(fmtCalDay(newDate))}</div>
          </div>
          <div>
            <div class="exp-new-kind">แบบเดือน/ปี</div>
            <div class="exp-new-date">${escapeHtml(fmtCalMonth(monthDate))}</div>
            <div class="exp-new-short">= ${escapeHtml(fmtCalDay(monthDate))}${monthAdd !== n ? ` · บวก ${monthAdd} วัน` : ''}</div>
          </div>
        </div>
        <div class="exp-new-status">${ok
          ? `<span class="badge ok">ครบ ${EXPIRY_MIN_MONTHS} เดือนแล้ว</span> เหลืออีก ${daysBetweenCal(today, newDate)} วัน`
          : `<span class="badge expired">ยังไม่ครบ ${EXPIRY_MIN_MONTHS} เดือน</span> ต้องบวกเพิ่มอีกอย่างน้อย ${stillShort} วัน`}</div>
      </div>`;
  }

  function update() {
    const parsed = parseExpiryInput(input.value);
    current = null;
    if (!parsed.date) {
      result.innerHTML = parsed.error ? `<p class="msg error">${escapeHtml(parsed.error)}</p>` : '';
      extend.classList.add('hidden');
      return;
    }
    current = parsed.date;
    const left = daysBetweenCal(today, current);
    const short = current < target;
    const needDays = Math.max(0, daysBetweenCal(current, target));
    const leftText = left > 0 ? `เหลืออีก <strong>${left}</strong> วันจะหมดอายุ`
      : left === 0 ? '<strong>หมดอายุวันนี้</strong>'
      : `<strong>หมดอายุไปแล้ว ${-left} วัน</strong>`;
    result.innerHTML = `
      <div class="stat-row" style="margin:4px 0 8px">
        <div class="stat-tile ${short ? 'danger' : ''}" style="min-width:220px">
          <div class="num">${left} วัน</div>
          <div class="label">${left >= 0 ? 'ก่อนหมดอายุ' : 'เลยวันหมดอายุมาแล้ว'}</div>
        </div>
      </div>
      <p style="margin:0">หมดอายุ: <strong>${escapeHtml(fmtCalDay(current))}</strong>
        ${parsed.dayGiven ? '' : '<br><span class="muted">ไม่ได้ระบุวัน — นับเป็นวันที่ 1 ของเดือนที่หมดอายุ</span>'}</p>
      <p style="margin:6px 0 0">${leftText}</p>
      <p style="margin:8px 0 0">${short
        ? `<span class="badge expired">น้อยกว่า ${EXPIRY_MIN_MONTHS} เดือน</span> ควรบวกอีก <strong>${needDays}</strong> วัน (ดูวันหมดอายุใหม่ด้านล่าง)`
        : `<span class="badge ok">ครบ ${EXPIRY_MIN_MONTHS} เดือนขึ้นไป</span> ไม่ต้องแก้วันหมดอายุ`}</p>`;
    extend.classList.remove('hidden');
    addInput.value = String(needDays);
    renderNew();
  }

  input.addEventListener('input', update);
  addInput.addEventListener('input', renderNew);
  input.focus();
}

async function renderAccount(container) {
  container.innerHTML = `
    <h2>เปลี่ยนรหัสผ่าน</h2>
    <form id="acc-form" class="stack card">
      <label class="field">รหัสผ่านปัจจุบัน
        <input type="password" id="acc-current" autocomplete="current-password" required>
      </label>
      <label class="field">รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)
        <input type="password" id="acc-new" autocomplete="new-password" minlength="6" required>
      </label>
      <button type="submit" class="primary">อัปเดตรหัสผ่าน</button>
      <div id="acc-msg"></div>
    </form>
  `;

  document.getElementById('acc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('acc-msg');
    msg.innerHTML = '';
    try {
      await api('POST', '/api/change-password', {
        currentPassword: document.getElementById('acc-current').value,
        newPassword: document.getElementById('acc-new').value,
      });
      msg.innerHTML = '<p class="msg success">อัปเดตรหัสผ่านเรียบร้อยแล้ว</p>';
      e.target.reset();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });
}

// ---------- Init ----------
(async function init() {
  try {
    state.user = await api('GET', '/api/me');
    await onLoggedIn();
  } catch {
    showLogin();
  }
})();
