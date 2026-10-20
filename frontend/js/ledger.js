import { api } from './api.js';
import { sha256 } from './sha256.js';
import { $, esc, fmtTime } from './util.js';

const blockHash = b => sha256(`${b.idx}|${b.ts}|${b.shipment}|${b.type}|${b.data}|${b.prev_hash}`);

// Браузер пересчитывает хэши сам: если сервер или злоумышленник изменит запись, проверка это покажет.
function verify(blocks) {
  const asc = [...blocks].sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < asc.length; i++) {
    if (blockHash(asc[i]) !== asc[i].hash) return asc[i].idx;
    if (i > 0 && asc[i].prev_hash !== asc[i - 1].hash) return asc[i].idx;
  }
  return -1;
}

export async function renderLedgerTab(root) {
  let data;
  try {
    data = await api('/api/ledger?limit=300');
  } catch (err) {
    root.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    return;
  }
  const blocks = data.blocks;
  let tampered = false;

  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Реестр событий</h2>
        <div class="row-btns">
          <span class="chip" data-status></span>
          <button class="btn small danger" data-tamper>Подменить запись</button>
          <button class="btn small" data-restore hidden>Загрузить заново с сервера</button>
        </div>
      </div>
      <p class="muted">Каждый блок содержит хэш SHA-256 предыдущего. Ваш браузер сам пересчитывает хэши ${blocks.length} последних блоков из ${data.total}.
        Кнопка «Подменить запись» занижает массу груза в одной записи у вас локально, и проверка сразу находит подделку.</p>
      <div class="table-wrap"><table class="data-table ledger-table">
        <thead><tr><th>#</th><th>Время</th><th>Перевозка</th><th>Событие</th><th>Хэш</th></tr></thead>
        <tbody data-body></tbody></table></div>
    </div>`;

  const draw = () => {
    const broken = verify(blocks);
    const st = $('[data-status]', root);
    st.className = `chip ${broken < 0 ? 'ok' : 'bad'}`;
    st.textContent = broken < 0 ? `✓ Цепочка цела · проверено ${blocks.length} блоков` : `✗ Нарушение в блоке #${broken}`;
    $('[data-tamper]', root).hidden = tampered;
    $('[data-restore]', root).hidden = !tampered;
    $('[data-body]', root).innerHTML = blocks.map(b => {
      const d = JSON.parse(b.data);
      return `<tr class="${b.idx === broken ? 'broken' : ''}">
        <td>${b.idx}</td><td>${fmtTime(b.ts)}</td><td>${esc(b.shipment)}</td>
        <td>${esc(d.text)}${d.weight ? ` <code>масса: ${d.weight} т</code>` : ''}</td>
        <td><code title="prev: ${b.prev_hash}">${b.prev_hash.slice(0, 8)}… → ${b.hash.slice(0, 8)}…</code></td></tr>`;
    }).join('');
    return broken;
  };
  draw();

  $('[data-tamper]', root).addEventListener('click', () => {
    // Классическое мошенничество: задним числом занизить заявленную массу груза.
    const target = blocks.find(b => b.type === 'REGISTERED');
    if (!target) return;
    const d = JSON.parse(target.data);
    d.weight = Math.round(d.weight * 0.6);
    target.data = JSON.stringify(d);
    tampered = true;
    draw();
    root.querySelector('tr.broken')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('[data-restore]', root).addEventListener('click', () => renderLedgerTab(root));
}
