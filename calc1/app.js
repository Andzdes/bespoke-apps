/* =============================================================
   Shop Calculator — Production Timeline Logic
   ============================================================= */

// ── Settings: defaults ── //
const DEFAULTS = {
    cutting: 18,
    edge_pvc: 20,
    edge_pg: 20,
    assembly: 25,
    day_start: 7,
    day_end: 18,
    work_days: [1, 2, 3, 4, 5, 6],
    pg_limit: 30,
    delivery_default: 3,
    hold_delay: 1000,
    hold_repeat: 125,
    hint_delay: 3,
    timezone: 'America/Los_Angeles',
    round_dur: 5,
    round_dt: 5,
};

// ── Load settings from localStorage ── //
function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem('calc1_settings') || '{}');
        return Object.assign({}, DEFAULTS, saved);
    } catch {
        return Object.assign({}, DEFAULTS);
    }
}

// ── Apply cfg to working variables ── //
let cfg = loadSettings();

let CUTTING_MIN_PER_SHEET = cfg.cutting;
let EDGE_PVC_MIN_PER_SHEET = cfg.edge_pvc;
let EDGE_PG_MIN_PER_SHEET = cfg.edge_pg;
let ASSEMBLY_MIN_PER_SHEET = cfg.assembly;
let WORKDAY_START_HOUR = cfg.day_start;
let WORKDAY_END_HOUR = cfg.day_end;
let WORK_DAYS = cfg.work_days.slice();
let PG_LIMIT = cfg.pg_limit;
let TIMEZONE = cfg.timezone;
let ROUND_DURATION_MIN = cfg.round_dur;
let ROUND_DATETIME_MIN = cfg.round_dt;
let DELIVERY_DEFAULT = cfg.delivery_default;
let HOLD_DELAY_MS = cfg.hold_delay;
let HOLD_REPEAT_MS = cfg.hold_repeat;
let HINT_DELAY_MS = cfg.hint_delay * 1000;

// ── DOM refs ── //
const elSheets = document.getElementById('sheets_count');
const elEdge = document.getElementById('edge_type');
const elDelivery = document.getElementById('delivery_hours');
const elStart = document.getElementById('start_date');          // hidden datetime-local
const elDuration = document.getElementById('result_duration');
const elDatetime = document.getElementById('result_datetime');
const elHint = document.getElementById('calc_hint');

let calcTimer;

// ── Day-off hint (based on real current time) ── //
const DAY_NAMES_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Returns a hint string if the user is currently at the boundary of
 * a non-work period, or null otherwise.
 *
 * Rules:
 *  - During work hours on a workday → no message
 *  - Workday, before work starts   → no message (work begins today)
 *  - Workday, after work ends AND tomorrow is a day off
 *       → "Завтра выходной. Работы начнутся в {day}"
 *  - Currently a non-work day
 *       → "Сегодня выходной. Работы начнутся в {day}"
 */
function getOffDayHint() {
    const nowMs = Date.now();
    const wc = wallClock(nowMs);
    const todayIso = isoWeekday(wc);
    const todayIsWorkday = WORK_DAYS.includes(todayIso);

    // Find the next workday starting from a given UTC ms
    function findNextWorkday(fromMs) {
        let ms = fromMs;
        for (let i = 0; i < 10; i++) {
            ms += 24 * 3600000;
            const w = wallClock(ms);
            const iso = isoWeekday(w);
            if (WORK_DAYS.includes(iso)) {
                // Return JS weekday (0=Sun..6=Sat) for DAY_NAMES_SHORT
                return DAY_NAMES_SHORT[w.weekday];
            }
        }
        return null;
    }

    if (!todayIsWorkday) {
        // Case A: today is a day off
        const next = findNextWorkday(nowMs);
        return next ? `Сегодня выходной. Работы начнутся в ${next}` : null;
    }

    if (wc.hour >= WORKDAY_END_HOUR) {
        // Case B: workday is over — check if tomorrow is off
        const tomorrowMs = nowMs + 24 * 3600000;
        const tw = wallClock(tomorrowMs);
        const tomorrowIso = isoWeekday(tw);
        if (!WORK_DAYS.includes(tomorrowIso)) {
            const next = findNextWorkday(nowMs);
            return next ? `Завтра выходной. Работы начнутся в ${next}` : null;
        }
    }

    // Workday, during or before work hours — no hint
    return null;
}

