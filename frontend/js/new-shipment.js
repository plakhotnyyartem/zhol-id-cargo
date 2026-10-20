import { api } from './api.js';
import { capacityError, capacityOf, minUnits } from './calc.js';
import { $, copyText, esc, fmtNum, toast } from './util.js';

/** Регистрация перевозки. Возвращает функцию prefill(params) для переноса данных из калькулятора. */
export function initNewShipment(root, { meta, user, onCreated, onOpen }) {
  const isForwarder = user.role === 'forwarder';
  const opt = obj => Object.entries(obj).map(([id, v]) => `<option value="${id}">${esc(v.name)}</option>`).join('');
  root.innerHTML = `
    <div class="new-grid">
      <form class="card" data-form novalidate>
        <div class="card-head"><h2>Регистрация перевозки</h2>
          <button type="button" class="btn small ghost" data-example>Заполнить пример</button></div>
        <p class="muted">После регистрации перевозка получит номер. По нему её смогут найти и отслеживать остальные участники, а затем присоединиться и загрузить свои документы.</p>
        <div class="form-grid">
          <label class="wide">Отправитель<input name="shipper" required></label>
          <label class="wide">Получатель<input name="consignee" required></label>
          <label class="wide">Наименование груза<input name="description" required></label>
          <label>Код ТН ВЭД<input name="hs" inputmode="numeric" maxlength="10" placeholder="10 цифр" required></label>
          <label>Тип груза<select name="cargo_type">${opt(meta.cargo_types)}</select></label>
          <label data-danger hidden>Класс опасности<select name="danger_class">${Object.entries(meta.danger_classes).map(([n, c]) => `<option value="${n}">${n} — ${esc(c.name)}</option>`).join('')}</select></label>
          <label data-cert hidden><span data-cert-label>Сертификат</span><input name="cert"></label>
          <label>Вид транспорта<select name="mode">${opt(meta.transport_modes)}</select></label>
          <label>Оборудование<select name="equipment"></select></label>
          <label>Количество единиц<input name="units" type="number" min="1" step="1" value="1" required></label>
          <label>Масса, т<input name="weight" type="number" min="0.01" step="0.01" required></label>
          <label>Объём, м³ <small>необязательно</small><input name="volume" type="number" min="0" step="0.1"></label>
          <label>Стоимость груза, USD<input name="value" type="number" min="1" step="1" required></label>
          <p class="hint wide" data-cap></p>
          <label class="wide">Маршрут для отслеживания<select name="route_id">${Object.entries(meta.routes).map(([id, r]) => `<option value="${id}">${esc(r.name)}: ${esc(r.short)}</option>`).join('')}</select></label>
        </div>

        <div class="cost-box">
          <div class="field-label">Стоимость перевозки</div>
          <div data-cost-calc hidden></div>
          <div class="form-grid">
            <label data-freight>Фрахт, USD <small>необязательно</small><input name="freight_usd" type="number" min="0" step="10"></label>
            ${isForwarder ? `<label>Ваше вознаграждение (экспедирование), USD<input name="forwarding_usd" type="number" min="0" step="10"></label>
            <p class="hint wide">Грузоотправитель, получатель и перевозчик увидят одну сумму — общий фрахт, без разбивки и без вашего вознаграждения.</p>` : ''}
          </div>
        </div>

        <p class="form-error" data-error></p>
        <button class="btn primary" type="submit">Зарегистрировать и получить номер</button>
      </form>
      <div data-side></div>
    </div>`;

  const form = $('[data-form]', root);
  const side = $('[data-side]', root);
  const CERT = { agro: 'Номер фитосанитарного сертификата', animal: 'Номер ветеринарного сертификата', dangerous: 'Номер ООН / паспорт безопасности' };
  const eqNow = () => meta.transport_modes[form.mode.value].equipment[form.equipment.value];
  const num = name => (form[name].value === '' ? null : Number(form[name].value));
  let calcCost = null;   // параметры расчёта из калькулятора: города и услуги

  const fillEquipment = keep => {
    const eqs = meta.transport_modes[form.mode.value].equipment;
    form.equipment.innerHTML = Object.entries(eqs).map(([id, e]) => `<option value="${id}">${esc(e.name)}</option>`).join('');
    if (keep && eqs[keep]) form.equipment.value = keep;
  };
  const sync = () => {
    const type = form.cargo_type.value;
    $('[data-danger]', root).hidden = type !== 'dangerous';
    $('[data-cert]', root).hidden = !CERT[type];
    if (CERT[type]) $('[data-cert-label]', root).textContent = CERT[type];
  };

  // Подсказываем число единиц по вместимости, пока пользователь не ввёл его сам.
  let unitsTouched = false;
  const suggestUnits = () => {
    if (!unitsTouched && capacityOf(eqNow(), 1) && num('weight') > 0) {
      form.units.value = minUnits(eqNow(), num('weight'), num('volume') || 0);
    }
  };

  // Масса и объём ограничены вместимостью выбранного количества единиц.
  const syncLimits = () => {
    const eq = eqNow();
    const units = Math.max(1, num('units') || 1);
    const cap = capacityOf(eq, units);
    form.weight.max = cap ? cap.t : '';
    form.volume.max = cap ? cap.m3 : '';
    const err = capacityError(eq, units, num('weight') || 0, num('volume') || 0);
    form.weight.classList.toggle('invalid', err.startsWith('Масса'));
    form.volume.classList.toggle('invalid', err.startsWith('Объём'));
    const box = $('[data-cap]', root);
    box.classList.toggle('bad', !!err);
    box.textContent = !cap ? 'Тариф от массы груза: ограничения по количеству единиц нет.'
      : err || `Допустимо: до ${fmtNum(cap.t, 1)} т и ${fmtNum(cap.m3, 1)} м³ (${units} × ${fmtNum(eq.cap_t, 1)} т / ${fmtNum(eq.cap_m3)} м³).`;
    return err;
  };

  const renderCost = () => {
    const box = $('[data-cost-calc]', root);
    box.hidden = !calcCost;
    $('[data-freight]', root).hidden = !!calcCost;
    if (!calcCost) return;
    const o = calcCost.options || {};
    const services = [
      o.insurance && `страховка ${o.insurance_pct}%`,
      o.loading && `погрузка${o.loading_usd != null ? ` $${fmtNum(o.loading_usd)}` : ''}`,
      o.escort && `сопровождение${o.escort_usd != null ? ` $${fmtNum(o.escort_usd)}` : ''}`,
      !isForwarder && o.forwarding && `экспедирование${o.forwarding_usd != null ? ` $${fmtNum(o.forwarding_usd)}` : ''}`,
    ].filter(Boolean);
    box.innerHTML = `<div class="calc-note">
      <div>По расчёту калькулятора: <b>${esc(meta.cities[calcCost.origin].name)} → ${esc(meta.cities[calcCost.destination].name)}</b>${services.length ? ` · ${services.join(', ')}` : ''}</div>
      <div class="hint">Сумма пересчитается по массе, количеству и оборудованию из этой формы.</div>
      <button type="button" class="btn small" data-reset-cost>Указать фрахт вручную</button></div>`;
  };

  form.addEventListener('input', e => {
    if (e.target.name === 'units') unitsTouched = true;
    if (e.target.name === 'mode') fillEquipment();
    sync();
    if (['weight', 'volume', 'mode', 'equipment'].includes(e.target.name)) suggestUnits();
    syncLimits();
  });

  // Больше допустимого ввести нельзя: при выходе из поля значение срезается до максимума.
  form.addEventListener('change', e => {
    const input = e.target;
    if (['weight', 'volume'].includes(input.name) && input.max !== '' && Number(input.value) > Number(input.max)) {
      input.value = Number(input.max);
      syncLimits();
      toast(`Больше нельзя: значение уменьшено до допустимого максимума ${fmtNum(input.max, 1)}`);
    }
  });

  root.addEventListener('click', e => {
    if (e.target.closest('[data-reset-cost]')) { calcCost = null; renderCost(); }
  });

  const setValues = values => {
    for (const [k, v] of Object.entries(values)) {
      if (k === 'equipment' || k === 'cost' || v == null || !form.elements[k]) continue;
      form.elements[k].value = v;
    }
    fillEquipment(values.equipment);
    sync();
    syncLimits();
  };

  const defaults = { shipper: user.role === 'shipper' ? user.company : '', consignee: user.role === 'consignee' ? user.company : '' };
  setValues({ ...defaults, mode: 'multimodal', equipment: 'container_40' });
  renderCost();
  sideInfo();

  $('[data-example]', root).addEventListener('click', () => {
    unitsTouched = false;
    setValues({ shipper: defaults.shipper || 'ТОО «Степной Экспресс» (демо)', consignee: defaults.consignee || 'Anatolia Trade (демо)',
      description: 'Мясо говяжье замороженное', hs: '0202300000', cargo_type: 'animal', cert: 'ВС-2026-11893',
      mode: 'multimodal', equipment: 'ref_40', weight: 260, volume: 520, value: 1420000, route_id: 'tmtm-khorgos' });
    suggestUnits();
    syncLimits();
  });

  const buildCost = () => {
    const forwarding = isForwarder ? num('forwarding_usd') : null;
    if (calcCost) {
      const options = { ...calcCost.options };
      if (forwarding != null) Object.assign(options, { forwarding: false, forwarding_usd: null });
      return { origin: calcCost.origin, destination: calcCost.destination, options, forwarding_usd: forwarding };
    }
    const freight = num('freight_usd');
    return freight || forwarding ? { freight_usd: freight, forwarding_usd: forwarding } : null;
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('[data-error]', form);
    err.textContent = '';
    const d = Object.fromEntries(new FormData(form));
    const body = {
      shipper: d.shipper, consignee: d.consignee, description: d.description, hs: d.hs,
      cargo_type: d.cargo_type, mode: d.mode, equipment: d.equipment, route_id: d.route_id,
      danger_class: d.cargo_type === 'dangerous' ? Number(d.danger_class) : null,
      cert: CERT[d.cargo_type] ? d.cert || null : null,
      weight: num('weight'), volume: num('volume'), units: num('units'), value: num('value'),
      cost: buildCost(),
    };
    if (!/^\d{10}$/.test(body.hs)) { err.textContent = 'Код ТН ВЭД должен состоять из 10 цифр'; return; }
    const capErr = syncLimits();
    if (capErr) { err.textContent = capErr; return; }
    try {
      const s = await api('/api/shipments', { method: 'POST', body });
      unitsTouched = false;
      calcCost = null;
      form.reset();
      setValues({ ...defaults, mode: 'multimodal', equipment: 'container_40' });
      renderCost();
      side.innerHTML = `
        <div class="card success">
          <div class="success-icon">✓</div>
          <h2>Перевозка зарегистрирована</h2>
          <p class="muted">Номер для отслеживания. Передайте его перевозчику, получателю и экспедитору: по нему они найдут груз и присоединятся к перевозке.</p>
          <div class="big-track">${esc(s.number)}</div>
          ${s.cost ? `<p class="muted">Стоимость перевозки: <b>$${fmtNum(s.cost.total)}</b></p>` : ''}
          <div class="row-btns center">
            <button class="btn" data-copy="${esc(s.number)}">Скопировать номер</button>
            <button class="btn primary-sm" data-open="${esc(s.number)}">Открыть и загрузить документы</button>
          </div>
        </div>`;
      side.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onCreated(s);
    } catch (ex) {
      err.textContent = ex.message;
    }
  });

  side.addEventListener('click', e => {
    const c = e.target.closest('[data-copy]');
    if (c) copyText(c.dataset.copy);
    const o = e.target.closest('[data-open]');
    if (o) onOpen(o.dataset.open);
  });

  function sideInfo() {
    side.innerHTML = `<div class="card"><h2>Что будет дальше</h2>
      <ol class="steps-list">
        <li><b>Номер перевозки.</b> Сразу после регистрации, например <code>ZH-2026-7KQ4XM</code>.</li>
        <li><b>Участники присоединяются</b> по номеру: перевозчик, получатель, экспедитор.</li>
        <li><b>Каждый загружает свои документы</b>: инвойс, контракт, упаковочный лист, накладную, сертификаты.</li>
        <li><b>Электронная декларация</b> собирается из документов автоматически и уходит в таможню.</li>
        <li><b>Таможня выпускает ЭД</b>, и груз проходит границу и порт без остановки.</li>
      </ol></div>`;
  }

  return prefill => {
    unitsTouched = true;
    calcCost = prefill.cost || null;
    setValues(prefill);
    if (isForwarder && calcCost?.options?.forwarding && calcCost.options.forwarding_usd != null) {
      form.forwarding_usd.value = calcCost.options.forwarding_usd;
    }
    renderCost();
    sideInfo();
  };
}
