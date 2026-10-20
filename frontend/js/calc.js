import { api } from './api.js';
import { $, esc, fmtNum, fmtUsd, toast } from './util.js';

const SERVICES = [
  ['loading', 'Погрузка и выгрузка'],
  ['escort', 'Охрана и сопровождение'],
  ['forwarding', 'Экспедирование'],
];

/** Допустимые масса и объём для выбранного оборудования и количества единиц. null — тариф за кг или тонну. */
export function capacityOf(eq, units) {
  if (!eq || eq.per_kg || eq.per_ton) return null;
  return { t: eq.cap_t * units, m3: eq.cap_m3 * units };
}

export function minUnits(eq, weight, volume) {
  if (!eq || eq.per_kg || eq.per_ton) return 1;
  return Math.max(1, Math.ceil(weight / eq.cap_t - 1e-9), volume ? Math.ceil(volume / eq.cap_m3 - 1e-9) : 1);
}

export function capacityError(eq, units, weight, volume) {
  const cap = capacityOf(eq, units);
  if (!cap) return '';
  const what = `${units} × ${eq.name}`;
  const need = minUnits(eq, weight, volume);
  if (weight > cap.t + 1e-9) return `Масса ${fmtNum(weight, 2)} т больше допустимой для ${what}: максимум ${fmtNum(cap.t, 1)} т. Нужно не меньше ${need} ед.`;
  if (volume && volume > cap.m3 + 1e-9) return `Объём ${fmtNum(volume, 1)} м³ больше допустимого для ${what}: максимум ${fmtNum(cap.m3, 1)} м³. Нужно не меньше ${need} ед.`;
  return '';
}

/**
 * Калькулятор: сначала вид транспорта, потом оборудование и количество единиц, потом груз, маршрут и услуги.
 * Расчёт делает сервер (POST /api/calc/quote); ctx.onBook получает параметры для оформления перевозки.
 */
