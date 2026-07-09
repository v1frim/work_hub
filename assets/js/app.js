/* ============================================================================
   Work Hub — інтерфейс: рендеринг, події, форми.
   ========================================================================== */
(function () {
  'use strict';
  const S = window.Store;

  /* ---------- Дрібні помічники ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICON = {
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4L19 6.5"/></svg>',
    checkMini: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4L19 6.5"/></svg>',
    recur: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>',
    subs: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 15V3h13l-2 4 2 4H4M4 21v-6"/></svg>',
  };

  const BUCKETS = [
    { id: 'today', title: 'Сьогодні' },
    { id: 'tomorrow', title: 'Завтра' },
    { id: 'week', title: 'На тижні' },
    { id: 'later', title: 'Потім' },
  ];

  /* ---------- Глобальний UI-стан ---------- */
  let currentTab = 'tasks';
  let listFilter = null; // null = усі списки

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ============================================================
     ЕКРАН: ЗАДАЧІ
     ============================================================ */
  function renderTasks() {
    const root = $('#screen-tasks');
    let tasks = S.tasks();
    if (listFilter) tasks = tasks.filter((t) => t.listId === listFilter);

    // згрупувати за bucket
    const groups = { today: [], tomorrow: [], week: [], later: [] };
    for (const t of tasks) {
      const b = S.bucketOf(t);
      if (b === 'done') continue; // виконані разові ховаємо
      if (groups[b]) groups[b].push(t);
    }

    let html = '';
    const active = listFilter ? S.list(listFilter).name : null;
    if (active) html += `<div class="section-hint">Фільтр: <b>${esc(active)}</b> · <a class="link-btn" id="clear-filter" style="display:inline">скинути</a></div>`;

    let anything = false;
    for (const g of BUCKETS) {
      const items = groups[g.id];
      if (!items.length) continue;
      anything = true;
      // сортування: невиконані спершу, потім за порядком
      items.sort((a, b) => (S.isDoneToday(a) - S.isDoneToday(b)) || (a.order - b.order));

      let count = '';
      if (g.id === 'today') {
        const done = items.filter(S.isDoneToday).length;
        count = `<span class="group-count">${done}/${items.length}</span>`;
      }
      html += `<section class="group"><div class="group-head">
        <div class="group-title ${g.id}">${g.title.toUpperCase()}</div>${count}</div>`;
      html += items.map(taskCard).join('');
      html += `</section>`;
    }

    if (!anything) {
      html += `<div class="empty"><div class="big">🗒️</div>Немає задач${active ? ' у цьому списку' : ''}.<br>Натисни «+», щоб додати.</div>`;
    }
    root.innerHTML = html;
    updateGauge();
  }

  function taskCard(t) {
    const list = S.list(t.listId);
    const doneToday = S.isDoneToday(t);
    const recurring = S.isRecurring(t);

    // мета-бейджі
    const badges = [];
    if (recurring) badges.push(`<span class="badge recur">${ICON.recur}${S.RECUR[t.recurrence.type].label}</span>`);
    if (t.kind === 'business') badges.push(`<span class="badge biz">${ICON.flag}Бізнес</span>`);
    if (t.complexity === 'complex' && t.subtasks && t.subtasks.length) {
      const d = t.subtasks.filter((s) => s.done).length;
      badges.push(`<span class="badge subs">${ICON.subs}${d}/${t.subtasks.length}</span>`);
    }

    // мітка дня для тижневих/пізніх
    let dayTag = '';
    const b = S.bucketOf(t);
    if ((b === 'week' || b === 'later') && t.dueDate) {
      const wd = S.WEEKDAYS_SHORT[S.fromStr(t.dueDate).getDay()];
      dayTag = `<span class="day-tag">${b === 'later' ? S.humanDate(t.dueDate) : wd}</span>`;
    }

    // підзадачі (розгорнуті для складних)
    let subs = '';
    if (t.complexity === 'complex' && t.subtasks && t.subtasks.length) {
      subs = `<div class="subs">` + t.subtasks.map((s) => `
        <div class="sub ${s.done ? 'on' : ''}" data-sub="${s.id}" data-task="${t.id}">
          <div class="mini">${s.done ? ICON.checkMini : ''}</div><span>${esc(s.title)}</span>
        </div>`).join('') + `</div>`;
    }

    const remind = t.remindAt ? `<div class="remind">${ICON.bell} ${t.dueDate ? S.humanDate(t.dueDate) + ' о ' : ''}${esc(t.remindAt)}</div>` : '';

    return `<div class="task ${doneToday ? 'done-today' : ''}" data-task="${t.id}">
      <button class="check ${doneToday ? 'on' : ''}" data-toggle="${t.id}" style="--c:${list.color}">${doneToday ? ICON.check : ''}</button>
      <div class="body" data-open="${t.id}">
        <div class="title">${esc(t.title)}</div>
        ${badges.length || dayTag ? `<div class="meta">${badges.join('')}${dayTag}</div>` : ''}
        ${remind}
        ${subs}
      </div>
    </div>`;
  }

  function updateGauge() {
    // «спідометр» = частка виконаного сьогодні
    const today = S.tasks().filter((t) => S.bucketOf(t) === 'today');
    const done = today.filter(S.isDoneToday).length;
    const ratio = today.length ? done / today.length : 0;
    const needle = $('#gauge-needle');
    if (needle) {
      const ang = -180 + ratio * 180; // -180..0 (зліва направо по верхній дузі)
      const rad = ang * Math.PI / 180;
      const cx = 18, cy = 26, r = 11;
      needle.setAttribute('x2', (cx + r * Math.cos(rad)).toFixed(1));
      needle.setAttribute('y2', (cy + r * Math.sin(rad)).toFixed(1));
    }
    const fill = $('#gauge-fill');
    if (fill) fill.setAttribute('stroke', ratio >= 1 ? '#34c759' : ratio >= 0.5 ? '#f5a623' : '#e2483d');
  }

  /* ============================================================
     ЕКРАН: СТАТИСТИКА
     ============================================================ */
  function renderStats() {
    const st = S.stats();
    const root = $('#screen-stats');
    const fmt = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

    const cards = [
      { num: st.evToday, lbl: 'Сьогодні', sub: `в середньому ${fmt(st.avgPerDay)}/день` },
      { num: st.evWeek, lbl: 'Цього тижня', sub: `в середньому ${fmt(st.avgPerWeek)}/тижд.` },
      { num: st.evMonth, lbl: 'Цього місяця', sub: `в середньому ${fmt(st.avgPerMonth)}/міс.` },
      { num: st.evYear, lbl: 'Цього року', sub: `всього ${st.total} виконань` },
    ];

    let html = `<div class="view-title" style="margin:14px 4px 0">Трекер виконань</div>`;
    html += `<div class="stat-grid">` + cards.map((c) => `
      <div class="stat-card"><div class="num">${c.num}</div><div class="lbl">${c.lbl}</div><div class="sub">${c.sub}</div></div>`).join('') + `</div>`;

    // серія
    html += `<div class="stat-grid">
      <div class="stat-card"><div class="num">🔥 ${st.streak}</div><div class="lbl">Серія днів поспіль</div><div class="sub">рекорд: ${st.best} дн.</div></div>
      <div class="stat-card"><div class="num">${st.activeDays}</div><div class="lbl">Днів у трекері</div><div class="sub">з ${st.firstDate === S.todayStr() ? 'сьогодні' : S.humanDate(st.firstDate)}</div></div>
    </div>`;

    // діаграма — 30 днів
    const max30 = Math.max(1, ...st.last30.map((d) => d.count));
    html += `<div class="panel"><h3>Останні 30 днів <span class="muted">· пік ${max30}</span></h3>
      <div class="bars">${st.last30.map((d) => `<div class="bar" title="${d.date}: ${d.count}"><i style="height:${Math.round(d.count / max30 * 100)}%"></i></div>`).join('')}</div></div>`;

    // діаграма — 12 місяців
    const max12 = Math.max(1, ...st.last12.map((d) => d.count));
    html += `<div class="panel"><h3>Останні 12 місяців <span class="muted">· пік ${max12}</span></h3>
      <div class="bars wide">${st.last12.map((d) => `<div class="bar"><i style="height:${Math.round(d.count / max12 * 100)}%"></i></div>`).join('')}</div>
      <div class="bars-x">${st.last12.map((d) => `<span>${d.label}</span>`).join('')}</div></div>`;

    // розбивка за місяць
    html += breakdownPanel('Операційка vs Розвиток бізнесу', [
      ['Операційна', st.byKind.ops, '#8b5cf6'],
      ['Бізнес', st.byKind.business, '#2ea3f2'],
    ]);
    html += breakdownPanel('Регулярні vs Разові', [
      ['Регулярні', st.byRecurring.recurring, '#34c759'],
      ['Разові', st.byRecurring.once, '#f5a623'],
    ]);
    html += breakdownPanel('Прості vs Складні', [
      ['Прості', st.byComplexity.simple, '#3aa8f0'],
      ['Складні', st.byComplexity.complex, '#e2483d'],
    ]);
    // за списками
    const lists = S.LISTS().map((l) => [l.name, st.byList[l.id] || 0, l.color]).filter((r) => r[1] > 0);
    if (lists.length) html += breakdownPanel('За списками', lists);

    html += `<div class="section-hint" style="text-align:center;margin-top:20px">Розбивка — за поточний місяць</div>`;
    root.innerHTML = html;
  }

  function breakdownPanel(title, rows) {
    const total = rows.reduce((s, r) => s + r[1], 0) || 1;
    return `<div class="panel"><h3>${title}</h3><div class="breakdown">` +
      rows.map(([k, v, color]) => `<div class="brow">
        <div class="k">${esc(k)}</div>
        <div class="track"><i style="width:${Math.round(v / total * 100)}%;background:${color}"></i></div>
        <div class="v">${v}</div></div>`).join('') + `</div></div>`;
  }

  /* ============================================================
     ЕКРАН: ЦІЛІ
     ============================================================ */
  function renderGoals() {
    const root = $('#screen-goals');
    const goals = S.goals();
    let html = `<div class="view-title" style="margin:14px 4px 0">Мої цілі</div>`;
    if (!goals.length) {
      html += `<div class="empty"><div class="big">🎯</div>Ще немає цілей.<br>Додай першу через «+».</div>`;
    } else {
      html += goals.map(goalCard).join('');
    }
    root.innerHTML = html;
  }

  function goalCard(g) {
    const ms = g.milestones || [];
    const done = ms.filter((m) => m.done).length;
    const prog = ms.length ? Math.round(done / ms.length * 100) : (g.done ? 100 : 0);
    const overdue = g.targetDate && g.targetDate < S.todayStr() && !g.done;
    return `<div class="goal ${g.done ? 'done' : ''}" data-goal="${g.id}">
      <div class="g-head">
        <div style="flex:1" data-editgoal="${g.id}">
          <div class="g-title">${esc(g.title)}</div>
          ${g.note ? `<div class="g-note">${esc(g.note)}</div>` : ''}
        </div>
      </div>
      <div class="g-bar"><i style="width:${prog}%"></i></div>
      <div class="g-prog">${prog}% · ${done}/${ms.length || 0} кроків</div>
      ${g.targetDate ? `<div class="g-date">🗓️ до ${S.humanDate(g.targetDate)}${overdue ? ' · прострочено' : ''}</div>` : ''}
      ${ms.length ? `<div class="ms">${ms.map((m) => `
        <div class="sub ${m.done ? 'on' : ''}" data-ms="${m.id}" data-goal="${g.id}">
          <div class="mini">${m.done ? ICON.checkMini : ''}</div><span>${esc(m.title)}</span></div>`).join('')}</div>` : ''}
    </div>`;
  }

  /* ============================================================
     БІЧНЕ МЕНЮ (drawer)
     ============================================================ */
  function renderDrawer() {
    const d = $('#drawer');
    const counts = {};
    for (const t of S.tasks()) {
      if (S.bucketOf(t) === 'done') continue;
      counts[t.listId] = (counts[t.listId] || 0) + 1;
    }
    const totalActive = S.tasks().filter((t) => S.bucketOf(t) !== 'done').length;
    let html = `<div class="d-head">
      <button class="settings" id="open-settings" aria-label="Налаштування">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.3 1z"/></svg>
      </button>
      <div style="font-weight:800;font-size:18px">Work Hub</div><div style="width:38px"></div></div>`;

    html += `<div class="d-item ${!listFilter ? 'active' : ''}" data-filter="">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>
      Головний екран<span class="cnt">${totalActive}</span></div>`;

    html += `<div class="d-item" data-goto="stats">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>Дневник задач</div>`;
    html += `<div class="d-item" data-goto="goals">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>Цілі</div>`;

    html += `<div class="d-sec">Списки задач</div>`;
    html += S.LISTS().map((l) => `<div class="d-item ${listFilter === l.id ? 'active' : ''}" data-filter="${l.id}">
      <span class="dot" style="background:${l.color}"></span>${esc(l.name)}<span class="cnt">${counts[l.id] || 0}</span></div>`).join('');

    d.innerHTML = html;
  }

  /* ============================================================
     ФОРМА ЗАДАЧІ (нижня шторка)
     ============================================================ */
  let draft = null; // чернетка задачі під час редагування

  function openTaskSheet(id) {
    const existing = id ? S.getTask(id) : null;
    draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      title: '', note: '', listId: 'ops', kind: 'ops', complexity: 'simple',
      subtasks: [], recurrence: { type: 'once' }, bucket: 'today', dueDate: null, remindAt: null,
    };
    renderTaskSheet(!!existing);
    openSheet();
  }

  function renderTaskSheet(isEdit) {
    const d = draft;
    const rec = d.recurrence || { type: 'once' };

    const listChips = S.LISTS().map((l) => `<button class="chip ${d.listId === l.id ? 'on' : ''}" data-setlist="${l.id}">
      <span class="dot" style="background:${l.color}"></span>${esc(l.name)}</button>`).join('');

    const kindChips = Object.entries(S.KINDS).map(([k, v]) =>
      `<button class="chip ${d.kind === k ? 'on' : ''}" data-setkind="${k}">${v.label}</button>`).join('');

    const cxChips = Object.entries(S.COMPLEXITY).map(([k, v]) =>
      `<button class="chip ${d.complexity === k ? 'on' : ''}" data-setcx="${k}">${v.label} · <span style="opacity:.7">${v.hint}</span></button>`).join('');

    const recChips = Object.entries(S.RECUR).map(([k, v]) =>
      `<button class="chip ${rec.type === k ? 'on' : ''}" data-setrec="${k}">${v.label}</button>`).join('');

    // додаткові поля повторення
    let recExtra = '';
    if (rec.type === 'interval') {
      recExtra = `<div class="field"><label>Кожні скільки днів</label>
        <input type="number" min="1" id="rec-interval" value="${rec.interval || 2}"></div>`;
    } else if (rec.type === 'weekly') {
      const wd = rec.weekdays || [];
      const order = [1, 2, 3, 4, 5, 6, 0]; // Пн..Нд
      recExtra = `<div class="field"><label>Дні тижня</label><div class="weekday-row">` +
        order.map((i) => `<div class="wd ${wd.includes(i) ? 'on' : ''}" data-wd="${i}">${S.WEEKDAYS_SHORT[i]}</div>`).join('') + `</div></div>`;
    } else if (rec.type === 'monthly') {
      recExtra = `<div class="field"><label>Число місяця</label>
        <input type="number" min="1" max="31" id="rec-dom" value="${rec.dayOfMonth || 1}"></div>`;
    }

    // група/дата — тільки для разових
    let scheduleField = '';
    if (rec.type === 'once') {
      const buckets = BUCKETS.map((b) => `<button class="chip ${d.bucket === b.id && !d.dueDate ? 'on' : ''}" data-setbucket="${b.id}">${b.title}</button>`).join('');
      scheduleField = `<div class="field"><label>Коли</label><div class="chips">${buckets}</div>
        <div style="margin-top:10px"><input type="date" id="due-date" value="${d.dueDate || ''}"></div></div>`;
    }

    // підзадачі — тільки для складних
    let subField = '';
    if (d.complexity === 'complex') {
      subField = `<div class="field"><label>Підзадачі</label><div class="subedit" id="subedit">` +
        (d.subtasks || []).map((s, i) => `<div class="row">
          <input type="text" data-subidx="${i}" value="${esc(s.title)}" placeholder="Крок ${i + 1}">
          <button class="del" data-delsub="${i}">✕</button></div>`).join('') +
        `</div><button class="link-btn" id="add-sub">+ Додати підзадачу</button></div>`;
    }

    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <button class="close-x" data-close>✕</button>
      <h2>${isEdit ? 'Редагувати задачу' : 'Нова задача'}</h2>

      <div class="field"><label>Назва</label>
        <input type="text" id="t-title" value="${esc(d.title)}" placeholder="Що потрібно зробити?" autocomplete="off"></div>

      <div class="field"><label>Список</label><div class="chips">${listChips}</div></div>
      <div class="field"><label>Тип</label><div class="chips">${kindChips}</div></div>
      <div class="field"><label>Складність</label><div class="chips">${cxChips}</div></div>
      <div class="field"><label>Повторення</label><div class="chips">${recChips}</div></div>
      ${recExtra}
      ${scheduleField}
      ${subField}

      <div class="field"><label>Нагадування (час)</label>
        <input type="time" id="t-remind" value="${d.remindAt || ''}"></div>
      <div class="field"><label>Нотатка</label>
        <textarea id="t-note" placeholder="Деталі…">${esc(d.note || '')}</textarea></div>

      <div class="sheet-actions">
        ${isEdit ? '<button class="btn danger" data-deltask>Видалити</button>' : ''}
        <button class="btn primary" id="save-task">${isEdit ? 'Зберегти' : 'Додати'}</button>
      </div>`;
  }

  // Зчитати поля вводу в чернетку (перед перемальовкою чи збереженням)
  function syncTaskInputs() {
    const g = (sel) => $(sel, $('#sheet'));
    if (g('#t-title')) draft.title = g('#t-title').value;
    if (g('#t-note')) draft.note = g('#t-note').value;
    if (g('#t-remind')) draft.remindAt = g('#t-remind').value || null;
    if (g('#due-date')) { const v = g('#due-date').value; draft.dueDate = v || null; }
    if (g('#rec-interval')) draft.recurrence.interval = Math.max(1, +g('#rec-interval').value || 1);
    if (g('#rec-dom')) draft.recurrence.dayOfMonth = Math.min(31, Math.max(1, +g('#rec-dom').value || 1));
    if (g('#subedit')) {
      $$('[data-subidx]', $('#sheet')).forEach((inp) => {
        const i = +inp.dataset.subidx;
        if (draft.subtasks[i]) draft.subtasks[i].title = inp.value;
      });
    }
  }

  function saveTask() {
    syncTaskInputs();
    if (!draft.title.trim()) { toast('Вкажи назву задачі'); return; }
    // очистити порожні підзадачі
    if (draft.complexity === 'complex') {
      draft.subtasks = (draft.subtasks || []).filter((s) => s.title.trim());
    } else {
      draft.subtasks = [];
    }
    // для регулярних без дати — стартуємо від сьогодні
    if (draft.recurrence.type !== 'once' && !draft.dueDate) draft.dueDate = S.todayStr();
    S.upsertTask(draft);
    closeSheet();
    toast(draft.id ? 'Збережено' : 'Додано');
    renderAll();
  }

  /* ============================================================
     ФОРМА ЦІЛІ
     ============================================================ */
  function openGoalSheet(id) {
    const existing = id ? S.getGoal(id) : null;
    draft = existing ? JSON.parse(JSON.stringify(existing)) : { title: '', note: '', targetDate: null, milestones: [] };
    renderGoalSheet(!!existing);
    openSheet();
  }

  function renderGoalSheet(isEdit) {
    const d = draft;
    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <button class="close-x" data-close>✕</button>
      <h2>${isEdit ? 'Редагувати ціль' : 'Нова ціль'}</h2>
      <div class="field"><label>Ціль</label>
        <input type="text" id="g-title" value="${esc(d.title)}" placeholder="Чого хочеш досягти?"></div>
      <div class="field"><label>Опис</label>
        <textarea id="g-note" placeholder="Деталі…">${esc(d.note || '')}</textarea></div>
      <div class="field"><label>Дедлайн</label>
        <input type="date" id="g-date" value="${d.targetDate || ''}"></div>
      <div class="field"><label>Кроки</label><div class="subedit" id="ms-edit">` +
        (d.milestones || []).map((m, i) => `<div class="row">
          <input type="text" data-msidx="${i}" value="${esc(m.title)}" placeholder="Крок ${i + 1}">
          <button class="del" data-delms="${i}">✕</button></div>`).join('') +
      `</div><button class="link-btn" id="add-ms">+ Додати крок</button></div>
      <div class="sheet-actions">
        ${isEdit ? '<button class="btn danger" data-delgoal>Видалити</button>' : ''}
        <button class="btn primary" id="save-goal">${isEdit ? 'Зберегти' : 'Додати'}</button>
      </div>`;
  }

  function syncGoalInputs() {
    const sh = $('#sheet');
    draft.title = $('#g-title', sh).value;
    draft.note = $('#g-note', sh).value;
    draft.targetDate = $('#g-date', sh).value || null;
    $$('[data-msidx]', sh).forEach((inp) => {
      const i = +inp.dataset.msidx;
      if (draft.milestones[i]) draft.milestones[i].title = inp.value;
    });
  }

  function saveGoal() {
    syncGoalInputs();
    if (!draft.title.trim()) { toast('Вкажи назву цілі'); return; }
    draft.milestones = (draft.milestones || []).filter((m) => m.title.trim());
    S.upsertGoal(draft);
    closeSheet();
    toast('Збережено');
    renderGoals();
    renderDrawer();
  }

  /* ============================================================
     НАЛАШТУВАННЯ / ЕКСПОРТ
     ============================================================ */
  function openSettings() {
    closeDrawer();
    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <button class="close-x" data-close>✕</button>
      <h2>Налаштування</h2>
      <div class="section-hint">Дані зберігаються локально на цьому пристрої (працює офлайн). Роби резервні копії.</div>
      <div class="field"><label>Резервна копія</label>
        <button class="btn ghost" id="export-btn" style="margin-bottom:10px">⬇️ Експортувати у файл</button>
        <button class="btn ghost" id="import-btn">⬆️ Імпортувати з файлу</button>
        <input type="file" id="import-file" accept="application/json" class="hidden">
      </div>
      <div class="field"><label>Небезпечна зона</label>
        <button class="btn danger" id="reset-btn">Скинути всі дані</button></div>
      <div class="section-hint" style="text-align:center;margin-top:18px">Work Hub · офлайн-трекер задач</div>`;
    openSheet();
  }

  function doExport() {
    const blob = new Blob([S.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `work-hub-${S.todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Файл збережено');
  }

  /* ============================================================
     КЕРУВАННЯ ШТОРКОЮ/МЕНЮ
     ============================================================ */
  function openSheet() { $('#sheet').classList.add('open'); $('#sheet-backdrop').classList.add('open'); }
  function closeSheet() { $('#sheet').classList.remove('open'); $('#sheet-backdrop').classList.remove('open'); draft = null; }
  function openDrawer() { renderDrawer(); $('#drawer').classList.add('open'); $('#drawer-backdrop').classList.add('open'); }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer-backdrop').classList.remove('open'); }

  function switchTab(tab) {
    currentTab = tab;
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $(`#screen-${tab}`).classList.add('active');
    $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'tasks') renderTasks();
    if (tab === 'stats') renderStats();
    if (tab === 'goals') renderGoals();
    window.scrollTo(0, 0);
  }

  function renderAll() { renderTasks(); renderDrawer(); }

  /* ============================================================
     ОБРОБНИКИ ПОДІЙ (делегування)
     ============================================================ */
  function bind() {
    // навігація
    $('#tabbar').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) switchTab(b.dataset.tab);
    });
    $('#btn-menu').addEventListener('click', openDrawer);
    $('#btn-today').addEventListener('click', () => { switchTab('tasks'); listFilter = null; renderTasks(); });
    $('#drawer-backdrop').addEventListener('click', closeDrawer);
    $('#sheet-backdrop').addEventListener('click', closeSheet);

    // FAB — залежно від вкладки
    $('#fab').addEventListener('click', () => {
      if (currentTab === 'goals') openGoalSheet();
      else openTaskSheet();
    });

    // Клік по екрану задач
    $('#screen-tasks').addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) { S.toggleTask(toggle.dataset.toggle); renderTasks(); renderDrawer(); return; }
      const sub = e.target.closest('[data-sub]');
      if (sub) { S.toggleSubtask(sub.dataset.task, sub.dataset.sub); renderTasks(); return; }
      const open = e.target.closest('[data-open]');
      if (open) { openTaskSheet(open.dataset.open); return; }
      const cf = e.target.closest('#clear-filter');
      if (cf) { listFilter = null; renderTasks(); }
    });

    // Клік по екрану цілей
    $('#screen-goals').addEventListener('click', (e) => {
      const ms = e.target.closest('[data-ms]');
      if (ms) { S.toggleMilestone(ms.dataset.goal, ms.dataset.ms); renderGoals(); return; }
      const eg = e.target.closest('[data-editgoal]');
      if (eg) openGoalSheet(eg.dataset.editgoal);
    });

    // Бічне меню
    $('#drawer').addEventListener('click', (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) { listFilter = f.dataset.filter || null; switchTab('tasks'); closeDrawer(); return; }
      const goto = e.target.closest('[data-goto]');
      if (goto) { const m = { stats: 'stats', goals: 'goals' }; switchTab(goto.dataset.goto); closeDrawer(); return; }
      if (e.target.closest('#open-settings')) openSettings();
    });

    // Усі кліки всередині шторки
    $('#sheet').addEventListener('click', onSheetClick);
  }

  function onSheetClick(e) {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }

    // --- задача ---
    const setlist = e.target.closest('[data-setlist]');
    if (setlist) { syncTaskInputs(); draft.listId = setlist.dataset.setlist; renderTaskSheet(!!draft.id); return; }
    const setkind = e.target.closest('[data-setkind]');
    if (setkind) { syncTaskInputs(); draft.kind = setkind.dataset.setkind; renderTaskSheet(!!draft.id); return; }
    const setcx = e.target.closest('[data-setcx]');
    if (setcx) {
      syncTaskInputs(); draft.complexity = setcx.dataset.setcx;
      if (draft.complexity === 'complex' && !(draft.subtasks && draft.subtasks.length)) {
        draft.subtasks = [{ id: S.uid(), title: '', done: false }];
      }
      renderTaskSheet(!!draft.id); return;
    }
    const setrec = e.target.closest('[data-setrec]');
    if (setrec) {
      syncTaskInputs();
      const type = setrec.dataset.setrec;
      draft.recurrence = { type };
      if (type === 'interval') draft.recurrence.interval = 2;
      if (type === 'weekly') draft.recurrence.weekdays = [S.fromStr(S.todayStr()).getDay()];
      if (type === 'monthly') draft.recurrence.dayOfMonth = S.fromStr(S.todayStr()).getDate();
      renderTaskSheet(!!draft.id); return;
    }
    const wd = e.target.closest('[data-wd]');
    if (wd) {
      syncTaskInputs();
      const i = +wd.dataset.wd;
      const arr = draft.recurrence.weekdays || (draft.recurrence.weekdays = []);
      const at = arr.indexOf(i);
      if (at >= 0) arr.splice(at, 1); else arr.push(i);
      renderTaskSheet(!!draft.id); return;
    }
    const sb = e.target.closest('[data-setbucket]');
    if (sb) { syncTaskInputs(); draft.bucket = sb.dataset.setbucket; draft.dueDate = null; renderTaskSheet(!!draft.id); return; }
    if (e.target.closest('#add-sub')) {
      syncTaskInputs(); draft.subtasks.push({ id: S.uid(), title: '', done: false }); renderTaskSheet(!!draft.id); return;
    }
    const delsub = e.target.closest('[data-delsub]');
    if (delsub) { syncTaskInputs(); draft.subtasks.splice(+delsub.dataset.delsub, 1); renderTaskSheet(!!draft.id); return; }
    if (e.target.closest('#save-task')) { saveTask(); return; }
    if (e.target.closest('[data-deltask]')) {
      if (confirm('Видалити задачу?')) { S.deleteTask(draft.id); closeSheet(); toast('Видалено'); renderAll(); }
      return;
    }

    // --- ціль ---
    if (e.target.closest('#add-ms')) { syncGoalInputs(); draft.milestones.push({ id: S.uid(), title: '', done: false }); renderGoalSheet(!!draft.id); return; }
    const delms = e.target.closest('[data-delms]');
    if (delms) { syncGoalInputs(); draft.milestones.splice(+delms.dataset.delms, 1); renderGoalSheet(!!draft.id); return; }
    if (e.target.closest('#save-goal')) { saveGoal(); return; }
    if (e.target.closest('[data-delgoal]')) {
      if (confirm('Видалити ціль?')) { S.deleteGoal(draft.id); closeSheet(); toast('Видалено'); renderGoals(); }
      return;
    }

    // --- налаштування ---
    if (e.target.closest('#export-btn')) { doExport(); return; }
    if (e.target.closest('#import-btn')) { $('#import-file').click(); return; }
    if (e.target.closest('#reset-btn')) {
      if (confirm('Скинути всі дані? Дію не можна скасувати.')) { S.resetAll(); closeSheet(); toast('Скинуто'); renderAll(); }
      return;
    }
  }

  // окремо: імпорт файлу (change)
  function bindLate() {
    $('#sheet').addEventListener('change', (e) => {
      if (e.target.id === 'import-file') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try { S.importJSON(reader.result); closeSheet(); toast('Імпортовано'); renderAll(); }
          catch (err) { toast('Помилка: ' + err.message); }
        };
        reader.readAsText(file);
      }
    });
  }

  /* ============================================================
     СТАРТ
     ============================================================ */
  function init() {
    // дата в іконці календаря
    const num = $('#today-num');
    if (num) num.textContent = String(S.fromStr(S.todayStr()).getDate());

    bind();
    bindLate();
    renderTasks();
    renderDrawer();

    // PWA service worker (тільки коли обслуговується через http/https)
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
