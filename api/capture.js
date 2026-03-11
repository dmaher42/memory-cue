const chrono = require('chrono-node');

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

  let type = classifyCapture(body.input);
  const parsedDates = chrono.parse(body.input);
  let reminderTime = null;

  if (parsedDates.length > 0) {
    reminderTime = parsedDates[0].start.date();
    type = 'reminder';
    console.log('[reminder detected]', reminderTime);
  }

  const record = {
    id: crypto.randomUUID(),
    text: body.input,
    type,
    reminderTime,
    createdAt: Date.now()
  };

  if (reminderTime) {
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
    reminderTime,
    record
  });
};
