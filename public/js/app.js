const state = {
  user: null,
  products: [],
  suppliers: [],
  customers: [],
};

const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', staff: 'พนักงาน' };
const TYPE_LABEL = { IN: 'รับเข้า', OUT: 'เบิกออก', ADJUST: 'ปรับปรุง' };
const PURPOSE_LABEL = { sale: 'ขาย', trial: 'ทดลอง/ตัวอย่าง' };
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
  receive: renderReceive,
  issue: renderIssue,
  history: renderHistory,
  claims: renderClaims,
  products: renderProducts,
  customers: renderCustomers,
  users: renderUsers,
  account: renderAccount,
};

function route() {
  const hash = location.hash.replace('#/', '') || 'dashboard';
  const viewName = hash.split('?')[0];
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === viewName);
  });
  const container = document.getElementById('view');
  const fn = routes[viewName] || renderDashboard;
  container.innerHTML = '<p class="muted">กำลังโหลด…</p>';
  fn(container).catch((err) => {
    container.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
  });
}
window.addEventListener('hashchange', route);

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function fmtDate(d) { return d || '—'; }
function fmtNum(n) {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
function formatMonthLabel(yyyyMM) {
  const [y, m] = yyyyMM.split('-').map(Number);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${months[m - 1]} ${y}`;
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

// ---------- Dashboard ----------
const FORECAST_STATUS = {
  urgent: { badge: 'expired', label: 'ด่วน' },
  order_soon: { badge: 'critical', label: 'สั่งซื้อเร็วๆ นี้' },
  no_usage_data: { badge: 'none', label: 'ไม่มีข้อมูลการใช้' },
  ok: { badge: 'ok', label: 'ปกติ' },
};

function buildForecastTableHTML(products) {
  const rows = products.map((p) => {
    const st = FORECAST_STATUS[p.status] || FORECAST_STATUS.ok;
    const wasteNote = p.projectedWaste > 0
      ? `<br><span class="muted" style="color:var(--warning)">${fmtNum(p.projectedWaste)} ${escapeHtml(p.unit)} เสี่ยงหมดอายุก่อนใช้</span>`
      : '';
    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong><br><span class="muted">${escapeHtml(p.skuCode)}</span></td>
        <td>${escapeHtml(p.supplierName || '—')}</td>
        <td class="right">${fmtNum(p.avgMonthlyUsage)} ${escapeHtml(p.unit)}${p.usageSource === 'estimated' ? ' <span class="muted">(ประมาณ)</span>' : ''}</td>
        <td class="right">${fmtNum(p.usableStock)} ${escapeHtml(p.unit)}${wasteNote}</td>
        <td class="right">${p.daysOfCover === null ? '—' : `${Math.round(p.daysOfCover)} วัน`}</td>
        <td class="right">${p.leadTimeDays} วัน</td>
        <td class="right"><strong>${fmtNum(p.suggestedOrderQty)} ${escapeHtml(p.unit)}</strong></td>
        <td><span class="badge ${st.badge}">${st.label}</span></td>
      </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>สินค้า</th><th>ซัพพลายเออร์</th><th class="right">ใช้เฉลี่ย/เดือน</th>
            <th class="right">คงเหลือที่ใช้ได้</th><th class="right">จำนวนวันที่ใช้ได้</th>
            <th class="right">ระยะเวลาส่งของ</th><th class="right">แนะนำสั่งซื้อ</th><th>สถานะ</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" class="muted">ไม่มีสินค้าให้พยากรณ์</td></tr>'}</tbody>
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
          <td>${TYPE_LABEL[t.type] || t.type}${t.type === 'OUT' && t.purpose === 'trial' ? ' <span class="badge critical">ทดลอง</span>' : ''}</td>
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
    <div class="card">
      <div class="chart-header">
        <h3>พยากรณ์การสั่งซื้อ</h3>
        <div class="chart-controls">
          <select id="forecast-supplier">
            <option value="">ซัพพลายเออร์ทั้งหมด</option>
            ${brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="muted">ปริมาณที่แนะนำให้สั่งซื้อเพิ่มในเดือนนี้ คำนวณจากอัตราการใช้ล่าสุด วันหมดอายุของสต็อกปัจจุบัน และระยะเวลาส่งของ ตั้งค่าจุดสั่งซื้อและระยะเวลาส่งของแต่ละสินค้าได้ที่หน้า "สินค้า" เพื่อความแม่นยำ</p>
      <div class="stat-row" id="forecast-stats"></div>
      <div id="forecast-body"><p class="muted">กำลังโหลด…</p></div>
    </div>
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
    <div class="stat-tile ${forecast.summary.wasteRiskCount ? 'warning' : ''}"><div class="num">${forecast.summary.wasteRiskCount}</div><div class="label">เสี่ยงสูญเปล่า (จะหมดอายุก่อนใช้)</div></div>
  `;

  function renderForecastTable() {
    const supplierFilter = document.getElementById('forecast-supplier').value;
    const filtered = supplierFilter
      ? forecast.products.filter((p) => p.supplierName === supplierFilter)
      : forecast.products;
    document.getElementById('forecast-body').innerHTML = buildForecastTableHTML(filtered);
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
  const lowCount = products.filter((p) => p.lowStock).length;
  const expiringCount = products.filter((p) => p.expiryStatus === 'critical' || p.expiryStatus === 'expired').length;

  const rows = products.map((p) => {
    const hasBatches = p.batches.length > 0;
    const rowId = `inv-row-${p.id}`;
    const batchRows = p.batches.map((b) => `
      <tr class="batch-subtable hidden" data-parent="${rowId}">
        <td></td>
        <td class="muted">ล็อต ${escapeHtml(b.batchNumber || String(b.id))} <span class="muted">${escapeHtml(b.supplier || '')}</span></td>
        <td>${daysUntilLabel(b.daysUntilExpiry)} <span class="muted">${b.expirationDate ? `(${fmtDate(b.expirationDate)})` : ''}</span> <span class="badge ${b.status}">${EXPIRY_STATUS_LABEL[b.status] || b.status}</span></td>
        <td class="right">${fmtNum(b.quantityRemaining)}</td>
        <td></td>
      </tr>`).join('');

    return `
      <tr class="${hasBatches ? 'inv-toggle-row' : ''}" ${hasBatches ? `data-toggle="${rowId}"` : ''}>
        <td>${hasBatches ? '<span class="inv-chevron">▸</span> ' : ''}<strong>${escapeHtml(p.name)}</strong><br><span class="muted">${escapeHtml(p.skuCode)}</span></td>
        <td>${hasBatches ? `${p.batches.length} ล็อต` : '<span class="muted">ไม่มีล็อต</span>'}</td>
        <td>${hasBatches ? daysUntilLabel(p.batches[0].daysUntilExpiry) : '—'} <span class="muted">${p.nearestExpiry ? `(${fmtDate(p.nearestExpiry)})` : ''}</span> ${hasBatches ? `<span class="badge ${p.expiryStatus}">${EXPIRY_STATUS_LABEL[p.expiryStatus] || p.expiryStatus}</span>` : ''}</td>
        <td class="right"><strong>${fmtNum(p.totalQuantity)}</strong> ${escapeHtml(p.unit)} ${p.lowStock ? '<span class="badge low">ต่ำ</span>' : ''}</td>
        <td class="muted right">จุดสั่งซื้อ @ ${fmtNum(p.reorderLevel)}</td>
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
          <thead><tr><th>สินค้า</th><th>ล็อต</th><th>วันหมดอายุที่ใกล้ที่สุด</th><th class="right">คงเหลือ</th><th class="right">จุดสั่งซื้อ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderInventory(container) {
  const inv = await api('GET', '/api/inventory');
  const sections = groupByBrand(inv)
    .map(([brand, products]) => buildInventoryBrandSectionHTML(brand, products))
    .join('');

  container.innerHTML = `
    <h2>คลังสินค้า</h2>
    ${sections || '<div class="card"><p class="muted">ยังไม่มีสินค้า</p></div>'}
  `;

  container.querySelectorAll('.inv-toggle-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.toggle;
      const expanding = row.classList.toggle('expanded');
      container.querySelectorAll(`[data-parent="${id}"]`).forEach((r) => r.classList.toggle('hidden', !expanding));
    });
  });
}

// ---------- Receive stock (inflow) ----------
function getHashQuery() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

async function renderReceive(container) {
  await loadProducts();
  await loadSuppliers();
  const claimId = getHashQuery().get('claimId');
  const claim = claimId ? await api('GET', `/api/claims/${claimId}`) : null;

  container.innerHTML = `
    <h2>รับสินค้าเข้า</h2>
    ${claim ? `
      <div class="msg success" style="margin-bottom:16px">
        กำลังรับคืนเข้าคลังจากรายการเคลม #${claim.id} —
        ${CLAIM_TYPE_LABEL[claim.type] || claim.type} จาก ${escapeHtml(claim.counterparty || '—')}:
        ${escapeHtml(claim.product_name)} จำนวน ${fmtNum(claim.quantity)} ${escapeHtml(claim.unit)}
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
        <label class="field">ต้นทุนต่อหน่วย (ไม่บังคับ)
          <input type="number" id="rf-cost" step="any" min="0">
        </label>
      </div>
      <div class="form-row">
        <label class="field">ซัพพลายเออร์
          <select id="rf-supplier">
            <option value="">— ไม่ระบุ —</option>
            ${supplierOptions(state.suppliers)}
            <option value="__new__">+ เพิ่มซัพพลายเออร์ใหม่…</option>
          </select>
        </label>
        <label class="field">วันที่รับสินค้า
          <input type="date" id="rf-date" value="${new Date().toISOString().slice(0, 10)}">
        </label>
      </div>
      <div class="form-row hidden" id="rf-new-supplier-row">
        <label class="field">ชื่อซัพพลายเออร์ใหม่
          <input type="text" id="rf-new-supplier-name">
        </label>
        <button type="button" id="rf-add-supplier-btn" class="secondary" style="align-self:flex-end">เพิ่มซัพพลายเออร์</button>
      </div>
      <div id="rf-supplier-msg"></div>
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
    const noteParts = [
      `รับคืนจาก${claim.type === 'supplier_claim' ? 'ซัพพลายเออร์' : 'ลูกค้า'} ${claim.counterparty || ''}`,
      `(อ้างอิงเคลม #${claim.id})`,
    ];
    if (claim.details) noteParts.push(`— ${claim.details}`);
    document.getElementById('rf-note').value = noteParts.join(' ');
    if (claim.type === 'supplier_claim' && state.suppliers.some((s) => s.name === claim.counterparty)) {
      document.getElementById('rf-supplier').value = claim.counterparty;
    }
  }

  document.getElementById('rf-supplier').addEventListener('change', (e) => {
    document.getElementById('rf-new-supplier-row').classList.toggle('hidden', e.target.value !== '__new__');
    if (e.target.value === '__new__') document.getElementById('rf-new-supplier-name').focus();
  });

  document.getElementById('rf-add-supplier-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('rf-new-supplier-name');
    const supplierMsg = document.getElementById('rf-supplier-msg');
    const name = nameInput.value.trim();
    supplierMsg.innerHTML = '';
    if (!name) return;
    try {
      await api('POST', '/api/suppliers', { name });
      await loadSuppliers();
      const select = document.getElementById('rf-supplier');
      select.innerHTML = `<option value="">— ไม่ระบุ —</option>${supplierOptions(state.suppliers)}<option value="__new__">+ เพิ่มซัพพลายเออร์ใหม่…</option>`;
      select.value = name;
      document.getElementById('rf-new-supplier-row').classList.add('hidden');
      nameInput.value = '';
    } catch (err) {
      supplierMsg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  document.getElementById('receive-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('rf-msg');
    msg.innerHTML = '';
    const supplierValue = document.getElementById('rf-supplier').value;
    if (supplierValue === '__new__') {
      msg.innerHTML = '<p class="msg error">กรุณากด "เพิ่มซัพพลายเออร์" ก่อน หรือเลือกซัพพลายเออร์ที่มีอยู่แล้ว</p>';
      return;
    }
    try {
      const result = await api('POST', '/api/batches', {
        productId: Number(document.getElementById('rf-product').value),
        batchNumber: document.getElementById('rf-batch').value || null,
        expirationDate: document.getElementById('rf-expiry').value || null,
        quantity: Number(document.getElementById('rf-qty').value),
        unitCost: document.getElementById('rf-cost').value ? Number(document.getElementById('rf-cost').value) : null,
        supplier: supplierValue || null,
        receivedDate: document.getElementById('rf-date').value || null,
        note: document.getElementById('rf-note').value || null,
      });
      if (claim) {
        await api('PATCH', `/api/claims/${claim.id}`, {
          status: 'resolved',
          resolutionNote: `รับคืนเข้าคลังแล้ว (ล็อตใหม่ #${result.batchId})`,
        });
        msg.innerHTML = '<p class="msg success">รับสินค้าเข้าคลังเรียบร้อยแล้ว และอัปเดตสถานะเคลมเป็น "เสร็จสิ้น" แล้ว — <a href="#/claims">กลับไปหน้าเคลม/ตีกลับ</a></p>';
      } else {
        msg.innerHTML = '<p class="msg success">รับสินค้าเข้าคลังเรียบร้อยแล้ว</p>';
      }
      e.target.reset();
      document.getElementById('rf-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('rf-new-supplier-row').classList.add('hidden');
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });
}

// ---------- Issue stock (outflow) ----------
async function renderIssue(container) {
  await loadProducts();
  await loadCustomers();
  container.innerHTML = `
    <h2>เบิกสินค้าออก (ขายให้ลูกค้า)</h2>
    <form id="issue-form" class="stack card">
      <div class="form-row">
        <label class="field">ซัพพลายเออร์
          <select id="if-product-supplier">${brandFilterOptionsHTML(state.products)}</select>
        </label>
        <label class="field">สินค้า
          <select id="if-product" required>${productOptions(state.products)}</select>
        </label>
      </div>
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
          </select>
        </label>
        <label class="field">ลูกค้า
          <select id="if-customer">
            <option value="">— ไม่ระบุ —</option>
            ${customerOptions(state.customers)}
            <option value="__new__">+ เพิ่มลูกค้าใหม่…</option>
          </select>
        </label>
      </div>
      <div class="form-row hidden" id="if-new-customer-row">
        <label class="field">ชื่อลูกค้าใหม่
          <input type="text" id="if-new-customer-name">
        </label>
        <button type="button" id="if-add-customer-btn" class="secondary" style="align-self:flex-end">เพิ่มลูกค้า</button>
      </div>
      <div id="if-customer-msg"></div>
      <label class="field">หมายเหตุ
        <textarea id="if-note" rows="2"></textarea>
      </label>
      <button type="button" id="if-preview-btn" class="secondary">ดูตัวอย่างการจัดสรร (FEFO)</button>
      <div id="if-preview"></div>
      <button type="submit" class="primary">ยืนยันการเบิกออก</button>
      <div id="if-msg"></div>
    </form>
  `;

  async function preview() {
    const productId = document.getElementById('if-product').value;
    const qty = Number(document.getElementById('if-qty').value);
    const previewEl = document.getElementById('if-preview');
    if (!productId || !qty) { previewEl.innerHTML = ''; return; }
    try {
      const p = await api('GET', `/api/outflow/preview?productId=${productId}&quantity=${qty}`);
      const rows = p.allocation.map((a) => `
        <tr data-batch-id="${a.batchId}">
          <td>ล็อต ${escapeHtml(a.batchNumber || a.batchId)}</td>
          <td class="if-exp-cell">
            <span class="if-exp-display">${fmtDate(a.expirationDate)}</span>
            <button type="button" class="secondary if-edit-exp">แก้ไขวันหมดอายุ</button>
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
            <input type="date" class="if-exp-input" style="width:140px;display:inline-block">
            <button type="button" class="secondary if-save-exp">บันทึก</button>
          `;
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

  document.getElementById('if-preview-btn').addEventListener('click', preview);
  wireSupplierProductCascade(
    document.getElementById('if-product-supplier'),
    document.getElementById('if-product'),
    state.products
  );

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
      });
      const purposeNote = purpose === 'trial' ? ' (บันทึกเป็นรายการให้ทดลอง/ตัวอย่าง)' : '';
      msg.innerHTML = `<p class="msg success">เบิกออกสำเร็จ จาก ${result.allocation.length} ล็อต${purposeNote}</p>`;
      document.getElementById('if-preview').innerHTML = '';
      e.target.reset();
      document.getElementById('if-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('if-new-customer-row').classList.add('hidden');
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  // ---- Convert ink to another SKU ----
  container.insertAdjacentHTML('beforeend', `
    <div class="card">
      <h3>แปลงหมึกเป็นเบอร์อื่น</h3>
      <p class="muted">ใช้เมื่อนำหมึกเบอร์หนึ่งไปแปลง/บรรจุใหม่เป็นอีกเบอร์หนึ่งก่อนส่งให้ลูกค้า
        ระบบจะตัดสต็อกจากสินค้าต้นทางและสร้างล็อตใหม่ให้สินค้าปลายทางให้อัตโนมัติ</p>
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
        <div class="form-row">
          <label class="field">วันหมดอายุใหม่ (ถ้าไม่ระบุจะใช้ของล็อตเดิม)
            <input type="date" id="cv-dest-expiry">
          </label>
          <label class="field">หมายเลขล็อตใหม่ (ไม่บังคับ)
            <input type="text" id="cv-dest-batch" placeholder="สร้างอัตโนมัติถ้าไม่ระบุ">
          </label>
        </div>
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

  document.getElementById('conv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('cv-msg');
    msg.innerHTML = '';
    try {
      await api('POST', '/api/outflow/convert', {
        sourceProductId: Number(document.getElementById('cv-source-product').value),
        sourceBatchId: document.getElementById('cv-source-batch').value || null,
        quantity: Number(document.getElementById('cv-qty').value),
        destProductId: Number(document.getElementById('cv-dest-product').value),
        destExpirationDate: document.getElementById('cv-dest-expiry').value || null,
        destBatchNumber: document.getElementById('cv-dest-batch').value || null,
        conversionDate: document.getElementById('cv-date').value || null,
        note: document.getElementById('cv-note').value || null,
      });
      msg.innerHTML = '<p class="msg success">แปลงหมึกเรียบร้อยแล้ว</p>';
      e.target.reset();
      document.getElementById('cv-date').value = new Date().toISOString().slice(0, 10);
      await refreshSourceBatches();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });
}

// ---------- History ----------
async function renderHistory(container) {
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
          </select>
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
    const from = document.getElementById('hf-from').value;
    const to = document.getElementById('hf-to').value;
    if (productId) params.set('productId', productId);
    if (type) params.set('type', type);
    if (purpose) params.set('purpose', purpose);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }

  async function load() {
    const rows = await api('GET', `/api/transactions?${currentQuery()}`);
    const body = rows.map((t) => `
      <tr>
        <td>${fmtDate(t.transaction_date)}</td>
        <td>${TYPE_LABEL[t.type] || t.type}${t.type === 'OUT' && t.purpose === 'trial' ? ' <span class="badge critical">ทดลอง/ตัวอย่าง</span>' : ''}</td>
        <td>${escapeHtml(t.product_name)} <span class="muted">(${escapeHtml(t.sku_code)})</span></td>
        <td class="muted">${escapeHtml(t.batch_number || '')}</td>
        <td>${fmtDate(t.expiration_date)}</td>
        <td class="right">${fmtNum(t.quantity)} ${escapeHtml(t.unit)}</td>
        <td>${escapeHtml(t.counterparty || '')}</td>
        <td class="muted">${escapeHtml(t.user_name || '')}</td>
        <td class="muted">${escapeHtml(t.note || '')}</td>
      </tr>`).join('');
    document.getElementById('hf-table').innerHTML = `
      <table>
        <thead><tr><th>วันที่</th><th>ประเภท</th><th>สินค้า</th><th>ล็อต</th><th>วันหมดอายุ</th><th class="right">จำนวน</th><th>ลูกค้า/ซัพพลายเออร์</th><th>โดย</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${body || '<tr><td colspan="9" class="muted">ไม่พบรายการที่ตรงกัน</td></tr>'}</tbody>
      </table>`;
  }

  document.getElementById('hf-apply').addEventListener('click', load);
  document.getElementById('hf-export').addEventListener('click', () => {
    window.open(`/api/transactions/export.csv?${currentQuery()}`, '_blank');
  });
  wireSupplierProductCascade(
    document.getElementById('hf-supplier'),
    document.getElementById('hf-product'),
    state.products,
    { includeAllProducts: true }
  );

  await load();
}

// ---------- Claims / returns ----------
const CLAIM_TYPE_LABEL = { customer_reject: 'ลูกค้าตีกลับ', supplier_claim: 'เคลมซัพพลายเออร์' };
const CLAIM_STATUS_LABEL = { pending: 'รอดำเนินการ', in_progress: 'กำลังดำเนินการ', approved: 'อนุมัติแล้ว', rejected: 'ถูกปฏิเสธ', resolved: 'เสร็จสิ้น' };
const CLAIM_STATUS_BADGE = { pending: 'none', in_progress: 'critical', approved: 'ok', rejected: 'expired', resolved: 'ok' };
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
function claimStatusOptions(selected) {
  return Object.entries(CLAIM_STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
}

function buildClaimsTableHTML(claims) {
  const rows = claims.map((c) => `
    <tr>
      <td>${fmtDate(c.claim_date)}</td>
      <td><span class="badge ${c.type === 'customer_reject' ? 'critical' : 'expired'}">${CLAIM_TYPE_LABEL[c.type] || c.type}</span></td>
      <td>${escapeHtml(c.product_name)} <span class="muted">(${escapeHtml(c.sku_code)})</span></td>
      <td class="muted">${escapeHtml(c.batch_number || '—')}</td>
      <td class="right">${fmtNum(c.quantity)} ${escapeHtml(c.unit)}</td>
      <td>${escapeHtml(c.counterparty || '—')}</td>
      <td class="muted">${CLAIM_CATEGORY_LABEL[c.category] || c.category}<br>${escapeHtml(c.details || '')}</td>
      <td><select class="cl-status" data-id="${c.id}">${claimStatusOptions(c.status)}</select></td>
      <td><input type="text" class="cl-resolution" data-id="${c.id}" value="${escapeHtml(c.resolution_note || '')}" placeholder="บันทึกผลการดำเนินการ"></td>
      <td>
        <input type="text" class="cl-redirect-to" data-id="${c.id}" value="${escapeHtml(c.redirected_to || '')}" placeholder="ชื่อลูกค้าที่ได้รับแทน" style="margin-bottom:4px">
        <input type="number" class="cl-redirect-qty" data-id="${c.id}" value="${c.redirected_quantity ?? ''}" placeholder="จำนวนที่ส่งต่อ" step="any" min="0">
      </td>
      <td class="muted">${escapeHtml(c.user_name || '')}</td>
      <td><a href="#/receive?claimId=${c.id}" class="secondary" style="display:inline-block;text-decoration:none;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12.5px;white-space:nowrap">รับคืนเข้าคลัง</a></td>
    </tr>`).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>วันที่</th><th>ประเภท</th><th>สินค้า</th><th>ล็อต</th><th class="right">จำนวน</th>
            <th>คู่กรณี</th><th>สาเหตุ</th><th>สถานะ</th><th>ผลการดำเนินการ</th><th>ส่งต่อให้ลูกค้าอื่น</th><th>บันทึกโดย</th><th></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="12" class="muted">ยังไม่มีรายการเคลม/ตีกลับ</td></tr>'}</tbody>
      </table>
    </div>`;
}

async function renderClaims(container) {
  await loadProducts();
  container.innerHTML = `
    <h2>เคลม/ตีกลับสินค้า</h2>
    <p class="muted">
      <strong>ข้อควรทราบ:</strong> การบันทึกเคลม/ตีกลับ ไม่ได้ปรับจำนวนสต็อกอัตโนมัติ —
      เป็นการบันทึกติดตามเรื่องแยกต่างหาก ถ้าท้ายที่สุดได้สินค้าคืนเข้าคลังจริง
      (เช่น ซัพพลายเออร์เปลี่ยนสินค้าใหม่ให้) ให้บันทึกผ่านหน้า "รับสินค้าเข้า" ตามปกติ
      หากนำตลับที่ถูกตีกลับจากลูกค้าเจ้าหนึ่งไปส่งให้ลูกค้าอีกเจ้าแทน (โดยไม่ผ่านคลัง)
      ให้บันทึกชื่อลูกค้าและจำนวนที่ช่อง "ส่งต่อให้ลูกค้าอื่น" ในตารางด้านล่างของรายการนั้น
    </p>
    <div class="card">
      <h3>บันทึกรายการใหม่</h3>
      <form id="cf-form" class="stack">
        <label class="field">ประเภทรายการ
          <select id="cf-type">
            <option value="customer_reject">ลูกค้าตีกลับสินค้า</option>
            <option value="supplier_claim">เคลมกับซัพพลายเออร์</option>
          </select>
        </label>
        <div class="form-row">
          <label class="field">ซัพพลายเออร์
            <select id="cf-product-supplier">${brandFilterOptionsHTML(state.products)}</select>
          </label>
          <label class="field">สินค้า
            <select id="cf-product" required>${productOptions(state.products)}</select>
          </label>
        </div>
        <label class="field">ล็อต (ถ้าทราบ)
          <select id="cf-batch"><option value="">— ไม่ระบุล็อต —</option></select>
        </label>
        <div class="form-row">
          <label class="field">จำนวน
            <input type="number" id="cf-qty" step="any" min="0.01" required>
          </label>
          <label class="field">วันที่
            <input type="date" id="cf-date" value="${new Date().toISOString().slice(0, 10)}">
          </label>
        </div>
        <label class="field"><span id="cf-counterparty-label">ชื่อลูกค้า</span>
          <input type="text" id="cf-counterparty">
        </label>
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
      <div class="filters">
        <label class="field">ประเภท
          <select id="clf-type">
            <option value="">ทั้งหมด</option>
            <option value="customer_reject">ลูกค้าตีกลับ</option>
            <option value="supplier_claim">เคลมซัพพลายเออร์</option>
          </select>
        </label>
        <label class="field">สถานะ
          <select id="clf-status">
            <option value="">ทั้งหมด</option>
            ${Object.entries(CLAIM_STATUS_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </label>
        <button id="clf-apply" class="secondary">กรอง</button>
      </div>
      <div class="table-wrap" id="cl-table"><p class="muted">กำลังโหลด…</p></div>
    </div>
  `;

  document.getElementById('cf-type').addEventListener('change', (e) => {
    document.getElementById('cf-counterparty-label').textContent = e.target.value === 'supplier_claim' ? 'ชื่อซัพพลายเออร์' : 'ชื่อลูกค้า';
  });

  document.getElementById('cf-product').addEventListener('change', async (e) => {
    const batchSelect = document.getElementById('cf-batch');
    batchSelect.innerHTML = '<option value="">— ไม่ระบุล็อต —</option>';
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

  document.getElementById('cf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('cf-msg');
    msg.innerHTML = '';
    try {
      await api('POST', '/api/claims', {
        type: document.getElementById('cf-type').value,
        productId: Number(document.getElementById('cf-product').value),
        batchId: document.getElementById('cf-batch').value || null,
        quantity: Number(document.getElementById('cf-qty').value),
        claimDate: document.getElementById('cf-date').value || null,
        counterparty: document.getElementById('cf-counterparty').value || null,
        category: document.getElementById('cf-category').value,
        details: document.getElementById('cf-details').value || null,
      });
      msg.innerHTML = '<p class="msg success">บันทึกรายการเรียบร้อยแล้ว</p>';
      e.target.reset();
      document.getElementById('cf-date').value = new Date().toISOString().slice(0, 10);
      await loadClaims();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  async function loadClaims() {
    const params = new URLSearchParams();
    const type = document.getElementById('clf-type').value;
    const status = document.getElementById('clf-status').value;
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    const claims = await api('GET', `/api/claims?${params.toString()}`);
    document.getElementById('cl-table').innerHTML = buildClaimsTableHTML(claims);

    document.querySelectorAll('.cl-status').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/claims/${sel.dataset.id}`, { status: sel.value });
        } catch (err) {
          alert(err.message);
        }
      });
    });
    document.querySelectorAll('.cl-resolution').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/claims/${input.dataset.id}`, { resolutionNote: input.value });
        } catch (err) {
          alert(err.message);
        }
      });
    });
    document.querySelectorAll('.cl-redirect-to').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/claims/${input.dataset.id}`, { redirectedTo: input.value });
        } catch (err) {
          alert(err.message);
        }
      });
    });
    document.querySelectorAll('.cl-redirect-qty').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/claims/${input.dataset.id}`, { redirectedQuantity: input.value ? Number(input.value) : null });
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  document.getElementById('clf-apply').addEventListener('click', loadClaims);
  await loadClaims();
}

// ---------- Products ----------
async function renderProducts(container) {
  const products = await api('GET', '/api/products?includeArchived=1');
  const isAdmin = state.user.role === 'admin';
  const rows = products.map((p) => `
    <tr>
      <td>${escapeHtml(p.sku_code)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.brand || '')}</td>
      <td>${escapeHtml(p.unit)}</td>
      <td><input type="number" class="pf-reorder-level" data-id="${p.id}" value="${p.reorder_level}" step="any" min="0" style="width:80px"></td>
      <td><input type="number" class="pf-leadtime" data-id="${p.id}" value="${p.lead_time_days}" min="0" style="width:70px"></td>
      <td>${p.archived ? '<span class="badge low">เก็บถาวร</span>' : '<span class="badge ok">ใช้งานอยู่</span>'}</td>
      <td>${isAdmin ? `<button class="secondary toggle-archive" data-id="${p.id}" data-archived="${p.archived}">${p.archived ? 'เลิกเก็บถาวร' : 'เก็บถาวร'}</button>` : ''}</td>
    </tr>`).join('');

  container.innerHTML = `
    <h2>สินค้า</h2>
    <div class="card">
      <h3>เพิ่ม SKU หมึกใหม่</h3>
      <form id="pf-form" class="stack">
        <div class="form-row">
          <label class="field">รหัส SKU <input type="text" id="pf-sku" required></label>
          <label class="field">ชื่อ <input type="text" id="pf-name" required></label>
        </div>
        <div class="form-row">
          <label class="field">ซัพพลายเออร์ <input type="text" id="pf-brand" placeholder="เช่น UIPS, Domino"></label>
          <label class="field">หน่วย <input type="text" id="pf-unit" value="ตลับ"></label>
        </div>
        <div class="form-row">
          <label class="field">จุดสั่งซื้อ <input type="number" id="pf-reorder" step="any" value="0"></label>
          <label class="field">ระยะเวลาส่งของจากซัพพลายเออร์ (วัน) <input type="number" id="pf-leadtime" min="0" value="30"></label>
        </div>
        <button type="submit" class="primary">เพิ่มสินค้า</button>
        <div id="pf-msg"></div>
      </form>
    </div>
    <div class="card">
      <p class="muted">จุดสั่งซื้อและระยะเวลาส่งของจะถูกใช้ในการพยากรณ์การสั่งซื้อที่แดชบอร์ด — การแก้ไขจะถูกบันทึกอัตโนมัติ</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>รหัส SKU</th><th>ชื่อ</th><th>ซัพพลายเออร์</th><th>หน่วย</th><th>จุดสั่งซื้อ</th><th>ระยะเวลาส่งของ (วัน)</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="muted">ยังไม่มีสินค้า</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('pf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pf-msg');
    msg.innerHTML = '';
    try {
      await api('POST', '/api/products', {
        skuCode: document.getElementById('pf-sku').value.trim(),
        name: document.getElementById('pf-name').value.trim(),
        brand: document.getElementById('pf-brand').value || null,
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
}

// ---------- Customers ----------
function userSelectOptionsHTML(users, selectedId) {
  const opts = users.map((u) => `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${escapeHtml(u.display_name)}</option>`).join('');
  return `<option value="">— ไม่ระบุ —</option>${opts}`;
}

async function renderCustomers(container) {
  const [customers, staffUsers] = await Promise.all([
    api('GET', '/api/customers?includeArchived=1'),
    api('GET', '/api/users/basic'),
  ]);

  const rows = customers.map((c) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone || '')}</td>
      <td>${escapeHtml(c.contact_person || '')}</td>
      <td class="muted">${escapeHtml(c.address || '')}</td>
      <td><select class="cu-assigned" data-id="${c.id}">${userSelectOptionsHTML(staffUsers, c.assigned_user_id)}</select></td>
      <td>${c.archived ? '<span class="badge low">เก็บถาวร</span>' : '<span class="badge ok">ใช้งานอยู่</span>'}</td>
      <td><button class="secondary toggle-customer-archive" data-id="${c.id}" data-archived="${c.archived}">${c.archived ? 'เลิกเก็บถาวร' : 'เก็บถาวร'}</button></td>
    </tr>`).join('');

  container.innerHTML = `
    <h2>ลูกค้า</h2>
    <div class="card">
      <h3>เพิ่มลูกค้าใหม่</h3>
      <form id="cu-form" class="stack">
        <div class="form-row">
          <label class="field">ชื่อลูกค้า/บริษัท <input type="text" id="cu-name" required></label>
          <label class="field">เบอร์โทร <input type="text" id="cu-phone"></label>
        </div>
        <div class="form-row">
          <label class="field">ผู้ติดต่อ <input type="text" id="cu-contact"></label>
          <label class="field">พนักงานขายที่ดูแล
            <select id="cu-assigned-new"><option value="">— ไม่ระบุ —</option>${staffUsers.map((u) => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('')}</select>
          </label>
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
        assignedUserId: document.getElementById('cu-assigned-new').value || null,
        note: document.getElementById('cu-note').value || null,
      });
      msg.innerHTML = '<p class="msg success">เพิ่มลูกค้าเรียบร้อยแล้ว</p>';
      route();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  container.querySelectorAll('.cu-assigned').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/customers/${select.dataset.id}`, { assignedUserId: select.value || null });
      } catch (err) {
        alert(err.message);
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
}

// ---------- Users (admin) ----------
async function renderUsers(container) {
  if (state.user.role !== 'admin') {
    container.innerHTML = '<p class="msg error">ต้องใช้สิทธิ์ผู้ดูแลระบบ</p>';
    return;
  }
  const users = await api('GET', '/api/users');
  const rows = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.display_name)}</td>
      <td>${ROLE_LABEL[u.role] || escapeHtml(u.role)}</td>
      <td>${u.active ? '<span class="badge ok">ใช้งานอยู่</span>' : '<span class="badge low">ปิดใช้งาน</span>'}</td>
      <td><button class="secondary toggle-active" data-id="${u.id}" data-active="${u.active}">${u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button></td>
    </tr>`).join('');

  container.innerHTML = `
    <h2>บัญชีพนักงาน</h2>
    <div class="card">
      <h3>เพิ่มบัญชีพนักงาน</h3>
      <form id="uf-form" class="stack">
        <div class="form-row">
          <label class="field">ชื่อผู้ใช้ <input type="text" id="uf-username" required></label>
          <label class="field">ชื่อที่แสดง <input type="text" id="uf-display" required></label>
        </div>
        <div class="form-row">
          <label class="field">รหัสผ่าน <input type="password" id="uf-password" minlength="6" required></label>
          <label class="field">บทบาท
            <select id="uf-role"><option value="staff">พนักงาน</option><option value="admin">ผู้ดูแลระบบ</option></select>
          </label>
        </div>
        <button type="submit" class="primary">สร้างบัญชี</button>
        <div id="uf-msg"></div>
      </form>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>สถานะ</th><th></th></tr></thead>
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
        displayName: document.getElementById('uf-display').value.trim(),
        password: document.getElementById('uf-password').value,
        role: document.getElementById('uf-role').value,
      });
      msg.innerHTML = '<p class="msg success">สร้างบัญชีเรียบร้อยแล้ว</p>';
      route();
    } catch (err) {
      msg.innerHTML = `<p class="msg error">${escapeHtml(err.message)}</p>`;
    }
  });

  container.querySelectorAll('.toggle-active').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const active = btn.dataset.active === '1';
      await api('PUT', `/api/users/${btn.dataset.id}/active`, { active: !active });
      route();
    });
  });
}

// ---------- Account ----------
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
