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

  // Два розділи застосунку — між ними перемикаємось угорі екрана
  const AREAS = {
    work: { label: 'Робота', accent: '#2ea3f2' },
    personal: { label: 'Особисте', accent: '#8b5cf6' },
  };

  // Складність — єдина вісь класифікації (замість колишніх «тип» і «складність»)
  const COMPLEXITY = {
    easy: { label: 'Легке', color: '#34c759' },
    medium: { label: 'Середнє', color: '#f5a623' },
    hard: { label: 'Складне', color: '#e2483d' },
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
      version: 2,
      tasks: [],
      goals: [],
      events: [], // журнал виконань {id, date, ts, taskId, title, area, complexity, recurring}
      settings: { seeded: false, area: 'work' },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedIfEmpty(blankState());
      const parsed = JSON.parse(raw);
      const base = blankState();
      const s = Object.assign(base, parsed, {
        tasks: parsed.tasks || [],
        goals: parsed.goals || [],
        events: parsed.events || [],
        settings: Object.assign(base.settings, parsed.settings || {}),
      });
      return migrate(s);
    } catch (e) {
      console.warn('Не вдалося прочитати сховище, стан скинуто.', e);
      return seedIfEmpty(blankState());
    }
  }

  /* Перехід зі старої моделі (списки + тип ops/business + проста/складна)
     на нову (розділ Робота/Особисте + складність легке/середнє/складне).
     Записи користувача зберігаються — лише переносяться в нові поля. */
  function migrate(s) {
    if (s.version >= 2 && s.tasks.every((t) => t.area)) return s;

    // старий список «Особисте» → особистий розділ, решта → робота
    const areaOf = (o) => (o.area ? o.area : (o.listId === 'personal' ? 'personal' : 'work'));
    // проста → легке, складна → складне (середнє зʼявляється лише вручну)
    const cxOf = (o) => {
      if (COMPLEXITY[o.complexity]) return o.complexity;
      if (o.complexity === 'complex') return 'hard';
      return 'easy';
    };

    for (const t of s.tasks) {
      t.area = areaOf(t);
      t.complexity = cxOf(t);
      delete t.kind; delete t.listId;
    }
    for (const g of s.goals) {
      if (!g.area) g.area = 'work';
    }
    for (const e of s.events) {
      e.area = areaOf(e);
      e.complexity = cxOf(e);
      delete e.kind; delete e.listId;
    }
    delete s.lists;
    s.version = 2;
    return s;
  }

  // Хук для модуля синхронізації: стор нічого не знає про GitHub,
  // лише повідомляє «я змінився».
  let onSavedHook = null;

  function save() {
    try {
      // Зливаємо поверх прочитаного, а не замінюємо: якщо застосунок
      // відкотиться на стару збірку, поля, яких вона не знає, не зникнуть.
      let base = null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { try { base = JSON.parse(raw); } catch (e) { base = null; } }
      const out = (base && typeof base === 'object') ? Object.assign({}, base, state) : state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) {
      console.error('Не вдалося зберегти дані', e);
    }
    if (onSavedHook) { try { onSavedHook(); } catch (e) { console.warn(e); } }
  }

  /* ---------- Демо-дані для першого запуску ---------- */

  function seedIfEmpty(s) {
    if (s.settings.seeded) return s;
    const t = todayStr();
    const mk = (o) => Object.assign({
      id: uid(), title: '', note: '', area: 'work',
      complexity: 'easy', subtasks: [], recurrence: { type: 'once' },
      bucket: 'today', dueDate: null, remindAt: null, done: false,
      completedAt: null, createdAt: new Date().toISOString(), order: 0,
    }, o);

    s.tasks = [
      // --- робочі ---
      mk({ title: 'План дій на день', complexity: 'medium', bucket: 'today',
        subtasks: [
          { id: uid(), title: 'Переглянути календар', done: true },
          { id: uid(), title: 'Визначити 3 пріоритети', done: false },
        ] }),
      mk({ title: 'Додати парасольки та підголівники «Нехай Бог» до Розетки', bucket: 'today', complexity: 'medium' }),
      mk({ title: 'Закинути в план постів', bucket: 'today', complexity: 'hard',
        subtasks: [{ id: uid(), title: 'Ідея посту', done: false }, { id: uid(), title: 'Візуал', done: false }] }),
      mk({ title: 'Податки', complexity: 'hard', recurrence: { type: 'monthly', dayOfMonth: 20 }, dueDate: t, bucket: 'today' }),
      mk({ title: 'Передоплати', recurrence: { type: 'daily' }, dueDate: addDays(t, 1), bucket: 'tomorrow' }),
      mk({ title: 'Замовити з Temu', recurrence: { type: 'weekly', weekdays: [5] }, dueDate: nextWeekdayDate(t, [5]), bucket: 'week' }),
      mk({ title: 'Пост', complexity: 'medium', recurrence: { type: 'weekly', weekdays: [6] }, dueDate: nextWeekdayDate(t, [6]), remindAt: '19:30', bucket: 'week' }),
      mk({ title: 'Пробити чеки за минулий місяць (Приват) та 2924', complexity: 'medium', recurrence: { type: 'monthly', dayOfMonth: 1 }, dueDate: addDays(t, 7), bucket: 'later' }),
      // --- особисті ---
      mk({ area: 'personal', title: 'Зарядка', recurrence: { type: 'daily' }, dueDate: t, bucket: 'today' }),
      mk({ area: 'personal', title: 'Комуналка', complexity: 'medium', recurrence: { type: 'monthly', dayOfMonth: 15 }, dueDate: addDays(t, 6), bucket: 'later' }),
      mk({ area: 'personal', title: 'Утеплення стін', complexity: 'hard', bucket: 'week', dueDate: addDays(t, 3),
        subtasks: [{ id: uid(), title: 'Порахувати матеріали', done: false }, { id: uid(), title: 'Знайти бригаду', done: false }] }),
    ].map((task, i) => Object.assign(task, { order: i }));

    s.goals = [
      { id: uid(), area: 'work', title: 'Вийти на 300 замовлень/міс', note: 'Масштабування продажів', targetDate: addDays(t, 90), createdAt: new Date().toISOString(), done: false,
        milestones: [
          { id: uid(), title: 'Розширити асортимент', done: true },
          { id: uid(), title: 'Налаштувати рекламу', done: false },
          { id: uid(), title: 'Вийти на нові маркетплейси', done: false },
        ] },
      { id: uid(), area: 'work', title: 'Автоматизувати рутину', note: 'Менше ручної операційки', targetDate: addDays(t, 30), createdAt: new Date().toISOString(), done: false,
        milestones: [{ id: uid(), title: 'Описати процеси', done: false }, { id: uid(), title: 'Впровадити чеклісти', done: false }] },
      { id: uid(), area: 'personal', title: 'Привести себе у форму', note: 'Регулярні тренування', targetDate: addDays(t, 60), createdAt: new Date().toISOString(), done: false,
        milestones: [{ id: uid(), title: 'Зарядка щодня 2 тижні', done: false }, { id: uid(), title: 'Записатись у зал', done: false }] },
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
      // Виконаною показуємо лише поточну появу задачі. Якщо строк уже
      // перенесено на майбутнє — це вже наступна поява, вона не виконана.
      if (task.dueDate && task.dueDate > todayStr()) return false;
      return state.events.some((e) => e.taskId === task.id && e.date === todayStr());
    }
    return !!task.done;
  }

  // До якої групи (Сьогодні/Завтра/На тижні/Потім) належить задача
  function bucketOf(task) {
    // Виконані разові зникають з головного екрана — їх видно в архіві
    // (екран календаря) за днем виконання.
    if (!isRecurring(task) && task.done) return 'done';

    // Регулярні після виконання не залишаються в «Сьогодні»: їхній dueDate
    // уже вказує на наступну появу, і саме він визначає групу нижче.
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
      taskId: task.id, title: task.title, area: task.area,
      complexity: task.complexity, recurring: isRecurring(task),
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
        // Перенести на наступну появу. Відлік ведемо від пізнішої з дат
        // (сьогодні / поточний строк), щоб виконана наперед задача
        // не «зависала» на тій самій даті.
        const t = todayStr();
        const base = (task.dueDate && task.dueDate > t) ? task.dueDate : t;
        task.prevDueDate = task.dueDate || null; // для скасування
        task.dueDate = nextOccurrence(base, task.recurrence);
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

  /* Скасувати щойно зроблене виконання регулярної задачі: прибрати запис
     із журналу й повернути попередній строк. */
  function undoCompletion(id) {
    const task = getTask(id);
    if (!task || !isRecurring(task)) return false;
    unlogTodayEvent(id);
    if (task.prevDueDate !== undefined) {
      task.dueDate = task.prevDueDate;
      delete task.prevDueDate;
    }
    save();
    return true;
  }

  /* Прогрес за сьогодні. Виконані регулярні задачі вже переїхали в інші
     групи, тому рахуємо їх окремо — інакше прогрес «стирався» б. */
  function todayProgress(area) {
    const t = todayStr();
    const done = state.events.filter((e) => e.date === t && (!area || e.area === area)).length;
    const pending = state.tasks.filter((x) => (!area || x.area === area)
      && bucketOf(x) === 'today' && !isDoneToday(x)).length;
    return { done, total: done + pending };
  }

  /* ---------- Архів: що стосується конкретного дня ---------- */

  /* Повертає { done, planned } для дати:
     done    — записи журналу за цей день (що реально виконано),
     planned — активні задачі, заплановані на цей день. */
  function dayEntries(dateStr, area) {
    const t = todayStr();
    const mine = (o) => !area || o.area === area;

    const done = state.events.filter((e) => e.date === dateStr && mine(e));

    const planned = [];
    for (const x of state.tasks) {
      if (!mine(x)) continue;
      if (!isRecurring(x) && x.done) continue; // виконана разова — вона вже в done
      if (isDoneToday(x)) continue;            // виконана сьогодні регулярна
      const due = x.dueDate;
      if (due) {
        // прострочені показуємо в сьогоднішньому дні
        if (due === dateStr || (dateStr === t && due < t)) planned.push(x);
      } else if (dateStr === t && (x.bucket || 'today') === 'today') {
        planned.push(x);
      }
    }
    planned.sort((a, b) => a.order - b.order);
    return { done, planned };
  }

  /* Дати місяця, у яких щось є (для крапок під числами) */
  function monthMarks(year, month, area) {
    const from = toStr(new Date(year, month, 1));
    const to = toStr(new Date(year, month + 1, 0));
    const marks = new Set();
    const mine = (o) => !area || o.area === area;

    for (const e of state.events) {
      if (mine(e) && e.date >= from && e.date <= to) marks.add(e.date);
    }
    for (const x of state.tasks) {
      if (!mine(x)) continue;
      if (!isRecurring(x) && x.done) continue;
      if (x.dueDate && x.dueDate >= from && x.dueDate <= to) marks.add(x.dueDate);
    }
    return marks;
  }

  /* Перенести задачу в іншу групу (день) і поставити на позицію index.
     Дата підбирається під групу; якщо задача вже в потрібному діапазоні
     («На тижні» / «Потім»), її конкретний день не змінюємо. */
  function moveTask(id, targetBucket, index) {
    const task = getTask(id);
    if (!task) return;
    const t = todayStr();
    const d = task.dueDate ? diffDays(task.dueDate, t) : null;

    if (targetBucket === 'today') task.dueDate = t;
    else if (targetBucket === 'tomorrow') task.dueDate = addDays(t, 1);
    else if (targetBucket === 'week') { if (d === null || d < 2 || d > 7) task.dueDate = addDays(t, 2); }
    else if (targetBucket === 'later') { if (d === null || d <= 7) task.dueDate = addDays(t, 8); }
    task.bucket = targetBucket;

    // Разова виконана задача при перетягуванні знову стає активною,
    // інакше вона зникла б із групи, куди її щойно поклали.
    if (!isRecurring(task) && task.done) {
      task.done = false;
      task.completedAt = null;
      unlogTodayEvent(task.id);
    }

    // Перебудувати порядок усередині цільової групи
    const inBucket = state.tasks
      .filter((x) => x.id !== id && bucketOf(x) === targetBucket)
      .sort((a, b) => (isDoneToday(a) - isDoneToday(b)) || (a.order - b.order));
    const at = Math.max(0, Math.min(index, inBucket.length));
    inBucket.splice(at, 0, task);
    inBucket.forEach((x, i) => { x.order = i; });

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

  // area: 'work' | 'personal' | null (усі розділи разом)
  function stats(area) {
    const t = todayStr();
    const all = area ? state.events.filter((e) => e.area === area) : state.events;
    const between = (a, b) => all.filter((e) => e.date >= a && e.date <= b);

    const total = all.length;
    const evToday = all.filter((e) => e.date === t).length;
    const evWeek = between(startOfWeek(t), t).length;
    const evMonth = between(startOfMonth(t), t).length;
    const evYear = between(startOfYear(t), t).length;

    // Період активності (від першої події) — для середніх
    let firstDate = t;
    for (const e of all) if (e.date < firstDate) firstDate = e.date;
    const activeDays = Math.max(1, diffDays(t, firstDate) + 1);
    const avgPerDay = total / activeDays;
    const avgPerWeek = avgPerDay * 7;
    const avgPerMonth = avgPerDay * 30.4;

    // Серія (streak) — поспіль дні з ≥1 виконанням
    const daySet = new Set(all.map((e) => e.date));
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
      last30.push({ date: d, count: all.filter((e) => e.date === d).length });
    }

    // Останні 12 місяців
    const last12 = [];
    const base = fromStr(t);
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const ms = toStr(dt);
      const me = toStr(new Date(dt.getFullYear(), dt.getMonth() + 1, 0));
      last12.push({ label: MONTHS[dt.getMonth()], count: between(ms, me).length });
    }

    // Розбивка за складністю та регулярністю (за поточний місяць)
    const monthEv = between(startOfMonth(t), t);
    const byRecurring = { recurring: 0, once: 0 };
    const byComplexity = { easy: 0, medium: 0, hard: 0 };
    for (const e of monthEv) {
      byRecurring[e.recurring ? 'recurring' : 'once']++;
      if (byComplexity[e.complexity] != null) byComplexity[e.complexity]++;
    }

    // Робота vs Особисте — рахуємо завжди по всіх подіях місяця, щоб
    // цю панель можна було показати незалежно від обраного розділу
    const byArea = { work: 0, personal: 0 };
    for (const e of eventsBetween(startOfMonth(t), t)) {
      if (byArea[e.area] != null) byArea[e.area]++;
    }

    return {
      total, evToday, evWeek, evMonth, evYear,
      avgPerDay, avgPerWeek, avgPerMonth,
      streak, best, activeDays, firstDate,
      last30, last12, byRecurring, byComplexity, byArea,
    };
  }

  /* ---------- Резервні копії ---------- */

  const BACKUP_APP = 'work-hub';

  /* Файл копії має обгортку: так при відновленні видно, що це «наш» файл,
     і якої він давності. Старий «голий» формат теж приймаємо. */
  function exportJSON() {
    return JSON.stringify({
      _app: BACKUP_APP,
      _version: state.version,
      _exportedAt: new Date().toISOString(),
      state,
    }, null, 2);
  }

  function importJSON(text) {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error('Це не JSON-файл'); }

    const data = (parsed && parsed.state) ? parsed.state : parsed; // нова обгортка або старий формат
    if (!data || !Array.isArray(data.tasks)) throw new Error('У файлі немає задач цього застосунку');
    if (parsed && parsed._app && parsed._app !== BACKUP_APP) throw new Error('Файл від іншого застосунку');

    state = migrate(Object.assign(blankState(), data));
    state.settings.seeded = true;
    save();
    return { at: (parsed && parsed._exportedAt) || null, tasks: state.tasks.length };
  }

  function markBackup() {
    state.settings.lastBackupAt = new Date().toISOString();
    save();
  }

  // Скільки днів минуло з останньої копії (null — копії ще не було)
  function daysSinceBackup() {
    const at = state.settings.lastBackupAt;
    if (!at) return null;
    return Math.max(0, diffDays(todayStr(), toStr(new Date(at))));
  }

  function backupFileName() { return `work-hub-${todayStr()}.json`; }

  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    state = seedIfEmpty(blankState());
    save();
  }

  /* ---------- Публічний API ---------- */

  window.Store = {
    // довідники
    AREAS, COMPLEXITY, RECUR, WEEKDAYS_SHORT,
    // поточний розділ (Робота / Особисте)
    area: () => state.settings.area || 'work',
    setArea: (a) => { if (AREAS[a]) { state.settings.area = a; save(); } },
    // дати
    todayStr, addDays, humanDate, fromStr, toStr, diffDays,
    // задачі (усі або лише поточного розділу)
    tasks: (area) => (area ? state.tasks.filter((t) => t.area === area) : state.tasks),
    getTask, upsertTask, deleteTask, toggleTask, toggleSubtask, moveTask,
    undoCompletion, todayProgress,
    isDoneToday, isRecurring, bucketOf, nextOccurrence,
    // архів
    dayEntries, monthMarks,
    // цілі
    goals: (area) => (area ? state.goals.filter((g) => g.area === area) : state.goals),
    getGoal, upsertGoal, deleteGoal, toggleMilestone,
    // статистика
    stats,
    // сервіс
    exportJSON, importJSON, resetAll, save, uid,
    markBackup, daysSinceBackup, backupFileName,
    setOnSaved: (fn) => { onSavedHook = fn; },
    raw: () => state,
  };
})();
