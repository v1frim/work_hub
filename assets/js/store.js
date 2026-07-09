/* ============================================================================
   Work Hub — шар даних, збереження та бізнес-логіка.
   Дані живуть у localStorage. Єдине джерело правди для статистики — журнал
   подій виконання (state.events), тому статистика зберігається навіть після
   видалення задачі.
   ========================================================================== */
(function () {
  'use strict';

  const STORAGE_KEY = 'work_hub_v1';

  /* ---------- Довідники ---------- */

  // Списки (кольорові категорії, як у бічному меню на скріншоті)
  const DEFAULT_LISTS = [
    { id: 'personal', name: 'Особисте', color: '#f5a623' },
    { id: 'other', name: 'Інше', color: '#e2483d' },
    { id: 'business', name: 'Розвиток бізнесу', color: '#3aa8f0' },
    { id: 'ops', name: 'Операційка', color: '#8b5cf6' },
    { id: 'regular', name: 'Регулярні', color: '#34c759' },
  ];

  // Осі класифікації (для фільтрів і статистики)
  const KINDS = {
    ops: { label: 'Операційна', short: 'Опер.' },
    business: { label: 'Розвиток бізнесу', short: 'Бізнес' },
  };
  const COMPLEXITY = {
    simple: { label: 'Проста', hint: 'Зробив і забув' },
    complex: { label: 'Складна', hint: 'З підзадачами' },
  };
  const RECUR = {
    once: { label: 'Разова' },
    daily: { label: 'Щодня' },
    interval: { label: 'Кожні N днів' },
    weekly: { label: 'По днях тижня' },
    monthly: { label: 'Щомісяця' },
  };

  const WEEKDAYS_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']; // getDay(): 0=Нд
  const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

  /* ---------- Робота з датами (локальний час, без зсувів TZ) ---------- */

  function todayStr() { return toStr(new Date()); }

  function toStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function fromStr(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(s, n) {
    const d = fromStr(s);
    d.setDate(d.getDate() + n);
    return toStr(d);
  }

  function diffDays(a, b) { // a - b у днях
    return Math.round((fromStr(a) - fromStr(b)) / 86400000);
  }

  function humanDate(s) {
    const d = fromStr(s);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  /* ---------- Стан ---------- */

  let state = load();

  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  function blankState() {
    return {
      version: 1,
      lists: DEFAULT_LISTS.map((l) => ({ ...l })),
      tasks: [],
      goals: [],
      events: [], // журнал виконань {id, date, ts, taskId, title, kind, listId, complexity, recurring}
      settings: { seeded: false },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedIfEmpty(blankState());
      const parsed = JSON.parse(raw);
      // Мінімальна міграція/захист
      const base = blankState();
      return Object.assign(base, parsed, {
        lists: parsed.lists && parsed.lists.length ? parsed.lists : base.lists,
        tasks: parsed.tasks || [],
        goals: parsed.goals || [],
        events: parsed.events || [],
        settings: Object.assign(base.settings, parsed.settings || {}),
      });
    } catch (e) {
      console.warn('Не вдалося прочитати сховище, стан скинуто.', e);
      return seedIfEmpty(blankState());
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Не вдалося зберегти дані', e);
    }
  }

  /* ---------- Демо-дані для першого запуску ---------- */

  function seedIfEmpty(s) {
    if (s.settings.seeded) return s;
    const t = todayStr();
    const mk = (o) => Object.assign({
      id: uid(), title: '', note: '', listId: 'ops', kind: 'ops',
      complexity: 'simple', subtasks: [], recurrence: { type: 'once' },
      bucket: 'today', dueDate: null, remindAt: null, done: false,
      completedAt: null, createdAt: new Date().toISOString(), order: 0,
    }, o);

    s.tasks = [
      mk({ title: 'План дій на день', listId: 'business', kind: 'business', complexity: 'complex', bucket: 'today',
        subtasks: [
          { id: uid(), title: 'Переглянути календар', done: true },
          { id: uid(), title: 'Визначити 3 пріоритети', done: false },
        ] }),
      mk({ title: 'Додати парасольки та підголівники «Нехай Бог» до Розетки', listId: 'business', kind: 'business', bucket: 'today', complexity: 'simple' }),
      mk({ title: 'Закинути в план постів', listId: 'business', kind: 'business', bucket: 'today', complexity: 'complex',
        subtasks: [{ id: uid(), title: 'Ідея посту', done: false }, { id: uid(), title: 'Візуал', done: false }] }),
      mk({ title: 'Податки', listId: 'regular', kind: 'ops', recurrence: { type: 'monthly', dayOfMonth: 20 }, dueDate: t, bucket: 'today' }),
      mk({ title: 'Передоплати', listId: 'ops', kind: 'ops', recurrence: { type: 'daily' }, dueDate: addDays(t, 1), bucket: 'tomorrow' }),
      mk({ title: 'Замовити з Temu', listId: 'ops', kind: 'ops', recurrence: { type: 'weekly', weekdays: [5] }, dueDate: nextWeekdayDate(t, [5]), bucket: 'week' }),
      mk({ title: 'Пост', listId: 'ops', kind: 'business', recurrence: { type: 'weekly', weekdays: [6] }, dueDate: nextWeekdayDate(t, [6]), remindAt: '19:30', bucket: 'week' }),
      mk({ title: 'Комуналка', listId: 'ops', kind: 'ops', recurrence: { type: 'monthly', dayOfMonth: 15 }, dueDate: addDays(t, 6), bucket: 'later' }),
      mk({ title: 'Пробити чеки за минулий місяць (Приват) та 2924', listId: 'regular', kind: 'ops', recurrence: { type: 'monthly', dayOfMonth: 1 }, dueDate: addDays(t, 7), bucket: 'later' }),
    ].map((task, i) => Object.assign(task, { order: i }));

    s.goals = [
      { id: uid(), title: 'Вийти на 300 замовлень/міс', note: 'Масштабування продажів', targetDate: addDays(t, 90), createdAt: new Date().toISOString(), done: false,
        milestones: [
          { id: uid(), title: 'Розширити асортимент', done: true },
          { id: uid(), title: 'Налаштувати рекламу', done: false },
          { id: uid(), title: 'Вийти на нові маркетплейси', done: false },
        ] },
      { id: uid(), title: 'Автоматизувати рутину', note: 'Менше ручної операційки', targetDate: addDays(t, 30), createdAt: new Date().toISOString(), done: false,
        milestones: [{ id: uid(), title: 'Описати процеси', done: false }, { id: uid(), title: 'Впровадити чеклісти', done: false }] },
    ];

    s.settings.seeded = true;
    // збережемо одразу, щоб демо не перегенерувалось
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }

  /* ---------- Логіка повторень ---------- */

  function nextWeekdayDate(fromS, weekdays) {
    // перша дата > fromS, чий день тижня входить у weekdays
    for (let i = 1; i <= 7; i++) {
      const cand = addDays(fromS, i);
      if (weekdays.includes(fromStr(cand).getDay())) return cand;
    }
    return addDays(fromS, 1);
  }

  function nextOccurrence(fromS, rec) {
    switch (rec.type) {
      case 'daily': return addDays(fromS, 1);
      case 'interval': return addDays(fromS, Math.max(1, rec.interval || 1));
      case 'weekly': return nextWeekdayDate(fromS, (rec.weekdays && rec.weekdays.length) ? rec.weekdays : [fromStr(fromS).getDay()]);
      case 'monthly': {
        const d = fromStr(fromS);
        const dom = rec.dayOfMonth || d.getDate();
        const nx = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const last = new Date(nx.getFullYear(), nx.getMonth() + 1, 0).getDate();
        nx.setDate(Math.min(dom, last));
        return toStr(nx);
      }
      default: return null; // once
    }
  }

  function isRecurring(task) { return task.recurrence && task.recurrence.type !== 'once'; }

  /* ---------- Стан «виконано» ---------- */

  function isDoneToday(task) {
    if (isRecurring(task)) {
      return state.events.some((e) => e.taskId === task.id && e.date === todayStr());
    }
    return !!task.done;
  }

  // До якої групи (Сьогодні/Завтра/На тижні/Потім) належить задача
  function bucketOf(task) {
    // Разові виконані: якщо виконано сьогодні — лишаємо у «Сьогодні»
    // позначеними (щоб бачити прогрес X/Y); з минулих днів — ховаємо.
    if (!isRecurring(task) && task.done) {
      const doneDay = task.completedAt ? toStr(new Date(task.completedAt)) : null;
      return doneDay === todayStr() ? 'today' : 'done';
    }

    // Регулярні, виконані сьогодні — лишаються в «Сьогодні» позначеними
    if (isRecurring(task) && isDoneToday(task)) return 'today';

    const anchor = task.dueDate;
    if (!anchor) return task.bucket || 'today';

    const t = todayStr();
    const d = diffDays(anchor, t);
    if (d <= 0) return 'today';     // сьогодні або прострочено
    if (d === 1) return 'tomorrow';
    if (d <= 7) return 'week';
    return 'later';
  }

  /* ---------- Мутації ---------- */

  function upsertTask(data) {
    if (data.id) {
      const i = state.tasks.findIndex((t) => t.id === data.id);
      if (i >= 0) state.tasks[i] = Object.assign({}, state.tasks[i], data);
    } else {
      data.id = uid();
      data.createdAt = new Date().toISOString();
      data.order = state.tasks.length;
      if (!data.done) data.done = false;
      state.tasks.push(data);
    }
    save();
    return data.id;
  }

  function getTask(id) { return state.tasks.find((t) => t.id === id); }

  function deleteTask(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    save();
  }

  function logEvent(task) {
    state.events.push({
      id: uid(), date: todayStr(), ts: new Date().toISOString(),
      taskId: task.id, title: task.title, kind: task.kind,
      listId: task.listId, complexity: task.complexity, recurring: isRecurring(task),
    });
  }

  function unlogTodayEvent(taskId) {
    const t = todayStr();
    // приберемо останню сьогоднішню подію цієї задачі
    for (let i = state.events.length - 1; i >= 0; i--) {
      if (state.events[i].taskId === taskId && state.events[i].date === t) {
        state.events.splice(i, 1);
        return;
      }
    }
  }

  // Перемкнути виконання задачі (за сьогодні)
  function toggleTask(id) {
    const task = getTask(id);
    if (!task) return;
    const doneNow = isDoneToday(task);

    if (isRecurring(task)) {
      if (doneNow) {
        unlogTodayEvent(id);
      } else {
        logEvent(task);
        // перенести наступний строк
        task.dueDate = nextOccurrence(todayStr(), task.recurrence);
      }
    } else {
      if (task.done) {
        task.done = false;
        task.completedAt = null;
        unlogTodayEvent(id);
      } else {
        task.done = true;
        task.completedAt = new Date().toISOString();
        logEvent(task);
      }
    }
    save();
  }

  function toggleSubtask(taskId, subId) {
    const task = getTask(taskId);
    if (!task) return;
    const s = (task.subtasks || []).find((x) => x.id === subId);
    if (s) { s.done = !s.done; save(); }
  }

  /* ---------- Цілі ---------- */

  function upsertGoal(data) {
    if (data.id) {
      const i = state.goals.findIndex((g) => g.id === data.id);
      if (i >= 0) state.goals[i] = Object.assign({}, state.goals[i], data);
    } else {
      data.id = uid();
      data.createdAt = new Date().toISOString();
      if (!data.milestones) data.milestones = [];
      state.goals.push(data);
    }
    save();
    return data.id;
  }
  function getGoal(id) { return state.goals.find((g) => g.id === id); }
  function deleteGoal(id) { state.goals = state.goals.filter((g) => g.id !== id); save(); }
  function toggleMilestone(goalId, mId) {
    const g = getGoal(goalId);
    if (!g) return;
    const m = g.milestones.find((x) => x.id === mId);
    if (m) { m.done = !m.done; save(); }
  }

  /* ---------- Статистика ---------- */

  function eventsBetween(fromS, toS) {
    return state.events.filter((e) => e.date >= fromS && e.date <= toS);
  }

  function startOfWeek(s) {
    // тиждень з понеділка
    const d = fromStr(s);
    const wd = (d.getDay() + 6) % 7; // 0 = понеділок
    return addDays(s, -wd);
  }
  function startOfMonth(s) { const d = fromStr(s); return toStr(new Date(d.getFullYear(), d.getMonth(), 1)); }
  function startOfYear(s) { const d = fromStr(s); return toStr(new Date(d.getFullYear(), 0, 1)); }

  function stats() {
    const t = todayStr();
    const total = state.events.length;
    const evToday = state.events.filter((e) => e.date === t).length;
    const evWeek = eventsBetween(startOfWeek(t), t).length;
    const evMonth = eventsBetween(startOfMonth(t), t).length;
    const evYear = eventsBetween(startOfYear(t), t).length;

    // Період активності (від першої події) — для середніх
    let firstDate = t;
    for (const e of state.events) if (e.date < firstDate) firstDate = e.date;
    const activeDays = Math.max(1, diffDays(t, firstDate) + 1);
    const avgPerDay = total / activeDays;
    const avgPerWeek = avgPerDay * 7;
    const avgPerMonth = avgPerDay * 30.4;

    // Серія (streak) — поспіль дні з ≥1 виконанням
    const daySet = new Set(state.events.map((e) => e.date));
    let streak = 0;
    let cur = t;
    // якщо сьогодні нічого не зроблено, серію рахуємо від учора
    if (!daySet.has(cur)) cur = addDays(cur, -1);
    while (daySet.has(cur)) { streak++; cur = addDays(cur, -1); }
    // найкраща серія
    let best = 0;
    const sortedDays = [...daySet].sort();
    let run = 0, prev = null;
    for (const d of sortedDays) {
      if (prev && diffDays(d, prev) === 1) run++; else run = 1;
      best = Math.max(best, run); prev = d;
    }

    // Останні 30 днів (для стовпчиків)
    const last30 = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(t, -i);
      last30.push({ date: d, count: state.events.filter((e) => e.date === d).length });
    }

    // Останні 12 місяців
    const last12 = [];
    const base = fromStr(t);
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const ms = toStr(dt);
      const me = toStr(new Date(dt.getFullYear(), dt.getMonth() + 1, 0));
      last12.push({ label: MONTHS[dt.getMonth()], count: eventsBetween(ms, me).length });
    }

    // Розбивка за типом / складністю / регулярністю (за поточний місяць)
    const monthEv = eventsBetween(startOfMonth(t), t);
    const byKind = { ops: 0, business: 0 };
    const byList = {};
    const byRecurring = { recurring: 0, once: 0 };
    const byComplexity = { simple: 0, complex: 0 };
    for (const e of monthEv) {
      if (byKind[e.kind] != null) byKind[e.kind]++;
      byList[e.listId] = (byList[e.listId] || 0) + 1;
      byRecurring[e.recurring ? 'recurring' : 'once']++;
      if (byComplexity[e.complexity] != null) byComplexity[e.complexity]++;
    }

    return {
      total, evToday, evWeek, evMonth, evYear,
      avgPerDay, avgPerWeek, avgPerMonth,
      streak, best, activeDays, firstDate,
      last30, last12, byKind, byList, byRecurring, byComplexity,
    };
  }

  /* ---------- Експорт/імпорт ---------- */

  function exportJSON() { return JSON.stringify(state, null, 2); }
  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.tasks)) throw new Error('Невірний формат файлу');
    state = Object.assign(blankState(), parsed);
    state.settings.seeded = true;
    save();
  }
  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    state = seedIfEmpty(blankState());
    save();
  }

  /* ---------- Публічний API ---------- */

  window.Store = {
    // довідники
    LISTS: () => state.lists,
    list: (id) => state.lists.find((l) => l.id === id) || { id, name: id, color: '#888' },
    KINDS, COMPLEXITY, RECUR, WEEKDAYS_SHORT,
    // дати
    todayStr, addDays, humanDate, fromStr, toStr, diffDays,
    // задачі
    tasks: () => state.tasks,
    getTask, upsertTask, deleteTask, toggleTask, toggleSubtask,
    isDoneToday, isRecurring, bucketOf, nextOccurrence,
    // цілі
    goals: () => state.goals,
    getGoal, upsertGoal, deleteGoal, toggleMilestone,
    // статистика
    stats,
    // сервіс
    exportJSON, importJSON, resetAll, save, uid,
    raw: () => state,
  };
})();