// ── Initialise start_date default (now in TIMEZONE, snapped to work hours) ── //
(function setDefaultStart() {
    // Start from now, then advance to the nearest work-time moment
    let utcMs = Date.now();

    // Inline snap: advance cursor until it falls inside a work slot
    for (let guard = 0; guard < 200; guard++) {
        const wc = wallClock(utcMs);
        const iso = wc.weekday === 0 ? 7 : wc.weekday; // ISO weekday
        if (WORK_DAYS.includes(iso) &&
            wc.hour >= WORKDAY_START_HOUR &&
            wc.hour < WORKDAY_END_HOUR) {
            break; // already in work time
        }
        if (!WORK_DAYS.includes(iso)) {
            utcMs += (24 - wc.hour) * 3600000 - wc.minute * 60000;
        } else if (wc.hour < WORKDAY_START_HOUR) {
            utcMs += (WORKDAY_START_HOUR - wc.hour) * 3600000 - wc.minute * 60000;
        } else {
            // after work: jump to next day's start
            utcMs += ((24 - wc.hour) + WORKDAY_START_HOUR) * 3600000 - wc.minute * 60000;
        }
    }

    // Format snapped time to datetime-local value (YYYY-MM-DDTHH:MM) in TIMEZONE
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = {};
    for (const { type, value } of fmt.formatToParts(new Date(utcMs))) {
        parts[type] = value;
    }
    elStart.value = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
})();

// ── Timezone helpers ── //

// Removed updateStartDisplay as we use native datetime-local


/**
 * Return the "wall-clock" components in TIMEZONE for a given UTC ms timestamp.
 */
function wallClock(utcMs) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
    });
    const p = {};
    for (const { type, value } of fmt.formatToParts(new Date(utcMs))) {
        p[type] = value;
    }
    return {
        year: +p.year,
        month: +p.month,
        day: +p.day,
        hour: p.hour === '24' ? 0 : +p.hour,
        minute: +p.minute,
        weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday.replace('.', '')),
        // JS 0=Sun … 6=Sat → ISO 1=Mon … 7=Sun
    };
}

/** ISO weekday (1=Mon … 7=Sun) from wallClock().weekday (0=Sun … 6=Sat) */
function isoWeekday(wc) {
    return wc.weekday === 0 ? 7 : wc.weekday;
}

/**
 * Parse the datetime-local value into UTC ms, treating the input as TIMEZONE.
 */
function parseLocalToUTC(datetimeLocalStr) {
    // datetime-local gives "YYYY-MM-DDTHH:MM" — we need to interpret it in TIMEZONE.
    // Strategy: try adjacent UTC offsets to find the one where the wall clock matches.
    const [datePart, timePart] = datetimeLocalStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = timePart.split(':').map(Number);

    // Start with a rough UTC guess (the literal values as UTC)
    const roughUtc = Date.UTC(y, m - 1, d, hh, mm);

    // Scan offsets from -14h to +14h in 15-min steps to find the matching wall clock
    for (let offMin = -14 * 60; offMin <= 14 * 60; offMin += 15) {
        const candidate = roughUtc - offMin * 60000;
        const wc = wallClock(candidate);
        if (wc.year === y && wc.month === m && wc.day === d &&
            wc.hour === hh && wc.minute === mm) {
            return candidate;
        }
    }
    // Fallback (should not happen)
    return roughUtc;
}

// ── Core calculation ── //

