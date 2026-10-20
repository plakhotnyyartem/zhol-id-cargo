import { api, download } from './api.js';
import { openDeclaration } from './declarations.js';
import { $, copyText, esc, fmtDate, fmtH, fmtNum, fmtSize, fmtTime, fmtUsd, setPart, toast } from './util.js';

const STATUS_CLS = { registered: 'pending', move: 'move', dwell: 'dwell', held: 'bad', delivered: 'done' };
const DECL_STATUS = {
  submitted: ['pending', 'На проверке у таможни'],
  released: ['ok', 'Выпущена'],
  rejected: ['bad', 'Отклонена'],
};
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt';

export const statusChip = st => `<span class="chip ${STATUS_CLS[st.code] || ''}">${esc(st.label)}</span>`;
export const declChip = status => status
  ? `<span class="chip ${DECL_STATUS[status][0]}">ЭД: ${DECL_STATUS[status][1].toLowerCase()}</span>`
  : '<span class="chip">ЭД не подана</span>';

/**
 * Рисует карточку перевозки в container. Повторные вызовы с теми же данными
 * обновляют только изменившиеся части, поэтому её можно вызывать при каждом опросе.
 * ctx: { meta, user, refresh() }
 */
export function renderShipment(container, s, ctx) {
  container._s = s;
  container._ctx = ctx;
  const full = s.access === 'participant' || s.access === 'customs';
  const key = `${s.number}|${s.access}|${!!s.can_upload}`;
  if (container.dataset.key !== key) {
    container.dataset.key = key;
    container.innerHTML = skeleton(s, ctx, full);
    if (!container._bound) bindActions(container);
    pickMissing(container);
  }
  const part = name => container.querySelector(`[data-part="${name}"]`);
  setPart(part('head'), headHtml(s));
  setPart(part('progress'), progressHtml(s, ctx));
  setPart(part('info'), infoHtml(s, ctx, full));
  setPart(part('timeline'), timelineHtml(s, ctx));
  setPart(part('events'), eventsHtml(s));
  if (full) {
    setPart(part('required'), requiredHtml(s));
    setPart(part('docs'), docsHtml(s));
    setPart(part('decl'), declHtml(s));
  } else {
    setPart(part('restricted'), restrictedHtml(s, ctx));
  }
}

function skeleton(s, ctx, full) {
  const docTypes = ctx.meta.doc_types;
  const required = new Set(full ? s.required_docs.map(d => d.type) : []);
  const options = Object.entries(docTypes)
    .sort(([a], [b]) => required.has(b) - required.has(a))
    .map(([id, d]) => `<option value="${id}">${esc(d.name)}${required.has(id) ? ' *' : ''}</option>`).join('');
  const upload = s.can_upload ? `
    <form class="upload" data-upload>
      <label>Тип документа<select name="doc_type">${options}</select></label>
      <label>Файл<input type="file" name="file" accept="${ACCEPT}" required></label>
      <button class="btn primary" type="submit">Загрузить</button>
      <p class="hint" data-hint></p>
    </form>` : '';
  const docsBlock = full ? `
    <div class="docs-grid">
      <div class="panel">
        <h3>Документы</h3>
        <div data-part="required"></div>
        ${upload}
        <div data-part="docs"></div>
      </div>
      <div class="panel">
        <h3>Электронная декларация</h3>
        <div data-part="decl"></div>
      </div>
    </div>` : '<div data-part="restricted"></div>';
  return `
    <div data-part="head"></div>
    <div data-part="progress"></div>
    <div data-part="info" class="detail-grid"></div>
    ${docsBlock}
    <h3 class="section-title">Маршрут</h3>
    <div data-part="timeline" class="timeline"></div>
    <h3 class="section-title">События в реестре</h3>
    <div data-part="events" class="events"></div>`;
}

function headHtml(s) {
  const actions = [];
  if (s.can_start) actions.push('<button class="btn primary-sm" data-action="start">Отправить груз в путь</button>');
  if (s.can_join.length) actions.push(`<button class="btn primary-sm" data-action="join">Присоединиться к перевозке</button>`);
  return `<div class="detail-head">
    <div>
      <div class="track-number">
        <span>${esc(s.number)}</span>
        <button class="icon-btn" data-action="copy" title="Скопировать номер">⧉</button>
      </div>
      <div class="sub">${esc(s.cargo.description)} · ${esc(s.cargo.mode)} · ${esc(s.cargo.equipment)}</div>
    </div>
    <div class="head-actions">${statusChip(s.status)} ${declChip(s.declaration_status)} ${actions.join('')}</div>
  </div>`;
}

