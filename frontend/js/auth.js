import { api, session } from './api.js';
import { $, esc } from './util.js';

export function initAuth(root, { meta, onLogin, onTrack }) {
  const roles = Object.entries(meta.roles);
  root.innerHTML = `
    <div class="auth-hero">
      <div class="brand big"><div class="logo">Ж</div><div><div class="brand-name">Жол-ID <span>Карго</span></div>
        <div class="brand-sub">Единое цифровое окно для грузовых перевозок</div></div></div>
      <h1>Один вход. Одна подача документов. <em>Данные — один раз.</em></h1>
      <ul class="hero-list">
        <li>Грузоотправитель, получатель, экспедитор, перевозчик и таможня работают в одной системе</li>
        <li>Каждая перевозка получает номер, по которому её отслеживает любой участник</li>
        <li>Документы загружаются один раз, из них собирается электронная декларация</li>
        <li>Расчёт стоимости для ж/д, авто, моря, авиа и Среднего коридора</li>
      </ul>
      <form class="track-form" data-track>
        <label>Отследить груз без входа</label>
        <div class="inline"><input name="number" placeholder="ZH-2026-XXXXXX" autocomplete="off" required>
          <button class="btn primary-sm">Найти</button></div>
      </form>
    </div>

    <div class="card auth-card">
      <div class="seg full">
        <button class="seg-btn active" data-auth="login">Вход</button>
        <button class="seg-btn" data-auth="register">Регистрация</button>
      </div>

      <form data-login class="auth-form">
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" data-error></p>
        <button class="btn primary">Войти</button>
      </form>

      <form data-register class="auth-form" hidden>
        <div class="field-label">От чьего лица вы регистрируетесь?</div>
        <div class="role-grid">${roles.map(([id, r], i) => `
          <label class="role-card">
            <input type="radio" name="role" value="${id}" ${i === 0 ? 'checked' : ''}>
            <b>${esc(r.name)}</b><small>${esc(r.desc)}</small>
          </label>`).join('')}
        </div>
        <div class="form-grid">
          <label>Имя и фамилия<input name="name" required minlength="2" autocomplete="name"></label>
          <label data-company-label>Организация<input name="company" required minlength="2" autocomplete="organization"></label>
          <label>БИН <small>12 цифр, необязательно</small><input name="bin" inputmode="numeric" maxlength="12" pattern="\\d{12}"></label>
          <label>Email<input name="email" type="email" required autocomplete="username"></label>
          <label class="wide">Пароль <small>минимум 8 символов</small><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        </div>
        <p class="form-error" data-error></p>
        <button class="btn primary">Зарегистрироваться</button>
      </form>

      <div class="demo-box">
        <div class="field-label">Быстрый демо-вход для презентации</div>
        <div class="demo-btns">${roles.map(([id, r]) => `<button class="btn small" data-demo="${id}">${esc(r.name)}</button>`).join('')}</div>
      </div>
    </div>`;

  const showForm = which => {
    root.querySelectorAll('[data-auth]').forEach(b => b.classList.toggle('active', b.dataset.auth === which));
    $('[data-login]', root).hidden = which !== 'login';
    $('[data-register]', root).hidden = which !== 'register';
  };

  const finish = ({ token, user }) => {
    session.set(token, user);
    onLogin(user);
  };

  const submit = (form, fn) => form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('[data-error]', form);
    err.textContent = '';
    const btn = form.querySelector('button.primary');
    btn.disabled = true;
    try {
      finish(await fn(Object.fromEntries(new FormData(form))));
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  submit($('[data-login]', root), data => api('/api/auth/login', { method: 'POST', body: data }));
  submit($('[data-register]', root), data => api('/api/auth/register', { method: 'POST', body: { ...data, bin: data.bin || null } }));

  root.addEventListener('click', async e => {
    const tab = e.target.closest('[data-auth]');
    if (tab) showForm(tab.dataset.auth);
    const demo = e.target.closest('[data-demo]');
    if (demo) {
      try {
        finish(await api('/api/auth/demo', { method: 'POST', body: { role: demo.dataset.demo } }));
      } catch (ex) {
        $('[data-login] [data-error]', root).textContent = ex.message;
      }
    }
  });

  // Для таможни «организация» — это пост или управление.
  $('[data-register]', root).addEventListener('change', e => {
    if (e.target.name !== 'role') return;
    $('[data-company-label]', root).firstChild.textContent = e.target.value === 'customs' ? 'Таможенный орган / пост' : 'Организация';
  });

  $('[data-track]', root).addEventListener('submit', e => {
    e.preventDefault();
    onTrack(e.target.number.value.trim().toUpperCase());
  });
}