function calculate() {
    // 1. Read inputs
    const sheets = Math.max(0, Math.floor(Number(elSheets.value) || 0));
    const edge = elEdge.value; // "PVC" or "Paint Grade"
    const delivery = Math.max(0, Number(elDelivery.value !== '' ? elDelivery.value : 3) || 0);
    const startStr = elStart.value;

    if (!startStr) {
        elDuration.textContent = '—';
        elDatetime.textContent = '—';
        return;
    }

    // 2. Total work-minutes
    const edgeRate = edge === 'Paint Grade' ? EDGE_PG_MIN_PER_SHEET : EDGE_PVC_MIN_PER_SHEET;
    let totalMin = sheets * (CUTTING_MIN_PER_SHEET + edgeRate + ASSEMBLY_MIN_PER_SHEET);
    totalMin += delivery * 60; // delivery is in hours

    // 3. Extra whole work-days for Paint Grade
    let extraDays = 0;
    if (edge === 'Paint Grade' && sheets > 0) {
        extraDays = Math.ceil(sheets / PG_LIMIT);
    }
    const workdayMinutes = (WORKDAY_END_HOUR - WORKDAY_START_HOUR) * 60;
    totalMin += extraDays * workdayMinutes;

    // 4. Round total minutes ONCE — used for both display and calendar projection
    let roundedTotalMin = Math.round(totalMin / ROUND_DURATION_MIN) * ROUND_DURATION_MIN;

    // 4a. Format "pure duration"
    const durDays = Math.floor(roundedTotalMin / workdayMinutes);
    const durHours = Math.floor((roundedTotalMin % workdayMinutes) / 60);
    const durMin = roundedTotalMin % 60;
    let durStr = '';
    if (durDays > 0) durStr += `${durDays} дн. `;
    if (durHours > 0 || durDays > 0) durStr += `${durHours} ч. `;
    if (durMin > 0 || durStr === '') durStr += `${durMin} мин.`;
    elDuration.textContent = durStr.trim();

    // 5. Project rounded minutes onto calendar
    let cursor = parseLocalToUTC(startStr);
    let remaining = roundedTotalMin;

    // Helper: advance cursor to next working-time minute (if it's outside work hours)
    function advanceToWorkTime() {
        for (let guard = 0; guard < 200; guard++) {
            const wc = wallClock(cursor);
            const iso = isoWeekday(wc);
            if (WORK_DAYS.includes(iso) &&
                wc.hour >= WORKDAY_START_HOUR &&
                wc.hour < WORKDAY_END_HOUR) {
                return; // cursor is in a work-minute
            }
            if (!WORK_DAYS.includes(iso)) {
                cursor += (24 - wc.hour) * 3600000 - wc.minute * 60000;
            } else if (wc.hour < WORKDAY_START_HOUR) {
                cursor += (WORKDAY_START_HOUR - wc.hour) * 3600000 - wc.minute * 60000;
            } else {
                cursor += ((24 - wc.hour) + WORKDAY_START_HOUR) * 3600000 - wc.minute * 60000;
            }
        }
    }

    // Iterate in chunks (minutes left in current work-day)
    while (remaining > 0) {
        advanceToWorkTime();
        const wc = wallClock(cursor);
        const minutesLeftToday = (WORKDAY_END_HOUR - wc.hour) * 60 - wc.minute;
        if (minutesLeftToday <= 0) {
            // Edge case: exactly at end of day
            cursor += 60000;
            continue;
        }
        const chunk = Math.min(remaining, minutesLeftToday);
        cursor += chunk * 60000;
        remaining -= chunk;
    }

    // 6. Round final datetime to nearest ROUND_DATETIME_MIN
    if (ROUND_DATETIME_MIN > 0) {
        const stepMs = ROUND_DATETIME_MIN * 60000;
        cursor = Math.round(cursor / stepMs) * stepMs;
    }

    // 6. Format result datetime — "MMM DD, HH:00 am/pm"
    const finDate = new Date(cursor);
    const monthStr = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, month: 'short' }).format(finDate);
    const fin = wallClock(cursor);
    const pad = (n) => String(n).padStart(2, '0');
    const h24 = fin.hour;
    const ampm = h24 >= 12 ? 'pm' : 'am';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    elDatetime.textContent =
        `${monthStr} ${fin.day}, ${h12}:${pad(fin.minute)} ${ampm}`;

    // 7. Show calculation breakdown (debounced)
    showBreakdownDebounced({
        cutting: sheets * CUTTING_MIN_PER_SHEET,
        edging: sheets * edgeRate,
        assembly: sheets * ASSEMBLY_MIN_PER_SHEET,
        paintDays: extraDays,
        delivery: delivery,
        weekends: countWeekendsDuring(startStr, cursor),
        sheets: sheets
    });
}

