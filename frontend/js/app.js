import { api, session } from './api.js';
import { initAuth } from './auth.js';
import { initCalc } from './calc.js';
import { renderDeclarationsTab } from './declarations.js';
import { renderLedgerTab } from './ledger.js';
import { createMap, mapLegend } from './map.js';
import { initNewShipment } from './new-shipment.js';
import { declChip, renderShipment, statusChip } from './shipment-view.js';
import { $, $$, closeModal, esc, fmtH, openModal, toast } from './util.js';

const POLL_MS = 2000;
const TABS = [
  ['monitor', 'Мои перевозки'],
  ['track', 'Отслеживание'],
  ['new', 'Новая перевозка'],
  ['calc', 'Расчёт стоимости'],
  ['decl', 'Декларации'],
  ['ledger', 'Реестр'],
  ['effect', 'Эффект'],
];

const app = {
  meta: null,
  shipments: [],
  selected: null,
  tracked: null,
  tab: 'monitor',
  map: null,
  prefillNew: null,
};

/* ---------------- Запуск ---------------- */

async function boot() {
  try {
    app.meta = await api('/api/meta');
  } catch (err) {
    document.body.innerHTML = `<p class="fatal">Сервер недоступен: ${esc(err.message)}. Запустите backend и обновите страницу.</p>`;
    return;
  }
  bindGlobal();
  if (session.token) {
    try {
      session.user = await api('/api/auth/me');
    } catch {
      session.clear();
    }
  }
  session.user ? showApp() : showAuth();
  setInterval(poll, POLL_MS);
}

function bindGlobal() {
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('zhol:logout', () => { session.clear(); showAuth(); toast('Сессия завершена, войдите снова', 'bad'); });
}

function showAuth() {
  $('#app').hidden = true;
  $('#auth-screen').hidden = false;
  initAuth($('#auth-screen'), {
    meta: app.meta,
    onLogin: user => { toast(`Добро пожаловать, ${user.name}`); showApp(); },
    onTrack: number => publicTrack(number),
  });
}