export function initCalc(root, ctx) {
  const { meta } = ctx;
  const st = { mode: null, equipment: null, quote: null, unitsTouched: false };

  root.innerHTML = `
    <div class="calc-grid">
      <div class="calc-steps">
        <div class="card step">
          <div class="step-title"><span class="step-n">1</span>Вид транспорта</div>
          <div class="choice-grid modes">${Object.entries(meta.transport_modes).map(([id, m]) => `
            <button type="button" class="choice" data-mode="${id}">${esc(m.name)}</button>`).join('')}
          </div>
        </div>
        <div class="card step">
          <div class="step-title"><span class="step-n">2</span>В чём везёте</div>
          <div class="choice-grid" data-equipment><p class="hint">Сначала выберите вид транспорта.</p></div>
        </div>
        <form class="card step" data-form novalidate>
          <div class="step-title"><span class="step-n">3</span>Груз</div>
          <div class="form-grid">
            <label>Тип груза<select name="cargo_type">${Object.entries(meta.cargo_types).map(([id, c]) => `<option value="${id}">${esc(c.name)}</option>`).join('')}</select></label>
            <label data-danger hidden>Класс опасности<select name="danger_class">${Object.entries(meta.danger_classes).map(([n, c]) => `<option value="${n}">${n} — ${esc(c.name)}</option>`).join('')}</select></label>
            <label data-units-field><span data-units-label>Количество единиц</span><input name="units" type="number" min="1" max="1000" step="1" value="1"></label>
            <label>Масса, т<input name="weight" type="number" min="0.01" step="0.01" value="20"></label>
            <label>Объём, м³ <small>необязательно</small><input name="volume" type="number" min="0" step="0.1" placeholder="—"></label>
            <label>Стоимость груза, USD<input name="value" type="number" min="0" step="100" value="50000"></label>
            <p class="hint wide" data-cap></p>
          </div>
          <div class="step-title"><span class="step-n">4</span>Маршрут</div>
          <div class="form-grid">
            <label>Откуда<select name="origin"></select></label>
            <label>Куда<select name="destination"></select></label>
          </div>
          <div class="step-title"><span class="step-n">5</span>Дополнительные услуги</div>
          <p class="hint svc-hint">Стоимость услуг указываете вы. Если поле пустое, в расчёт идёт ориентир по типовому тарифу.</p>
          <div class="services">
            <div class="svc">
              <label><input type="checkbox" name="insurance" checked> Страхование груза</label>
              <span class="svc-input"><input name="insurance_pct" type="number" min="0" max="10" step="0.05" value="0.3"><span>% от стоимости</span></span>
            </div>
            ${SERVICES.map(([key, label]) => `
            <div class="svc">
              <label><input type="checkbox" name="${key}"> ${label}</label>
              <span class="svc-input"><input name="${key}_usd" type="number" min="0" step="10" disabled><span>USD</span></span>
            </div>`).join('')}
          </div>
        </form>
      </div>
      <aside class="card result" data-result></aside>
    </div>`;

  const form = $('[data-form]', root);
  const eqNow = () => (st.mode ? meta.transport_modes[st.mode].equipment[st.equipment] : null);
  const num = name => (form[name].value === '' ? null : Number(form[name].value));

  const fillCities = () => {
    const ok = c => (st.mode === 'sea' ? c.port : st.mode === 'air' ? c.air : true);
    const opts = Object.entries(meta.cities).filter(([, c]) => ok(c))
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru'))
      .map(([id, c]) => `<option value="${id}">${esc(c.name)} (${c.country})</option>`).join('');
    for (const name of ['origin', 'destination']) {
      const prev = form[name].value;
      form[name].innerHTML = opts;
      if ([...form[name].options].some(o => o.value === prev)) form[name].value = prev;
    }
    // Разумные пары по умолчанию для каждого вида транспорта.
    const defaults = { sea: ['aktau', 'baku'], air: ['almaty', 'istanbul'], road: ['almaty', 'tashkent'],
      rail: ['almaty', 'aktau'], multimodal: ['almaty', 'baku'] };
    if (form.origin.value === form.destination.value && defaults[st.mode]) {
      [form.origin.value, form.destination.value] = defaults[st.mode];
    }
  };

  const renderEquipment = () => {
    const box = $('[data-equipment]', root);
    const eqs = meta.transport_modes[st.mode].equipment;
    if (!eqs[st.equipment]) st.equipment = Object.keys(eqs)[0];
    box.innerHTML = Object.entries(eqs).map(([id, e]) => {
      const cap = e.per_kg ? 'тариф за кг' : e.per_ton ? 'тариф за тонну' : `до ${fmtNum(e.cap_t, 1)} т · ${fmtNum(e.cap_m3)} м³ на единицу`;
      return `<button type="button" class="choice ${id === st.equipment ? 'active' : ''}" data-eq="${id}">
        ${esc(e.name)}<small>${cap}${e.ref ? ' · реф' : ''}</small></button>`;
    }).join('');
  };

  // Пока пользователь сам не менял количество, подбираем минимально нужное.
  const suggestUnits = () => {
    const eq = eqNow();
    if (!st.unitsTouched && capacityOf(eq, 1)) form.units.value = minUnits(eq, num('weight') || 0, num('volume') || 0);
  };

  // Ограничения полей: max у массы и объёма = вместимость × количество единиц.
  const syncLimits = () => {
    const eq = eqNow();
    const cap = capacityOf(eq, Math.max(1, num('units') || 1));
    $('[data-units-field]', root).hidden = !cap;
    $('[data-units-label]', root).textContent = eq && cap ? `Количество: ${eq.name.toLowerCase()}` : 'Количество единиц';
    form.weight.max = cap ? cap.t : '';
    form.volume.max = cap ? cap.m3 : '';
    const err = capacityError(eq, Math.max(1, num('units') || 1), num('weight') || 0, num('volume') || 0);
    form.weight.classList.toggle('invalid', !!err && err.startsWith('Масса'));
    form.volume.classList.toggle('invalid', !!err && err.startsWith('Объём'));
    const capBox = $('[data-cap]', root);
    capBox.classList.toggle('bad', !!err);
    capBox.textContent = !cap ? (eq ? 'Тариф считается от массы груза, ограничения по количеству нет.' : '')
      : err || `Допустимо: до ${fmtNum(cap.t, 1)} т и ${fmtNum(cap.m3, 1)} м³ (${num('units') || 1} × ${fmtNum(eq.cap_t, 1)} т / ${fmtNum(eq.cap_m3)} м³).`;
    return err;
  };

  const syncServices = () => {
    form.insurance_pct.disabled = !form.insurance.checked;
    for (const [key] of SERVICES) form[`${key}_usd`].disabled = !form[key].checked;
  };

  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(calculate, 250); };

  async function calculate() {
    const out = $('[data-result]', root);
    if (!st.mode) {
      out.innerHTML = `<h2>Стоимость перевозки</h2><p class="hint">Выберите вид транспорта — расчёт появится здесь и будет обновляться при каждом изменении.</p>`;
      return;
    }
    const options = { insurance: form.insurance.checked, insurance_pct: num('insurance_pct') ?? 0 };
    for (const [key] of SERVICES) {
      options[key] = form[key].checked;
      options[`${key}_usd`] = form[key].checked ? num(`${key}_usd`) : null;
    }
    const body = {
      mode: st.mode, equipment: st.equipment, cargo_type: form.cargo_type.value,
      danger_class: form.cargo_type.value === 'dangerous' ? Number(form.danger_class.value) : null,
      weight: num('weight'), volume: num('volume'), units: Math.max(1, num('units') || 1),
      value: num('value') || 0, origin: form.origin.value, destination: form.destination.value, options,
    };
    const fail = msg => { st.quote = null; out.innerHTML = `<h2>Стоимость перевозки</h2><div class="banner bad">${esc(msg)}</div>`; };
    if (!(body.weight > 0)) return fail('Укажите массу груза.');
    const capErr = syncLimits();
    if (capErr) return fail(capErr);
    if (options.insurance && !(options.insurance_pct >= 0 && options.insurance_pct <= 10)) return fail('Процент страховки — от 0 до 10.');
    try {
      const q = await api('/api/calc/quote', { method: 'POST', body });
      st.quote = { q, body };
      out.innerHTML = resultHtml(q, ctx);
      for (const [key] of SERVICES) form[`${key}_usd`].placeholder = `≈ ${fmtNum(q.suggested[key])}`;
      form.escort.checked ||= q.escort_required;
      form.escort.disabled = q.escort_required;
      syncServices();
    } catch (err) {
      fail(err.message);
    }
  }

  root.addEventListener('click', e => {
    const m = e.target.closest('[data-mode]');
    if (m) {
      st.mode = m.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === m));
      renderEquipment();
      fillCities();
      suggestUnits();
      schedule();
    }
    const eq = e.target.closest('[data-eq]');
    if (eq) {
      st.equipment = eq.dataset.eq;
      renderEquipment();
      suggestUnits();
      schedule();
    }
    if (e.target.closest('[data-book]') && st.quote) {
      const { body } = st.quote;
      ctx.onBook({
        mode: body.mode, equipment: body.equipment, cargo_type: body.cargo_type, danger_class: body.danger_class,
        weight: body.weight, volume: body.volume, value: body.value, units: body.units,
        cost: { origin: body.origin, destination: body.destination, options: body.options },
      });
    }
  });

  form.addEventListener('input', e => {
    if (e.target.name === 'units') st.unitsTouched = true;
    if (e.target.name === 'weight' || e.target.name === 'volume') suggestUnits();
    $('[data-danger]', root).hidden = form.cargo_type.value !== 'dangerous';
    syncServices();
    syncLimits();
    schedule();
  });

  // Больше допустимого ввести нельзя: при выходе из поля значение срезается до максимума.
  form.addEventListener('change', e => {
    const input = e.target;
    if (!['weight', 'volume'].includes(input.name) || input.max === '' || input.value === '') return;
    if (Number(input.value) > Number(input.max)) {
      input.value = Number(input.max);
      syncLimits();
      toast(`Больше нельзя: значение уменьшено до допустимого максимума ${fmtNum(input.max, 1)}`);
      schedule();
    }
  });

  fillCities();
  syncServices();
  calculate();
}

