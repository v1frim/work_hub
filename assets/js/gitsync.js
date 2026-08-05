/* ============================================================================
   Work Hub — автоматична копія даних у приватний репозиторій GitHub.

   Як працює: після кожної зміни даних (з паузою ~5 с) весь стан заливається
   одним файлом через Contents API. Кожне заливання — це коміт, тобто історія
   версій виходить сама собою: навіть якщо в репозиторій потрапить зіпсований
   стан, попередній день лишається в git.

   Токен зберігається ОКРЕМИМ ключем localStorage, не в даних застосунку —
   інакше він потрапляв би у файл резервної копії, яким можна поділитися.
   ========================================================================== */
(function () {
  'use strict';

  const CFG_KEY = 'work_hub_git';
  const DEBOUNCE_MS = 5000;
  const DEFAULT_PATH = 'backup.json';
  const DEFAULT_API = 'https://api.github.com';

  const S = window.Store;

  let cfg = loadCfg();
  let timer = null;
  let lastPushed = null;   // останній успішно залитий JSON — щоб не робити порожніх комітів
  let suppress = false;    // ігнорувати власні записи в стор (інакше нескінченний цикл)
  let listeners = [];
  let status = { state: cfg ? 'idle' : 'off', error: null };

  /* ---------- Конфіг ---------- */

  function loadCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveCfg() {
    try {
      if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(CFG_KEY);
    } catch (e) { console.warn('Не вдалося зберегти налаштування копії', e); }
  }

  /* ---------- base64 з підтримкою кирилиці ---------- */

  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function fromBase64(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- Виклики GitHub API ---------- */

  async function api(path, opts) {
    const o = opts || {};
    const base = (cfg && cfg.apiBase) || DEFAULT_API;
    const res = await fetch(base + path, {
      method: o.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + cfg.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: o.body,
    });

    if (res.status === 404 && o.allow404) return null;
    if (!res.ok) {
      let msg = `GitHub відповів ${res.status}`;
      if (res.status === 401) msg = 'Токен недійсний або протермінований';
      else if (res.status === 403) msg = 'Токен не має доступу саме до цього репозиторію: у налаштуваннях токена додай його в Repository access і дай Contents: Read and write';
      else if (res.status === 404) msg = 'Репозиторій або файл не знайдено';
      else if (res.status === 409 || res.status === 422) msg = 'Конфлікт версій — спробуй ще раз';
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  function contentsPath() {
    return `/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.path).replace(/%2F/g, '/')}`;
  }

  /* ---------- Стан для інтерфейсу ---------- */

  function setStatus(state, error) {
    status = { state, error: error || null };
    listeners.forEach((fn) => { try { fn(status); } catch (e) {} });
  }

  /* ---------- Підключення ---------- */

  async function connect(input) {
    const repo = String(input.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
    const token = String(input.token || '').trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('Вкажи репозиторій у форматі власник/назва');
    if (!token) throw new Error('Встав токен');

    const probe = { repo, token, path: (input.path || DEFAULT_PATH).trim() || DEFAULT_PATH, apiBase: input.apiBase };
    const prev = cfg;
    cfg = probe;
    try {
      const info = await api(`/repos/${repo}`);
      if (info && info.permissions && info.permissions.push === false) {
        throw new Error('Токен має лише читання — потрібне право Contents: Read and write');
      }
      saveCfg();
      setStatus('idle');
      await pushNow({ force: true });
      return true;
    } catch (e) {
      cfg = prev;           // невдале підключення не має псувати робоче
      setStatus(prev ? 'idle' : 'off');
      throw e;
    }
  }

  function disconnect() {
    cfg = null;
    lastPushed = null;
    saveCfg();
    setStatus('off');
  }

  /* ---------- Заливання ---------- */

  function schedulePush() {
    if (!cfg || suppress) return;
    clearTimeout(timer);
    timer = setTimeout(() => { pushNow().catch(() => {}); }, DEBOUNCE_MS);
  }

  /* Знімок для порівняння «чи щось змінилось» — саме стан, без обгортки
     файлу: у ній є _exportedAt, який інакше робив би кожен виклик унікальним
     і плодив коміти з однаковим вмістом. */
  function snapshot() {
    try { return JSON.stringify(S.raw()); } catch (e) { return null; }
  }

  async function pushNow(opts) {
    const o = opts || {};
    if (!cfg) return false;

    const snap = snapshot();
    if (!o.force && snap !== null && snap === lastPushed) return false; // нічого не змінилось
    const json = S.exportJSON();

    /* Запобіжник: не заливаємо мовчки, якщо задач раптово стало нуль або
       вдвічі менше. Саме так авто-копія й затирає хороші дані зіпсованими. */
    const count = S.tasks().length;
    if (!o.force && cfg.lastCount != null && cfg.lastCount > 0
        && (count === 0 || count < cfg.lastCount / 2)) {
      setStatus('needs-confirm');
      return false;
    }

    clearTimeout(timer);
    setStatus('syncing');
    try {
      const meta = await api(contentsPath(), { allow404: true });
      await api(contentsPath(), {
        method: 'PUT',
        body: JSON.stringify({
          message: `Work Hub: копія ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          content: toBase64(json),
          sha: meta && meta.sha ? meta.sha : undefined,
        }),
      });

      cfg.lastCount = count;
      cfg.lastAt = new Date().toISOString();
      saveCfg();

      suppress = true;              // markBackup пише в стор — не ловимо власний запис
      try { S.markBackup(); } finally { suppress = false; }
      lastPushed = snapshot();      // знімок ПІСЛЯ markBackup, інакше мітка
                                    // часу копії одразу рахувалась би зміною

      setStatus('synced');
      return true;
    } catch (e) {
      setStatus('error', e.message);
      return false;
    }
  }

  /* ---------- Відновлення ---------- */

  async function restore() {
    if (!cfg) throw new Error('Автокопію не підключено');
    setStatus('syncing');
    try {
      const meta = await api(contentsPath());
      if (!meta || !meta.content) throw new Error('У репозиторії ще немає файлу копії');
      const json = fromBase64(meta.content);

      suppress = true;              // importJSON викликає save — не штовхаємо назад те, що щойно взяли
      let res;
      try { res = S.importJSON(json); } finally { suppress = false; }

      lastPushed = snapshot();
      cfg.lastCount = S.tasks().length;
      saveCfg();
      setStatus('synced');
      return res;
    } catch (e) {
      setStatus('error', e.message);
      throw e;
    }
  }

  /* ---------- Публічний API ---------- */

  window.GitSync = {
    configured: () => !!cfg,
    config: () => (cfg ? { repo: cfg.repo, path: cfg.path, lastAt: cfg.lastAt || null } : null),
    // щоб не просити той самий токен двічі (стрічка подій для Календаря)
    token: () => (cfg ? cfg.token : null),
    status: () => status,
    onChange: (fn) => { listeners.push(fn); },
    connect, disconnect, restore,
    pushNow,
    schedulePush,
  };

  // Підписуємось на зміни стора
  if (S && S.setOnSaved) S.setOnSaved(schedulePush);
})();
