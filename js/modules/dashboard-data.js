import { buildActivityIndex, getRecentActivity } from './activity-index.js';
import {
  getCoachingItems,
  getTeachingItems,
  getThisWeekActions,
  getTodayActions,
} from './action-planner.js';

const INBOX_FOLDER_NAME = 'inbox';

const normalizePriority = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const toDashboardItem = (item, activityById) => {
  const activityEntry = item?.id ? activityById.get(item.id) : null;

  return {
    id: typeof item?.id === 'string' ? item.id : '',
    title: typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : 'Untitled note',
    type:
      (typeof item?.type === 'string' && item.type.trim()) ||
      (typeof activityEntry?.type === 'string' && activityEntry.type.trim()) ||
      'note',
    folder:
      (typeof item?.folder === 'string' && item.folder.trim()) ||
      (typeof activityEntry?.folder === 'string' && activityEntry.folder.trim()) ||
      'Unsorted',
    priority: normalizePriority(item?.priority ?? activityEntry?.aiPriority),
    createdAt: activityEntry?.createdAt ?? 0,
  };
};

const mapActionItems = (items, activityById) => items.map((item) => toDashboardItem(item, activityById));

const buildInboxItems = (activityEntries, activityById) => {
  return mapActionItems(
    activityEntries.filter(
      (entry) => typeof entry.folder === 'string' && entry.folder.trim().toLowerCase() === INBOX_FOLDER_NAME,
    ),
    activityById,
  );
};

export const buildDashboardData = () => {
  const activityEntries = buildActivityIndex();
  const activityById = new Map(activityEntries.map((entry) => [entry.id, entry]));

  return {
    today: mapActionItems(getTodayActions(), activityById),
    thisWeek: mapActionItems(getThisWeekActions(), activityById),
    coaching: mapActionItems(getCoachingItems(), activityById),
    teaching: mapActionItems(getTeachingItems(), activityById),
    recent: mapActionItems(getRecentActivity(10), activityById),
    inbox: buildInboxItems(activityEntries, activityById),
  };
};