function progressHtml(s, ctx) {
  const total = ctx.meta.routes[s.route_id].plan.total;
  const pct = Math.round(s.status.progress * 100);
  const left = s.delivered ? 'груз доставлен' : s.started ? `осталось ≈ ${fmtH(total - s.t)} в пути` : 'ещё не отправлен';
  const held = s.status.code === 'held'
    ? `<div class="banner bad">Груз остановлен на таможенном узле: ждёт выпуска электронной декларации.
       ${s.access === 'customs' ? 'Проверьте декларацию ниже.' : 'Таможня получила документы и рассматривает их.'}</div>`
    : '';
  return `${held}<div class="progress-row"><div class="bar big"><i style="width:${pct}%"></i></div>
    <span>${pct}% · ${left}</span></div>`;
}

function infoHtml(s, ctx, full) {
  const cmp = ctx.meta.routes[s.route_id].compare;
  const f = s.form;
  const cargo = [
    ['Груз', esc(s.cargo.description)],
    ['Тип', esc(s.cargo.cargo_type) + (s.cargo.danger_class ? `, класс ${s.cargo.danger_class}` : '')],
    ['Транспорт', esc(s.cargo.mode)],
    ['Оборудование', esc(s.cargo.equipment)],
    ...(full ? [
      ['Код ТН ВЭД', esc(f.hs)],
      ['Масса', `${fmtNum(f.weight, 1)} т${f.volume ? ` · ${fmtNum(f.volume)} м³` : ''}`],
      ['Стоимость', `$${fmtNum(f.value)}`],
      ['Пломба', `${esc(s.seal)} <span class="chip ok">цела</span>`],
    ] : []),
  ];
  const parts = s.participants.map(p => `<div class="kv"><span>${esc(p.role_name)}</span><b>${
    p.filled ? (p.company ? `${esc(p.company)}<small>${esc(p.name)}</small>` : 'назначен') : '<em>не назначен</em>'}</b></div>`).join('');
  return `
    <div class="panel"><h3>Груз</h3>${cargo.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    <div class="panel"><h3>Участники</h3>${parts}
      ${s.my_role ? `<p class="hint">Вы участвуете как: <b>${esc(ctx.meta.roles[s.my_role].name)}</b></p>` : ''}</div>
    <div class="panel"><h3>Срок по маршруту</h3>
      <div class="big-num">${fmtH(cmp.zhol.total)} <small>вместо ${fmtH(cmp.trad.total)}</small></div>
      <div class="kv"><span>Маршрут</span><b>${esc(ctx.meta.routes[s.route_id].short)}</b></div>
      <div class="kv"><span>Экономия с Жол-ID</span><b class="ok-text">${fmtH(cmp.trad.total - cmp.zhol.total)}</b></div>
    </div>
    ${costHtml(s.cost)}`;
}

// Экспедитор видит разбивку со своим вознаграждением, остальные — общий фрахт (решает сервер).
function costHtml(cost) {
  if (!cost) return '';
  return `<div class="panel cost-lines"><h3>Стоимость перевозки</h3>
    ${cost.lines.map(l => `<div class="kv"><span>${esc(l.label)}</span><b>${fmtUsd(l.usd)}</b></div>`).join('')}
    ${cost.lines.length > 1 ? `<div class="kv total-row"><span>Итого</span><b>${fmtUsd(cost.total)}</b></div>` : ''}
    ${cost.route ? `<p class="hint">Расчёт по маршруту ${esc(cost.route)}</p>` : ''}
    ${cost.hidden_note ? '<p class="hint">Остальные участники видят только общую сумму фрахта, без разбивки и вашего вознаграждения.</p>' : ''}
  </div>`;
}

function requiredHtml(s) {
  const done = s.required_docs.filter(d => d.present).length;
  return `<div class="checklist-head">Обязательные для декларации: ${done} из ${s.required_docs.length}</div>
    <ul class="checklist">${s.required_docs.map(d =>
      `<li class="${d.present ? 'ok' : ''}">${d.present ? '✓' : '○'} ${esc(d.name)}</li>`).join('')}</ul>`;
}

