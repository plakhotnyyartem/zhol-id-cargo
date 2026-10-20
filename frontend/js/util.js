export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtNum = (n, digits = 0) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: digits });
export const fmtUsd = n => `$${fmtNum(n, 0)}`;
export const fmtH = h => (h < 48 ? `${Math.round(h)} ч` : `${(h / 24).toFixed(1)} сут`);
export const fmtDate = sec => new Date(sec * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const fmtTime = ms => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtSize = b => (b < 1024 ? `${b} Б` : b < 1048576 ? `${(b / 1024).toFixed(0)} КБ` : `${(b / 1048576).toFixed(1)} МБ`);

// Перерисовывает часть интерфейса, только если её разметка изменилась.
// Так опрос сервера раз в пару секунд не сбрасывает выбранный файл, фокус или прокрутку.
export function setPart(el, html) {
  if (el && el._html !== html) {
    el.innerHTML = html;
    el._html = html;
  }
}

let toastTimer;
export function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

export function openModal(html, wide = false) {
  const m = $('#modal');
  $('#modal-body').innerHTML = html;
  m.classList.toggle('wide', wide);
  m.hidden = false;
  document.body.classList.add('modal-open');
}

export function closeModal() {
  $('#modal').hidden = true;
  document.body.classList.remove('modal-open');
}

export const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* приватный режим */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* приватный режим */ } },
};

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Скопировано: ${text}`);
  } catch {
    toast('Не удалось скопировать — выделите номер вручную', 'bad');
  }
}
