const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const toTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

export function getRecallItems(items = [], options = {}) {
  const now = Date.now();
  const maxItems = Math.min(3, Math.max(1, Number(options.limit) || 3));

  return (Array.isArray(items) ? items : [])
    .filter((item) => {
      const createdAt = toTimestamp(item?.createdAt);
      if (!createdAt) {
        return false;
      }

      const age = now - createdAt;
      return age > SEVEN_DAYS_MS;
    })
    .sort((a, b) => toTimestamp(b?.createdAt) - toTimestamp(a?.createdAt))
    .slice(0, maxItems);
}
