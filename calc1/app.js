/* =============================================================
   Shop Calculator — Production Timeline Logic
   ============================================================= */

// ── Constants (edit these to tune the calculator) ── //
const CUTTING_MIN_PER_SHEET = 18;
const EDGE_PVC_MIN_PER_SHEET = 20;
const EDGE_PG_MIN_PER_SHEET = 20;
const ASSEMBLY_MIN_PER_SHEET = 25;
const WORKDAY_START_HOUR = 7;
const WORKDAY_END_HOUR = 18;
const WORK_DAYS = [1, 2, 3, 4, 5, 6]; // 1=Mon … 5=Fri
const PG_LIMIT = 30;   // +1 work-day per N sheets of Paint Grade
const TIMEZONE = 'America/Los_Angeles';

// ── DOM refs ── //
const elSheets = document.getElementById('sheets_count');
const elEdge = document.getElementById('edge_type');
const elDelivery = document.getElementById('delivery_hours');
const elStart = document.getElementById('start_date');
const elDuration = document.getElementById('result_duration');
const elDatetime = document.getElementById('result_datetime');

// ── Initialise start_date default (now in TIMEZONE, snapped to work hours) ── //
(function setDefaultStart() {
    // Start from now, then advance to the nearest work-time moment
    let utcMs = Date.now();

    // Inline snap: advance cursor until it falls inside a work slot
    for (let guard = 0; guard < 525960; guard++) {
        const wc = wallClock(utcMs);
        const iso = wc.weekday === 0 ? 7 : wc.weekday; // ISO weekday
        if (WORK_DAYS.includes(iso) &&
            wc.hour >= WORKDAY_START_HOUR &&
            wc.hour < WORKDAY_END_HOUR) {
            break; // already in work time
        }
        if (!WORK_DAYS.includes(iso)) {
            utcMs += 60000; // non-work day: minute-step (advanceToWorkTime handles weekends)
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
    const delivery = Math.max(0, Number(elDelivery.value) || 0);
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
        extraDays = Math.floor(sheets / PG_LIMIT);
    }
    const workdayMinutes = (WORKDAY_END_HOUR - WORKDAY_START_HOUR) * 60;
    totalMin += extraDays * workdayMinutes;

    // 4. Format "pure duration"
    const durDays = Math.floor(totalMin / workdayMinutes);
    const durHours = Math.floor((totalMin % workdayMinutes) / 60);
    const durMin = totalMin % 60;
    let durStr = '';
    if (durDays > 0) durStr += `${durDays} дн. `;
    if (durHours > 0 || durDays > 0) durStr += `${durHours} ч.`;
    if (durStr === '') durStr = `${durMin} мин.`;
    elDuration.textContent = durStr.trim();

    // 5. Project onto calendar
    let cursor = parseLocalToUTC(startStr);
    let remaining = totalMin;

    // Helper: advance cursor to next working-time minute (if it's outside work hours)
    function advanceToWorkTime() {
        for (let guard = 0; guard < 525960; guard++) { // max ~1 year of minutes
            const wc = wallClock(cursor);
            const iso = isoWeekday(wc);
            if (WORK_DAYS.includes(iso) &&
                wc.hour >= WORKDAY_START_HOUR &&
                wc.hour < WORKDAY_END_HOUR) {
                return; // cursor is in a work-minute
            }
            // Jump smartly instead of +1 min each time
            if (!WORK_DAYS.includes(iso)) {
                // Skip whole non-work day → jump to next day 00:00 in TZ then retry
                cursor += 60000; // tick forward (simple; loops will handle)
            } else if (wc.hour < WORKDAY_START_HOUR) {
                // Before work → jump to WORKDAY_START_HOUR same day
                cursor += (WORKDAY_START_HOUR - wc.hour) * 3600000 - wc.minute * 60000;
            } else {
                // After work → jump to next day start
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
}

// ── Event binding (reactive recalculation) ── //
[elSheets, elDelivery, elStart].forEach(el => {
    el.addEventListener('input', calculate);
});
elEdge.addEventListener('change', calculate);

// Prevent negative values on number inputs
[elSheets, elDelivery].forEach(el => {
    el.addEventListener('input', () => {
        if (el.value !== '' && Number(el.value) < 0) el.value = 0;
    });
});

// Initial calculation
calculate();