function showBreakdownDebounced(data) {
    if (calcTimer) clearTimeout(calcTimer);
    if (elHint) elHint.classList.remove('is-visible');

    const offDayHint = getOffDayHint();

    // Показываем сообщение о выходном сразу, без задержки
    if (offDayHint) {
        elHint.innerHTML = `<b>${offDayHint}</b>`;
        elHint.classList.add('is-visible');
    }

    // Если листов нет — только сообщение выше, без дальнейшего расчёта
    if (!data.sheets || data.sheets <= 0) return;

    // Остальной breakdown через 3 сек
    calcTimer = setTimeout(() => {
        const parts = [];
        const workdayMin = (WORKDAY_END_HOUR - WORKDAY_START_HOUR) * 60;

        const formatHMM = (m) => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            return `${hrs}:${String(mins).padStart(2, '0')}`;
        };

        // Если минут больше одного рабочего дня — добавляем расшифровку в скобках
        const withDayBreakdown = (m) => {
            if (m <= workdayMin) return formatHMM(m);
            const days = Math.floor(m / workdayMin);
            const remHrs = Math.floor((m % workdayMin) / 60);
            const dayPart = `${days} ${pluralRu(days, 'день', 'дня', 'дней')}`;
            const hrPart = remHrs > 0 ? `, ${remHrs} ч` : '';
            return `${formatHMM(m)} (${dayPart}${hrPart} раб. времени)`;
        };

        if (data.cutting > 0) parts.push(`Порезка - ${withDayBreakdown(data.cutting)}`);
        if (data.edging > 0) parts.push(`Поклейка - ${withDayBreakdown(data.edging)}`);
        if (data.assembly > 0) parts.push(`Сборка - ${withDayBreakdown(data.assembly)}`);
        if (data.paintDays > 0) parts.push(`Покраска кромки - ${data.paintDays} ${pluralRu(data.paintDays, 'день', 'дня', 'дней')}`);
        if (data.delivery > 0) parts.push(`Доставка - ${withDayBreakdown(data.delivery * 60)}`);

        if (data.weekends > 0) {
            parts.push(`Выходной - ${data.weekends} ${pluralRu(data.weekends, 'день', 'дня', 'дней')}`);
        }

        if (elHint && parts.length > 0) {
            let hintHtml = '';
            // Если есть сообщение о выходном — вставить bold + перенос строки
            if (offDayHint) {
                hintHtml += `<b>${offDayHint}</b><br>`;
            }
            parts.forEach((part, i) => {
                hintHtml += part;
                if (i < parts.length - 1) {
                    hintHtml += part.includes('(') ? ',<br>' : ', ';
                }
            });
            elHint.innerHTML = hintHtml;
            elHint.classList.add('is-visible');
        }
    }, HINT_DELAY_MS);
}

/**
 * Russian pluralization: picks the correct word form for a given number.
 * @param {number} n - the number
 * @param {string} one - form for 1 (день)
 * @param {string} few - form for 2-4 (дня)
 * @param {string} many - form for 5+ (дней)
 */
function pluralRu(n, one, few, many) {
    const mod100 = Math.abs(n) % 100;
    const mod10 = Math.abs(n) % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
}

/**
 * Counts unique non-work days (weekends) between start and finish of work.
 */
function countWeekendsDuring(startStr, endUtcMs) {
    let tempCursor = parseLocalToUTC(startStr);
    if (tempCursor >= endUtcMs) return 0;

    const skippedDates = new Set();

    while (tempCursor <= endUtcMs) {
        const wc = wallClock(tempCursor);
        const iso = isoWeekday(wc);
        if (!WORK_DAYS.includes(iso)) {
            skippedDates.add(`${wc.year}-${wc.month}-${wc.day}`);
        }
        tempCursor += 12 * 3600000;
    }

    return skippedDates.size;
}

// ── Event binding (reactive recalculation) ── //
[elSheets, elDelivery, elStart].forEach(el => {
    el.addEventListener('input', calculate);
});