function resultHtml(q, ctx) {
  const canBook = ctx.user.role !== 'customs';
  return `
    <h2>Стоимость перевозки</h2>
    <div class="total">${fmtUsd(q.total_usd)}</div>
    <div class="total-sub">≈ ${fmtNum(q.total_kzt)} ₸ <small>по курсу ${q.kzt_rate} ₸/$</small></div>
    <div class="kv"><span>Расстояние</span><b>${fmtNum(q.distance_km)} км</b></div>
    <div class="kv"><span>Транспорт</span><b>${esc(q.unit_label)}</b></div>
    <table class="breakdown">${q.lines.map(l => `<tr><td>${esc(l.label)}</td><td>${fmtUsd(l.usd)}</td></tr>`).join('')}
      <tr class="sum"><td>Итого</td><td>${fmtUsd(q.total_usd)}</td></tr></table>
    <div class="days">
      <div><span>Срок с Жол-ID</span><b>${fmtNum(q.days.zhol, 1)} сут</b></div>
      <div><span>Без единого окна</span><b class="muted-b">${fmtNum(q.days.trad, 1)} сут</b></div>
    </div>
    ${q.saving_usd ? `<div class="banner ok">Электронная декларация дешевле брокерского оформления на ${fmtUsd(q.saving_usd)}</div>` : ''}
    ${q.warnings.map(w => `<div class="banner">${esc(w)}</div>`).join('')}
    ${canBook ? '<button class="btn primary" data-book>Оформить перевозку с этими параметрами</button>' : ''}
    <p class="hint">Расчёт ориентировочный: модельные тарифы прототипа, не публичная оферта.</p>`;
}
