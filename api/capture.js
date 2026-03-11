const { RRule } = require('rrule');

const ALLOWED_ORIGINS = [
  'https://dmaher42.github.io',
  'https://memory-cue.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

const MAX_INPUT_CHARS = 6000;

const notes = [];
const reminders = [];
const tasks = [];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function classifyCapture(input) {
  const text = input.toLowerCase();

  if (
    text.includes('remind') ||
    text.includes('tomorrow') ||
    text.includes('today') ||
    text.includes('monday') ||
    text.includes('tuesday') ||
    text.includes('wednesday') ||
    text.includes('thursday') ||
    text.includes('friday') ||
    text.includes('lesson') ||
    text.includes('week')
  ) {
    return 'reminder';
  }

  if (
    text.startsWith('todo') ||
    text.startsWith('task') ||
    text.includes('need to')
  ) {
    return 'task';
  }

  return 'note';
}

function detectRecurrence(text) {
  const t = text.toLowerCase();

  if (t.includes('every') || t.includes('weekly') || t.includes('each')) {
    return 'weekly';
  }

  if (t.includes('daily')) {
    return 'daily';
  }

  if (t.includes('next two weeks')) {
    return 'weekly';
  }

  return null;
}

function getWeekCount(text) {
  if (text.toLowerCase().includes('next two weeks')) {
    return 2;
  }

  return 4;
}

function extractByWeekday(text) {
  const weekdays = [];
  const t = text.toLowerCase();

  if (t.includes('monday')) weekdays.push(RRule.MO);
  if (t.includes('tuesday')) weekdays.push(RRule.TU);
  if (t.includes('wednesday')) weekdays.push(RRule.WE);
  if (t.includes('thursday')) weekdays.push(RRule.TH);
  if (t.includes('friday')) weekdays.push(RRule.FR);
  if (t.includes('saturday')) weekdays.push(RRule.SA);
  if (t.includes('sunday')) weekdays.push(RRule.SU);

  return weekdays;
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const schemaVersion = body.schemaVersion;
  const input = typeof body.input === 'string' ? body.input.trim() : '';

  if (schemaVersion !== 2) {
    return res.status(400).json({ error: 'Invalid schemaVersion.' });
  }

  if (!input) {
    return res.status(400).json({ error: 'Missing input.' });
  }

  if (input.length > MAX_INPUT_CHARS) {
    return res.status(400).json({ error: 'input too large.' });
  }

  const type = classifyCapture(body.input);

  const recurrenceType = detectRecurrence(body.input);
  let recurrenceRule = null;
  let occurrences = [];

  if (recurrenceType === 'weekly') {
    const weekdays = extractByWeekday(body.input);
    const weekCount = getWeekCount(body.input);

    recurrenceRule = new RRule({
      freq: RRule.WEEKLY,
      interval: 1,
      count: weekdays.length > 0 ? weekdays.length * weekCount : weekCount,
      byweekday: weekdays.length > 0 ? weekdays : undefined,
      dtstart: new Date()
    });
  } else if (recurrenceType === 'daily') {
    recurrenceRule = new RRule({
      freq: RRule.DAILY,
      interval: 1,
      count: 4,
      dtstart: new Date()
    });
  }

  if (recurrenceRule) {
    occurrences = recurrenceRule.all();
  }

  const record = {
    id: crypto.randomUUID(),
    text: body.input,
    type,
    recurrence: recurrenceRule ? recurrenceRule.toString() : null,
    occurrences,
    createdAt: Date.now()
  };

  if (type === 'reminder') {
    reminders.push(record);
  } else if (type === 'task') {
    tasks.push(record);
  } else {
    notes.push(record);
  }

  console.log('[capture classified]', type);

  return res.status(200).json({
    success: true,
    type,
    recurrence: record.recurrence,
    occurrences,
    entry: record
  });
};