// Edge toggle
const elEdgePrev = document.getElementById('edge_prev');
const elEdgeNext = document.getElementById('edge_next');
function toggleEdge() {
    elEdge.value = elEdge.value === 'PVC' ? 'Paint Grade' : 'PVC';
    calculate();
}
// Using pointerdown can be more reliable in some iframe scenarios
if (elEdgePrev) elEdgePrev.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleEdge(); });
if (elEdgeNext) elEdgeNext.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleEdge(); });

// Note: Native datetime picker handles its own display

// Clear number fields on focus so user doesn't have to delete the digit
[elSheets].forEach(el => {
    el.addEventListener('focus', () => { if (el.value === '0' || el.value === '') el.value = ''; });
    el.addEventListener('blur', () => { if (el.value === '') { el.value = ''; /* keep empty = placeholder */ } });
});

// Delivery: clear on focus, restore 3 if left blank
elDelivery.addEventListener('focus', () => { if (Number(elDelivery.value) === 3 || elDelivery.value === '') elDelivery.value = ''; });
elDelivery.addEventListener('blur', () => { if (elDelivery.value === '') { elDelivery.value = 3; calculate(); } });

// Prevent negative values on number inputs
[elSheets, elDelivery].forEach(el => {
    el.addEventListener('input', () => {
        if (el.value !== '' && Number(el.value) < 0) el.value = 0;
    });
});

// Step buttons logic
// — sheets buttons: hold 1s → auto-repeat at 8/sec
// — other buttons:  simple click

function stepValue(btn) {
    const targetId = btn.getAttribute('data-target');
    const inputEl = document.getElementById(targetId);
    if (!inputEl) return;
    let val = Number(inputEl.value) || 0;
    if (btn.classList.contains('calc__step--minus')) {
        val = Math.max(0, val - 1);
    } else {
        val += 1;
    }
    inputEl.value = val;
    calculate();
}