function docsHtml(s) {
  if (!s.documents.length) return '<p class="hint">Документы ещё не загружены.</p>';
  return `<div class="doc-list">${s.documents.map(d => `
    <div class="doc">
      <div class="doc-main">
        <b>${esc(d.type_name)}</b>
        <span>${esc(d.filename)} · ${fmtSize(d.size)}</span>
        <small>${esc(d.uploaded_role)}: ${esc(d.uploader)} · ${fmtDate(d.uploaded_at)} · <code title="SHA-256: ${d.sha256}">${d.sha256.slice(0, 10)}…</code></small>
      </div>
      <div class="doc-actions">
        <button class="btn small" data-action="download" data-id="${d.id}" data-name="${esc(d.filename)}">Скачать</button>
        ${d.can_delete ? `<button class="btn small danger" data-action="delete" data-id="${d.id}">Удалить</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

function declHtml(s) {
  const d = s.declaration;
  const missing = s.required_docs.filter(x => !x.present).map(x => x.name);
  const declarant = ['shipper', 'forwarder'].includes(s.my_role);
  const submitBtn = label => `<button class="btn primary" data-action="declare">${label}</button>`;

  if (!d) {
    if (s.can_declare) {
      return `<p>Все обязательные документы на месте. Платформа соберёт декларацию из данных перевозки
        и загруженных файлов и отправит её таможне и всем органам одновременно.</p>${submitBtn('Сформировать и подать ЭД')}`;
    }
    if (declarant) return `<p class="hint">Чтобы подать декларацию, загрузите: ${missing.map(esc).join(', ')}.</p>`;
    return `<p class="hint">Декларацию подаёт грузоотправитель или экспедитор, когда все участники загрузят документы.
      ${missing.length ? `Не хватает: ${missing.map(esc).join(', ')}.` : 'Документы собраны.'}</p>`;
  }

  const [cls, label] = DECL_STATUS[d.status];
  const decide = s.can_decide ? `
    <div class="decide">
      <textarea data-comment rows="2" placeholder="Комментарий (обязателен при отказе)"></textarea>
      <div class="row-btns">
        <button class="btn ok" data-action="release" data-id="${d.id}">Выпустить декларацию</button>
        <button class="btn danger" data-action="reject" data-id="${d.id}">Отклонить</button>
      </div>
    </div>` : '';
  const note = {
    submitted: 'Таможня проверяет документы. Пока декларация не выпущена, груз остановится на первом таможенном узле.',
    released: 'Сведения разосланы всем органам. Таможенные узлы груз проходит без повторной проверки документов.',
    rejected: s.can_declare ? 'Исправьте или дозагрузите документы и подайте декларацию повторно.' : 'Декларант должен исправить документы и подать её повторно.',
  }[d.status];
  return `
    <div class="decl-card ${cls}">
      <div class="decl-top"><b>${esc(d.number)}</b><span class="chip ${cls}">${label}</span></div>
      <div class="kv"><span>Подана</span><b>${fmtDate(d.submitted_at)}<small>${esc(d.submitted_by)}</small></b></div>
      ${d.decided_at ? `<div class="kv"><span>Решение</span><b>${fmtDate(d.decided_at)}<small>${esc(d.decided_by)}</small></b></div>` : ''}
      ${d.comment ? `<div class="banner ${d.status === 'rejected' ? 'bad' : ''}">${esc(d.comment)}</div>` : ''}
      <p class="hint">${note}</p>
      <button class="btn small" data-action="open-decl" data-id="${d.id}">Открыть декларацию</button>
    </div>
    ${decide}
    ${d.status === 'rejected' && s.can_declare ? submitBtn('Подать повторно') : ''}`;
}

function restrictedHtml(s, ctx) {
  const msg = s.access === 'public'
    ? 'Войдите в систему, чтобы видеть участников, документы и декларацию.'
    : 'Документы и электронная декларация доступны только участникам перевозки и таможне.';
  const join = s.can_join.length
    ? `<p>Если вы ${esc(ctx.meta.roles[s.can_join[0]].name.toLowerCase())} этого груза, присоединитесь к перевозке:
       после этого сможете загружать документы.</p><button class="btn primary-sm" data-action="join">Присоединиться как ${esc(ctx.meta.roles[s.can_join[0]].name.toLowerCase())}</button>`
    : '';
  return `<div class="panel restricted"><p>${msg}</p>${join}</div>`;
}

function timelineHtml(s, ctx) {
  const route = ctx.meta.routes[s.route_id];
  const phases = route.plan.phases;
  const cur = s.started && !s.delivered ? phases[s.cursor] : null;
  return route.nodes.map((id, i) => {
    const n = ctx.meta.nodes[id];
    const reached = i === 0 ? s.started : phases.some(p => p.kind === 'move' && p.to === id && s.t >= p.end);
    let cls = reached ? 'done' : '';
    if (cur && ((cur.kind === 'dwell' && cur.node === id) || (cur.kind === 'move' && cur.to === id))) {
      cls = s.status.code === 'held' ? 'current held' : 'current';
    }
    const meta = n.dwell ? `простой ${n.dwell.zhol} ч <s>${n.dwell.trad} ч</s>` : n.country;
    return `<div class="tl-node ${cls}"><span class="tl-dot"></span>
      <div class="tl-name">${esc(n.name)}${n.customs ? ' <span class="tl-badge">таможня</span>' : ''}</div>
      <div class="tl-meta">${meta}</div></div>`;
  }).join('');
}

function eventsHtml(s) {
  return s.events.map(e => `<div class="event"><span>${fmtTime(e.ts)}</span><span>${esc(e.text)}</span>
    <code title="${e.hash}">${e.hash.slice(0, 10)}…</code></div>`).join('');
}

/* ---------------- Действия ---------------- */

function bindActions(container) {
  container._bound = true;
  const run = async (fn, okMessage) => {
    try {
      await fn();
      if (okMessage) toast(okMessage);
      await container._ctx.refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  };

  container.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const s = container._s;
    const id = btn.dataset.id;
    const comment = () => container.querySelector('[data-comment]')?.value.trim();
    switch (btn.dataset.action) {
      case 'copy': copyText(s.number); break;
      case 'start': run(() => api(`/api/shipments/${s.number}/start`, { method: 'POST' }), 'Груз отправлен в путь'); break;
      case 'join': run(() => api(`/api/shipments/${s.number}/join`, { method: 'POST', body: {} }), 'Вы присоединились к перевозке'); break;
      case 'declare': run(() => api(`/api/shipments/${s.number}/declaration`, { method: 'POST' }), 'Декларация подана в таможню'); break;
      case 'release': run(() => api(`/api/declarations/${id}/decision`, { method: 'POST', body: { decision: 'release', comment: comment() || null } }), 'Декларация выпущена'); break;
      case 'reject': run(() => api(`/api/declarations/${id}/decision`, { method: 'POST', body: { decision: 'reject', comment: comment() || null } }), 'Декларация отклонена'); break;
      case 'open-decl': openDeclaration(id, () => container._ctx.refresh()); break;
      case 'download': download(`/api/documents/${id}`, btn.dataset.name).catch(err => toast(err.message, 'bad')); break;
      case 'delete':
        if (confirm('Удалить документ?')) run(() => api(`/api/documents/${id}`, { method: 'DELETE' }), 'Документ удалён');
        break;
    }
  });

  container.addEventListener('change', e => {
    if (e.target.name !== 'doc_type') return;
    updateHint(container);
  });

  container.addEventListener('submit', e => {
    const form = e.target.closest('[data-upload]');
    if (!form) return;
    e.preventDefault();
    const file = form.file.files[0];
    if (!file) return toast('Выберите файл', 'bad');
    if (file.size > 10 * 1024 * 1024) return toast('Файл больше 10 МБ', 'bad');
    const fd = new FormData(form);
    const btn = form.querySelector('button');
    btn.disabled = true;
    run(async () => {
      await api(`/api/shipments/${container._s.number}/documents`, { method: 'POST', form: fd });
      form.reset();
    }, 'Документ загружен').finally(() => { btn.disabled = false; pickMissing(container); });
  });
}

// Предлагаем загрузить первый недостающий обязательный документ.
function pickMissing(container) {
  const form = $('[data-upload]', container);
  if (!form) return;
  const missing = container._s.required_docs?.find(d => !d.present);
  if (missing) form.doc_type.value = missing.type;
  updateHint(container);
}

function updateHint(container) {
  const form = $('[data-upload]', container);
  if (!form) return;
  const { meta } = container._ctx;
  const type = meta.doc_types[form.doc_type.value];
  const who = type.hint.map(r => meta.roles[r].name.toLowerCase()).join(', ');
  $('[data-hint]', form).textContent = `Обычно загружает: ${who}. Форматы: PDF, JPG, PNG, DOC(X), XLS(X), TXT, до 10 МБ.`;
}
