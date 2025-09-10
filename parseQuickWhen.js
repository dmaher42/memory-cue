(function(global){
  function toISODatePart(d){
    return d.toISOString().slice(0,10);
  }

  function parseQuickWhen(text){
    const now = new Date();
    let date = now;
    let time = '';
    let str = String(text || '').toLowerCase();

    // use chrono if available
    if (global.chrono) {
      try {
        const parsed = global.chrono.parseDate(str, now, { forwardDate: true });
        if (parsed) {
          return { date: toISODatePart(parsed), time: parsed.toTimeString().slice(0,5) };
        }
      } catch (e) {
        // ignore and fallback
      }
    }

    // relative phrases
    if (/\b(today|hoy|aujourd'hui|aujourd’hui)\b/.test(str)) {
      date = now;
      str = str.replace(/\b(today|hoy|aujourd'hui|aujourd’hui)\b/, '');
    } else if (/\b(tomorrow|mañana|demain)\b/.test(str)) {
      date = new Date(now);
      date.setDate(now.getDate() + 1);
      str = str.replace(/\b(tomorrow|mañana|demain)\b/, '');
    } else if (/\bnext week\b/.test(str)) {
      date = new Date(now);
      date.setDate(now.getDate() + 7);
      str = str.replace(/\bnext week\b/, '');
    }

    // specific date formats
    let m = str.match(/(\d{4})[-\.](\d{1,2})[-\.](\d{1,2})/);
    if (m) {
      date = new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
      str = str.replace(m[0], '');
    } else {
      m = str.match(/(\d{1,2})[\/\.](\d{1,2})(?:[\/\.](\d{2,4}))?/);
      if (m) {
        let first = parseInt(m[1],10);
        let second = parseInt(m[2],10);
        let year = m[3] ? parseInt(m[3],10) : now.getFullYear();
        if (year < 100) year += 2000;
        let day, month;
        if (first > 12 && second <= 12) { day = first; month = second-1; }
        else if (second > 12 && first <= 12) { day = second; month = first-1; }
        else { day = first; month = second-1; }
        date = new Date(year, month, day);
        str = str.replace(m[0], '');
      }
    }

    // time
    m = str.match(/(\d{1,2})(?:[:h](\d{2}))?\s*(am|pm)?/);
    if (m) {
      let hour = parseInt(m[1],10);
      const minute = parseInt(m[2] || '0',10);
      const mer = m[3];
      if (mer === 'pm' && hour < 12) hour += 12;
      if (mer === 'am' && hour === 12) hour = 0;
      time = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    }

    return { date: toISODatePart(date), time };
  }

  global.parseQuickWhen = parseQuickWhen;
  if (typeof module !== 'undefined') module.exports = { parseQuickWhen };
})(typeof globalThis !== 'undefined' ? globalThis : this);
