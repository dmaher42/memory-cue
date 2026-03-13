const MAX_TAGS = 5;

const TAG_RULES = [
  { tag: 'teaching', pattern: /\b(lesson|teach|teaching|class|classroom|student|curriculum)\b/i },
  { tag: 'history', pattern: /\b(history|historical|ancient|rome|roman|pompeii)\b/i },
  { tag: 'idea', pattern: /\b(idea|brainstorm|concept|plan|draft)\b/i },
  { tag: 'reminder', pattern: /\b(remind|reminder|due|deadline|follow\s?up|schedule|appointment)\b/i },
  { tag: 'task', pattern: /\b(todo|to-do|task|checklist|finish|complete)\b/i },
  { tag: 'meeting', pattern: /\b(meeting|call|sync|standup)\b/i },
  { tag: 'personal', pattern: /\b(personal|family|home|health)\b/i },
];

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
};

export const generateTags = (text) => {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return [];
  }

  const tags = [];

  TAG_RULES.forEach(({ tag, pattern }) => {
    if (tags.length >= MAX_TAGS) {
      return;
    }

    if (pattern.test(normalizedText) && !tags.includes(tag)) {
      tags.push(tag);
    }
  });

  return tags.slice(0, MAX_TAGS);
};
