import { storage } from './util.js';

const TOKEN_KEY = 'zhol-token';

export const session = {
  token: storage.get(TOKEN_KEY),
  user: null,
  set(token, user) {
    this.token = token;
    this.user = user;
    storage.set(TOKEN_KEY, token);
  },
  clear() {
    this.token = null;
    this.user = null;
    storage.remove(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let payload;
  if (form) {
    payload = form;  // FormData: браузер сам выставит multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && session.token) window.dispatchEvent(new Event('zhol:logout'));
    const detail = typeof data?.detail === 'string' ? data.detail : 'Ошибка запроса';
    throw new ApiError(res.status, detail);
  }
  return data;
}

// Скачивание защищённого файла: fetch с токеном, затем временная ссылка на blob.
export async function download(path, filename) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!res.ok) throw new ApiError(res.status, 'Не удалось скачать файл');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