document.querySelectorAll('.calc__step[data-target="sheets_count"]').forEach(btn => {
    let holdTimer = null;
    let repeatTimer = null;

    const startHold = (e) => {
        e.preventDefault();
        stepValue(btn); // immediate first step

        holdTimer = setTimeout(() => {
            repeatTimer = setInterval(() => stepValue(btn), HOLD_REPEAT_MS);
        }, HOLD_DELAY_MS);
    };

    const stopHold = () => {
        clearTimeout(holdTimer);
        clearInterval(repeatTimer);
        holdTimer = repeatTimer = null;
    };

    btn.addEventListener('pointerdown', startHold);
    btn.addEventListener('pointerup', stopHold);
    btn.addEventListener('pointerleave', stopHold);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

// Other step buttons (delivery, etc.) — simple click
document.querySelectorAll('.calc__step:not([data-target="sheets_count"])').forEach(btn => {
    btn.addEventListener('click', () => stepValue(btn));
});

// Initial calculation
calculate();

// ── Settings panel UI ── //
(function initSettings() {
    const btnOpen = document.getElementById('settings_btn');
    const panel = document.getElementById('settings_panel');
    const btnSave = document.getElementById('settings_save');
    const btnReset = document.getElementById('settings_reset');
    const btnCancel = document.getElementById('settings_cancel');
    const tabs = document.querySelectorAll('.settings__tab');
    const panes = { main: document.getElementById('settings_tab_main'), advanced: document.getElementById('settings_tab_advanced') };

    // Toggle open/close
    btnOpen.addEventListener('click', () => {
        const isOpen = !panel.hidden;
        panel.hidden = isOpen;
        if (!isOpen) populateForm(cfg);
    });

    // Cancel — close without saving
    btnCancel.addEventListener('click', () => {
        panel.hidden = true;
    });

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            Object.values(panes).forEach(p => p.hidden = true);
            panes[tab.dataset.tab].hidden = false;
        });
    });

    function populateForm(c) {
        document.getElementById('cfg_cutting').value = c.cutting;
        document.getElementById('cfg_edge_pvc').value = c.edge_pvc;
        document.getElementById('cfg_edge_pg').value = c.edge_pg;
        document.getElementById('cfg_assembly').value = c.assembly;
        document.getElementById('cfg_day_start').value = c.day_start;
        document.getElementById('cfg_day_end').value = c.day_end;
        document.getElementById('cfg_pg_limit').value = c.pg_limit;
        document.getElementById('cfg_delivery_default').value = c.delivery_default;
        document.getElementById('cfg_hold_delay').value = c.hold_delay;
        document.getElementById('cfg_hold_repeat').value = c.hold_repeat;
        document.getElementById('cfg_hint_delay').value = c.hint_delay;
        document.getElementById('cfg_timezone').value = c.timezone;
        document.getElementById('cfg_round_dur').value = c.round_dur;
        document.getElementById('cfg_round_dt').value = c.round_dt;
        // Weekday checkboxes
        document.querySelectorAll('#cfg_workdays input[type="checkbox"]').forEach(cb => {
            cb.checked = c.work_days.includes(Number(cb.value));
        });
    }

    function readForm() {
        const days = [];
        document.querySelectorAll('#cfg_workdays input[type="checkbox"]:checked').forEach(cb => {
            days.push(Number(cb.value));
        });
        return {
            cutting: Number(document.getElementById('cfg_cutting').value) || DEFAULTS.cutting,
            edge_pvc: Number(document.getElementById('cfg_edge_pvc').value) || DEFAULTS.edge_pvc,
            edge_pg: Number(document.getElementById('cfg_edge_pg').value) || DEFAULTS.edge_pg,
            assembly: Number(document.getElementById('cfg_assembly').value) || DEFAULTS.assembly,
            day_start: Number(document.getElementById('cfg_day_start').value),
            day_end: Number(document.getElementById('cfg_day_end').value),
            work_days: days.length ? days : DEFAULTS.work_days.slice(),
            pg_limit: Number(document.getElementById('cfg_pg_limit').value) || DEFAULTS.pg_limit,
            delivery_default: Number(document.getElementById('cfg_delivery_default').value),
            hold_delay: Number(document.getElementById('cfg_hold_delay').value) || DEFAULTS.hold_delay,
            hold_repeat: Number(document.getElementById('cfg_hold_repeat').value) || DEFAULTS.hold_repeat,
            hint_delay: Number(document.getElementById('cfg_hint_delay').value),
            timezone: document.getElementById('cfg_timezone').value.trim() || DEFAULTS.timezone,
            round_dur: Number(document.getElementById('cfg_round_dur').value) || DEFAULTS.round_dur,
            round_dt: Number(document.getElementById('cfg_round_dt').value) || DEFAULTS.round_dt,
        };
    }

    function applyConfig(c) {
        CUTTING_MIN_PER_SHEET = c.cutting;
        EDGE_PVC_MIN_PER_SHEET = c.edge_pvc;
        EDGE_PG_MIN_PER_SHEET = c.edge_pg;
        ASSEMBLY_MIN_PER_SHEET = c.assembly;
        WORKDAY_START_HOUR = c.day_start;
        WORKDAY_END_HOUR = c.day_end;
        WORK_DAYS = c.work_days.slice();
        PG_LIMIT = c.pg_limit;
        DELIVERY_DEFAULT = c.delivery_default;
        HOLD_DELAY_MS = c.hold_delay;
        HOLD_REPEAT_MS = c.hold_repeat;
        HINT_DELAY_MS = c.hint_delay * 1000;
        TIMEZONE = c.timezone;
        ROUND_DURATION_MIN = c.round_dur;
        ROUND_DATETIME_MIN = c.round_dt;
        elDelivery.value = c.delivery_default;
    }

    btnSave.addEventListener('click', () => {
        const newCfg = readForm();
        cfg = newCfg;
        localStorage.setItem('calc1_settings', JSON.stringify(newCfg));
        applyConfig(newCfg);
        panel.hidden = true;
        calculate();
    });

    btnReset.addEventListener('click', () => {
        cfg = Object.assign({}, DEFAULTS);
        localStorage.removeItem('calc1_settings');
        populateForm(cfg);
        applyConfig(cfg);
        calculate();
    });

    // Populate on first load (in case panel opened before save)
    populateForm(cfg);
})();