async function publicTrack(number) {
  try {
    const s = await api(`/api/shipments/${encodeURIComponent(number)}`);
    openModal('<div data-public-ship></div>', true);
    renderShipment($('[data-public-ship]'), s, { meta: app.meta, user: null, refresh: () => publicTrack(number) });
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function showApp() {
  const user = session.user;
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  const role = app.meta.roles[user.role];
  $('#nav').innerHTML = TABS
    .filter(([id]) => !(id === 'new' && user.role === 'customs'))
    .map(([id, label]) => `<button class="tab-btn" data-tab="${id}">${id === 'monitor' && user.role === 'customs' ? 'Все перевозки' : label}</button>`).join('');
  $('#user-box').innerHTML = `<div class="user-info"><b>${esc(user.name)}</b><span>${esc(user.company)}</span></div>
    <span class="chip role">${esc(role.name)}</span><button class="btn small ghost" id="logout">Выйти</button>`;

  app.shipments = [];
  app.selected = null;
  app.tracked = null;
  $('#tab-monitor').innerHTML = `
    <div class="monitor-grid">
      <div class="card map-card"><div class="card-head"><h2>Средний коридор</h2>${mapLegend}</div><svg id="map" role="img" aria-label="Схема Транскаспийского маршрута"></svg></div>
      <aside class="card list-card"><div class="card-head"><h2 id="list-title"></h2>
        ${user.role !== 'customs' ? '<button class="btn small" data-goto="new">+ Новая</button>' : ''}</div>
        <div id="shipment-list" class="shipment-list"></div></aside>
    </div>
    <div id="monitor-detail" class="card detail"></div>`;
  app.map = createMap($('#map'), app.meta, number => { app.selected = number; renderMonitor(); });

  $('#tab-track').innerHTML = `
    <div class="card track-card">
      <h2>Отследить перевозку по номеру</h2>
      <p class="muted">Найти перевозку может любой зарегистрированный участник. Если вы перевозчик, получатель или экспедитор этого груза, присоединитесь к ней, чтобы загружать документы.</p>
      <form class="inline" id="track-form"><input name="number" placeholder="ZH-2026-XXXXXX" autocomplete="off" required>
        <button class="btn primary-sm">Найти</button></form>
    </div>
    <div id="track-detail" class="card detail" hidden></div>`;

  app.prefillNew = user.role === 'customs' ? null : initNewShipment($('#tab-new'), {
    meta: app.meta, user,
    onCreated: s => { app.selected = s.number; loadShipments(); },
    onOpen: number => { app.selected = number; showTab('monitor'); },
  });
  initCalc($('#tab-calc'), {
    meta: app.meta, user,
    onBook: params => { app.prefillNew?.(params); showTab('new'); toast('Параметры перенесены из калькулятора'); },
  });
  showTab(homeTab());
}

// Главная — вкладка, которая открывается сразу после входа.
const homeTab = () => (session.user?.role === 'customs' ? 'decl' : 'monitor');

/* ---------------- Вкладки ---------------- */

function showTab(name) {
  app.tab = name;
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  if (name === 'monitor') loadShipments();
  if (name === 'decl') renderDeclarationsTab($('#tab-decl'), { onOpenShipment: n => { showTab('track'); trackNumber(n); } });
  if (name === 'ledger') renderLedgerTab($('#tab-ledger'));
  if (name === 'effect') renderEffect();
  window.scrollTo({ top: 0 });
}

function poll() {
  if (!session.user || document.hidden || !$('#modal').hidden) return;
  if (app.tab === 'monitor') loadShipments();
  if (app.tab === 'track' && app.tracked) trackNumber(app.tracked, true);
}

/* ---------------- Мониторинг ---------------- */

async function loadShipments() {
  try {
    app.shipments = await api('/api/shipments');
  } catch (err) {
    return toast(err.message, 'bad');
  }
  if (!app.shipments.some(s => s.number === app.selected)) app.selected = app.shipments[0]?.number ?? null;
  renderMonitor();
}

function renderMonitor() {
  const isCustoms = session.user.role === 'customs';
  $('#list-title').textContent = isCustoms ? `Все перевозки · ${app.shipments.length}` : `Мои перевозки · ${app.shipments.length}`;
  app.map.update(app.shipments, app.selected);

  const list = $('#shipment-list');
  const html = app.shipments.map(s => `
    <button class="ship-item ${s.number === app.selected ? 'active' : ''}" data-select="${esc(s.number)}">
      <div class="ship-top"><span class="ship-id">${esc(s.number)}</span>${statusChip(s.status)}</div>
      <div class="ship-desc">${esc(s.cargo.description)} · ${esc(app.meta.routes[s.route_id].short)}</div>
      <div class="ship-foot"><div class="bar"><i style="width:${(s.status.progress * 100).toFixed(1)}%"></i></div>${declChip(s.declaration_status)}</div>
    </button>`).join('');
  if (list._html !== html) {
    list.innerHTML = html || `<div class="empty"><p>${isCustoms ? 'Перевозок пока нет.' : 'У вас пока нет перевозок.'}</p>
      ${isCustoms ? '' : '<p class="hint">Зарегистрируйте новую или найдите существующую по номеру во вкладке «Отслеживание».</p>'}</div>`;
    list._html = html;
  }

  const detail = $('#monitor-detail');
  const s = app.shipments.find(x => x.number === app.selected);
  detail.hidden = !s;
  if (s) renderShipment(detail, s, { meta: app.meta, user: session.user, refresh: loadShipments });
}

/* ---------------- Отслеживание ---------------- */

async function trackNumber(number, silent = false) {
  const box = $('#track-detail');
  if (!silent) {
    showTabOnly('track');
    $('#track-form').number.value = number;
  }
  try {
    const s = await api(`/api/shipments/${encodeURIComponent(number)}`);
    app.tracked = s.number;
    box.hidden = false;
    renderShipment(box, s, { meta: app.meta, user: session.user, refresh: () => trackNumber(s.number, true) });
  } catch (err) {
    if (!silent) { box.hidden = true; app.tracked = null; toast(err.message, 'bad'); }
  }
}

function showTabOnly(name) {
  if (app.tab === name) return;
  app.tab = name;
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
}

/* ---------------- Эффект ---------------- */

async function renderEffect() {
  const root = $('#tab-effect');
  try {
    app.shipments = await api('/api/shipments');
  } catch { /* покажем только сравнение маршрутов */ }
  let hours = 0, docs = 0;
  for (const s of app.shipments) {
    const c = app.meta.routes[s.route_id].compare;
    hours += c.trad.total - c.zhol.total;
    docs += s.documents?.length ?? 0;
  }
  const released = app.shipments.filter(s => s.declaration_status === 'released').length;
  const kpi = (label, value, note) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;
  const routes = Object.values(app.meta.routes);
  const max = Math.max(...routes.map(r => r.compare.trad.total));
  const seg = (cls, h, title) => `<i class="${cls}" style="width:${(h / max * 100).toFixed(2)}%" title="${title}: ${fmtH(h)}"></i>`;
  const row = (label, c, move) => `<div class="hbar-row"><span>${label}</span>
    <div class="hbar">${seg('seg-paper', c.paper, 'Оформление')}${seg('seg-move', move, 'Движение')}${seg('seg-dwell', c.dwell, 'Простои')}</div><b>${fmtH(c.total)}</b></div>`;

  root.innerHTML = `
    <div class="kpis">
      ${kpi('Перевозок', app.shipments.length, session.user.role === 'customs' ? 'на платформе' : 'с вашим участием')}
      ${kpi('Сэкономлено времени', fmtH(hours), 'по сравнению с бумажным оформлением')}
      ${kpi('Документов загружено', docs, 'каждый один раз для всех органов')}
      ${kpi('Декларации выпущены', released, 'граница и порт без остановки')}
    </div>
    <div class="card">
      <div class="card-head"><h2>Время доставки по маршрутам</h2></div>
      <p class="muted">Модельные оценки: движение одинаковое, разница в оформлении и простоях на границах и в портах.</p>
      <div class="bar-legend"><span><i class="seg-paper"></i>Оформление документов</span><span><i class="seg-move"></i>Движение</span><span><i class="seg-dwell"></i>Простои на границах и в портах</span></div>
      ${routes.map(r => {
        const c = r.compare;
        return `<div class="route-bars"><h4>${esc(r.name)} <span class="chip ok">−${Math.round((1 - c.zhol.total / c.trad.total) * 100)}%</span></h4>
          ${row('Сейчас', c.trad, c.move)}${row('Жол-ID', c.zhol, c.move)}</div>`;
      }).join('')}
    </div>`;
}

/* ---------------- События интерфейса ---------------- */

document.addEventListener('click', async e => {
  if (e.target.closest('#home-link')) {
    e.preventDefault();
    closeModal();
    showTab(homeTab());
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) showTab(tab.dataset.tab);
  const go = e.target.closest('[data-goto]');
  if (go) showTab(go.dataset.goto);
  const sel = e.target.closest('[data-select]');
  if (sel) { app.selected = sel.dataset.select; renderMonitor(); }
  if (e.target.closest('#logout')) {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    session.clear();
    showAuth();
  }
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'track-form') return;
  e.preventDefault();
  trackNumber(e.target.number.value.trim().toUpperCase());
});

boot();
