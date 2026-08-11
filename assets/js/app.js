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
    cal: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 15V3h13l-2 4 2 4H4M4 21v-6"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  };

  const BUCKETS = [
    { id: 'today', title: 'Сьогодні' },
    { id: 'tomorrow', title: 'Завтра' },
    { id: 'week', title: 'На тижні' },
    { id: 'later', title: 'Потім' },
  ];

  /* ---------- Глобальний UI-стан ---------- */
  let currentTab = 'tasks';
  let bannerHidden = false; // банер про копію сховано до наступного запуску
  const expandedTasks = new Set(); // які задачі показують підзадачі

  // Перемкнути розділ Робота/Особисте й оновити все, що від нього залежить
  function setArea(a) {
    S.setArea(a);
    $$('#area-switch [data-area]').forEach((b) => b.classList.toggle('on', b.dataset.area === a));
    document.body.classList.toggle('area-personal', a === 'personal');
    if (currentTab === 'tasks') renderTasks();
    if (currentTab === 'stats') renderStats();
    if (currentTab === 'goals') renderGoals();
    if (currentTab === 'calendar') renderCalendar();
    if (currentTab === 'events') renderEvents();
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

  /* ============================================================
     ЗАКРИТИ ФОРМУ СВАЙПОМ УНИЗ

     Як у системних шторках iOS: тягнеш форму згори вниз — вона їде за
     пальцем і закривається. Знизу списку жест не заважає прокрутці:
     тягнути можна або за «смужку»/заголовок, або коли форма вже
     прокручена до самого верху.
     ============================================================ */
  const SHEET_CLOSE_PX = 110;  // після якого зсуву форма закривається
  const SHEET_DECIDE = 8;      // після якого зсуву вирішуємо: тягнемо чи гортаємо
  const SHEET_HEAD_PX = 70;    // верхня смуга форми, з якої тягнути можна завжди

  const SHEET = { tracking: false, decided: null, startX: 0, startY: 0, dy: 0, fromHead: false, t0: 0 };

  function setupSheetSwipe() {
    const sh = $('#sheet');
    sh.addEventListener('pointerdown', onSheetDown);
    sh.addEventListener('pointermove', onSheetMove, { passive: false });
    sh.addEventListener('pointerup', onSheetUp);
    sh.addEventListener('pointercancel', onSheetUp);
    // iOS зупиняє власну прокрутку лише від не-пасивного touchmove
    sh.addEventListener('touchmove', (e) => { if (SHEET.decided === 'drag') e.preventDefault(); }, { passive: false });
  }

  function onSheetDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const sh = $('#sheet');
    if (!sh.classList.contains('open')) return;
    // у полях уводу палець виділяє текст, а не тягне форму
    if (e.target.closest('input, textarea, select')) return;
    SHEET.tracking = true;
    SHEET.decided = null;
    SHEET.startX = e.clientX;
    SHEET.startY = e.clientY;
    SHEET.dy = 0;
    SHEET.t0 = Date.now();
    SHEET.fromHead = !!e.target.closest('.grabber, h2, .close-x')
      || (e.clientY - sh.getBoundingClientRect().top) < SHEET_HEAD_PX;
  }

  function onSheetMove(e) {
    if (!SHEET.tracking) return;
    const sh = $('#sheet');
    const dy = e.clientY - SHEET.startY;
    const dx = e.clientX - SHEET.startX;

    if (!SHEET.decided) {
      if (dy < SHEET_DECIDE) {
        // вгору або вбік — це не наш жест
        if (dy < -SHEET_DECIDE || Math.abs(dx) > SHEET_DECIDE) SHEET.tracking = false;
        return;
      }
      if (Math.abs(dx) > dy) { SHEET.tracking = false; return; }
      // з середини форми тягнемо лише коли вона вже вгорі — інакше це прокрутка
      if (!SHEET.fromHead && sh.scrollTop > 0) { SHEET.tracking = false; return; }
      SHEET.decided = 'drag';
      sh.classList.add('dragging');
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }

    e.preventDefault();
    SHEET.dy = dy;
    sh.style.transform = `translateY(${dy}px)`;
    $('#sheet-backdrop').style.opacity = String(Math.max(0, 1 - dy / 420));
  }

  function onSheetUp() {
    if (!SHEET.tracking) return;
    const sh = $('#sheet');
    const dy = SHEET.dy;
    const decided = SHEET.decided;
    const flick = dy > 45 && (Date.now() - SHEET.t0) < 260; // різкий короткий рух теж закриває

    SHEET.tracking = false;
    SHEET.decided = null;
    SHEET.dy = 0;
    sh.classList.remove('dragging');
    $('#sheet-backdrop').style.opacity = '';
    if (decided !== 'drag') return;

    suppressClickUntil = Date.now() + 350; // після жесту браузер ще шле click
    if (dy > SHEET_CLOSE_PX || flick) closeSheet();
    else sh.style.transform = '';
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

  /* ============================================================
     ЗВУК І АНІМАЦІЯ ВИКОНАННЯ

     Задача не зникає миттєво: спершу видно поставлену галочку,
     і лише за секунду рядок згасає. Разом зі звуком це дає чіткий
     сигнал «зроблено».
     ============================================================ */
  const HOLD_DONE_MS = 900;   // скільки милуємось галочкою
  const FADE_MS = 260;        // згасання рядка

  let audioCtx = null;

  /* Короткий двонотний сигнал. Генеруємо на льоту, щоб не тягнути
     звуковий файл: він однаково не встиг би завантажитись офлайн. */
  function playDoneSound() {
    if (!S.soundOn()) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      // iOS дозволяє звук лише після дотику — а ми тут саме з дотику
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const t = audioCtx.currentTime;
      const gain = audioCtx.createGain();
      gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);

      [880, 1318.5].forEach((freq, i) => {          // ля → мі, «дзінь»
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + i * 0.085);
        osc.connect(gain);
        osc.start(t + i * 0.085);
        osc.stop(t + 0.42);
      });
    } catch (e) { /* без звуку — не біда */ }
  }

  /* Спільний обробник позначення задачі: і на екрані задач, і в архіві. */
  function toggleWithFeedback(id, rerender) {
    const task = S.getTask(id);
    if (!task) return;

    const wasDone = S.isDoneToday(task);
    const wasRecurringPending = S.isRecurring(task) && !wasDone;
    S.toggleTask(id);

    // Зняли галочку — нічого святкувати, оновлюємо одразу
    if (wasDone) { rerender(); renderDrawer(); return; }

    playDoneSound();

    const row = $(`.screen.active .task[data-task="${id}"]`);
    if (!row) { rerender(); renderDrawer(); return; }

    // показуємо галочку, не перемальовуючи список
    row.classList.add('done-today', 'just-done');
    const check = $('.check', row);
    if (check) { check.classList.add('on'); check.innerHTML = ICON.check; }

    // лічильник дня оновлюємо одразу — приємніше, ніж чекати секунду
    const badge = $('.group[data-bucket="today"] .group-count');
    if (badge) {
      const pr = S.todayProgress(S.area());
      badge.textContent = `${pr.done}/${pr.total}`;
      badge.classList.toggle('full', pr.done === pr.total);
    }
    renderDrawer();

    setTimeout(() => {
      const el = $(`.screen.active .task[data-task="${id}"]`);
      if (el) el.classList.add('vanish');
      setTimeout(() => {
        rerender();
        if (wasRecurringPending) {
          const now = S.getTask(id);
          const b = BUCKETS.find((x) => x.id === S.bucketOf(now));
          toast(`Далі: ${b ? b.title.toLowerCase() : S.humanDate(now.dueDate)}`, {
            label: 'Скасувати',
            fn: () => { S.undoCompletion(id); rerender(); renderDrawer(); },
          });
        }
      }, FADE_MS);
    }, HOLD_DONE_MS);
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

    let html = bannerHidden ? '' : backupBannerHTML();
    let anything = false;
    for (const g of BUCKETS) {
      const items = groups[g.id];
      // «Сьогодні» показуємо навіть порожнім, якщо сьогодні щось зроблено —
      // інакше прогрес зникав би разом з останньою виконаною задачею
      const keepToday = g.id === 'today' && progress.done > 0;
      if (!items.length && !keepToday) continue;
      anything = true;
      // невиконані спершу, далі за датою, і лише потім за ручним порядком
      const sorted = S.sortTasks(items);

      const count = g.id === 'today'
        ? `<span class="group-count ${progress.done === progress.total ? 'full' : ''}">${progress.done}/${progress.total}</span>` : '';
      html += `<section class="group" data-bucket="${g.id}"><div class="group-head">
        <div class="group-title ${g.id}">${g.title.toUpperCase()}</div>${count}</div>`;
      html += sorted.length ? sorted.map(taskCard).join('')
        : `<div class="all-done">🎉 Усе на сьогодні виконано</div>`;
      html += `</section>`;
    }

    if (!anything) {
      const a = S.AREAS[S.area()].label.toLowerCase();
      html += `<div class="empty"><div class="big">🗒️</div>У розділі «${esc(a)}» ще немає задач.<br>Натисни «+», щоб додати.</div>`;
    }
    root.innerHTML = html;
  }

  /* Підпис під назвою: коли саме задача має відбутися.
     Для «На тижні» та «Потім» показуємо конкретну дату (лише буква дня
     праворуч не каже, яке це число), для сьогодні/завтра — лише час,
     бо день уже написаний у заголовку групи. */
  function whenNote(t, bucket) {
    const showDate = (bucket === 'week' || bucket === 'later') && t.dueDate;
    const time = t.remindAt;
    if (!showDate && !time) return '';

    let text = '';
    if (showDate && time) text = `${S.humanDate(t.dueDate)} о ${esc(time)}`;
    else if (showDate) text = S.humanDate(t.dueDate);
    else text = `о ${esc(time)}`;

    return `<div class="remind">${time ? ICON.bell : ICON.cal} ${text}</div>`;
  }

  // opts.flat — картка всередині конкретного дня (в архіві): день і так
  // відомий із заголовка, тож дату й мітку дня не дублюємо
  function taskCard(t, opts) {
    const flat = !!(opts && opts.flat);
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

    // мітка дня тижня праворуч — для швидкого перегляду
    let dayTag = '';
    const b = S.bucketOf(t);
    if (!flat && (b === 'week' || b === 'later') && t.dueDate) {
      dayTag = `<span class="day-tag">${S.WEEKDAYS_SHORT[S.fromStr(t.dueDate).getDay()]}</span>`;
    }

    // підзадачі — лише коли розгорнуто
    let subs = '';
    if (hasSubs && open) {
      subs = `<div class="subs">` + t.subtasks.map((s) => `
        <div class="sub ${s.done ? 'on' : ''}" data-sub="${s.id}" data-task="${t.id}">
          <div class="mini">${s.done ? ICON.checkMini : ''}</div><span>${esc(s.title)}</span>
        </div>`).join('') + `</div>`;
    }

    const remind = flat ? (t.remindAt ? `<div class="remind">${ICON.bell} о ${esc(t.remindAt)}</div>` : '') : whenNote(t, b);

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
     ЕКРАН: КАЛЕНДАР / АРХІВ

     Сітка місяця з крапками там, де щось заплановано або виконано.
     Під нею — що саме стосується обраного дня: спершу заплановане,
     потім виконане.
     ============================================================ */
  const MONTH_NAMES = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
    'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  const calState = { y: null, m: null, sel: null };

  function renderCalendar() {
    const root = $('#screen-calendar');
    const today = S.todayStr();
    if (calState.sel === null) {
      const d = S.fromStr(today);
      calState.y = d.getFullYear(); calState.m = d.getMonth(); calState.sel = today;
    }

    const { y, m } = calState;
    const first = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // з понеділка
    const marks = S.monthMarks(y, m, S.area());

    let cells = '';
    for (let i = 0; i < lead; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = S.toStr(new Date(y, m, d));
      const cls = [
        ds === calState.sel ? 'sel' : '',
        ds === today ? 'today' : '',
        marks.has(ds) ? 'has' : '',
      ].filter(Boolean).join(' ');
      cells += `<div class="cal-cell ${cls}" data-day="${ds}"><span>${d}</span></div>`;
    }

    const { done, planned } = S.dayEntries(calState.sel, S.area());
    const sd = S.fromStr(calState.sel);
    const dayLabel = `${sd.getDate()} ${MONTH_NAMES[sd.getMonth()].slice(0, 3).toLowerCase()}, ${S.WEEKDAYS_SHORT[sd.getDay()]}`;
    const isToday = calState.sel === today;

    let list = '';
    if (planned.length) {
      list += planned.map((t) => taskCard(t, { flat: true })).join('');
    }
    if (done.length) {
      list += done.map((e) => {
        const cx = S.COMPLEXITY[e.complexity] || S.COMPLEXITY.easy;
        return `<div class="task done-today">
          <button class="check on" style="--c:${cx.color}" disabled>${ICON.check}</button>
          <div class="body"><div class="line"><span class="title">${esc(e.title)}</span></div></div>
        </div>`;
      }).join('');
    }
    if (!list) list = `<div class="empty"><div class="big">📭</div>Цього дня нічого немає.</div>`;

    root.innerHTML = `
      <div class="cal-head">
        <button class="cal-nav" data-mon="-1" aria-label="Попередній місяць">‹</button>
        <div class="cal-title">${MONTH_NAMES[m]} ${y !== S.fromStr(today).getFullYear() ? y : ''}</div>
        <button class="cal-nav" data-mon="1" aria-label="Наступний місяць">›</button>
      </div>
      <div class="cal-week">${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'].map((d) => `<div>${d}</div>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-day">
        <div class="cal-day-title">${dayLabel.toUpperCase()}</div>
        ${done.length ? `<span class="group-count full">${done.length} ✓</span>` : ''}
      </div>
      ${isToday ? '' : '<div class="section-hint">Відмічати можна лише сьогоднішні задачі</div>'}
      <div class="cal-list ${isToday ? '' : 'readonly'}">${list}</div>`;
  }

  /* ============================================================
     ЕКРАН: ПОДІЇ-НАГАДУВАННЯ

     Показуємо обидва розділи разом (з плашкою «Робота»/«Особисте»),
     бо про день народження треба памʼятати незалежно від того, у якому
     режимі зараз застосунок.
     ============================================================ */
  let showPastEvents = false;

  function renderEvents() {
    const root = $('#screen-events');
    const t = S.todayStr();
    const list = S.reminders().filter((r) => S.nextEventDate(r) >= t);
    const past = S.pastReminders();

    let html = `<div class="view-title" style="margin:14px 4px 0">Події та нагадування</div>`;
    html += notifyHintHTML();

    if (!list.length) {
      html += `<div class="empty"><div class="big">🔔</div>Тут живуть події, які не треба виконувати —<br>дні народження, свята, зустрічі.<br>Натисни «+», щоб додати.</div>`;
    } else {
      // групуємо: сьогодні / цього тижня / далі
      const groups = { today: [], week: [], later: [] };
      for (const r of list) {
        const d = S.diffDays(S.nextEventDate(r), t);
        if (d === 0) groups.today.push(r);
        else if (d <= 7) groups.week.push(r);
        else groups.later.push(r);
      }
      const titles = { today: 'Сьогодні', week: 'Найближчі 7 днів', later: 'Далі' };
      for (const k of ['today', 'week', 'later']) {
        if (!groups[k].length) continue;
        html += `<section class="group"><div class="group-head">
          <div class="group-title ${k === 'today' ? 'today' : 'later'}">${titles[k].toUpperCase()}</div></div>`;
        html += groups[k].map(eventCard).join('');
        html += `</section>`;
      }
    }

    if (past.length) {
      html += `<button class="link-btn" id="toggle-past" style="margin-top:14px">${showPastEvents ? '▾' : '▸'} Минулі (${past.length})</button>`;
      if (showPastEvents) html += `<div class="past-events">${past.map(eventCard).join('')}</div>`;
    }

    if (list.length) {
      html += `<button class="btn ghost" id="ics-all" style="margin-top:18px">📅 Додати всі події в Календар</button>`;
    }
    root.innerHTML = html;
  }

  function eventCard(r) {
    const area = S.AREAS[r.area] || S.AREAS.work;
    const date = S.nextEventDate(r);
    const t = S.todayStr();
    const d = S.diffDays(date, t);
    const wd = S.WEEKDAYS_SHORT[S.fromStr(date).getDay()];

    let when = `${S.humanDate(date)}, ${wd}`;
    if (r.time) when += ` о ${esc(r.time)}`;
    let rel = '';
    if (d === 0) rel = 'сьогодні';
    else if (d === 1) rel = 'завтра';
    else if (d > 1) rel = `через ${d} дн.`;
    else rel = `${-d} дн. тому`;

    const alerts = (r.alerts || []).map((m) =>
      `<span class="mark recur">${ICON.bell}${esc(S.alertLabel(m))}</span>`).join('');

    return `<div class="event ${d < 0 ? 'is-past' : ''}" data-event="${r.id}">
      <div class="ev-main" data-editevent="${r.id}">
        <div class="ev-top">
          <span class="ev-area" style="--a:${area.accent}">${area.label}</span>
          ${r.yearly ? `<span class="ev-tag">🎂 щороку</span>` : ''}
          <span class="ev-rel">${rel}</span>
        </div>
        <div class="ev-title">${esc(r.title)}</div>
        <div class="ev-when">${when}</div>
        ${r.note ? `<div class="ev-note">${esc(r.note)}</div>` : ''}
        ${alerts ? `<div class="ev-alerts">${alerts}</div>` : ''}
      </div>
      <button class="ev-ics" data-ics="${r.id}" title="Додати в Календар">📅</button>
    </div>`;
  }

  /* Підказка про те, як влаштовані сповіщення. Чесно: у шторці їх шле
     Календар телефона, бо застосунок цього робити не може, коли закритий. */
  function notifyHintHTML() {
    const canNotify = 'Notification' in window;
    const granted = canNotify && Notification.permission === 'granted';
    const feedOn = window.CalFeed && window.CalFeed.healthy();

    const notifyLine = granted
      ? `<div style="margin-top:6px" class="bk-ok">Сповіщення в застосунку дозволені — він нагадає й сам, поки відкритий.</div>`
      : (canNotify && Notification.permission !== 'denied'
        ? `<button class="link-btn" id="ask-notify">Дозволити сповіщення й у застосунку</button>` : '');

    // Синхронізація увімкнена: нічого робити руками не треба
    if (feedOn) {
      return `<div class="notify-hint">
        <div class="bk-ok"><b>Події їдуть у Календар самі.</b> Він і нагадає у шторці — навіть коли застосунок закритий.</div>
        <div style="margin-top:6px">Телефон перечитує стрічку сам (зазвичай раз на годину). Треба негайно — кнопка 📅 біля події кладе її в Календар одразу.</div>
        ${notifyLine}
      </div>`;
    }

    return `<div class="notify-hint">
      <div><b>📅 = покласти подію в Календар.</b> Саме він потім нагадає у шторці — навіть коли цей застосунок закритий.</div>
      <div style="margin-top:6px">У вікні «Поділитися» Календаря немає: обери <b>Telegram</b> (собі в «Обране») або <b>Зберегти до Файлів</b>, а тоді <b>відкрий сам файл</b> — Календар запропонує «Додати все».</div>
      <button class="link-btn" id="cal-setup">⚙️ Налаштувати, щоб події переносились самі</button>
      ${notifyLine}
    </div>`;
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
    // редагування відкривається з будь-якого місця картки, крім кроків,
    // а олівець у кутку показує, що ціль узагалі можна редагувати
    return `<div class="goal ${g.done ? 'done' : ''}" data-goal="${g.id}" data-editgoal="${g.id}">
      <div class="g-head">
        <div style="flex:1">
          <div class="g-title">${g.done ? '✅ ' : ''}${esc(g.title)}</div>
          ${g.note ? `<div class="g-note">${esc(g.note)}</div>` : ''}
        </div>
        <button class="g-edit" data-editgoal="${g.id}" aria-label="Редагувати ціль">${ICON.pencil}</button>
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
    const GEAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.3 1z"/></svg>';

    let html = `<div class="d-head"><div style="font-weight:800;font-size:18px">Work Hub</div></div>`;

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
    html += `<div class="d-item" data-goto="events">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>Події та нагадування</div>`;
    html += `<div class="d-item" data-goto="goals">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>Цілі</div>`;
    html += `<div class="d-item" data-goto="calendar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Календар / архів</div>`;

    // Окремим пунктом із назвою: іконка в кутку губилась
    html += `<hr>`;
    html += `<div class="d-item" id="open-settings">${GEAR}Налаштування${backupHintHTML()}</div>`;

    d.innerHTML = html;
  }

  // Підказка біля «Налаштувань»: у якому стані резервна копія
  function backupHintHTML() {
    const G = window.GitSync;
    if (G && G.configured()) {
      const st = G.status().state;
      if (st === 'error' || st === 'needs-confirm') return '<span class="cnt bk-warn">копія!</span>';
      return '<span class="cnt bk-ok">копія ✓</span>';
    }
    const days = S.daysSinceBackup();
    if (days === null || days > 14) return '<span class="cnt bk-warn">копія!</span>';
    return '';
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
    // нова задача починається з назви — одразу даємо писати
    openSheet(existing ? null : { focus: '#t-title' });
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
      const sel = Array.isArray(rec.daysOfMonth) ? rec.daysOfMonth : [];
      let cells = '';
      for (let i = 1; i <= 31; i++) {
        cells += `<div class="dom ${sel.includes(i) ? 'on' : ''}" data-dom="${i}">${i}</div>`;
      }
      recExtra = `<div class="field"><label>Числа місяця</label>
        <div class="dom-grid">${cells}</div>
        <div class="section-hint" style="margin-top:8px">Можна обрати кілька. Якщо обрати <b>31</b>, у коротких місяцях задача стане на останній день (30, 29 або 28).</div>
      </div>`;
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
        <input type="text" id="t-title" enterkeyhint="done" value="${esc(d.title)}" placeholder="Що потрібно зробити?" autocomplete="off"></div>

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

    // якщо для повторення не обрано жодного дня — беремо сьогоднішній,
    // інакше задача не мала б коли зʼявитись
    const rec = draft.recurrence;
    if (rec.type === 'monthly' && !(rec.daysOfMonth && rec.daysOfMonth.length)) {
      rec.daysOfMonth = [S.fromStr(S.todayStr()).getDate()];
    }
    if (rec.type === 'weekly' && !(rec.weekdays && rec.weekdays.length)) {
      rec.weekdays = [S.fromStr(S.todayStr()).getDay()];
    }

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
     ФОРМА ПОДІЇ
     ============================================================ */
  function openEventSheet(id) {
    const existing = id ? S.getReminder(id) : null;
    draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      title: '', note: '', area: S.area(), date: S.todayStr(),
      time: '', yearly: false, alerts: [1440],
    };
    renderEventSheet(!!existing);
    openSheet(existing ? null : { focus: '#e-title' });
  }

  function renderEventSheet(isEdit) {
    const d = draft;
    const areaChips = Object.entries(S.AREAS).map(([k, v]) =>
      `<button class="chip ${d.area === k ? 'on' : ''}" data-evarea="${k}">
        <span class="dot" style="background:${v.accent}"></span>${v.label}</button>`).join('');

    const alerts = d.alerts || [];
    const alertChips = S.ALERT_PRESETS.map((p) =>
      `<button class="chip ${alerts.includes(p.m) ? 'on' : ''}" data-alert="${p.m}">${p.label}</button>`).join('');

    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <button class="close-x" data-close>✕</button>
      <h2>${isEdit ? 'Редагувати подію' : 'Нова подія'}</h2>
      <div class="section-hint">Подію не треба виконувати — вона просто настає. Нагадування прийде у Календарі телефона.</div>

      <div class="field"><label>Що саме</label>
        <input type="text" id="e-title" enterkeyhint="done" value="${esc(d.title)}" placeholder="Напр. День народження мами" autocomplete="off"></div>

      <div class="field"><label>Розділ</label><div class="chips">${areaChips}</div></div>

      <div class="field"><label>Дата</label>
        <input type="date" id="e-date" value="${d.date || ''}"></div>

      <div class="field"><label>Час (необовʼязково)</label>
        <input type="time" id="e-time" value="${d.time || ''}">
        <div class="section-hint" style="margin-top:6px">Без часу подія вважається на весь день.</div></div>

      <div class="field"><label>Повторення</label>
        <div class="chips">
          <button class="chip ${!d.yearly ? 'on' : ''}" data-yearly="0">Один раз</button>
          <button class="chip ${d.yearly ? 'on' : ''}" data-yearly="1">🎂 Щороку</button>
        </div>
        <div class="section-hint" style="margin-top:6px">Щороку — для днів народження та свят.</div></div>

      <div class="field"><label>Нагадати (до ${S.MAX_ALERTS})</label>
        <div class="chips">${alertChips}</div></div>

      <div class="field"><label>Нотатка</label>
        <textarea id="e-note" placeholder="Деталі…">${esc(d.note || '')}</textarea></div>

      <div class="sheet-actions">
        ${isEdit ? '<button class="btn danger" data-delevent>Видалити</button>' : ''}
        <button class="btn primary" id="save-event">${isEdit ? 'Зберегти' : 'Додати'}</button>
      </div>`;
  }

  function syncEventInputs() {
    const sh = $('#sheet');
    if ($('#e-title', sh)) draft.title = $('#e-title', sh).value;
    if ($('#e-note', sh)) draft.note = $('#e-note', sh).value;
    if ($('#e-date', sh)) draft.date = $('#e-date', sh).value;
    if ($('#e-time', sh)) draft.time = $('#e-time', sh).value || '';
  }

  function saveEvent() {
    syncEventInputs();
    if (!draft.title.trim()) { toast('Вкажи назву події'); return; }
    if (!draft.date) { toast('Обери дату'); return; }
    const isNew = !draft.id;
    const id = S.upsertReminder(draft);
    closeSheet();
    toast(isNew ? 'Подію додано' : 'Збережено');
    renderEvents();
    // Якщо стрічка ввімкнена, подія поїде в Календар сама — не смикаємо
    // «Поділитися». Інакше одразу пропонуємо покласти її туди руками.
    if (isNew && !(window.CalFeed && window.CalFeed.healthy())) {
      setTimeout(() => shareICS([S.getReminder(id)]), 400);
    }
  }

  /* Віддати подію системному Календарю. На iPhone відкриється «Поділитися»,
     звідки файл іде в Календар разом з нагадуваннями. */
  async function shareICS(list) {
    if (!list.length) return;
    const ics = S.buildICS(list);
    const name = list.length === 1
      ? `${list[0].title.replace(/[^\wа-яіїєґА-ЯІЇЄҐ ]+/gi, '').trim().slice(0, 40) || 'podiya'}.ics`
      : `work-hub-events.ics`;
    try {
      const file = new File([ics], name, { type: 'text/calendar' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Додати в Календар' });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Файл збережено — відкрий його, щоб додати в Календар');
  }

  /* ============================================================
     ФОРМА ЦІЛІ
     ============================================================ */
  function openGoalSheet(id) {
    const existing = id ? S.getGoal(id) : null;
    draft = existing ? JSON.parse(JSON.stringify(existing)) : { title: '', note: '', area: S.area(), targetDate: null, milestones: [] };
    renderGoalSheet(!!existing);
    openSheet(existing ? null : { focus: '#g-title' });
  }

  function renderGoalSheet(isEdit) {
    const d = draft;
    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <button class="close-x" data-close>✕</button>
      <h2>${isEdit ? 'Редагувати ціль' : 'Нова ціль'}</h2>
      <div class="field"><label>Ціль</label>
        <input type="text" id="g-title" enterkeyhint="done" value="${esc(d.title)}" placeholder="Чого хочеш досягти?"></div>
      <div class="field"><label>Опис</label>
        <textarea id="g-note" placeholder="Деталі…">${esc(d.note || '')}</textarea></div>
      <div class="field"><label>Розділ</label>
        <div class="chips">${Object.entries(S.AREAS).map(([k, v]) =>
          `<button class="chip ${d.area === k ? 'on' : ''}" data-goalarea="${k}">
            <span class="dot" style="background:${v.accent}"></span>${v.label}</button>`).join('')}</div></div>
      <div class="field"><label>Дедлайн</label>
        <input type="date" id="g-date" value="${d.targetDate || ''}"></div>
      ${isEdit ? `<div class="field"><label>Стан</label>
        <button class="btn ghost" id="g-done">${d.done ? '✅ Ціль досягнута — повернути в роботу' : '🏁 Позначити досягнутою'}</button></div>` : ''}
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
    // ціль з іншого розділу зникне з поточного списку — попереджаємо, куди
    const moved = draft.area && draft.area !== S.area() ? S.AREAS[draft.area].label : null;
    S.upsertGoal(draft);
    closeSheet();
    toast(moved ? `Збережено — ціль тепер у «${moved}»` : 'Збережено');
    renderGoals();
    renderDrawer();
  }

  /* ============================================================
     НАЛАШТУВАННЯ / ЕКСПОРТ
     ============================================================ */
  function openSettings() {
    closeDrawer();
    const days = S.daysSinceBackup();
    const status = days === null
      ? '<span class="bk-warn">копії ще не було</span>'
      : days === 0 ? '<span class="bk-ok">сьогодні ✓</span>'
        : `${days} дн. тому${days > 14 ? ' <span class="bk-warn">— варто оновити</span>' : ''}`;

    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <button class="close-x" data-close>✕</button>
      <h2>Налаштування</h2>
      <div class="section-hint">Дані зберігаються лише на цьому пристрої. Якщо видалити застосунок — вони зникнуть разом з ним, тож копія має жити деінде.</div>
      <div class="field"><label>Резервна копія</label>
        <div class="bk-status">Остання копія: ${status}</div>
        <button class="btn primary" id="export-btn" style="margin-bottom:10px">💾 Зберегти копію</button>
        <button class="btn ghost" id="import-btn">📂 Відновити з файлу</button>
        <input type="file" id="import-file" accept="application/json,.json" class="hidden">
        <div class="section-hint" style="margin-top:8px">Відкриється системне «Поділитися» — поклади файл у Файли / iCloud або надішли собі.</div>
      </div>
      <div class="field"><label>Звук</label>
        <button class="btn ghost" id="sound-btn">${S.soundOn() ? '🔊 Звук виконання: увімкнено' : '🔇 Звук виконання: вимкнено'}</button>
      </div>
      ${calFeedHTML()}
      ${gitSyncHTML()}
      <div class="field"><label>Небезпечна зона</label>
        <button class="btn danger" id="reset-btn">Скинути всі дані</button></div>
      <div class="section-hint" style="text-align:center;margin-top:18px">Work Hub · офлайн-трекер задач</div>`;
    openSheet();
  }

  /* ---------- Синхронізація подій із системним Календарем ----------
     Записати подію просто в Календар браузер не може. Зате Календар уміє
     сам ходити за файлом .ics по посиланню — цим і користуємось. */

  const CAL_STATE_TEXT = {
    off: 'вимкнено',
    idle: 'очікує змін',
    syncing: 'оновлюю…',
    synced: 'стрічку оновлено ✓',
    error: 'помилка',
  };

  function calFeedHTML() {
    const C = window.CalFeed;
    if (!C) return '';

    if (!C.enabled()) {
      const g = C.guess();
      const hasGitToken = window.GitSync && window.GitSync.configured();
      return `<div class="field"><label>Події в Календарі телефона</label>
        <div class="section-hint" style="margin:0 0 10px">Календар уміє сам забирати події за посиланням. Увімкни — і кожна нова подія доїжджатиме в нього без твоєї участі (підписатись треба лише раз).</div>
        <input type="text" id="cal-repo" placeholder="власник/репозиторій" value="${esc(g.repo)}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <input type="text" id="cal-branch" placeholder="гілка (gh-pages)" value="${esc(g.branch)}" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:8px">
        <input type="text" id="cal-token" placeholder="токен GitHub" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:8px">
        ${hasGitToken ? `<button class="link-btn" id="cal-usegit">Взяти токен від автокопії</button>` : ''}
        <button class="btn ghost" id="cal-enable" style="margin-top:10px">📆 Увімкнути синхронізацію</button>
        <div class="section-hint" style="margin-top:8px">Це той самий репозиторій, з якого відкривається застосунок, і той самий токен (право <b>Contents: Read and write</b>). Файл ляже за випадковою адресою — вгадати її неможливо, але це <b>публічне</b> посилання, тож таємниць у назвах подій краще не тримати.</div>
        <details class="howto" style="margin-top:8px"><summary>Пише, що токен не має доступу?</summary>
          <div style="margin-top:4px">Токен від автокопії виданий лише на репозиторій з копією — цього він не бачить. Треба додати:</div>
          <ol>
            <li>github.com → аватар → <b>Settings</b> → внизу <b>Developer settings</b>.</li>
            <li><b>Personal access tokens</b> → <b>Fine-grained tokens</b> → відкрий свій токен.</li>
            <li><b>Repository access</b> → <b>Only select repositories</b> → додай до списку ще й цей репозиторій.</li>
            <li><b>Repository permissions</b> → <b>Contents</b> → <b>Read and write</b>.</li>
            <li>Внизу — <b>Update</b>. Повернись сюди й натисни «Увімкнути» ще раз.</li>
          </ol>
        </details>
      </div>`;
    }

    const c = C.config();
    const st = C.status();
    const cls = st.state === 'error' ? 'bk-warn' : (st.state === 'synced' ? 'bk-ok' : '');
    const when = c.lastAt ? new Date(c.lastAt).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

    const live = C.healthy(); // стрічка залилась хоч раз — інакше посилання ще порожнє

    return `<div class="field"><label>Події в Календарі телефона</label>
      <div class="bk-status" id="cal-info">
        <div id="cal-state" class="${cls}">${CAL_STATE_TEXT[st.state] || st.state}${st.error ? ': ' + esc(st.error) : ''}</div>
        <div id="cal-meta">оновлено: ${when} · подій: ${c.count}</div>
      </div>
      ${live ? '' : `<div class="section-hint bk-warn" style="margin:0 0 10px">Файл стрічки ще жодного разу не залився — посилання поки нікуди не веде. Натисни «Оновити стрічку зараз»: якщо все гаразд, зʼявиться «стрічку оновлено ✓».</div>`}
      ${live
        ? `<a class="btn primary" id="cal-subscribe" href="${esc(c.webcal)}" style="margin-bottom:10px">📆 Підписатись у Календарі</a>`
        : `<button class="btn primary" disabled style="margin-bottom:10px">📆 Підписатись у Календарі</button>`}
      <div class="section-hint" style="margin:0 0 10px">Одне натискання — Календар сам спитає «Підписатись». У вікні підписки лиши <b>«Вилучити сигнали» вимкненим</b>, інакше нагадування не спрацюють.</div>
      <div class="feed-url" id="cal-url">${esc(c.webcal)}</div>
      <button class="btn ghost" id="cal-copy" style="margin-bottom:10px" ${live ? '' : 'disabled'}>🔗 Скопіювати посилання</button>
      <details class="howto"><summary>Якщо кнопка не спрацювала — вручну</summary>
        <ol>
          <li>Скопіюй посилання кнопкою вище.</li>
          <li>Налаштування → Програми → <b>Календар</b> → Облікові записи → <b>Додати обліковий запис</b> → <b>Інше</b> → <b>Додати передплачений календар</b>.</li>
          <li>Встав посилання → <b>Далі</b> → <b>Зберегти</b>.</li>
          <li>У тому ж вікні лишай <b>«Вилучити сигнали» вимкненим</b> — інакше нагадування не спрацюють.</li>
        </ol>
        <div class="section-hint" style="margin-top:6px">Як часто перечитувати стрічку, вирішує сам телефон (зазвичай раз на годину). Підписаний календар доступний лише для читання — редагуй події тут, у застосунку.</div>
      </details>
      <button class="btn ${live ? 'ghost' : 'primary'}" id="cal-push" style="margin:10px 0">⬆️ Оновити стрічку зараз</button>
      <button class="btn danger" id="cal-off">Вимкнути</button>
    </div>`;
  }

  /* Статус у налаштуваннях — це знімок на момент відкриття. Заливання
     триває секунди, тож без цього на екрані назавжди застигало б
     «оновлюю…», і не було б видно ні успіху, ні помилки. */
  function bindLiveStatus() {
    if (window.CalFeed) window.CalFeed.onChange((st) => {
      const el = $('#cal-state');
      if (!el) return;
      el.className = st.state === 'error' ? 'bk-warn' : (st.state === 'synced' ? 'bk-ok' : '');
      el.textContent = (CAL_STATE_TEXT[st.state] || st.state) + (st.error ? ': ' + st.error : '');
      const c = window.CalFeed.config();
      const meta = $('#cal-meta');
      if (meta && c) {
        const when = c.lastAt ? new Date(c.lastAt).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
        meta.textContent = `оновлено: ${when} · подій: ${c.count}`;
      }
      // перша вдала заливка вмикає кнопку копіювання й прибирає попередження
      if (st.state === 'synced' && $('#cal-copy') && $('#cal-copy').disabled) openSettings();
    });

    if (window.GitSync) window.GitSync.onChange((st) => {
      const el = $('#git-state');
      if (!el) return;
      el.className = (st.state === 'error' || st.state === 'needs-confirm') ? 'bk-warn' : (st.state === 'synced' ? 'bk-ok' : '');
      el.textContent = (GIT_STATE_TEXT[st.state] || st.state) + (st.error ? ': ' + st.error : '');
    });
  }

  function calEnable() {
    const sh = $('#sheet');
    const repo = $('#cal-repo', sh).value;
    const branch = $('#cal-branch', sh).value;
    const token = $('#cal-token', sh).value;
    toast('Перевіряю доступ…');
    window.CalFeed.enable({ repo, branch, token })
      .then(() => {
        openSettings();
        toast('Готово — лишилось підписатись у Календарі');
        renderEvents();
      })
      .catch((err) => toast('Не вдалося: ' + err.message));
  }

  async function calCopy() {
    const url = window.CalFeed.config().webcal;
    try {
      await navigator.clipboard.writeText(url);
      toast('Посилання скопійовано');
    } catch (e) {
      // clipboard недоступний (немає https або дозволу) — даємо виділити вручну
      const el = $('#cal-url');
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
      }
      toast('Скопіюй посилання вручну');
    }
  }

  /* ---------- Автокопія на GitHub ---------- */

  const GIT_STATE_TEXT = {
    off: 'не підключено',
    idle: 'очікує змін',
    syncing: 'заливаю…',
    synced: 'синхронізовано ✓',
    error: 'помилка',
    'needs-confirm': 'потрібне підтвердження',
  };

  function gitSyncHTML() {
    const G = window.GitSync;
    if (!G) return '';

    if (!G.configured()) {
      return `<div class="field"><label>Автокопія на GitHub</label>
        <div class="section-hint" style="margin:0 0 10px">Копія оновлюватиметься сама після кожної зміни. Кожне заливання — окремий коміт, тож історія версій зберігається.</div>
        <input type="text" id="git-repo" placeholder="власник/репозиторій" autocomplete="off" autocapitalize="off" spellcheck="false">
        <input type="text" id="git-token" placeholder="токен GitHub (ghp_… або github_pat_…)" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:8px">
        <button class="btn ghost" id="git-connect" style="margin-top:10px">🔗 Підключити</button>
        <div class="section-hint" style="margin-top:8px">Потрібен приватний репозиторій і fine-grained токен із правом <b>Contents: Read and write</b>. Токен зберігається лише на цьому пристрої й не потрапляє у файл копії.</div>
      </div>`;
    }

    const c = G.config();
    const st = G.status();
    const cls = st.state === 'error' || st.state === 'needs-confirm' ? 'bk-warn' : (st.state === 'synced' ? 'bk-ok' : '');
    const when = c.lastAt ? new Date(c.lastAt).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

    return `<div class="field"><label>Автокопія на GitHub</label>
      <div class="bk-status" id="git-info">
        <div><b>${esc(c.repo)}</b> / ${esc(c.path)}</div>
        <div id="git-state" class="${cls}">${GIT_STATE_TEXT[st.state] || st.state}${st.error ? ': ' + esc(st.error) : ''}</div>
        <div>остання копія: ${when}</div>
      </div>
      ${st.state === 'needs-confirm' ? `<div class="section-hint bk-warn" style="margin:0 0 10px">Задач стало помітно менше, ніж у копії. Автозаливання зупинено, щоб не затерти дані. Якщо так і має бути — натисни «Залити зараз».</div>` : ''}
      <button class="btn ghost" id="git-push" style="margin-bottom:10px">⬆️ Залити зараз</button>
      <button class="btn ghost" id="git-restore" style="margin-bottom:10px">⬇️ Відновити з GitHub</button>
      <button class="btn danger" id="git-disconnect">Відключити</button>
    </div>`;
  }

  /* Копія: спершу системне «Поділитися» (на iPhone кладе файл одразу
     у Файли/iCloud), і лише як запасний варіант — звичайне завантаження,
     яке на телефоні ховає файл у «Завантаження» браузера. */
  async function doExport() {
    const json = S.exportJSON();
    const name = S.backupFileName();

    try {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Резервна копія Work Hub' });
        S.markBackup();
        toast('Копію збережено');
        refreshBackupBanner();
        return;
      }
    } catch (e) {
      // користувач закрив вікно «Поділитися» — не вважаємо це копією
      if (e && e.name === 'AbortError') return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    S.markBackup();
    toast('Файл завантажено');
    refreshBackupBanner();
  }

  function gitConnect() {
    const repo = $('#git-repo', $('#sheet')).value;
    const token = $('#git-token', $('#sheet')).value;
    toast('Перевіряю доступ…');
    window.GitSync.connect({ repo, token })
      .then(() => {
        openSettings();
        refreshBackupBanner(); // копія свіжа — банер більше не потрібен
        toast('Підключено — копія оновлюватиметься сама');
      })
      .catch((err) => toast('Не вдалося: ' + err.message));
  }

  /* Банер угорі списку, якщо копії давно (або взагалі) не було —
     мовчазну кнопку в налаштуваннях легко не помітити. */
  const BACKUP_NAG_DAYS = 14;
  function backupBannerHTML() {
    const days = S.daysSinceBackup();
    const has = S.tasks().length > 0;
    if (!has) return '';
    if (days !== null && days < BACKUP_NAG_DAYS) return '';
    const txt = days === null
      ? 'Копії твоїх задач ще немає — усе живе лише на цьому телефоні'
      : `Останню копію робив ${days} дн. тому`;
    return `<div class="backup-banner" id="backup-banner">
      <div class="bb-text">⚠️ ${txt}</div>
      <button class="bb-act" id="bb-save">Зберегти</button>
      <button class="bb-close" id="bb-hide" aria-label="Приховати">✕</button>
    </div>`;
  }

  function refreshBackupBanner() {
    if (currentTab === 'tasks') renderTasks();
  }

  /* ============================================================
     КЕРУВАННЯ ШТОРКОЮ/МЕНЮ
     ============================================================ */
  /* ---------- Форма над клавіатурою ----------
     iOS не зменшує вікно, коли вилазить клавіатура: фіксована шторка
     лишається прибитою до низу екрана й ховається під нею — саме тому
     кнопка «Додати» ставала недосяжною. visualViewport каже, скільки
     екрана з'їдено; на цю величину піднімаємо форму й тримаємо панель
     кнопок на видноті. */
  function setupKeyboardFit() {
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
      const sh = $('#sheet');
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      sh.style.setProperty('--kb', inset + 'px');
      sh.style.setProperty('--vvh', vv.height + 'px');
      sh.classList.toggle('kb', inset > 80); // 80px — щоб не рахувати панель Safari
    };

    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    // focusin/out ловить випадки, коли клавіатура з'явилась без resize
    document.addEventListener('focusin', () => setTimeout(apply, 60));
    document.addEventListener('focusout', () => setTimeout(apply, 60));
    apply();
  }

  /* opts.focus — селектор поля, у яке одразу стати курсором. На iPhone
     клавіатура відкривається лише в межах того самого дотику, що й відкрив
     форму, тому focus() робимо синхронно, без setTimeout. */
  function openSheet(opts) {
    const sh = $('#sheet');
    sh.style.transform = '';        // прибираємо слід від свайпу вниз
    sh.scrollTop = 0;
    sh.classList.add('open');
    $('#sheet-backdrop').classList.add('open');
    const sel = opts && opts.focus;
    if (sel) {
      const el = $(sel, sh);
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }
  }

  function closeSheet() {
    const sh = $('#sheet');
    sh.style.transform = '';
    sh.classList.remove('open');
    $('#sheet-backdrop').classList.remove('open');
    draft = null;
  }
  function openDrawer() { renderDrawer(); $('#drawer').classList.add('open'); $('#drawer-backdrop').classList.add('open'); }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer-backdrop').classList.remove('open'); }

  function switchTab(tab) {
    currentTab = tab;
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $(`#screen-${tab}`).classList.add('active');
    // календар живе за кнопкою вгорі, тож у нижньому меню нічого не підсвічуємо
    $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#btn-today').classList.toggle('on', tab === 'calendar');
    if (tab === 'tasks') renderTasks();
    if (tab === 'stats') renderStats();
    if (tab === 'goals') renderGoals();
    if (tab === 'calendar') renderCalendar();
    if (tab === 'events') renderEvents();
    window.scrollTo(0, 0);
  }

  /* ---------- Сповіщення в застосунку ----------
     Працюють, поки застосунок відкритий. Коли він закритий, iOS
     «морозить» сторінку — там нагадує Календар, куди ми віддали подію. */
  function askNotifyPermission() {
    if (!('Notification' in window)) { toast('Браузер не вміє сповіщень'); return; }
    Notification.requestPermission().then((p) => {
      renderEvents();
      toast(p === 'granted' ? 'Сповіщення дозволено' : 'Сповіщення не дозволено');
    });
  }

  function showEventNotification(item) {
    const r = item.reminder;
    const body = `${S.humanDate(S.nextEventDate(r))}${r.time ? ' о ' + r.time : ''} · ${S.alertLabel(item.minutes)}`;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(r.title, { body, tag: item.key, icon: 'assets/icons/icon.svg' });
        }).catch(() => new Notification(r.title, { body }));
      } else {
        new Notification(r.title, { body });
      }
    } catch (e) { /* нічого не вдіємо */ }
  }

  function checkDueAlerts() {
    const due = S.dueAlerts();
    if (!due.length) return;
    for (const item of due) {
      if ('Notification' in window && Notification.permission === 'granted') {
        showEventNotification(item);
      } else {
        toast(`🔔 ${item.reminder.title} — ${S.alertLabel(item.minutes)}`);
      }
      playDoneSound();
      S.markNotified(item.reminder.id, item.key);
    }
    if (currentTab === 'events') renderEvents();
  }

  function renderAll() {
    if (currentTab === 'calendar') renderCalendar(); else renderTasks();
    renderDrawer();
  }

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
    // кнопка календаря вгорі: відкрити архів / повернутись до задач
    $('#btn-today').addEventListener('click', () => {
      switchTab(currentTab === 'calendar' ? 'tasks' : 'calendar');
    });

    // Календар: вибір дня, гортання місяців, відмітка сьогоднішніх задач
    $('#screen-calendar').addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return;
      const mon = e.target.closest('[data-mon]');
      if (mon) {
        calState.m += +mon.dataset.mon;
        if (calState.m < 0) { calState.m = 11; calState.y--; }
        if (calState.m > 11) { calState.m = 0; calState.y++; }
        renderCalendar();
        return;
      }
      const day = e.target.closest('[data-day]');
      if (day) { calState.sel = day.dataset.day; renderCalendar(); return; }

      // відмічати дозволяємо лише в сьогоднішньому дні
      if (calState.sel !== S.todayStr()) return;
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) { toggleWithFeedback(toggle.dataset.toggle, renderCalendar); return; }
      const subsBtn = e.target.closest('[data-subs]');
      if (subsBtn) {
        const id = subsBtn.dataset.subs;
        if (expandedTasks.has(id)) expandedTasks.delete(id); else expandedTasks.add(id);
        renderCalendar();
        return;
      }
      const sub = e.target.closest('[data-sub]');
      if (sub) { S.toggleSubtask(sub.dataset.task, sub.dataset.sub); renderCalendar(); return; }
      const open = e.target.closest('[data-open]');
      if (open) openTaskSheet(open.dataset.open);
    });
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
      else if (currentTab === 'events') openEventSheet();
      else openTaskSheet();
    });

    // Клік по екрану задач
    $('#screen-tasks').addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return; // щойно перетягнули — не відкриваємо форму
      if (e.target.closest('#bb-save')) { doExport(); return; }
      if (e.target.closest('#bb-hide')) { bannerHidden = true; renderTasks(); return; }
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) { toggleWithFeedback(toggle.dataset.toggle, renderTasks); return; }
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

    // Клік по екрану подій
    $('#screen-events').addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return;
      const ics = e.target.closest('[data-ics]');
      if (ics) { shareICS([S.getReminder(ics.dataset.ics)]); return; }
      if (e.target.closest('#ics-all')) {
        const t = S.todayStr();
        shareICS(S.reminders().filter((r) => S.nextEventDate(r) >= t));
        return;
      }
      if (e.target.closest('#toggle-past')) { showPastEvents = !showPastEvents; renderEvents(); return; }
      if (e.target.closest('#ask-notify')) { askNotifyPermission(); return; }
      if (e.target.closest('#cal-setup')) { openSettings(); return; }
      const ed = e.target.closest('[data-editevent]');
      if (ed) openEventSheet(ed.dataset.editevent);
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
    if (Date.now() < suppressClickUntil) return; // щойно тягнули форму — це не клік
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
      if (type === 'monthly') draft.recurrence.daysOfMonth = [S.fromStr(S.todayStr()).getDate()];
      renderTaskSheet(!!draft.id); return;
    }
    const dom = e.target.closest('[data-dom]');
    if (dom) {
      syncTaskInputs();
      const n = +dom.dataset.dom;
      const arr = draft.recurrence.daysOfMonth || (draft.recurrence.daysOfMonth = []);
      const at = arr.indexOf(n);
      if (at >= 0) arr.splice(at, 1); else arr.push(n);
      arr.sort((a, b) => a - b);
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

    // --- подія ---
    const evArea = e.target.closest('[data-evarea]');
    if (evArea) { syncEventInputs(); draft.area = evArea.dataset.evarea; renderEventSheet(!!draft.id); return; }
    const yearly = e.target.closest('[data-yearly]');
    if (yearly) { syncEventInputs(); draft.yearly = yearly.dataset.yearly === '1'; renderEventSheet(!!draft.id); return; }
    const alert = e.target.closest('[data-alert]');
    if (alert) {
      syncEventInputs();
      const m = +alert.dataset.alert;
      const arr = draft.alerts || (draft.alerts = []);
      const at = arr.indexOf(m);
      if (at >= 0) arr.splice(at, 1);
      else if (arr.length < S.MAX_ALERTS) arr.push(m);
      else toast(`Максимум ${S.MAX_ALERTS} нагадування`);
      arr.sort((a, b) => a - b);
      renderEventSheet(!!draft.id); return;
    }
    if (e.target.closest('#save-event')) { saveEvent(); return; }
    if (e.target.closest('[data-delevent]')) {
      if (confirm('Видалити подію?')) { S.deleteReminder(draft.id); closeSheet(); toast('Видалено'); renderEvents(); }
      return;
    }

    // --- ціль ---
    const ga = e.target.closest('[data-goalarea]');
    if (ga) { syncGoalInputs(); draft.area = ga.dataset.goalarea; renderGoalSheet(!!draft.id); return; }
    if (e.target.closest('#g-done')) { syncGoalInputs(); draft.done = !draft.done; renderGoalSheet(!!draft.id); return; }
    if (e.target.closest('#add-ms')) { syncGoalInputs(); draft.milestones.push({ id: S.uid(), title: '', done: false }); renderGoalSheet(!!draft.id); return; }
    const delms = e.target.closest('[data-delms]');
    if (delms) { syncGoalInputs(); draft.milestones.splice(+delms.dataset.delms, 1); renderGoalSheet(!!draft.id); return; }
    if (e.target.closest('#save-goal')) { saveGoal(); return; }
    if (e.target.closest('[data-delgoal]')) {
      if (confirm('Видалити ціль?')) { S.deleteGoal(draft.id); closeSheet(); toast('Видалено'); renderGoals(); }
      return;
    }

    if (e.target.closest('#sound-btn')) {
      const on = !S.soundOn();
      S.setSound(on);
      openSettings();
      if (on) playDoneSound();   // одразу чути, як воно звучить
      return;
    }

    // --- стрічка подій для Календаря ---
    if (e.target.closest('#cal-usegit')) {
      $('#cal-token', $('#sheet')).value = window.GitSync.token() || '';
      toast('Токен підставлено');
      return;
    }
    if (e.target.closest('#cal-enable')) { calEnable(); return; }
    if (e.target.closest('#cal-copy')) { calCopy(); return; }
    if (e.target.closest('#cal-push')) {
      toast('Оновлюю…');
      window.CalFeed.publishNow({ force: true }).then((ok) => {
        toast(ok ? 'Стрічку оновлено' : ('Не вдалося: ' + (window.CalFeed.status().error || '')));
        openSettings();
      });
      return;
    }
    if (e.target.closest('#cal-off')) {
      if (!confirm('Вимкнути синхронізацію з Календарем? Файл стрічки буде прибрано, і підписка в Календарі спорожніє.')) return;
      window.CalFeed.disable().then(() => {
        openSettings();
        renderEvents();
        toast('Синхронізацію вимкнено');
      });
      return;
    }

    // --- автокопія на GitHub ---
    if (e.target.closest('#git-connect')) { gitConnect(); return; }
    if (e.target.closest('#git-push')) {
      toast('Заливаю…');
      window.GitSync.pushNow({ force: true }).then((ok) => {
        toast(ok ? 'Копію залито' : ('Не вдалося: ' + (window.GitSync.status().error || 'без змін')));
        openSettings();
        refreshBackupBanner();
      });
      return;
    }
    if (e.target.closest('#git-restore')) {
      if (!confirm('Відновлення замінить усі поточні задачі даними з GitHub. Продовжити?')) return;
      window.GitSync.restore().then((r) => {
        closeSheet();
        setArea(S.area());
        toast(`Відновлено: ${r.tasks} задач`);
      }).catch((err) => toast('Не вдалося: ' + err.message));
      return;
    }
    if (e.target.closest('#git-disconnect')) {
      if (!confirm('Відключити автокопію? Файл у репозиторії лишиться на місці.')) return;
      window.GitSync.disconnect();
      openSettings();
      toast('Автокопію відключено');
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
    /* Enter у назві = зберегти. Найшвидший шлях: набрав і відправив,
       не тягнучись до кнопки. Решта полів (нотатка) — багаторядкові,
       там Enter лишається переносом рядка. */
    $('#sheet').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const id = e.target && e.target.id;
      if (id === 't-title') { e.preventDefault(); saveTask(); }
      else if (id === 'e-title') { e.preventDefault(); saveEvent(); }
      else if (id === 'g-title') { e.preventDefault(); saveGoal(); }
    });

    $('#sheet').addEventListener('change', (e) => {
      if (e.target.id === 'import-file') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (!confirm('Відновлення замінить усі поточні задачі даними з файлу. Продовжити?')) {
            e.target.value = '';
            return;
          }
          try {
            const r = S.importJSON(reader.result);
            closeSheet();
            setArea(S.area());
            toast(`Відновлено: ${r.tasks} задач`);
          } catch (err) {
            toast('Не вдалося: ' + err.message);
          }
          e.target.value = ''; // щоб той самий файл можна було обрати ще раз
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
    bindLiveStatus();
    setupDragAndDrop();
    setupAreaSwipe();
    setupSheetSwipe();
    setupKeyboardFit();
    setArea(S.area()); // відновлює обраний розділ і малює список

    // нагадування перевіряємо при відкритті, при поверненні та раз на хвилину
    checkDueAlerts();
    setInterval(checkDueAlerts, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDueAlerts(); });

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
    // При ПЕРШОМУ відкритті контролера ще не було: там воркер лише стає на
    // місце, і перезавантажувати сторінку нема за чим.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
