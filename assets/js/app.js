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
    recur: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></svg>',
    subs: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
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
  const expandedTasks = new Set(); // які задачі показують підзадачі

  // Перемкнути розділ Робота/Особисте й оновити все, що від нього залежить
  function setArea(a) {
    S.setArea(a);
    $$('#area-switch [data-area]').forEach((b) => b.classList.toggle('on', b.dataset.area === a));
    document.body.classList.toggle('area-personal', a === 'personal');
    if (currentTab === 'tasks') renderTasks();
    if (currentTab === 'stats') renderStats();
    if (currentTab === 'goals') renderGoals();
    renderDrawer();
  }

  /* ============================================================
     ПЕРЕМИКАННЯ РОЗДІЛІВ ГОРИЗОНТАЛЬНИМ СВАЙПОМ

     Свайп вліво → наступний розділ (Робота → Особисте),
     вправо → попередній. Вертикальна прокрутка та перетягування
     задач мають пріоритет: жест зараховується лише коли рух
     явно горизонтальний.
     ============================================================ */
  const AREA_ORDER = ['work', 'personal'];
  const SWIPE_MIN = 55;     // мінімальний зсув пальця для перемикання
  const SWIPE_RATIO = 1.4;  // наскільки горизонталь має переважати вертикаль
  const SWIPE_DECIDE = 10;  // після якого зсуву вирішуємо: свайп чи прокрутка

  const SWIPE = { tracking: false, decided: null, startX: 0, startY: 0, dx: 0 };

  function setupAreaSwipe() {
    document.addEventListener('pointerdown', onSwipeDown);
    document.addEventListener('pointermove', onSwipeMove, { passive: false });
    document.addEventListener('pointerup', onSwipeUp);
    document.addEventListener('pointercancel', resetSwipe);
    // на iOS лише не-пасивний touchmove надійно блокує власну прокрутку браузера
    document.addEventListener('touchmove', (e) => {
      if (SWIPE.decided === 'swipe') e.preventDefault();
    }, { passive: false });
  }

  function onSwipeDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // не заважаємо формі, бічному меню та самому перемикачу
    if (e.target.closest('#sheet') || e.target.closest('#drawer') || e.target.closest('#area-switch')) return;
    if ($('#sheet').classList.contains('open') || $('#drawer').classList.contains('open')) return;
    SWIPE.tracking = true;
    SWIPE.decided = null;
    SWIPE.startX = e.clientX;
    SWIPE.startY = e.clientY;
    SWIPE.dx = 0;
  }

  function onSwipeMove(e) {
    if (!SWIPE.tracking) return;
    if (DRAG.active) { resetSwipe(); return; } // тягнемо задачу — не наш жест

    const dx = e.clientX - SWIPE.startX;
    const dy = e.clientY - SWIPE.startY;

    if (!SWIPE.decided) {
      if (Math.abs(dy) > SWIPE_DECIDE && Math.abs(dy) >= Math.abs(dx)) { resetSwipe(); return; } // прокрутка
      if (Math.abs(dx) > SWIPE_DECIDE && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) {
        SWIPE.decided = 'swipe';
        if (DRAG.timer) { clearTimeout(DRAG.timer); DRAG.timer = null; } // скасувати «підйом» задачі
      } else return;
    }

    e.preventDefault();
    SWIPE.dx = dx;
    // екран трохи їде за пальцем; біля межі (немає куди гортати) — сильніше гальмує
    const screen = $('.screen.active');
    if (screen) {
      const damp = nextArea(dx) ? 0.35 : 0.12;
      screen.style.transition = 'none';
      screen.style.transform = `translateX(${dx * damp}px)`;
    }
  }

  function onSwipeUp() {
    if (!SWIPE.tracking) return;
    const dx = SWIPE.dx;
    const decided = SWIPE.decided;
    const target = nextArea(dx);
    resetSwipe();

    // Після жесту браузер ще шле click — інакше він відкрив би форму задачі,
    // над якою проїхав палець.
    if (decided === 'swipe') suppressClickUntil = Date.now() + 350;

    const screen = $('.screen.active');
    if (decided === 'swipe' && Math.abs(dx) >= SWIPE_MIN && target) {
      slideToArea(target, Math.sign(dx));
    } else if (screen) {
      screen.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)';
      screen.style.transform = '';
      setTimeout(() => { screen.style.transition = ''; }, 220);
    }
  }

  // Куди веде свайп: dx < 0 (вліво) — далі по списку розділів, dx > 0 — назад
  function nextArea(dx) {
    const i = AREA_ORDER.indexOf(S.area());
    const j = i + (dx < 0 ? 1 : -1);
    return AREA_ORDER[j] || null;
  }

  function resetSwipe() {
    SWIPE.tracking = false;
    SWIPE.decided = null;
    SWIPE.dx = 0;
  }

  // Плавно замінити вміст: старий екран іде за напрямком свайпу, новий приходить з іншого боку
  function slideToArea(area, sign) {
    const out = $('.screen.active');
    if (!out) { setArea(area); return; }
    if (navigator.vibrate) navigator.vibrate(8);

    out.style.transition = 'transform .14s ease-out, opacity .14s ease-out';
    out.style.transform = `translateX(${sign * 45}px)`;
    out.style.opacity = '0';

    setTimeout(() => {
      setArea(area);
      const el = $('.screen.active');
      if (!el) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${-sign * 45}px)`;
      el.style.opacity = '0';
      requestAnimationFrame(() => {
        el.style.transition = 'transform .18s ease-out, opacity .18s ease-out';
        el.style.transform = 'translateX(0)';
        el.style.opacity = '1';
        setTimeout(() => { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; }, 200);
      });
    }, 140);
  }

  // action: { label, fn } — необовʼязкова кнопка в тості (напр. «Скасувати»)
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = esc(msg) + (action ? ` <button class="toast-act">${esc(action.label)}</button>` : '');
    if (action) {
      $('.toast-act', t).onclick = () => {
        t.classList.remove('show');
        clearTimeout(toast._t);
        action.fn();
      };
    }
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), action ? 4000 : 1800);
  }

  /* ============================================================
     ЕКРАН: ЗАДАЧІ
     ============================================================ */
  function renderTasks() {
    const root = $('#screen-tasks');
    const tasks = S.tasks(S.area()); // лише поточний розділ

    // згрупувати за bucket
    const groups = { today: [], tomorrow: [], week: [], later: [] };
    for (const t of tasks) {
      const b = S.bucketOf(t);
      if (b === 'done') continue; // виконані разові ховаємо
      if (groups[b]) groups[b].push(t);
    }

    const progress = S.todayProgress(S.area());

    let html = '';
    let anything = false;
    for (const g of BUCKETS) {
      const items = groups[g.id];
      // «Сьогодні» показуємо навіть порожнім, якщо сьогодні щось зроблено —
      // інакше прогрес зникав би разом з останньою виконаною задачею
      const keepToday = g.id === 'today' && progress.done > 0;
      if (!items.length && !keepToday) continue;
      anything = true;
      // сортування: невиконані спершу, потім за порядком
      items.sort((a, b) => (S.isDoneToday(a) - S.isDoneToday(b)) || (a.order - b.order));

      const count = g.id === 'today'
        ? `<span class="group-count ${progress.done === progress.total ? 'full' : ''}">${progress.done}/${progress.total}</span>` : '';
      html += `<section class="group" data-bucket="${g.id}"><div class="group-head">
        <div class="group-title ${g.id}">${g.title.toUpperCase()}</div>${count}</div>`;
      html += items.length ? items.map(taskCard).join('')
        : `<div class="all-done">🎉 Усе на сьогодні виконано</div>`;
      html += `</section>`;
    }

    if (!anything) {
      const a = S.AREAS[S.area()].label.toLowerCase();
      html += `<div class="empty"><div class="big">🗒️</div>У розділі «${esc(a)}» ще немає задач.<br>Натисни «+», щоб додати.</div>`;
    }
    root.innerHTML = html;
  }

  function taskCard(t) {
    const cx = S.COMPLEXITY[t.complexity] || S.COMPLEXITY.easy;
    const doneToday = S.isDoneToday(t);
    const recurring = S.isRecurring(t);
    const hasSubs = t.subtasks && t.subtasks.length;
    const open = expandedTasks.has(t.id);

    // Компактні маркери — іконки в тому ж рядку, що й назва (без окремого рядка).
    // Текст лишається у підказці (title), щоб зміст не втрачався.
    const marks = [];
    if (recurring) {
      marks.push(`<span class="mark recur" title="${esc(S.RECUR[t.recurrence.type].label)}">${ICON.recur}</span>`);
    }
    if (hasSubs) {
      const d = t.subtasks.filter((s) => s.done).length;
      marks.push(`<span class="mark subs ${open ? 'on' : ''}" data-subs="${t.id}"
        title="Підзадачі: ${d}/${t.subtasks.length}">${ICON.subs}${d}/${t.subtasks.length}</span>`);
    }

    // мітка дня для тижневих/пізніх
    let dayTag = '';
    const b = S.bucketOf(t);
    if ((b === 'week' || b === 'later') && t.dueDate) {
      const wd = S.WEEKDAYS_SHORT[S.fromStr(t.dueDate).getDay()];
      dayTag = `<span class="day-tag">${b === 'later' ? S.humanDate(t.dueDate) : wd}</span>`;
    }

    // підзадачі — лише коли розгорнуто
    let subs = '';
    if (hasSubs && open) {
      subs = `<div class="subs">` + t.subtasks.map((s) => `
        <div class="sub ${s.done ? 'on' : ''}" data-sub="${s.id}" data-task="${t.id}">
          <div class="mini">${s.done ? ICON.checkMini : ''}</div><span>${esc(s.title)}</span>
        </div>`).join('') + `</div>`;
    }

    const remind = t.remindAt ? `<div class="remind">${ICON.bell} ${t.dueDate ? S.humanDate(t.dueDate) + ' о ' : ''}${esc(t.remindAt)}</div>` : '';

    // колір чекбокса = складність (зелений/помаранчевий/червоний)
    return `<div class="task ${doneToday ? 'done-today' : ''}" data-task="${t.id}">
      <button class="check ${doneToday ? 'on' : ''}" data-toggle="${t.id}" style="--c:${cx.color}" title="${cx.label}">${doneToday ? ICON.check : ''}</button>
      <div class="body">
        <div class="line" data-open="${t.id}">${dayTag}<span class="title">${esc(t.title)}</span>${
          marks.length ? `<span class="marks">${marks.join('')}</span>` : ''}</div>
        ${remind}
        ${subs}
      </div>
    </div>`;
  }

  /* ============================================================
     ПЕРЕТЯГУВАННЯ ЗАДАЧ МІЖ ГРУПАМИ (днями)

     Стартує довгим натисканням (~280 мс), щоб не заважати звичайній
     прокрутці списку. Далі за пальцем летить копія рядка, а місце падіння
     показує пунктирна рамка.
     ============================================================ */
  const HOLD_MS = 280;      // скільки тримати, щоб «підняти» задачу
  const MOVE_CANCEL = 12;   // зсув до старту = прокрутка, не перетягування

  const DRAG = {
    active: false, id: null, row: null, ghost: null, ph: null,
    timer: null, startX: 0, startY: 0, offX: 0, offY: 0, lastY: 0, raf: null,
  };
  let suppressClickUntil = 0; // щоб після перетягування не відкривалась форма

  function setupDragAndDrop() {
    const screen = $('#screen-tasks');
    screen.addEventListener('pointerdown', onDragDown);
    document.addEventListener('pointermove', onDragMove, { passive: false });
    document.addEventListener('pointerup', finishDrag);
    document.addEventListener('pointercancel', abortDrag);
    // На iOS лише preventDefault у НЕ-пасивному touchmove надійно
    // зупиняє прокрутку сторінки під час перетягування.
    document.addEventListener('touchmove', (e) => {
      if (DRAG.active) e.preventDefault();
    }, { passive: false });
  }

  function onDragDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // не починаємо перетягування з чекбокса, іконки підзадач чи самої підзадачі
    if (e.target.closest('[data-toggle]') || e.target.closest('[data-subs]') || e.target.closest('[data-sub]')) return;
    const row = e.target.closest('.task');
    if (!row) return;

    DRAG.row = row;
    DRAG.id = row.dataset.task;
    DRAG.startX = e.clientX;
    DRAG.startY = e.clientY;
    DRAG.lastY = e.clientY;
    clearTimeout(DRAG.timer);
    DRAG.timer = setTimeout(() => startDrag(e.clientX, e.clientY), HOLD_MS);
  }

  function startDrag(x, y) {
    DRAG.timer = null;
    const row = DRAG.row;
    if (!row || !row.isConnected) return;

    const r = row.getBoundingClientRect();
    DRAG.active = true;
    DRAG.offX = x - r.left;
    DRAG.offY = y - r.top;

    // копія рядка, що летить за пальцем
    const ghost = row.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = r.width + 'px';
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    document.body.appendChild(ghost);
    DRAG.ghost = ghost;

    // місце, куди впаде задача
    const ph = document.createElement('div');
    ph.className = 'drop-ph';
    ph.style.height = r.height + 'px';
    row.parentNode.insertBefore(ph, row);
    DRAG.ph = ph;

    row.classList.add('is-dragging');
    document.body.classList.add('dragging');
    ensureAllGroups();          // щоб можна було кинути і в порожній день
    if (navigator.vibrate) navigator.vibrate(15);
    startAutoScroll();
  }

  // Під час перетягування показуємо всі 4 групи, навіть порожні
  function ensureAllGroups() {
    const root = $('#screen-tasks');
    for (const g of BUCKETS) {
      if (root.querySelector(`.group[data-bucket="${g.id}"]`)) continue;
      const sec = document.createElement('section');
      sec.className = 'group is-temp';
      sec.dataset.bucket = g.id;
      sec.innerHTML = `<div class="group-head"><div class="group-title ${g.id}">${g.title.toUpperCase()}</div></div>
        <div class="drop-empty"></div>`;
      root.appendChild(sec);
    }
  }

  function onDragMove(e) {
    if (!DRAG.active) {
      // ще чекаємо на довге натискання — якщо палець поїхав, це прокрутка
      if (DRAG.timer) {
        const dx = Math.abs(e.clientX - DRAG.startX);
        const dy = Math.abs(e.clientY - DRAG.startY);
        if (dx > MOVE_CANCEL || dy > MOVE_CANCEL) { clearTimeout(DRAG.timer); DRAG.timer = null; DRAG.row = null; }
      }
      return;
    }
    e.preventDefault();
    DRAG.lastY = e.clientY;
    DRAG.ghost.style.left = (e.clientX - DRAG.offX) + 'px';
    DRAG.ghost.style.top = (e.clientY - DRAG.offY) + 'px';
    updateDropSpot(e.clientY);
  }

  // Куди саме впаде: визначаємо групу під пальцем і позицію в ній
  function updateDropSpot(y) {
    const groups = $$('#screen-tasks .group');
    if (!groups.length) return;

    let target = null;
    for (const g of groups) {
      const r = g.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) { target = g; break; }
    }
    if (!target) {
      // палець вище/нижче за всі групи — беремо крайню
      const first = groups[0].getBoundingClientRect();
      target = y < first.top ? groups[0] : groups[groups.length - 1];
    }

    $$('#screen-tasks .group').forEach((g) => g.classList.toggle('drop-over', g === target));

    const rows = $$('.task:not(.is-dragging)', target);
    let before = null;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = row; break; }
    }
    if (before) target.insertBefore(DRAG.ph, before);
    else target.appendChild(DRAG.ph);
  }

  // Автопрокрутка, коли тягнеш до краю екрана
  function startAutoScroll() {
    const step = () => {
      if (!DRAG.active) return;
      const y = DRAG.lastY;
      const h = window.innerHeight;
      let dy = 0;
      if (y < 90) dy = -Math.ceil((90 - y) / 6);
      else if (y > h - 130) dy = Math.ceil((y - (h - 130)) / 6);
      if (dy) { window.scrollBy(0, dy); updateDropSpot(y); }
      DRAG.raf = requestAnimationFrame(step);
    };
    DRAG.raf = requestAnimationFrame(step);
  }

  function finishDrag() {
    if (DRAG.timer) { clearTimeout(DRAG.timer); DRAG.timer = null; DRAG.row = null; return; } // це був звичайний тап
    if (!DRAG.active) return;

    const group = DRAG.ph.closest('.group');
    const bucket = group && group.dataset.bucket;
    let index = 0;
    if (group) {
      for (const el of group.children) {
        if (el === DRAG.ph) break;
        if (el.classList.contains('task') && !el.classList.contains('is-dragging')) index++;
      }
    }
    const id = DRAG.id;
    cleanupDrag();
    if (bucket && id) {
      S.moveTask(id, bucket, index);
      suppressClickUntil = Date.now() + 350;
      renderTasks();
      renderDrawer();
      toast('Перенесено: ' + (BUCKETS.find((b) => b.id === bucket) || {}).title);
    }
  }

  function abortDrag() {
    if (DRAG.timer) { clearTimeout(DRAG.timer); DRAG.timer = null; DRAG.row = null; }
    if (!DRAG.active) return;
    cleanupDrag();
    renderTasks();
  }

  function cleanupDrag() {
    if (DRAG.raf) cancelAnimationFrame(DRAG.raf);
    if (DRAG.ghost) DRAG.ghost.remove();
    if (DRAG.ph) DRAG.ph.remove();
    if (DRAG.row) DRAG.row.classList.remove('is-dragging');
    $$('#screen-tasks .group').forEach((g) => g.classList.remove('drop-over'));
    document.body.classList.remove('dragging');
    Object.assign(DRAG, { active: false, id: null, row: null, ghost: null, ph: null, timer: null, raf: null });
  }

  /* ============================================================
     ЕКРАН: СТАТИСТИКА
     ============================================================ */
  function renderStats() {
    // статистика поточного розділу (перемикач Робота/Особисте вгорі діє й тут)
    const st = S.stats(S.area());
    const root = $('#screen-stats');
    const fmt = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

    const cards = [
      { num: st.evToday, lbl: 'Сьогодні', sub: `в середньому ${fmt(st.avgPerDay)}/день` },
      { num: st.evWeek, lbl: 'Цього тижня', sub: `в середньому ${fmt(st.avgPerWeek)}/тижд.` },
      { num: st.evMonth, lbl: 'Цього місяця', sub: `в середньому ${fmt(st.avgPerMonth)}/міс.` },
      { num: st.evYear, lbl: 'Цього року', sub: `всього ${st.total} виконань` },
    ];

    let html = `<div class="view-title" style="margin:14px 4px 0">Трекер виконань · ${S.AREAS[S.area()].label}</div>`;
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
    const CX = S.COMPLEXITY;
    html += breakdownPanel('За складністю', [
      [CX.easy.label, st.byComplexity.easy, CX.easy.color],
      [CX.medium.label, st.byComplexity.medium, CX.medium.color],
      [CX.hard.label, st.byComplexity.hard, CX.hard.color],
    ]);
    html += breakdownPanel('Регулярні vs Разові', [
      ['Регулярні', st.byRecurring.recurring, '#34c759'],
      ['Разові', st.byRecurring.once, '#f5a623'],
    ]);
    // байдуже, який розділ обрано — ця панель порівнює обидва
    html += breakdownPanel('Робота vs Особисте', [
      [S.AREAS.work.label, st.byArea.work, S.AREAS.work.accent],
      [S.AREAS.personal.label, st.byArea.personal, S.AREAS.personal.accent],
    ]);

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
    const goals = S.goals(S.area()); // цілі теж розділені на Робота/Особисте
    let html = `<div class="view-title" style="margin:14px 4px 0">Мої цілі · ${S.AREAS[S.area()].label}</div>`;
    if (!goals.length) {
      html += `<div class="empty"><div class="big">🎯</div>У цьому розділі ще немає цілей.<br>Додай першу через «+».</div>`;
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
    const cur = S.area();
    // активні задачі по кожному розділу
    const cnt = { work: 0, personal: 0 };
    for (const t of S.tasks()) {
      if (S.bucketOf(t) === 'done') continue;
      if (cnt[t.area] != null) cnt[t.area]++;
    }
    let html = `<div class="d-head">
      <button class="settings" id="open-settings" aria-label="Налаштування">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.3 1z"/></svg>
      </button>
      <div style="font-weight:800;font-size:18px">Work Hub</div><div style="width:38px"></div></div>`;

    html += `<div class="d-sec">Розділи</div>`;
    for (const [id, a] of Object.entries(S.AREAS)) {
      html += `<div class="d-item ${cur === id ? 'active' : ''}" data-setarea="${id}">
        <span class="dot" style="background:${a.accent}"></span>${a.label}<span class="cnt">${cnt[id]}</span></div>`;
    }

    html += `<div class="d-sec">Екрани</div>`;
    html += `<div class="d-item" data-goto="tasks">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>Задачі</div>`;
    html += `<div class="d-item" data-goto="stats">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>Статистика</div>`;
    html += `<div class="d-item" data-goto="goals">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>Цілі</div>`;

    d.innerHTML = html;
  }

  /* ============================================================
     ФОРМА ЗАДАЧІ (нижня шторка)
     ============================================================ */
  let draft = null; // чернетка задачі під час редагування

  function openTaskSheet(id) {
    const existing = id ? S.getTask(id) : null;
    draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      title: '', note: '', area: S.area(), complexity: 'easy',
      subtasks: [], recurrence: { type: 'once' }, bucket: 'today', dueDate: null, remindAt: null,
    };
    renderTaskSheet(!!existing);
    openSheet();
  }

  function renderTaskSheet(isEdit) {
    const d = draft;
    const rec = d.recurrence || { type: 'once' };

    const areaChips = Object.entries(S.AREAS).map(([k, v]) =>
      `<button class="chip ${d.area === k ? 'on' : ''}" data-setarea-chip="${k}">
        <span class="dot" style="background:${v.accent}"></span>${v.label}</button>`).join('');

    const cxChips = Object.entries(S.COMPLEXITY).map(([k, v]) =>
      `<button class="chip ${d.complexity === k ? 'on' : ''}" data-setcx="${k}">
        <span class="dot" style="background:${v.color}"></span>${v.label}</button>`).join('');

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

    // підзадачі — доступні будь-якій задачі
    const subField = `<div class="field"><label>Підзадачі</label><div class="subedit" id="subedit">` +
      (d.subtasks || []).map((s, i) => `<div class="row">
        <input type="text" data-subidx="${i}" value="${esc(s.title)}" placeholder="Крок ${i + 1}">
        <button class="del" data-delsub="${i}">✕</button></div>`).join('') +
      `</div><button class="link-btn" id="add-sub">+ Додати підзадачу</button></div>`;

    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <button class="close-x" data-close>✕</button>
      <h2>${isEdit ? 'Редагувати задачу' : 'Нова задача'}</h2>

      <div class="field"><label>Назва</label>
        <input type="text" id="t-title" value="${esc(d.title)}" placeholder="Що потрібно зробити?" autocomplete="off"></div>

      <div class="field"><label>Розділ</label><div class="chips">${areaChips}</div></div>
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
    draft.subtasks = (draft.subtasks || []).filter((s) => s.title.trim());
    // для регулярних без дати — стартуємо від сьогодні
    if (draft.recurrence.type !== 'once' && !draft.dueDate) draft.dueDate = S.todayStr();
    // isNew треба зчитати ДО збереження (upsertTask проставляє id)
    // і до closeSheet(), який обнуляє draft
    const isNew = !draft.id;
    S.upsertTask(draft);
    closeSheet();
    toast(isNew ? 'Додано' : 'Збережено');
    renderAll();
  }

  /* ============================================================
     ФОРМА ЦІЛІ
     ============================================================ */
  function openGoalSheet(id) {
    const existing = id ? S.getGoal(id) : null;
    draft = existing ? JSON.parse(JSON.stringify(existing)) : { title: '', note: '', area: S.area(), targetDate: null, milestones: [] };
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
    $('#btn-today').addEventListener('click', () => { switchTab('tasks'); });
    $('#drawer-backdrop').addEventListener('click', closeDrawer);
    $('#sheet-backdrop').addEventListener('click', closeSheet);

    // Перемикач Робота / Особисте вгорі
    $('#area-switch').addEventListener('click', (e) => {
      const b = e.target.closest('[data-area]');
      if (!b || b.dataset.area === S.area()) return;
      setArea(b.dataset.area);
    });

    // FAB — залежно від вкладки
    $('#fab').addEventListener('click', () => {
      if (currentTab === 'goals') openGoalSheet();
      else openTaskSheet();
    });

    // Клік по екрану задач
    $('#screen-tasks').addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return; // щойно перетягнули — не відкриваємо форму
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const id = toggle.dataset.toggle;
        const task = S.getTask(id);
        const wasPending = task && S.isRecurring(task) && !S.isDoneToday(task);
        S.toggleTask(id);
        renderTasks(); renderDrawer();
        // регулярна щойно переїхала на наступний строк — покажемо куди,
        // і дамо змогу скасувати, якщо натиснув випадково
        if (wasPending) {
          const now = S.getTask(id);
          const b = BUCKETS.find((x) => x.id === S.bucketOf(now));
          toast(`Далі: ${b ? b.title.toLowerCase() : S.humanDate(now.dueDate)}`, {
            label: 'Скасувати',
            fn: () => { S.undoCompletion(id); renderTasks(); renderDrawer(); },
          });
        }
        return;
      }
      // згорнути/розгорнути підзадачі — має перехоплюватись раніше за data-open
      const subsBtn = e.target.closest('[data-subs]');
      if (subsBtn) {
        const id = subsBtn.dataset.subs;
        if (expandedTasks.has(id)) expandedTasks.delete(id); else expandedTasks.add(id);
        renderTasks();
        return;
      }
      const sub = e.target.closest('[data-sub]');
      if (sub) { S.toggleSubtask(sub.dataset.task, sub.dataset.sub); renderTasks(); return; }
      const open = e.target.closest('[data-open]');
      if (open) { openTaskSheet(open.dataset.open); return; }
    });

    // Клік по екрану цілей
    $('#screen-goals').addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return; // щойно був свайп
      const ms = e.target.closest('[data-ms]');
      if (ms) { S.toggleMilestone(ms.dataset.goal, ms.dataset.ms); renderGoals(); return; }
      const eg = e.target.closest('[data-editgoal]');
      if (eg) openGoalSheet(eg.dataset.editgoal);
    });

    // Бічне меню
    $('#drawer').addEventListener('click', (e) => {
      const a = e.target.closest('[data-setarea]');
      if (a) { setArea(a.dataset.setarea); switchTab('tasks'); closeDrawer(); return; }
      const goto = e.target.closest('[data-goto]');
      if (goto) { switchTab(goto.dataset.goto); closeDrawer(); return; }
      if (e.target.closest('#open-settings')) openSettings();
    });

    // Усі кліки всередині шторки
    $('#sheet').addEventListener('click', onSheetClick);
  }

  function onSheetClick(e) {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }

    // --- задача ---
    const setarea = e.target.closest('[data-setarea-chip]');
    if (setarea) { syncTaskInputs(); draft.area = setarea.dataset.setareaChip; renderTaskSheet(!!draft.id); return; }
    const setcx = e.target.closest('[data-setcx]');
    if (setcx) { syncTaskInputs(); draft.complexity = setcx.dataset.setcx; renderTaskSheet(!!draft.id); return; }
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
    setupDragAndDrop();
    setupAreaSwipe();
    setArea(S.area()); // відновлює обраний розділ і малює список

    // PWA service worker (тільки коли обслуговується через http/https)
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      setupServiceWorker();
    }
  }

  /* Реєстрація воркера + автоматичне підхоплення нових версій.
     Важливо для застосунку на головному екрані: він може «жити» днями,
     тому перевіряємо оновлення при кожному відкритті/поверненні у застосунок. */
  function setupServiceWorker() {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const check = () => reg.update().catch(() => {});
      check();
      // при поверненні до застосунку
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      window.addEventListener('focus', check);
      // і раз на годину, якщо застосунок відкритий довго
      setInterval(check, 60 * 60 * 1000);

      // новий воркер уже чекає — попросимо його стати активним
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage('skip-waiting');
          }
        });
      });
    }).catch(() => {});

    // Коли нова версія перебирає керування — один раз перезавантажуємось,
    // щоб користувач бачив свіжий код (дані в localStorage не зачіпаються).
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
