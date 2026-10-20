import { api, session } from './api.js';
import { $, closeModal, esc, fmtDate, fmtNum, openModal, toast } from './util.js';

const STAMP = { submitted: 'НА ПРОВЕРКЕ', released: 'ВЫПУЩЕНО', rejected: 'ОТКЛОНЕНО' };
const STATUS = { submitted: ['pending', 'На проверке'], released: ['ok', 'Выпущена'], rejected: ['bad', 'Отклонена'] };

// Печатная форма электронной декларации. Документы перечислены с хэшами SHA-256:
// подменить файл после выпуска незаметно нельзя.
export async function openDeclaration(id, onChanged) {
  let d;
  try {
    d = await api(`/api/declarations/${id}`);
  } catch (err) {
    return toast(err.message, 'bad');
  }
  const p = d.payload;
  const g = p.goods;
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : '');
  const canDecide = session.user?.role === 'customs' && d.status === 'submitted';

  openModal(`
    <div class="declaration" id="print-area">
      <div class="decl-header">
        <div>
          <div class="decl-kicker">Жол-ID · единое окно</div>
          <h2>Электронная декларация № ${esc(d.number)}</h2>
          <div class="hint">${esc(p.procedure)} · перевозка ${esc(p.shipment)} · подана ${fmtDate(d.submitted_at)}</div>
        </div>
        <div class="stamp ${d.status}">${STAMP[d.status]}${d.decided_at ? `<small>${fmtDate(d.decided_at)}</small>` : ''}</div>
      </div>

      <h3>1. Декларант</h3>
      <table class="decl-table">
        ${row('Лицо', `${esc(p.declarant.name)} (${esc(p.declarant.role.toLowerCase())})`)}
        ${row('Организация', esc(p.declarant.company))}
        ${row('БИН', esc(p.declarant.bin))}
      </table>

      <h3>2. Стороны сделки</h3>
      <table class="decl-table">
        ${row('Отправитель', esc(p.shipper))}
        ${row('Получатель', esc(p.consignee))}
      </table>

      <h3>3. Товар</h3>
      <table class="decl-table">
        ${row('Наименование', esc(g.description))}
        ${row('Код ТН ВЭД', esc(g.hs))}
        ${row('Тип груза', esc(g.cargo_type))}
        ${row('Опасность', esc(g.danger))}
        ${row('Масса брутто', `${fmtNum(g.weight_t, 2)} т`)}
        ${row('Объём', g.volume_m3 ? `${fmtNum(g.volume_m3)} м³` : '')}
        ${row('Таможенная стоимость', `$${fmtNum(g.value_usd)}`)}
        ${row('Сертификат', esc(g.cert))}
      </table>

      <h3>4. Транспорт</h3>
      <table class="decl-table">
        ${row('Вид транспорта', esc(p.transport.mode))}
        ${row('Оборудование', esc(p.transport.equipment))}
        ${row('Маршрут', esc(p.transport.route))}
        ${row('Навигационная пломба', esc(p.transport.seal))}
      </table>

      <h3>5. Приложенные документы</h3>
      <table class="decl-table docs">
        <tr><th>Документ</th><th>Файл</th><th>SHA-256</th></tr>
        ${p.documents.map(x => `<tr><td>${esc(x.type)}</td><td>${esc(x.filename)}</td><td><code>${x.sha256.slice(0, 16)}…</code></td></tr>`).join('')}
      </table>

      <h3>6. Получатели сведений (данные введены один раз)</h3>
      <p>${p.recipients.map(esc).join(' · ')}</p>

      ${d.comment ? `<div class="banner ${d.status === 'rejected' ? 'bad' : ''}"><b>Комментарий таможни:</b> ${esc(d.comment)}</div>` : ''}
      <div class="decl-footer">
        <div>Подал: ${esc(d.submitted_by)}</div>
        ${d.decided_by ? `<div>Решение: ${esc(d.decided_by)}</div>` : ''}
        <div>Хэш декларации: <code>${d.hash}</code></div>
      </div>
    </div>
    <div class="modal-actions no-print">
      ${canDecide ? `
        <textarea id="decl-comment" rows="2" placeholder="Комментарий (обязателен при отказе)"></textarea>
        <button class="btn ok" data-decide="release">Выпустить</button>
        <button class="btn danger" data-decide="reject">Отклонить</button>` : ''}
      <button class="btn" data-print>Печать / PDF</button>
    </div>`, true);

  $('[data-print]').addEventListener('click', () => window.print());
  document.querySelectorAll('[data-decide]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      const comment = $('#decl-comment').value.trim() || null;
      await api(`/api/declarations/${id}/decision`, { method: 'POST', body: { decision: btn.dataset.decide, comment } });
      toast(btn.dataset.decide === 'release' ? 'Декларация выпущена' : 'Декларация отклонена');
      closeModal();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
}

export async function renderDeclarationsTab(root, { onOpenShipment }) {
  const isCustoms = session.user.role === 'customs';
  let list;
  try {
    list = await api('/api/declarations');
  } catch (err) {
    root.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    return;
  }
  const filter = root.dataset.filter || (isCustoms ? 'submitted' : 'all');
  const counts = { all: list.length, submitted: 0, released: 0, rejected: 0 };
  list.forEach(d => { counts[d.status] += 1; });
  const shown = filter === 'all' ? list : list.filter(d => d.status === filter);
  const tabs = [['submitted', 'На проверке'], ['released', 'Выпущены'], ['rejected', 'Отклонены'], ['all', 'Все']]
    .map(([k, label]) => `<button class="seg-btn ${filter === k ? 'active' : ''}" data-filter="${k}">${label} <b>${counts[k]}</b></button>`).join('');

  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>${isCustoms ? 'Очередь электронных деклараций' : 'Мои электронные декларации'}</h2>
        <div class="seg">${tabs}</div>
      </div>
      <p class="muted">${isCustoms
        ? 'Декларации собраны платформой из данных перевозки и документов участников. После выпуска сведения автоматически уходят во все органы.'
        : 'Декларацию подаёт грузоотправитель или экспедитор в карточке перевозки, когда загружены все обязательные документы.'}</p>
      ${shown.length ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Декларация</th><th>Перевозка</th><th>Декларант</th><th>Подана</th><th>Статус</th><th></th></tr></thead>
        <tbody>${shown.map(d => `<tr>
          <td><b>${esc(d.number)}</b></td>
          <td><button class="link" data-ship="${esc(d.shipment)}">${esc(d.shipment)}</button></td>
          <td>${esc(d.submitted_by)}</td>
          <td>${fmtDate(d.submitted_at)}</td>
          <td><span class="chip ${STATUS[d.status][0]}">${STATUS[d.status][1]}</span></td>
          <td><button class="btn small" data-open="${d.id}">${isCustoms && d.status === 'submitted' ? 'Проверить' : 'Открыть'}</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="hint">Здесь пока пусто.</p>'}
    </div>`;

  root.onclick = e => {
    const f = e.target.closest('[data-filter]');
    if (f) { root.dataset.filter = f.dataset.filter; renderDeclarationsTab(root, { onOpenShipment }); }
    const o = e.target.closest('[data-open]');
    if (o) openDeclaration(o.dataset.open, () => renderDeclarationsTab(root, { onOpenShipment }));
    const sh = e.target.closest('[data-ship]');
    if (sh) onOpenShipment(sh.dataset.ship);
  };
}
