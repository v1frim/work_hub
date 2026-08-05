/* ============================================================================
   Work Hub — автоматична стрічка подій для системного Календаря.

   Навіщо: у браузера немає доступу до Календаря телефона (EventKit — тільки
   для рідних застосунків), тож «записати подію напряму» неможливо. Але
   Календар уміє САМ ходити за файлом .ics по посиланню — це «підписка на
   календар». Тому робимо так:

     подія в застосунку → .ics лежить у репозиторії GitHub Pages
                        → Календар періодично перечитує його сам

   Далі кожна нова подія доїжджає в Календар без жодних дій: підписатися
   треба лише один раз.

   Важливе, чого не обійти:
   - оновлення не миттєве — коли саме перечитати стрічку, вирішує iOS;
   - підписаний календар доступний лише для читання (редагувати події можна
     в застосунку, не в Календарі);
   - файл лежить за ПУБЛІЧНИМ посиланням, тому в шлях підмішуємо випадковий
     ключ: адресу неможливо вгадати, але вона й не таємниця — секретів у
     назвах подій тримати не варто.
   ========================================================================== */
(function () {
  'use strict';

  const CFG_KEY = 'work_hub_calfeed';
  const DEBOUNCE_MS = 4000;
  const DEFAULT_API = 'https://api.github.com';
  const CAL_NAME = 'Work Hub — події';

  const S = window.Store;

  let cfg = loadCfg();       // {repo, branch, path, token, site, lastAt, apiBase}
  let timer = null;
  let lastPublished = null;  // останній залитий текст .ics — щоб не робити порожніх комітів
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
    } catch (e) { console.warn('Не вдалося зберегти налаштування стрічки', e); }
  }

  function setStatus(state, error) {
    status = { state, error: error || null };
    listeners.forEach((fn) => { try { fn(status); } catch (e) {} });
  }

  /* ---------- Здогадка про репозиторій за адресою сайту ----------
     Застосунок роздає GitHub Pages, тож адреса сама каже, куди класти файл:
     https://vasya.github.io/work_hub/ → репозиторій vasya/work_hub. */

  function guess() {
    const segs = location.pathname.split('/').filter(Boolean);
    if (segs.length && /\.[a-z]+$/i.test(segs[segs.length - 1])) segs.pop(); // прибираємо index.html
    const m = /^([\w.-]+)\.github\.io$/i.exec(location.hostname);
    let repo = '';
    if (m) repo = segs.length ? `${m[1]}/${segs[0]}` : `${m[1]}/${m[1]}.github.io`;
    const site = location.origin + (segs.length ? '/' + segs[0] : '') + '/';
    return { repo, branch: 'gh-pages', site };
  }

  // Випадковий ключ у назві файлу: посилання публічне, але невгадуване
  function randomKey() {
    const a = new Uint8Array(9);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function feedUrl() {
    if (!cfg) return '';
    return cfg.site + cfg.path;
  }

  // Календар iOS/macOS відкриває підписку саме за webcal://
  function webcalUrl() {
    return feedUrl().replace(/^https?:\/\//, 'webcal://');
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

  /* ---------- GitHub API ---------- */

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
      else if (res.status === 404) msg = 'Репозиторій або гілку не знайдено';
      else if (res.status === 409 || res.status === 422) msg = 'Конфлікт версій — спробуй ще раз';
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  function contentsPath(query) {
    const p = `/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.path).replace(/%2F/g, '/')}`;
    return query ? `${p}?${query}` : p;
  }

  /* ---------- Що саме публікуємо ---------- */

  function icsText() {
    // усі події обох розділів: у Календарі вони живуть разом, з плашкою в описі
    return S.buildICS(S.reminders(), { name: CAL_NAME, feed: true });
  }

  /* ---------- Увімкнення ---------- */

  async function enable(input) {
    const g = guess();
    const repo = String((input && input.repo) || g.repo || '').trim()
      .replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
    const token = String((input && input.token) || '').trim();
    const branch = String((input && input.branch) || g.branch).trim() || 'gh-pages';
    const site = String((input && input.site) || g.site).replace(/\/*$/, '/');

    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('Вкажи репозиторій у форматі власник/назва');
    if (!token) throw new Error('Встав токен');

    const prev = cfg;
    cfg = {
      repo, token, branch, site,
      // шлях лишаємо старий, якщо стрічку вже вмикали: інакше довелося б
      // перепідписуватись у Календарі щоразу
      path: (prev && prev.path) || `feed/${randomKey()}.ics`,
      apiBase: (input && input.apiBase) || (prev && prev.apiBase),
    };

    try {
      const info = await api(`/repos/${repo}`);
      if (info && info.permissions && info.permissions.push === false) {
        throw new Error('Токен має лише читання — потрібне право Contents: Read and write');
      }
      saveCfg();
      setStatus('idle');
      const ok = await publishNow({ force: true });
      if (!ok && status.state === 'error') throw new Error(status.error || 'Не вдалося залити файл');
      return { url: feedUrl(), webcal: webcalUrl() };
    } catch (e) {
      // Конфіг ми вже встигли записати (щоб publishNow мав з чим працювати),
      // тож при невдачі його треба саме СТЕРТИ. Інакше в памʼяті телефона
      // лишиться налаштування, якого насправді немає: застосунок вважав би
      // синхронізацію ввімкненою, а файл ніколи б не зʼявився.
      cfg = prev;
      saveCfg();
      setStatus(prev ? 'idle' : 'off');
      throw e;
    }
  }

  /* Чи стрічка справді працює: увімкнена і хоч раз залилась. */
  function healthy() { return !!(cfg && cfg.lastAt); }

  /* Вимикаємо — і за замовчуванням прибираємо файл із репозиторію, щоб
     публічне посилання перестало віддавати події. */
  async function disable(opts) {
    const o = opts || {};
    if (cfg && o.removeFile !== false) {
      try {
        const meta = await api(contentsPath(`ref=${encodeURIComponent(cfg.branch)}`), { allow404: true });
        if (meta && meta.sha) {
          await api(contentsPath(), {
            method: 'DELETE',
            body: JSON.stringify({ message: 'Work Hub: прибрано стрічку подій', sha: meta.sha, branch: cfg.branch }),
          });
        }
      } catch (e) { /* файл прибрати не вийшло — конфіг усе одно знімаємо */ }
    }
    cfg = null;
    lastPublished = null;
    clearTimeout(timer);
    saveCfg();
    setStatus('off');
  }

  /* ---------- Заливання ---------- */

  function schedulePublish() {
    if (!cfg) return;
    clearTimeout(timer);
    timer = setTimeout(() => { publishNow().catch(() => {}); }, DEBOUNCE_MS);
  }

  async function publishNow(opts) {
    const o = opts || {};
    if (!cfg) return false;

    const text = icsText();
    // задачі змінюються значно частіше за події — не смикаємо GitHub даремно
    if (!o.force && text === lastPublished) return false;

    clearTimeout(timer);
    setStatus('syncing');
    try {
      const meta = await api(contentsPath(`ref=${encodeURIComponent(cfg.branch)}`), { allow404: true });
      await api(contentsPath(), {
        method: 'PUT',
        body: JSON.stringify({
          message: `Work Hub: події ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          content: toBase64(text),
          branch: cfg.branch,
          sha: meta && meta.sha ? meta.sha : undefined,
        }),
      });

      lastPublished = text;
      cfg.lastAt = new Date().toISOString();
      cfg.lastCount = S.reminders().length;
      saveCfg();
      setStatus('synced');
      return true;
    } catch (e) {
      setStatus('error', e.message);
      return false;
    }
  }

  /* ---------- Публічний API ---------- */

  window.CalFeed = {
    enabled: () => !!cfg,
    healthy,
    config: () => (cfg ? {
      repo: cfg.repo, branch: cfg.branch, path: cfg.path,
      lastAt: cfg.lastAt || null, count: cfg.lastCount || 0,
      url: feedUrl(), webcal: webcalUrl(),
    } : null),
    guess,
    status: () => status,
    onChange: (fn) => { listeners.push(fn); },
    enable, disable, publishNow, schedulePublish,
  };

  if (S && S.setOnSaved) S.setOnSaved(schedulePublish);
})();
