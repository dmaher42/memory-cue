// js/main.js

// Navigation helpers
const navButtons = [...document.querySelectorAll('.nav-desktop [data-route]')];

// Routing
const views = [...document.querySelectorAll('[data-view]')];
const viewMap = new Map(views.map(v => [v.dataset.view, v]));
const DEFAULT_VIEW = 'dashboard';
const ACTIVITY_EVENT_NAME = 'memoryCue:activity';
const ACTIVITY_QUEUE_LIMIT = 20;

navButtons.forEach(btn => {
  if (!viewMap.has(btn.dataset.route)) {
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('cursor-not-allowed', 'opacity-60');
    btn.disabled = true;
  }
});

function show(view){
  let targetView = viewMap.get(view);
  if (!targetView) {
    if (view !== DEFAULT_VIEW) {
      view = DEFAULT_VIEW;
      targetView = viewMap.get(view);
    }
    if (!targetView) return null;
  }

  views.forEach(v => {
    v.hidden = v !== targetView;
  });

  // Update active navigation states
  function updateNavButtons(buttons, activeView){
    buttons.forEach(btn => {
      const isActive = btn.dataset.route === activeView;
      btn.classList.remove('bg-white/20', 'text-white');
      btn.classList.add('hover:bg-white/20', 'text-white/80', 'hover:text-white');
      if (isActive) {
        btn.setAttribute('aria-current', 'page');
        btn.classList.add('bg-white/20', 'text-white');
        btn.classList.remove('hover:bg-white/20', 'text-white/80', 'hover:text-white');
      } else {
        btn.removeAttribute('aria-current');
      }
    });
  }

  updateNavButtons(navButtons, view);
  if (!targetView.hasAttribute('tabindex')) {
    targetView.setAttribute('tabindex', '-1');
  }
  requestAnimationFrame(() => {
    if (typeof targetView.focus === 'function') {
      try {
        targetView.focus({ preventScroll: true });
      } catch (_) {
        // ignore focus errors
      }
    }
  });
  return view;
}

function getViewFromHash(){
  return (location.hash || `#${DEFAULT_VIEW}`).slice(1);
}

function syncViewFromHash(){
  const requestedView = getViewFromHash();
  const resolvedView = show(requestedView);
  if (!resolvedView) return;
  if (resolvedView !== requestedView) {
    history.replaceState(null, '', `#${resolvedView}`);
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
  const route = btn.dataset.route;
  if (!viewMap.has(route)) return;
  e.preventDefault();
  const targetHash = `#${route}`;
  if (location.hash === targetHash) {
    show(route);
  } else {
    location.hash = targetHash;
  }
});

window.addEventListener('hashchange', syncViewFromHash);

if (!location.hash) {
  location.hash = `#${DEFAULT_VIEW}`;
}

syncViewFromHash();

const quickActionButtons = document.querySelectorAll('[data-quick-action]');

function focusElementWithHighlight(element){
  if (!element) return false;
  const target = element;
  if (typeof target.focus === 'function') {
    target.focus({ preventScroll: false });
  }
  if (target.select) {
    try { target.select(); } catch { /* ignore */ }
  }
  if (target.isContentEditable) {
    try {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch {
      // ignore selection issues
    }
  }
  target.classList.remove('dashboard-highlight');
  void target.offsetWidth;
  target.classList.add('dashboard-highlight');
  window.setTimeout(() => {
    target.classList.remove('dashboard-highlight');
  }, 900);
  return true;
}

function resolveFocusTarget(focusTarget){
  if (!focusTarget) return null;
  if (typeof focusTarget === 'function') {
    try { return focusTarget(); } catch { return null; }
  }
  if (typeof focusTarget === 'string') {
    return document.querySelector(focusTarget);
  }
  return focusTarget;
}

function showViewAndFocus(view, focusTarget){
  const resolvedView = show(view);
  if (!resolvedView) return;
  if (location.hash !== `#${resolvedView}`) {
    history.replaceState(null, '', `#${resolvedView}`);
  }
  const attemptFocus = (attempt = 0) => {
    const target = resolveFocusTarget(focusTarget);
    if (target) {
      focusElementWithHighlight(target);
      return;
    }
    if (attempt < 3) {
      window.setTimeout(() => attemptFocus(attempt + 1), 120);
    }
  };
  requestAnimationFrame(() => attemptFocus());
}

quickActionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.quickAction;
    if (!action) return;
    if (action === 'reminder') {
      showViewAndFocus('reminders', '#title');
    } else if (action === 'note') {
      showViewAndFocus('notes', '#quick-note');
    } else if (action === 'planner') {
      showViewAndFocus('planner', () => document.querySelector('#planner-grid textarea'));
    }
  });
});

function normalizeActivityPayload(entry){
  if (!entry || typeof entry !== 'object') return null;
  const label = typeof entry.label === 'string' ? entry.label.trim() : '';
  if (!label) return null;
  const timestampSource = entry.timestamp ? new Date(entry.timestamp) : new Date();
  const tsValid = timestampSource instanceof Date && !Number.isNaN(timestampSource.getTime());
  const timestamp = tsValid ? timestampSource : new Date();
  const payload = { ...entry };
  payload.label = label;
  payload.timestamp = timestamp.toISOString();
  if (!payload.target) {
    payload.target = { view: DEFAULT_VIEW };
  }
  if (!payload.id) {
    const seed = `${payload.type || 'activity'}-${timestamp.getTime()}-${Math.random().toString(16).slice(2, 8)}`;
    payload.id = seed;
  }
  return payload;
}

function dispatchActivityEvent(entry){
  const payload = normalizeActivityPayload(entry);
  if (!payload) return false;
  if (typeof window !== 'undefined') {
    const queue = Array.isArray(window.memoryCueActivityQueue) ? window.memoryCueActivityQueue : [];
    queue.push(payload);
    while (queue.length > ACTIVITY_QUEUE_LIMIT) queue.shift();
    window.memoryCueActivityQueue = queue;
  }
  if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') {
    return false;
  }
  try {
    if (typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent(ACTIVITY_EVENT_NAME, { detail: payload }));
    } else if (document.createEvent) {
      const evt = document.createEvent('CustomEvent');
      if (evt && evt.initCustomEvent) {
        evt.initCustomEvent(ACTIVITY_EVENT_NAME, false, false, payload);
        document.dispatchEvent(evt);
      }
    }
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') {
  const existing = typeof window.memoryCueActivity === 'object' && window.memoryCueActivity !== null
    ? window.memoryCueActivity
    : {};
  existing.push = dispatchActivityEvent;
  existing.eventName = ACTIVITY_EVENT_NAME;
  window.memoryCueActivity = existing;
}

let supabaseClient = null;
let resourcesController = null;
let resourcesControllerAbort = null;
let authSubscription = null;
let supabaseInitPromise = null;
let supabaseModulePromise = null;

const globalEnv = (typeof globalThis !== 'undefined' && (globalThis.__SUPABASE_ENV__ || globalThis.__supabaseEnv__)) || {};
const nodeEnv = (typeof process !== 'undefined' && process?.env) ? process.env : {};
const SUPABASE_URL = (typeof globalEnv.VITE_SUPABASE_URL === 'string' && globalEnv.VITE_SUPABASE_URL)
  || (typeof nodeEnv.VITE_SUPABASE_URL === 'string' && nodeEnv.VITE_SUPABASE_URL)
  || (typeof window !== 'undefined' ? window.SUPABASE_URL : undefined)
  || '';
const SUPABASE_ANON_KEY = (typeof globalEnv.VITE_SUPABASE_ANON_KEY === 'string' && globalEnv.VITE_SUPABASE_ANON_KEY)
  || (typeof nodeEnv.VITE_SUPABASE_ANON_KEY === 'string' && nodeEnv.VITE_SUPABASE_ANON_KEY)
  || (typeof window !== 'undefined' ? window.SUPABASE_ANON_KEY : undefined)
  || '';
const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let supabaseInitialSessionPromise = null;
let supabaseInitialSessionResolved = !hasSupabaseConfig;

const ACTIVITY_SUBJECTS = new Set(['HPE', 'English', 'HASS']);
const ACTIVITY_PHASES = new Set(['start', 'middle', 'end']);

function createLogger(namespace){
  const hasConsole = typeof console !== 'undefined';
  const prefix = namespace ? `[${namespace}]` : '';

  function withPrefix(args){
    return prefix ? [prefix, ...args] : args;
  }

  function isDebugEnabled(){
    if (typeof window !== 'undefined' && typeof window.DEBUG !== 'undefined'){
      return Boolean(window.DEBUG);
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.DEBUG !== 'undefined'){
      return Boolean(globalThis.DEBUG);
    }
    return false;
  }

  return {
    debug(...args){
      if (hasConsole && typeof console.debug === 'function' && isDebugEnabled()){
        console.debug(...withPrefix(args));
      }
    },
    info(...args){
      if (hasConsole && typeof console.info === 'function'){
        console.info(...withPrefix(args));
      }
    },
    warn(...args){
      if (hasConsole && typeof console.warn === 'function'){
        console.warn(...withPrefix(args));
      }
    },
    error(...args){
      if (hasConsole && typeof console.error === 'function'){
        console.error(...withPrefix(args));
      }
    },
  };
}

function buildFilters(state = {}){
  const rawSubject = typeof state.subject === 'string' ? state.subject : 'all';
  const subject = rawSubject === 'all' || ACTIVITY_SUBJECTS.has(rawSubject) ? rawSubject : 'all';
  const rawPhase = typeof state.phase === 'string' ? state.phase : 'any';
  const phase = rawPhase === 'any' || ACTIVITY_PHASES.has(rawPhase) ? rawPhase : 'any';
  const search = typeof state.search === 'string' ? state.search.trim() : '';
  const pinnedOnly = Boolean(state.pinnedOnly);
  return { subject, phase, search, pinnedOnly };
}

function applyFilters(activities, state = {}){
  const { subject, phase, search, pinnedOnly } = buildFilters(state);
  const term = search.toLowerCase();
  return (Array.isArray(activities) ? activities : []).filter((activity) => {
    if (!activity || typeof activity !== 'object') return false;
    if (subject !== 'all' && activity.subject !== subject) return false;
    if (phase !== 'any' && activity.phase !== phase) return false;
    if (pinnedOnly && !activity.pinned) return false;
    if (term){
      const title = typeof activity.title === 'string' ? activity.title.toLowerCase() : '';
      const description = typeof activity.description === 'string' ? activity.description.toLowerCase() : '';
      if (!title.includes(term) && !description.includes(term)){
        return false;
      }
    }
    return true;
  });
}

function capitalise(value){
  if (!value) return '';
  const str = String(value);
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function subjectBadgeClass(subject){
  switch (subject) {
    case 'HPE':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200';
    case 'English':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200';
    case 'HASS':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300';
  }
}

function phaseBadgeClass(phase){
  switch (phase) {
    case 'start':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-200';
    case 'middle':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200';
    case 'end':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300';
  }
}

function renderCard(activity, { pinnedIds } = {}){
  if (typeof document === 'undefined' || !activity) {
    return { card: null, isPinned: false };
  }
  const card = document.createElement('article');
  card.className = 'flex h-full flex-col gap-4 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus-within:outline-none focus-within:ring-2 focus-within:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900/50';
  if (activity?.id) {
    card.dataset.activityId = String(activity.id);
  }

  const header = document.createElement('div');
  header.className = 'flex flex-col gap-3';

  const titleRow = document.createElement('div');
  titleRow.className = 'flex items-start justify-between gap-3';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'min-w-0 flex-1';
  const title = document.createElement('h3');
  title.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
  const titleText = (activity?.title && String(activity.title).trim()) || 'Untitled activity';
  title.textContent = titleText;
  titleWrap.appendChild(title);
  titleRow.appendChild(titleWrap);

  const hasPinnedLookup = pinnedIds && typeof pinnedIds.has === 'function';
  const isPinned = Boolean(activity?.pinned || (hasPinnedLookup && activity?.id && pinnedIds.has(activity.id)));

  if (activity?.id){
    const pinButton = document.createElement('button');
    pinButton.type = 'button';
    pinButton.dataset.activityPin = String(activity.id);
    pinButton.dataset.activityTitle = titleText;
    pinButton.className = 'activity-pin-btn inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400';
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.dataset.pinIcon = 'true';
    icon.textContent = '☆';
    const srLabel = document.createElement('span');
    srLabel.className = 'sr-only';
    srLabel.dataset.pinLabel = 'true';
    srLabel.textContent = `Pin ${titleText}`;
    pinButton.append(icon, srLabel);
    titleRow.appendChild(pinButton);
  }

  header.appendChild(titleRow);

  const badgeWrap = document.createElement('div');
  badgeWrap.className = 'flex flex-wrap gap-2 text-xs font-semibold';
  if (activity?.subject){
    const subjectBadge = document.createElement('span');
    subjectBadge.className = `inline-flex items-center rounded-full px-3 py-1 ${subjectBadgeClass(activity.subject)}`;
    subjectBadge.textContent = activity.subject;
    badgeWrap.appendChild(subjectBadge);
  }
  if (activity?.phase){
    const phaseBadge = document.createElement('span');
    phaseBadge.className = `inline-flex items-center rounded-full px-3 py-1 ${phaseBadgeClass(activity.phase)}`;
    phaseBadge.textContent = `${capitalise(activity.phase)} phase`;
    badgeWrap.appendChild(phaseBadge);
  }
  if (badgeWrap.childElementCount) {
    header.appendChild(badgeWrap);
  }
  card.appendChild(header);

  const description = document.createElement('p');
  description.className = 'text-sm leading-6 text-slate-600 dark:text-slate-300';
  description.textContent = (activity?.description && String(activity.description).trim())
    || 'No description provided yet.';
  card.appendChild(description);

  if (activity?.url){
    const link = document.createElement('a');
    link.className = 'inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200';
    link.href = activity.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = 'Open resource';
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '↗';
    link.appendChild(icon);
    card.appendChild(link);
  }

  if (Array.isArray(activity?.keywords) && activity.keywords.length){
    const keywordWrap = document.createElement('div');
    keywordWrap.className = 'flex flex-wrap gap-2 pt-2';
    activity.keywords.forEach((kw) => {
      const label = String(kw || '').trim();
      if (!label) return;
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center rounded-full border border-slate-200 bg-slate-100/80 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300';
      chip.textContent = `#${label}`;
      keywordWrap.appendChild(chip);
    });
    if (keywordWrap.childElementCount) {
      card.appendChild(keywordWrap);
    }
  }

  return { card, isPinned };
}

function setActive(elList, predicate){
  return Array.from(elList || []).map((el, index) => {
    if (!el) return { element: el, active: false };
    const active = Boolean(predicate(el, index));
    el.dataset.active = active ? 'true' : 'false';
    el.setAttribute('aria-pressed', String(active));
    return { element: el, active };
  });
}

function loadSupabaseModule(){
  if (supabaseModulePromise) return supabaseModulePromise;
  if (typeof window === 'undefined') {
    supabaseModulePromise = Promise.resolve(null);
    return supabaseModulePromise;
  }
  supabaseModulePromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .catch((error) => {
      console.error('Supabase library failed to load', error);
      return null;
    });
  return supabaseModulePromise;
}

function markInitialAuthReady(){
  supabaseInitialSessionResolved = true;
}

async function waitForInitialAuth(){
  if (supabaseInitialSessionResolved) return;
  if (!supabaseInitialSessionPromise) return;
  try {
    await supabaseInitialSessionPromise;
  } catch {
    // Errors are logged when the initial session request fails.
  }
}

function setupSupabaseAuth(){
  if (!supabaseClient || setupSupabaseAuth.initialised) return;
  setupSupabaseAuth.initialised = true;
  supabaseInitialSessionPromise = supabaseClient.auth.getSession()
    .then(async ({ data }) => {
      const session = data?.session || null;
      const nextUser = session?.user ?? null;
      const previousUserId = authUser?.id || null;
      const nextUserId = nextUser?.id || null;
      const userChanged = previousUserId !== nextUserId;
      authUser = nextUser;
      if (userChanged){
        resetActivityPins();
      }
      updateAuthUI(authUser);
      if (authUser) {
        await upsertProfile(authUser);
      }
      resourcesController?.handleAuthChange(authUser);
      if (userChanged){
        resourcesController?.refresh({ showLoading: true });
      }
      return authUser;
    })
    .catch((error) => {
      console.error('Initial Supabase session fetch failed', error);
      return null;
    })
    .finally(() => {
      markInitialAuthReady();
    });
  const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
    handleAuthStateChange(event, session);
  });
  authSubscription = data?.subscription || authSubscription;
  if (authSubscription && typeof window !== 'undefined' && !setupSupabaseAuth.cleanupRegistered) {
    window.addEventListener('beforeunload', () => {
      try {
        authSubscription.unsubscribe();
      } catch {
        // ignore cleanup errors
      }
    }, { once: true });
    setupSupabaseAuth.cleanupRegistered = true;
  }
}
setupSupabaseAuth.initialised = false;
setupSupabaseAuth.cleanupRegistered = false;

function ensureSupabase(){
  if (supabaseClient) return Promise.resolve(supabaseClient);
  if (!hasSupabaseConfig) return Promise.resolve(null);
  if (!supabaseInitPromise) {
    supabaseInitPromise = loadSupabaseModule().then((mod) => {
      if (!mod || typeof mod.createClient !== 'function') return null;
      try {
        const client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
        });
        supabaseClient = client;
        if (typeof window !== 'undefined') {
          window.supabaseClient = supabaseClient;
        }
        setupSupabaseAuth();
        resourcesController?.refresh({ showLoading: true });
        return supabaseClient;
      } catch (error) {
        console.error('Supabase initialisation failed', error);
        supabaseClient = null;
        return null;
      }
    });
  }
  return supabaseInitPromise;
}

const authForm = document.getElementById('auth-form');
const authEmailInput = document.getElementById('auth-email');
const authFeedbackEl = document.getElementById('auth-feedback');
const signInBtn = document.getElementById('sign-in-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const userBadge = document.getElementById('user-badge');
const userBadgeEmail = document.getElementById('user-badge-email');
const userBadgeInitial = document.getElementById('user-badge-initial');
const signInDefaultLabel = signInBtn?.textContent || 'Send link';

let authUser = null;

const activityPinState = {
  userId: null,
  ids: new Set(),
  loading: null,
};

function resetActivityPins(){
  activityPinState.userId = null;
  activityPinState.ids = new Set();
  activityPinState.loading = null;
}

function setActivityPinLocally(activityId, pinned){
  if (!activityId) return;
  if (pinned){
    activityPinState.ids.add(activityId);
  } else {
    activityPinState.ids.delete(activityId);
  }
  if (authUser?.id && activityPinState.userId !== authUser.id){
    activityPinState.userId = authUser.id;
  }
}

async function ensureActivityPins(){
  if (!authUser?.id){
    resetActivityPins();
    return activityPinState.ids;
  }
  if (activityPinState.userId === authUser.id && !activityPinState.loading){
    return activityPinState.ids;
  }
  if (activityPinState.loading){
    try {
      await activityPinState.loading;
    } catch {
      // Ignore concurrent load errors; fall back to current cache
    }
    return activityPinState.ids;
  }
  const userId = authUser.id;
  const loadPromise = (async () => {
    const client = supabaseClient || await ensureSupabase();
    if (!client){
      activityPinState.ids = new Set();
      activityPinState.userId = userId;
      return activityPinState.ids;
    }
    const { data, error } = await client
      .from('activity_pins')
      .select('activity_id')
      .eq('user_id', userId);
    if (error) throw error;
    const nextIds = new Set(
      Array.isArray(data)
        ? data.map((row) => row?.activity_id).filter((value) => typeof value === 'string' && value)
        : []
    );
    activityPinState.ids = nextIds;
    activityPinState.userId = userId;
    return activityPinState.ids;
  })();
  activityPinState.loading = loadPromise;
  try {
    await loadPromise;
  } catch (error) {
    console.error('Pinned activities fetch failed', error);
  } finally {
    if (activityPinState.loading === loadPromise){
      activityPinState.loading = null;
    }
  }
  return activityPinState.ids;
}

async function persistActivityPin(activityId, pinned){
  if (!authUser?.id) throw new Error('User must be signed in to pin activities');
  const client = supabaseClient || await ensureSupabase();
  if (!client) throw new Error('Supabase client not available');
  if (pinned){
    const { error } = await client
      .from('activity_pins')
      .upsert({
        user_id: authUser.id,
        activity_id: activityId,
        pinned_at: new Date().toISOString(),
      }, { onConflict: 'user_id,activity_id' });
    if (error) throw error;
  } else {
    const { error } = await client
      .from('activity_pins')
      .delete()
      .eq('user_id', authUser.id)
      .eq('activity_id', activityId);
    if (error) throw error;
  }
}

function setAuthFeedback(message = '', tone = 'info'){
  if (!authFeedbackEl) return;
  const toneClasses = {
    info: 'text-white/80',
    success: 'text-emerald-200',
    warning: 'text-amber-200',
    error: 'text-rose-200',
  };
  authFeedbackEl.classList.remove('text-white/80', 'text-emerald-200', 'text-amber-200', 'text-rose-200');
  if (!message){
    authFeedbackEl.textContent = '';
    authFeedbackEl.classList.add('hidden');
    return;
  }
  authFeedbackEl.classList.remove('hidden');
  authFeedbackEl.classList.add(toneClasses[tone] || toneClasses.info);
  authFeedbackEl.textContent = message;
}

function updateAuthUI(user){
  const isSignedIn = Boolean(user);
  if (authForm) authForm.classList.toggle('hidden', isSignedIn);
  if (signOutBtn) signOutBtn.classList.toggle('hidden', !isSignedIn);
  if (userBadge) userBadge.classList.toggle('hidden', !isSignedIn);
  if (isSignedIn){
    const email = user?.email || '';
    if (userBadgeEmail) userBadgeEmail.textContent = email;
    if (userBadgeInitial) userBadgeInitial.textContent = email ? email.charAt(0).toUpperCase() : 'U';
  } else if (authEmailInput){
    authEmailInput.value = '';
  }
}

function escapeIlike(term){
  return term.replace(/[%_,]/g, (match) => `\\${match}`);
}

async function loadActivities({ subject, phase, search, pinnedOnly } = {}){
  const client = supabaseClient || await ensureSupabase();
  if (!client) return [];
  await waitForInitialAuth();
  let pinnedIds = new Set();
  if (authUser?.id){
    pinnedIds = await ensureActivityPins();
  }
  const filterPinned = Boolean(pinnedOnly && authUser?.id);
  if (filterPinned && pinnedIds.size === 0){
    return [];
  }
  let query = client
    .from('activities')
    .select('id,title,subject,phase,description,url,keywords')
    .order('title', { ascending: true });
  if (filterPinned){
    query = query.in('id', Array.from(pinnedIds));
  }
  if (subject && subject !== 'all'){
    query = query.eq('subject', subject);
  }
  if (phase && phase !== 'any'){
    query = query.eq('phase', phase);
  }
  if (search && search.trim()){
    const pattern = `%${escapeIlike(search.trim())}%`;
    query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const items = Array.isArray(data) ? data : [];
  if (!authUser?.id){
    return items.map((item) => ({ ...item, pinned: false }));
  }
  return items.map((item) => ({ ...item, pinned: pinnedIds.has(item.id) }));
}

async function addActivity(record = {}){
  const client = await ensureSupabase();
  if (!client) throw new Error('Supabase client not available');
  const subject = typeof record.subject === 'string' && ACTIVITY_SUBJECTS.has(record.subject) ? record.subject : null;
  const phase = typeof record.phase === 'string' && ACTIVITY_PHASES.has(record.phase) ? record.phase : null;
  const keywords = Array.isArray(record.keywords)
    ? record.keywords.map((kw) => String(kw).trim()).filter(Boolean)
    : [];
  const payload = {
    title: typeof record.title === 'string' ? record.title : '',
    subject,
    phase,
    description: typeof record.description === 'string' ? record.description : '',
    url: typeof record.url === 'string' ? record.url : '',
    keywords,
  };
  if (authUser?.id){
    payload.created_by = authUser.id;
  }
  if (record.id) payload.id = record.id;
  const { data, error } = await client
    .from('activities')
    .insert(payload)
    .select('id,title,subject,phase,description,url,keywords,created_by')
    .single();
  if (error) throw error;
  resourcesController?.refresh();
  return data;
}

async function upsertProfile(user){
  if (!supabaseClient || !user) return;
  try {
    await supabaseClient
      .from('profiles')
      .upsert({ id: user.id, email: user.email || '' }, { onConflict: 'id' });
  } catch (error) {
    console.error('Profile upsert failed', error);
  }
}

async function handleAuthStateChange(event, session){
  const nextUser = session?.user ?? null;
  const previousUserId = authUser?.id || null;
  const nextUserId = nextUser?.id || null;
  const userChanged = previousUserId !== nextUserId;
  authUser = nextUser;
  if (userChanged){
    resetActivityPins();
  }
  updateAuthUI(authUser);
  if (authUser) {
    await upsertProfile(authUser);
  }
  if (event === 'SIGNED_IN' && authUser?.email){
    setAuthFeedback(`Signed in as ${authUser.email}`, 'success');
  } else if (event === 'SIGNED_OUT') {
    setAuthFeedback('Signed out.', 'info');
  }
  resourcesController?.handleAuthChange(authUser);
  if (userChanged){
    resourcesController?.refresh({ showLoading: true });
  } else {
    resourcesController?.refresh();
  }
  markInitialAuthReady();
}

if (authForm) {
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = authEmailInput?.value?.trim();
    if (!email) {
      setAuthFeedback('Enter your email address to sign in.', 'warning');
      authEmailInput?.focus();
      return;
    }
    if (signInBtn) {
      signInBtn.disabled = true;
      signInBtn.textContent = 'Sending…';
    }
    try {
      const client = await ensureSupabase();
      if (!client) {
        setAuthFeedback('Supabase is not configured yet.', 'warning');
        return;
      }
      const redirectTo = typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : undefined;
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setAuthFeedback(`Magic link sent to ${email}. Check your inbox.`, 'success');
    } catch (error) {
      console.error('Supabase sign-in failed', error);
      setAuthFeedback(error?.message || 'Unable to send sign-in link right now.', 'error');
    } finally {
      if (signInBtn) {
        signInBtn.disabled = false;
        signInBtn.textContent = signInDefaultLabel;
      }
    }
  });
}

signOutBtn?.addEventListener('click', async () => {
  const client = await ensureSupabase();
  if (!client) return;
  signOutBtn.disabled = true;
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.error('Supabase sign-out failed', error);
    setAuthFeedback('Unable to sign out right now.', 'error');
  } finally {
    signOutBtn.disabled = false;
  }
});

if (!hasSupabaseConfig) {
  authEmailInput?.setAttribute('disabled', 'true');
  signInBtn?.setAttribute('disabled', 'true');
  setAuthFeedback('Configure Supabase environment keys to enable sign-in and activities.', 'warning');
} else {
  ensureSupabase().catch((error) => {
    console.error('Supabase load failed', error);
    setAuthFeedback('Unable to initialise Supabase right now.', 'error');
  });
}

if (typeof window !== 'undefined') {
  window.memoryCueResources = {
    loadActivities,
    addActivity,
    refresh: () => resourcesController?.refresh(),
  };
}

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');

function updateThemeToggleState(isDark){
  if (!themeToggle) return;
  const iconDark = themeToggle.dataset.iconDark || '🌙';
  const iconLight = themeToggle.dataset.iconLight || '☀️';
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.textContent = isDark ? iconLight : iconDark;
  themeToggle.setAttribute('aria-label', isDark ? 'Activate light mode' : 'Activate dark mode');
}

function setTheme(t){
  document.documentElement.classList.toggle('dark', t === 'dark');
  localStorage.setItem('theme', t);
}

function toggleTheme(){
  const isPressed = themeToggle?.getAttribute('aria-pressed') === 'true';
  const isDark = themeToggle ? isPressed : document.documentElement.classList.contains('dark');
  const nextIsDark = !isDark;
  setTheme(nextIsDark ? 'dark' : 'light');
  updateThemeToggleState(nextIsDark);
}

themeToggle?.addEventListener('click', toggleTheme);
const preferred = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
setTheme(preferred);
updateThemeToggleState(preferred === 'dark');

// Date utilities shared across planner and notes
function toDateKey(date){
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Dashboard overview controller
const dashboardController = (() => {
  const lessonListEl = document.getElementById('dashboard-lessons-list');
  const deadlinesListEl = document.getElementById('dashboard-deadlines-list');
  const remindersListEl = document.getElementById('dashboard-reminders-list');
  const lessonsSkeletonEl = document.getElementById('dashboard-lessons-skeleton');
  const deadlinesSkeletonEl = document.getElementById('dashboard-deadlines-skeleton');
  const remindersSkeletonEl = document.getElementById('dashboard-reminders-skeleton');
  const weatherStatusEl = document.getElementById('weather-status');
  const weatherSkeletonEl = document.getElementById('weather-skeleton');
  const activityContainerEl = document.getElementById('dashboard-activity-container');
  const activityListEl = document.getElementById('dashboard-activity-list');
  const activityLoadingEl = document.getElementById('dashboard-activity-loading');
  const activityEmptyEl = document.getElementById('dashboard-activity-empty');
  const hiddenTrayEl = document.getElementById('dashboard-hidden-tray');
  const hiddenListEl = document.getElementById('dashboard-hidden-list');
  const hiddenRestoreAllBtn = document.getElementById('dashboard-show-all');

  const hasDashboard = lessonListEl
    || deadlinesListEl
    || remindersListEl
    || weatherStatusEl
    || activityContainerEl
    || activityListEl
    || activityLoadingEl
    || activityEmptyEl;
  const locale = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-AU';

  const headlineFormatter = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeFormatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const longTimeFormatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const activityTimestampFormatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const hasActivityFeed = Boolean(activityContainerEl || activityListEl || activityLoadingEl || activityEmptyEl);
  const ACTIVITY_MAX_ITEMS = 7;
  const activityState = { ready: false, items: [] };
  const activityIconMap = {
    lesson: '📚',
    deadline: '⏰',
    reminder: '🔔',
    planner: '🗓️',
    note: '📝',
    weather: '🌦️',
    general: '✨',
  };
  const activityViewLabels = {
    dashboard: 'Dashboard',
    reminders: 'Reminders',
    planner: 'Planner',
    notes: 'Notes',
    resources: 'Resources',
    templates: 'Templates',
    settings: 'Settings',
  };
  const dayLabelFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' });

  const dateEl = document.getElementById('dashboard-date');
  if (dateEl) {
    dateEl.textContent = headlineFormatter.format(new Date());
  }

  if (!hasDashboard) {
    return null;
  }

  const dashboardAreas = [...document.querySelectorAll('[data-dashboard-area]')];
  const widgetElements = new Map();
  dashboardAreas.forEach((area) => {
    area.querySelectorAll('[data-dashboard-widget]').forEach((widget) => {
      const widgetId = widget.dataset.dashboardWidget;
      if (!widgetId) return;
      widgetElements.set(widgetId, widget);
    });
  });

  const widgetLabels = {};
  widgetElements.forEach((el, id) => {
    const label = el.dataset.widgetTitle || el.querySelector('h2')?.textContent?.trim() || id;
    widgetLabels[id] = label;
  });

  const DASHBOARD_PREF_KEY = 'memoryCue.dashboardPreferences.v1';
  let dashboardPreferences = null;

  function getDefaultDashboardPreferences(){
    const areas = {};
    const widgets = {};
    dashboardAreas.forEach((area) => {
      const areaId = area.dataset.dashboardArea || 'default';
      const order = [];
      area.querySelectorAll('[data-dashboard-widget]').forEach((widget) => {
        const widgetId = widget.dataset.dashboardWidget;
        if (!widgetId) return;
        order.push(widgetId);
        widgets[widgetId] = { collapsed: false, hidden: false };
      });
      areas[areaId] = order;
    });
    return { version: 1, areas, widgets };
  }

  function loadDashboardPreferences(){
    const defaults = getDefaultDashboardPreferences();
    const stored = safeRead(DASHBOARD_PREF_KEY);
    if (!stored || stored.version !== defaults.version) {
      return defaults;
    }
    const preferences = { version: defaults.version, areas: {}, widgets: { ...defaults.widgets } };
    const storedAreas = (stored && typeof stored.areas === 'object') ? stored.areas : {};
    dashboardAreas.forEach((area) => {
      const areaId = area.dataset.dashboardArea || 'default';
      const defaultOrder = defaults.areas[areaId] || [];
      const storedOrder = Array.isArray(storedAreas[areaId]) ? storedAreas[areaId] : [];
      const mergedOrder = [];
      storedOrder.forEach((id) => {
        if (defaultOrder.includes(id) && !mergedOrder.includes(id)) {
          mergedOrder.push(id);
        }
      });
      defaultOrder.forEach((id) => {
        if (!mergedOrder.includes(id)) mergedOrder.push(id);
      });
      preferences.areas[areaId] = mergedOrder;
    });
    const storedWidgets = (stored && typeof stored.widgets === 'object') ? stored.widgets : {};
    Object.keys(defaults.widgets).forEach((id) => {
      const entry = storedWidgets[id];
      preferences.widgets[id] = {
        collapsed: Boolean(entry?.collapsed),
        hidden: Boolean(entry?.hidden),
      };
    });
    return preferences;
  }

  function saveDashboardPreferences(){
    if (!dashboardPreferences) return;
    safeWrite(DASHBOARD_PREF_KEY, dashboardPreferences);
  }

  function ensureWidgetState(widgetId){
    if (!dashboardPreferences.widgets[widgetId]) {
      dashboardPreferences.widgets[widgetId] = { collapsed: false, hidden: false };
    }
    return dashboardPreferences.widgets[widgetId];
  }

  function getAreaId(widgetId){
    const el = widgetElements.get(widgetId);
    if (!el) return null;
    const area = el.closest('[data-dashboard-area]');
    return area ? (area.dataset.dashboardArea || 'default') : null;
  }

  function applyAreaOrder(areaId){
    const area = dashboardAreas.find(item => (item.dataset.dashboardArea || 'default') === areaId);
    if (!area) return;
    const order = dashboardPreferences.areas[areaId] || [];
    const nodes = Array.from(area.querySelectorAll('[data-dashboard-widget]'));
    const nodeMap = new Map(nodes.map(node => [node.dataset.dashboardWidget, node]));
    order.forEach((widgetId) => {
      const node = nodeMap.get(widgetId);
      if (node) area.appendChild(node);
    });
    nodes.forEach((node) => {
      const widgetId = node.dataset.dashboardWidget;
      if (!order.includes(widgetId)) {
        area.appendChild(node);
      }
    });
  }

  function applyWidgetState(widgetId){
    const el = widgetElements.get(widgetId);
    if (!el) return;
    const state = ensureWidgetState(widgetId);
    const collapsed = Boolean(state.collapsed);
    const body = el.querySelector('[data-widget-body]');
    if (body) {
      body.hidden = collapsed;
      if (collapsed) {
        body.setAttribute('aria-hidden', 'true');
      } else {
        body.removeAttribute('aria-hidden');
      }
    }
    el.dataset.collapsed = collapsed ? 'true' : 'false';
    const collapseBtn = el.querySelector('[data-widget-action="collapse"]');
    if (collapseBtn) {
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const icon = collapseBtn.querySelector('[data-icon]');
      if (icon) icon.textContent = collapsed ? '+' : '−';
      const sr = collapseBtn.querySelector('.sr-only');
      if (sr) sr.textContent = collapsed ? 'Expand widget' : 'Collapse widget';
      collapseBtn.setAttribute('title', collapsed ? 'Expand widget' : 'Collapse widget');
    }
    const hidden = Boolean(state.hidden);
    el.classList.toggle('hidden', hidden);
    if (hidden) {
      el.setAttribute('aria-hidden', 'true');
      el.dataset.widgetHidden = 'true';
    } else {
      el.removeAttribute('aria-hidden');
      el.dataset.widgetHidden = 'false';
    }
  }

  function applyDashboardPreferences(){
    dashboardAreas.forEach((area) => {
      const areaId = area.dataset.dashboardArea || 'default';
      applyAreaOrder(areaId);
    });
    widgetElements.forEach((_, widgetId) => {
      applyWidgetState(widgetId);
    });
    updateHiddenTray();
    updateMoveButtonStates();
  }

  function updateHiddenTray(){
    if (!hiddenTrayEl || !hiddenListEl) return;
    hiddenListEl.replaceChildren();
    const hiddenEntries = Object.entries(dashboardPreferences.widgets)
      .filter(([, value]) => Boolean(value && value.hidden));
    if (!hiddenEntries.length) {
      hiddenTrayEl.classList.add('hidden');
      hiddenRestoreAllBtn?.classList.add('hidden');
      return;
    }
    hiddenTrayEl.classList.remove('hidden');
    hiddenEntries.forEach(([widgetId]) => {
      const label = widgetLabels[widgetId] || widgetId;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.widgetRestore = widgetId;
      button.className = 'inline-flex items-center gap-2 rounded-full bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600';
      button.innerHTML = `<span aria-hidden="true">↩︎</span> ${label}`;
      hiddenListEl.appendChild(button);
    });
    if (hiddenRestoreAllBtn) {
      hiddenRestoreAllBtn.classList.remove('hidden');
    }
  }

  function updateMoveButtonStates(){
    dashboardAreas.forEach((area) => {
      const areaId = area.dataset.dashboardArea || 'default';
      const order = dashboardPreferences.areas[areaId] || [];
      const visible = order.filter(id => !ensureWidgetState(id).hidden);
      visible.forEach((widgetId, index) => {
        const el = widgetElements.get(widgetId);
        if (!el) return;
        const upBtn = el.querySelector('[data-widget-action="move-up"]');
        const downBtn = el.querySelector('[data-widget-action="move-down"]');
        if (upBtn) upBtn.disabled = index === 0;
        if (downBtn) downBtn.disabled = index === visible.length - 1;
      });
    });
  }

  function moveWidget(widgetId, direction){
    const areaId = getAreaId(widgetId);
    if (!areaId) return;
    const order = dashboardPreferences.areas[areaId] || [];
    const visible = order.filter(id => !ensureWidgetState(id).hidden);
    const currentIndex = visible.indexOf(widgetId);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= visible.length) return;
    const swapId = visible[targetIndex];
    const currentOrderIndex = order.indexOf(widgetId);
    const swapOrderIndex = order.indexOf(swapId);
    if (currentOrderIndex === -1 || swapOrderIndex === -1) return;
    order[currentOrderIndex] = swapId;
    order[swapOrderIndex] = widgetId;
    applyAreaOrder(areaId);
    saveDashboardPreferences();
    updateMoveButtonStates();
  }

  function restoreWidget(widgetId){
    const state = ensureWidgetState(widgetId);
    state.hidden = false;
    applyWidgetState(widgetId);
    const areaId = getAreaId(widgetId);
    if (areaId) applyAreaOrder(areaId);
    saveDashboardPreferences();
    updateHiddenTray();
    updateMoveButtonStates();
    const el = widgetElements.get(widgetId);
    if (el) {
      addEnterAnimation(el);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function setupWidgetControls(widgetId){
    ensureWidgetState(widgetId);
    const el = widgetElements.get(widgetId);
    if (!el) return;
    const collapseBtn = el.querySelector('[data-widget-action="collapse"]');
    const hideBtn = el.querySelector('[data-widget-action="hide"]');
    const moveUpBtn = el.querySelector('[data-widget-action="move-up"]');
    const moveDownBtn = el.querySelector('[data-widget-action="move-down"]');
    collapseBtn?.addEventListener('click', () => {
      const state = ensureWidgetState(widgetId);
      state.collapsed = !state.collapsed;
      applyWidgetState(widgetId);
      saveDashboardPreferences();
    });
    hideBtn?.addEventListener('click', () => {
      const state = ensureWidgetState(widgetId);
      state.hidden = true;
      applyWidgetState(widgetId);
      saveDashboardPreferences();
      updateHiddenTray();
      updateMoveButtonStates();
    });
    moveUpBtn?.addEventListener('click', () => moveWidget(widgetId, -1));
    moveDownBtn?.addEventListener('click', () => moveWidget(widgetId, 1));
  }

  dashboardPreferences = loadDashboardPreferences();
  widgetElements.forEach((_, widgetId) => {
    setupWidgetControls(widgetId);
  });
  applyDashboardPreferences();
  saveDashboardPreferences();

  hiddenListEl?.addEventListener('click', (event) => {
    const restoreBtn = event.target.closest('[data-widget-restore]');
    if (!restoreBtn) return;
    restoreWidget(restoreBtn.dataset.widgetRestore);
  });

  hiddenRestoreAllBtn?.addEventListener('click', () => {
    Object.keys(dashboardPreferences.widgets).forEach((widgetId) => {
      const state = ensureWidgetState(widgetId);
      state.hidden = false;
    });
    applyDashboardPreferences();
    saveDashboardPreferences();
  });

  const LESSON_STORAGE_KEY = 'memoryCue.dashboardLessons.v1';
  const DEADLINE_STORAGE_KEY = 'memoryCue.dashboardDeadlines.v1';
  const WEATHER_CODE_MAP = {
    0: { icon: '☀️', label: 'Clear sky' },
    1: { icon: '🌤️', label: 'Mostly clear' },
    2: { icon: '⛅️', label: 'Partly cloudy' },
    3: { icon: '☁️', label: 'Overcast' },
    45: { icon: '🌫️', label: 'Foggy' },
    48: { icon: '🌫️', label: 'Ice fog' },
    51: { icon: '🌦️', label: 'Light drizzle' },
    53: { icon: '🌦️', label: 'Drizzle' },
    55: { icon: '🌧️', label: 'Heavy drizzle' },
    56: { icon: '🌧️', label: 'Freezing drizzle' },
    57: { icon: '🌧️', label: 'Freezing drizzle' },
    61: { icon: '🌧️', label: 'Light rain' },
    63: { icon: '🌧️', label: 'Rain showers' },
    65: { icon: '🌧️', label: 'Heavy rain' },
    66: { icon: '🌧️', label: 'Freezing rain' },
    67: { icon: '🌧️', label: 'Freezing rain' },
    71: { icon: '🌨️', label: 'Light snow' },
    73: { icon: '🌨️', label: 'Snow' },
    75: { icon: '❄️', label: 'Heavy snow' },
    77: { icon: '❄️', label: 'Snow grains' },
    80: { icon: '🌦️', label: 'Light showers' },
    81: { icon: '🌧️', label: 'Showers' },
    82: { icon: '⛈️', label: 'Heavy showers' },
    85: { icon: '🌨️', label: 'Snow showers' },
    86: { icon: '🌨️', label: 'Heavy snow showers' },
    95: { icon: '⛈️', label: 'Thunderstorm' },
    96: { icon: '⛈️', label: 'Thunderstorm & hail' },
    99: { icon: '⛈️', label: 'Thunderstorm & hail' },
    default: { icon: 'ℹ️', label: 'Weather update' },
  };

  const overviewLessonCountEl = document.getElementById('dashboard-lesson-count');
  const overviewDeadlineCountEl = document.getElementById('dashboard-deadline-count');
  const overviewReminderCountEl = document.getElementById('dashboard-reminder-count');
  const nextLessonEl = document.getElementById('dashboard-next-lesson');
  const lessonStatusEl = document.getElementById('dashboard-lesson-status');
  const lessonsEmptyEl = document.getElementById('dashboard-lessons-empty');
  const lessonFeedbackEl = document.getElementById('lesson-feedback');
  const deadlinesEmptyEl = document.getElementById('dashboard-deadlines-empty');
  const deadlineFeedbackEl = document.getElementById('deadline-feedback');
  const remindersEmptyEl = document.getElementById('dashboard-reminders-empty');
  const weatherSummaryEl = document.getElementById('weather-summary');
  const weatherIconEl = document.getElementById('weather-icon');
  const weatherTempEl = document.getElementById('weather-temperature');
  const weatherDescEl = document.getElementById('weather-description');
  const weatherLocationEl = document.getElementById('weather-location');
  const weatherWindEl = document.getElementById('weather-wind');
  const weatherRainEl = document.getElementById('weather-rain');
  const weatherSunsetEl = document.getElementById('weather-sunset');
  const weatherFootnoteEl = document.getElementById('weather-footnote');
  const weatherRefreshBtn = document.getElementById('weather-refresh');

  const lessonForm = document.getElementById('lesson-form');
  const lessonSubjectInput = document.getElementById('lesson-subject');
  const lessonStartInput = document.getElementById('lesson-start');
  const lessonEndInput = document.getElementById('lesson-end');
  const lessonLocationInput = document.getElementById('lesson-location');

  const deadlineForm = document.getElementById('deadline-form');
  const deadlineTitleInput = document.getElementById('deadline-title');
  const deadlineDueInput = document.getElementById('deadline-due');
  const deadlineCourseInput = document.getElementById('deadline-course');

  const counts = { lessons: 0, deadlines: 0, reminders: 0 };
  let lessonFeedbackTimer = null;
  let deadlineFeedbackTimer = null;
  let isFetchingWeather = false;

  function addEnterAnimation(el, className = 'animate-widget-pop'){
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    el.addEventListener('animationend', () => {
      el.classList.remove(className);
    }, { once: true });
  }

  function bumpElement(el){
    if (!el) return;
    el.classList.remove('dashboard-bump');
    void el.offsetWidth;
    el.classList.add('dashboard-bump');
  }

  function randomId(prefix = 'id'){
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function safeRead(key){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function safeWrite(key, value){
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage write failures (private browsing, etc.)
    }
  }

  function createLesson(start, end, subject, location, focus = ''){
    return { id: randomId('lesson'), start, end, subject, location: location || '', focus };
  }

  function createDeadline(baseDate, offsetDays, hour, minute, title, course, notes = ''){
    const due = new Date(baseDate);
    due.setHours(0, 0, 0, 0);
    due.setDate(due.getDate() + offsetDays);
    due.setHours(hour, minute, 0, 0);
    return {
      id: randomId('deadline'),
      title,
      due: due.toISOString(),
      course: course || '',
      notes,
      done: false,
    };
  }

  function seedLessons(){
    const today = new Date();
    const key = toDateKey(today);
    return {
      [key]: [
        createLesson('08:45', '09:30', 'Year 8 Science', 'Lab 2', 'Energy transfer experiment'),
        createLesson('10:15', '11:00', 'Year 10 English', 'Room 14', 'Draft persuasive speech feedback'),
        createLesson('11:45', '12:30', 'Year 7 Pastoral Care', 'Outdoor court', 'Team-building circuits'),
        createLesson('14:15', '15:00', 'Faculty collaboration', 'Library hub', 'Moderate assessment rubrics'),
      ],
    };
  }

  function seedDeadlines(){
    const now = new Date();
    return [
      createDeadline(now, 1, 15, 30, 'Year 9 research outlines', '9A Humanities', 'Collect drafts and provide quick feedback.'),
      createDeadline(now, 3, 9, 0, 'Staff PD reflection summary', 'Faculty', 'Submit summary to head of department.'),
      createDeadline(now, 6, 12, 0, 'Newsletter highlights due', 'Whole school', 'Share classroom wins and reminders.'),
    ];
  }

  function loadLessons(){
    const stored = safeRead(LESSON_STORAGE_KEY);
    if (stored && typeof stored === 'object' && stored.byDate) {
      return stored;
    }
    const seeded = { version: 1, byDate: seedLessons() };
    safeWrite(LESSON_STORAGE_KEY, seeded);
    return seeded;
  }

  function loadDeadlines(){
    const stored = safeRead(DEADLINE_STORAGE_KEY);
    if (stored && Array.isArray(stored.items)) {
      return stored;
    }
    const seeded = { version: 1, items: seedDeadlines() };
    safeWrite(DEADLINE_STORAGE_KEY, seeded);
    return seeded;
  }

  let lessonsState = loadLessons();
  let deadlinesState = loadDeadlines();
  let remindersState = [];

  function saveLessons(){
    safeWrite(LESSON_STORAGE_KEY, lessonsState);
  }

  function saveDeadlines(){
    safeWrite(DEADLINE_STORAGE_KEY, deadlinesState);
  }

  function setFeedbackMessage(el, text, variant = 'info'){
    if (!el) return;
    const colorClasses = ['text-emerald-600', 'text-rose-600', 'text-slate-500'];
    colorClasses.forEach(cls => el.classList.remove(cls));
    if (!text){
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    const variantClass = variant === 'success'
      ? 'text-emerald-600'
      : variant === 'error'
        ? 'text-rose-600'
        : 'text-slate-500';
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.add(variantClass);
  }

  function showLessonFeedback(message, variant){
    if (!lessonFeedbackEl) return;
    if (lessonFeedbackTimer) clearTimeout(lessonFeedbackTimer);
    setFeedbackMessage(lessonFeedbackEl, message, variant);
    if (message){
      lessonFeedbackTimer = setTimeout(() => {
        setFeedbackMessage(lessonFeedbackEl, '');
      }, 4000);
    }
  }

  function showDeadlineFeedback(message, variant){
    if (!deadlineFeedbackEl) return;
    if (deadlineFeedbackTimer) clearTimeout(deadlineFeedbackTimer);
    setFeedbackMessage(deadlineFeedbackEl, message, variant);
    if (message){
      deadlineFeedbackTimer = setTimeout(() => {
        setFeedbackMessage(deadlineFeedbackEl, '');
      }, 4000);
    }
  }

  function updateCounter(el, value){
    if (!el) return;
    const next = String(value);
    const previous = el.textContent;
    el.textContent = next;
    if (previous !== next) {
      bumpElement(el);
    }
  }

  function applyOverviewCounts(){
    updateCounter(overviewLessonCountEl, counts.lessons);
    updateCounter(overviewDeadlineCountEl, counts.deadlines);
    updateCounter(overviewReminderCountEl, counts.reminders);
  }

  function parseTimeToDate(baseDate, timeString){
    if (!timeString) return null;
    const [hourPart, minutePart] = timeString.split(':');
    const hour = Number.parseInt(hourPart, 10);
    const minute = Number.parseInt(minutePart, 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    const dt = new Date(baseDate);
    dt.setHours(hour, minute, 0, 0);
    return dt;
  }

  function minutesFromTimeString(timeString){
    if (!timeString) return Number.POSITIVE_INFINITY;
    const [hourPart, minutePart] = timeString.split(':');
    const hour = Number.parseInt(hourPart, 10);
    const minute = Number.parseInt(minutePart, 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return Number.POSITIVE_INFINITY;
    return hour * 60 + minute;
  }

  function formatDuration(ms){
    const abs = Math.abs(ms);
    const totalMinutes = Math.round(abs / 60000);
    if (totalMinutes < 1) return 'moments';
    if (totalMinutes < 60) return `${totalMinutes} min${totalMinutes === 1 ? '' : 's'}`;
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    if (totalHours >= 24){
      const days = Math.floor(totalHours / 24);
      const remainingHours = totalHours % 24;
      const dayLabel = `${days} day${days === 1 ? '' : 's'}`;
      if (days >= 7 || remainingHours === 0) return dayLabel;
      return `${dayLabel} ${remainingHours} hr${remainingHours === 1 ? '' : 's'}`;
    }
    const hourLabel = `${totalHours} hr${totalHours === 1 ? '' : 's'}`;
    if (!remainingMinutes) return hourLabel;
    return `${hourLabel} ${remainingMinutes} min`;
  }

  function buildLessonTimeLabel(dayDate, start, end){
    const startDate = parseTimeToDate(dayDate, start);
    const endDate = parseTimeToDate(dayDate, end);
    if (startDate && endDate){
      return `${longTimeFormatter.format(startDate)} – ${longTimeFormatter.format(endDate)}`;
    }
    if (startDate){
      return longTimeFormatter.format(startDate);
    }
    return '';
  }

  function badgeClassForTone(tone){
    switch (tone){
      case 'active':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200';
      case 'soon':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200';
      case 'future':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200';
      case 'past':
        return 'bg-slate-100 text-slate-500 dark:bg-slate-800/70 dark:text-slate-300';
      default:
        return 'bg-slate-100 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300';
    }
  }

  function formatLessonStatus(start, end, now){
    if (!start){
      return { label: 'Time to confirm', tone: 'neutral' };
    }
    if (now < start){
      const diff = start - now;
      return {
        label: `Starts in ${formatDuration(diff)}`,
        tone: diff <= 60 * 60 * 1000 ? 'soon' : 'future',
      };
    }
    if (end && now <= end){
      return { label: `In progress · ends ${longTimeFormatter.format(end)}`, tone: 'active' };
    }
    if (end){
      return { label: `Finished ${formatDuration(now - end)} ago`, tone: 'past' };
    }
    return { label: 'Completed', tone: 'past' };
  }

  function iconForActivity(type){
    return activityIconMap[type] || activityIconMap.general;
  }

  function viewLabel(view){
    if (!view) return '';
    if (activityViewLabels[view]) return activityViewLabels[view];
    if (typeof view === 'string' && view.length){
      return view.charAt(0).toUpperCase() + view.slice(1);
    }
    return '';
  }

  function normaliseActivityTarget(target){
    if (!target) return { view: DEFAULT_VIEW, anchor: null, selector: null };
    if (typeof target === 'string'){
      const trimmed = target.trim();
      if (!trimmed) return { view: DEFAULT_VIEW, anchor: null, selector: null };
      if (trimmed.startsWith('#')){
        return { view: DEFAULT_VIEW, anchor: trimmed, selector: trimmed };
      }
      if (trimmed.includes('#')){
        const [viewPart, anchorPart] = trimmed.split('#');
        const viewName = viewMap.has(viewPart) ? viewPart : DEFAULT_VIEW;
        const anchor = anchorPart ? `#${anchorPart}` : null;
        return { view: viewName, anchor, selector: anchor };
      }
      if (viewMap.has(trimmed)){
        return { view: trimmed, anchor: null, selector: null };
      }
      const selector = trimmed.startsWith('.') || trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      const anchor = selector.startsWith('#') ? selector : null;
      return { view: DEFAULT_VIEW, anchor, selector };
    }
    if (typeof target === 'object'){
      let viewName = null;
      if (typeof target.view === 'string' && viewMap.has(target.view)){
        viewName = target.view;
      } else if (typeof target.route === 'string' && viewMap.has(target.route)){
        viewName = target.route;
      } else if (typeof target.name === 'string' && viewMap.has(target.name)){
        viewName = target.name;
      } else if (typeof target.hash === 'string'){
        const candidate = target.hash.replace(/^#/, '');
        if (viewMap.has(candidate)) viewName = candidate;
      } else if (typeof target.href === 'string'){
        const candidate = target.href.replace(/^#/, '');
        if (viewMap.has(candidate)) viewName = candidate;
      }
      const finalView = viewName || DEFAULT_VIEW;
      const anchor = typeof target.anchor === 'string' ? target.anchor : (typeof target.hash === 'string' ? target.hash : null);
      const selector = typeof target.selector === 'string' ? target.selector : anchor;
      return { view: finalView, anchor: anchor || null, selector: selector || null };
    }
    return { view: DEFAULT_VIEW, anchor: null, selector: null };
  }

  function relativeActivityLabel(date){
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = now - date;
    if (Number.isNaN(diff)) return '';
    if (diff < 0) return 'Upcoming';
    if (diff < 45 * 1000) return 'Just now';
    return `${formatDuration(diff)} ago`;
  }

  function updateActivityEmptyState(){
    if (!hasActivityFeed) return;
    const hasItems = activityState.items.length > 0;
    if (activityListEl){
      activityListEl.classList.toggle('hidden', !hasItems);
    }
    if (activityEmptyEl){
      if (activityState.ready && !hasItems){
        activityEmptyEl.classList.remove('hidden');
      } else {
        activityEmptyEl.classList.add('hidden');
      }
    }
  }

  function ensureActivityReady(){
    if (!hasActivityFeed || activityState.ready) return;
    activityState.ready = true;
    if (activityLoadingEl) activityLoadingEl.classList.add('hidden');
    if (activityListEl) activityListEl.setAttribute('aria-busy', 'false');
    updateActivityEmptyState();
  }

  function updateActivityRelativeTimes(){
    if (!activityListEl) return;
    const nodes = activityListEl.querySelectorAll('[data-activity-relative-timestamp]');
    nodes.forEach((node) => {
      const iso = node.getAttribute('data-activity-relative-timestamp');
      if (!iso) return;
      const dt = new Date(iso);
      if (Number.isNaN(dt.getTime())) return;
      node.textContent = relativeActivityLabel(dt);
    });
  }

  function navigateToTarget(target){
    const normalized = normaliseActivityTarget(target);
    const viewName = normalized.view && viewMap.has(normalized.view) ? normalized.view : DEFAULT_VIEW;
    const selector = normalized.selector || normalized.anchor;
    const applyAnchor = () => {
      if (!selector) return;
      requestAnimationFrame(() => {
        const el = document.querySelector(selector);
        if (el && typeof el.scrollIntoView === 'function'){
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    };
    if (location.hash === `#${viewName}`){
      show(viewName);
      applyAnchor();
      return;
    }
    const onHashChange = () => {
      window.removeEventListener('hashchange', onHashChange);
      applyAnchor();
    };
    window.addEventListener('hashchange', onHashChange, { once: true });
    location.hash = `#${viewName}`;
  }

  function renderActivityList(){
    if (!activityListEl) return;
    const fragment = document.createDocumentFragment();
    activityState.items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'list-none';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'flex w-full items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 px-4 py-3 text-left transition hover:border-blue-300 hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';
      button.dataset.activityId = item.id;
      button.addEventListener('click', () => navigateToTarget(item.target));

      const iconEl = document.createElement('span');
      iconEl.className = 'text-xl leading-none';
      iconEl.textContent = item.icon;

      const content = document.createElement('div');
      content.className = 'flex-1 space-y-1';

      const labelEl = document.createElement('p');
      labelEl.className = 'text-sm font-semibold text-slate-900 dark:text-slate-100';
      labelEl.textContent = item.label;
      content.appendChild(labelEl);

      if (item.target && item.target.view){
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300';
        badge.textContent = viewLabel(item.target.view);
        content.appendChild(badge);
      }

      const meta = document.createElement('p');
      meta.className = 'text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1';

      const relativeEl = document.createElement('span');
      relativeEl.dataset.activityRelativeTimestamp = item.timestamp;
      relativeEl.textContent = relativeActivityLabel(item.date);
      meta.appendChild(relativeEl);

      const timeEl = document.createElement('time');
      timeEl.dateTime = item.timestamp;
      timeEl.textContent = activityTimestampFormatter.format(item.date);

      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '•';
      meta.append(dot, timeEl);

      content.appendChild(meta);

      button.append(iconEl, content);
      addEnterAnimation(button);
      li.appendChild(button);
      fragment.appendChild(li);
    });
    activityLoadingEl?.classList.add('hidden');
    activityListEl.classList.remove('hidden');
    activityListEl.setAttribute('aria-busy', 'false');
    activityListEl.replaceChildren(fragment);
    updateActivityEmptyState();
    updateActivityRelativeTimes();
  }

  function addActivityEntry(detail){
    if (!hasActivityFeed) return;
    const payload = normalizeActivityPayload(detail);
    if (!payload) return;
    ensureActivityReady();
    const entryDate = new Date(payload.timestamp);
    const entry = {
      id: payload.id,
      label: payload.label,
      type: payload.type || 'general',
      action: payload.action || 'update',
      timestamp: payload.timestamp,
      date: entryDate,
      icon: payload.icon || iconForActivity(payload.type),
      target: normaliseActivityTarget(payload.target),
    };
    const existingIndex = activityState.items.findIndex(item => item.id === entry.id);
    if (existingIndex !== -1){
      activityState.items.splice(existingIndex, 1);
    }
    activityState.items.unshift(entry);
    if (activityState.items.length > ACTIVITY_MAX_ITEMS){
      activityState.items.length = ACTIVITY_MAX_ITEMS;
    }
    renderActivityList();
  }

  if (hasActivityFeed){
    if (activityListEl) activityListEl.setAttribute('aria-busy', 'true');
    const pending = (typeof window !== 'undefined' && Array.isArray(window.memoryCueActivityQueue))
      ? window.memoryCueActivityQueue.slice(-ACTIVITY_MAX_ITEMS)
      : [];
    pending.forEach(addActivityEntry);
    if (!activityState.ready){
      setTimeout(() => { ensureActivityReady(); }, 1200);
    } else {
      ensureActivityReady();
    }
    document.addEventListener(ACTIVITY_EVENT_NAME, (event) => {
      addActivityEntry(event?.detail);
    });
  }

  function renderLessons(){
    if (!lessonListEl) return;
    const today = new Date();
    const todayKey = toDateKey(today);
    const lessonArray = Array.isArray(lessonsState.byDate?.[todayKey]) ? lessonsState.byDate[todayKey].slice() : [];
    lessonArray.sort((a, b) => minutesFromTimeString(a.start) - minutesFromTimeString(b.start));

    lessonListEl.replaceChildren();
    if (lessonsSkeletonEl) lessonsSkeletonEl.classList.add('hidden');
    lessonListEl.classList.remove('hidden');
    lessonListEl.setAttribute('aria-busy', 'false');
    counts.lessons = lessonArray.length;
    applyOverviewCounts();

    if (lessonArray.length === 0){
      if (lessonsEmptyEl) lessonsEmptyEl.classList.remove('hidden');
      if (lessonStatusEl) lessonStatusEl.classList.add('hidden');
      if (nextLessonEl) nextLessonEl.textContent = '';
      lessonListEl.classList.add('hidden');
      return;
    }

    if (lessonsEmptyEl) lessonsEmptyEl.classList.add('hidden');

    const now = new Date();
    const fragment = document.createDocumentFragment();
    let completed = 0;
    let activeLesson = null;
    let upcomingLesson = null;

    lessonArray.forEach((lesson) => {
      const start = parseTimeToDate(today, lesson.start);
      const end = parseTimeToDate(today, lesson.end);

      if (end && now > end) {
        completed += 1;
      }

      if (start && end && start <= now && now <= end){
        if (!activeLesson || (start < activeLesson.start)){
          activeLesson = { lesson, start, end };
        }
      } else if (start && start > now){
        if (!upcomingLesson || start < upcomingLesson.start){
          upcomingLesson = { lesson, start, end };
        }
      }

      const status = formatLessonStatus(start, end, now);
      const li = document.createElement('li');
      li.className = 'flex flex-col gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 p-4 md:flex-row md:items-center md:justify-between';

      const details = document.createElement('div');
      details.className = 'space-y-1';
      const heading = document.createElement('p');
      heading.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
      heading.textContent = lesson.subject || 'Lesson';
      const meta = document.createElement('p');
      meta.className = 'text-sm text-slate-500 dark:text-slate-400';
      const timeLabel = buildLessonTimeLabel(today, lesson.start, lesson.end);
      const metaParts = [];
      if (timeLabel) metaParts.push(timeLabel);
      if (lesson.location) metaParts.push(lesson.location);
      meta.textContent = metaParts.join(' • ');
      details.append(heading, meta);
      if (lesson.focus){
        const focus = document.createElement('p');
        focus.className = 'text-sm text-slate-500 dark:text-slate-400';
        focus.textContent = lesson.focus;
        details.appendChild(focus);
      }

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-3 self-start md:self-auto';
      const statusBadge = document.createElement('span');
      statusBadge.className = `inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${badgeClassForTone(status.tone)}`;
      statusBadge.textContent = status.label;
      actions.appendChild(statusBadge);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'text-sm font-semibold text-rose-600 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        const current = lessonsState.byDate?.[todayKey];
        if (!Array.isArray(current)) return;
        lessonsState.byDate[todayKey] = current.filter(item => item.id !== lesson.id);
        saveLessons();
        const timeLabel = buildLessonTimeLabel(today, lesson.start, lesson.end);
        const removalParts = [lesson.subject || 'Lesson'];
        if (timeLabel) removalParts.push(timeLabel);
        if (lesson.location) removalParts.push(lesson.location);
        dispatchActivityEvent({
          type: 'lesson',
          action: 'deleted',
          label: `Lesson removed · ${removalParts.join(' • ')}`,
          target: { view: 'dashboard', anchor: '#lessons-heading' },
        });
        showLessonFeedback('Lesson removed from today.', 'success');
        renderLessons();
      });
      actions.appendChild(removeBtn);

      li.append(details, actions);
      addEnterAnimation(li);
      fragment.appendChild(li);
    });

    lessonListEl.appendChild(fragment);

    if (lessonStatusEl){
      lessonStatusEl.classList.remove('hidden');
      const finished = Math.min(completed, lessonArray.length);
      const text = `${finished} of ${lessonArray.length} complete`;
      const previous = lessonStatusEl.textContent;
      lessonStatusEl.textContent = text;
      if (previous !== text) {
        bumpElement(lessonStatusEl);
      }
    }

    if (nextLessonEl){
      if (activeLesson){
        const untilLabel = activeLesson.end ? longTimeFormatter.format(activeLesson.end) : longTimeFormatter.format(activeLesson.start);
        nextLessonEl.textContent = `Now: ${activeLesson.lesson.subject} until ${untilLabel}`;
      } else if (upcomingLesson){
        nextLessonEl.textContent = `Next: ${upcomingLesson.lesson.subject} at ${longTimeFormatter.format(upcomingLesson.start)}`;
      } else {
        nextLessonEl.textContent = 'All lessons are wrapped up for today.';
      }
    }
  }

  function renderDeadlines(){
    if (!deadlinesListEl) return;
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 7);
    windowEnd.setHours(23, 59, 59, 999);

    const all = Array.isArray(deadlinesState.items) ? deadlinesState.items : [];
    const upcoming = all.filter(item => !item.done && item.due).filter(item => {
      try {
        const dueDate = new Date(item.due);
        if (Number.isNaN(dueDate.getTime())) return false;
        return dueDate >= windowStart && dueDate <= windowEnd;
      } catch {
        return false;
      }
    });
    upcoming.sort((a, b) => new Date(a.due) - new Date(b.due));

    deadlinesListEl.replaceChildren();
    if (deadlinesSkeletonEl) deadlinesSkeletonEl.classList.add('hidden');
    deadlinesListEl.classList.remove('hidden');
    deadlinesListEl.setAttribute('aria-busy', 'false');
    counts.deadlines = upcoming.length;
    applyOverviewCounts();

    if (!upcoming.length){
      if (deadlinesEmptyEl) deadlinesEmptyEl.classList.remove('hidden');
      deadlinesListEl.classList.add('hidden');
      return;
    }

    if (deadlinesEmptyEl) deadlinesEmptyEl.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    upcoming.forEach((deadline) => {
      const due = new Date(deadline.due);
      const diff = due - now;
      const overdue = diff < 0;
      const highlightClass = overdue
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200'
        : diff <= 24 * 60 * 60 * 1000
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200';
      const statusLabel = overdue ? `Overdue by ${formatDuration(diff)}` : `Due in ${formatDuration(diff)}`;

      const li = document.createElement('li');
      li.className = 'rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 p-4';

      const top = document.createElement('div');
      top.className = 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between';

      const info = document.createElement('div');
      info.className = 'space-y-1';
      const title = document.createElement('p');
      title.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
      title.textContent = deadline.title || 'Deadline';
      const meta = document.createElement('p');
      meta.className = 'text-sm text-slate-500 dark:text-slate-400';
      const dueLabel = overdue ? `Was due ${dateTimeFormatter.format(due)}` : `Due ${dateTimeFormatter.format(due)}`;
      const metaPieces = [dueLabel];
      if (deadline.course) metaPieces.push(deadline.course);
      meta.textContent = metaPieces.join(' • ');
      info.append(title, meta);
      if (deadline.notes){
        const note = document.createElement('p');
        note.className = 'text-sm text-slate-500 dark:text-slate-400';
        note.textContent = deadline.notes;
        info.appendChild(note);
      }

      const actions = document.createElement('div');
      actions.className = 'flex flex-col items-start sm:items-end gap-3';
      const status = document.createElement('span');
      status.className = `inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${highlightClass}`;
      status.textContent = statusLabel;
      const completeBtn = document.createElement('button');
      completeBtn.type = 'button';
      completeBtn.className = 'text-sm font-semibold text-emerald-600 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500';
      completeBtn.textContent = 'Mark done';
      completeBtn.addEventListener('click', () => {
        const index = deadlinesState.items.findIndex(item => item.id === deadline.id);
        if (index === -1) return;
        deadlinesState.items[index].done = true;
        saveDeadlines();
        dispatchActivityEvent({
          type: 'deadline',
          action: 'completed',
          label: `Deadline completed · ${deadline.title || 'Deadline'}`,
          target: { view: 'dashboard', anchor: '#deadlines-heading' },
        });
        showDeadlineFeedback('Deadline marked as complete.', 'success');
        renderDeadlines();
      });
      actions.append(status, completeBtn);

      top.append(info, actions);
      li.appendChild(top);
      addEnterAnimation(li);
      fragment.appendChild(li);
    });

    deadlinesListEl.appendChild(fragment);
  }

  function renderReminders(){
    if (!remindersListEl) return;
    remindersListEl.replaceChildren();
    if (remindersSkeletonEl) remindersSkeletonEl.classList.add('hidden');
    remindersListEl.classList.remove('hidden');
    remindersListEl.setAttribute('aria-busy', 'false');
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const filtered = remindersState
      .filter(item => item && !item.done && item.due)
      .filter(item => {
        try {
          const dueDate = new Date(item.due);
          if (Number.isNaN(dueDate.getTime())) return false;
          return dueDate <= endOfDay;
        } catch {
          return false;
        }
      });

    filtered.sort((a, b) => new Date(a.due) - new Date(b.due));

    counts.reminders = filtered.length;
    applyOverviewCounts();

    if (!filtered.length){
      if (remindersEmptyEl) remindersEmptyEl.classList.remove('hidden');
      remindersListEl.classList.add('hidden');
      return;
    }

    if (remindersEmptyEl) remindersEmptyEl.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    filtered.slice(0, 6).forEach((reminder) => {
      const due = new Date(reminder.due);
      const diff = due - now;
      const overdue = diff < 0;
      const soon = !overdue && diff <= 60 * 60 * 1000;
      const highlightClass = overdue
        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-500/30'
        : soon
          ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30'
          : 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/30';
      let statusLabel = '';
      if (overdue){
        statusLabel = `Overdue by ${formatDuration(diff)}`;
      } else if (soon){
        statusLabel = `Due in ${formatDuration(diff)}`;
      } else {
        statusLabel = `Due today · ${timeFormatter.format(due)}`;
      }

      const li = document.createElement('li');
      li.className = 'rounded-xl border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900/50 p-4 shadow-sm';

      const header = document.createElement('div');
      header.className = 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between';

      const content = document.createElement('div');
      content.className = 'space-y-1';
      const title = document.createElement('p');
      title.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
      title.textContent = reminder.title || 'Reminder';
      const meta = document.createElement('p');
      meta.className = 'text-sm text-slate-500 dark:text-slate-400';
      const dueLabel = overdue
        ? `Was due ${dateTimeFormatter.format(due)}`
        : `Due ${timeFormatter.format(due)} (${dayLabelFormatter.format(due)})`;
      const metaParts = [dueLabel];
      if (reminder.priority) metaParts.push(`${reminder.priority} priority`);
      meta.textContent = metaParts.join(' • ');
      content.append(title, meta);
      if (reminder.notes){
        const [firstLine] = String(reminder.notes).split('\n');
        if (firstLine){
          const note = document.createElement('p');
          note.className = 'text-sm text-slate-500 dark:text-slate-400';
          note.textContent = firstLine;
          content.appendChild(note);
        }
      }

      const status = document.createElement('span');
      status.className = `inline-flex items-center rounded-md px-3 py-1 text-sm font-medium border ${highlightClass}`;
      status.textContent = statusLabel;

      header.append(content, status);
      li.appendChild(header);
      addEnterAnimation(li);
      fragment.appendChild(li);
    });

    remindersListEl.appendChild(fragment);
  }

  function handleLessonSubmit(event){
    event.preventDefault();
    if (!lessonSubjectInput || !lessonStartInput || !lessonEndInput) return;
    const subject = lessonSubjectInput.value.trim();
    const start = lessonStartInput.value;
    const end = lessonEndInput.value;
    if (!subject){
      showLessonFeedback('Add a lesson or group name first.', 'error');
      lessonSubjectInput.focus();
      return;
    }
    const startDate = parseTimeToDate(new Date(), start);
    const endDate = parseTimeToDate(new Date(), end);
    if (startDate && endDate && endDate <= startDate){
      showLessonFeedback('Finish time must be after the start time.', 'error');
      lessonEndInput.focus();
      return;
    }
    const todayKey = toDateKey(new Date());
    if (!Array.isArray(lessonsState.byDate?.[todayKey])){
      if (!lessonsState.byDate) lessonsState.byDate = {};
      lessonsState.byDate[todayKey] = [];
    }
    const locationValue = lessonLocationInput?.value.trim() || '';
    const newLesson = createLesson(start, end, subject, locationValue);
    lessonsState.byDate[todayKey].push(newLesson);
    saveLessons();
    const timeLabel = buildLessonTimeLabel(new Date(), start, end);
    const lessonParts = [subject];
    if (timeLabel) lessonParts.push(timeLabel);
    if (locationValue) lessonParts.push(locationValue);
    dispatchActivityEvent({
      type: 'lesson',
      action: 'created',
      label: `Lesson added · ${lessonParts.join(' • ')}`,
      target: { view: 'dashboard', anchor: '#lessons-heading' },
    });
    lessonForm?.reset();
    lessonSubjectInput.focus();
    showLessonFeedback('Lesson added to today.', 'success');
    renderLessons();
  }

  function handleDeadlineSubmit(event){
    event.preventDefault();
    if (!deadlineTitleInput || !deadlineDueInput) return;
    const title = deadlineTitleInput.value.trim();
    const dueValue = deadlineDueInput.value;
    if (!title){
      showDeadlineFeedback('Add a deadline title.', 'error');
      deadlineTitleInput.focus();
      return;
    }
    if (!dueValue){
      showDeadlineFeedback('Choose when this is due.', 'error');
      deadlineDueInput.focus();
      return;
    }
    const dueDate = new Date(dueValue);
    if (Number.isNaN(dueDate.getTime())){
      showDeadlineFeedback('Enter a valid due date and time.', 'error');
      deadlineDueInput.focus();
      return;
    }
    if (!Array.isArray(deadlinesState.items)){
      deadlinesState.items = [];
    }
    const courseValue = deadlineCourseInput?.value.trim() || '';
    const newDeadline = {
      id: randomId('deadline'),
      title,
      due: dueDate.toISOString(),
      course: courseValue,
      notes: '',
      done: false,
    };
    deadlinesState.items.push(newDeadline);
    saveDeadlines();
    dispatchActivityEvent({
      type: 'deadline',
      action: 'created',
      label: `Deadline added · ${title} (${dateTimeFormatter.format(dueDate)})`,
      target: { view: 'dashboard', anchor: '#deadlines-heading' },
    });
    deadlineForm?.reset();
    showDeadlineFeedback('Deadline saved for this week.', 'success');
    renderDeadlines();
  }

  function setWeatherStatus(text, variant = 'info'){
    if (!weatherStatusEl) return;
    weatherStatusEl.textContent = text;
    weatherStatusEl.classList.remove('text-rose-200', 'text-white/90', 'text-white/70', 'text-white/80');
    if (variant === 'error'){
      weatherStatusEl.classList.add('text-rose-200');
    } else if (variant === 'success'){
      weatherStatusEl.classList.add('text-white/90');
    } else {
      weatherStatusEl.classList.add('text-white/80');
    }
  }

  function getCurrentCoords(){
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation){
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => reject(err)
      );
    });
  }

  async function getLocationName(lat, lon){
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocode error ${res.status}`);
    const data = await res.json();
    return data.city || data.locality || data.principalSubdivision || 'Unknown location';
  }

  async function fetchWeather(latitude, longitude, place){
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      current_weather: 'true',
      daily: 'precipitation_probability_max,sunrise,sunset',
      timezone: 'auto',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok) throw new Error(`Weather error ${res.status}`);
    const data = await res.json();
    const locationLabel = place || 'Unknown location';
    renderWeather(data, locationLabel, { fallback: false });
    setWeatherStatus('Updated', 'success');
    return data;
  }

  function renderWeather(data, locationLabel, { fallback } = {}){
    if (!weatherSummaryEl) return;
    const current = data?.current_weather;
    if (!current) throw new Error('Weather data missing');
    if (weatherSkeletonEl) weatherSkeletonEl.classList.add('hidden');
    weatherSummaryEl.classList.remove('hidden');
    addEnterAnimation(weatherSummaryEl);
    const code = WEATHER_CODE_MAP[current.weathercode] || WEATHER_CODE_MAP.default;
    if (weatherIconEl) weatherIconEl.textContent = code.icon;
    if (weatherDescEl){
      const descriptor = locationLabel ? `${code.label} · ${locationLabel}` : code.label;
      weatherDescEl.textContent = descriptor;
    }
    if (weatherTempEl) weatherTempEl.textContent = `${Math.round(current.temperature)}°C`;
    if (weatherLocationEl) weatherLocationEl.textContent = locationLabel;
    if (weatherWindEl) weatherWindEl.textContent = `${Math.round(current.windspeed)} km/h`;
    if (weatherRainEl){
      const rain = data?.daily?.precipitation_probability_max?.[0];
      weatherRainEl.textContent = typeof rain === 'number' ? `${Math.round(rain)}%` : '—';
    }
    if (weatherSunsetEl){
      const sunsetIso = data?.daily?.sunset?.[0];
      weatherSunsetEl.textContent = sunsetIso ? longTimeFormatter.format(new Date(sunsetIso)) : '—';
    }
    if (weatherFootnoteEl){
      const updatedAt = current.time ? longTimeFormatter.format(new Date(current.time)) : longTimeFormatter.format(new Date());
      const notes = [`Updated ${updatedAt}`];
      if (fallback) notes.push('Default location');
      notes.push('Source: Open‑Meteo');
      weatherFootnoteEl.textContent = notes.join(' • ');
    }
  }

  async function initWeather(statusMessage = 'Finding your forecast…'){
    if (!weatherStatusEl) return;
    if (isFetchingWeather) return;
    isFetchingWeather = true;
    try {
      setWeatherStatus(statusMessage, 'info');
      weatherSkeletonEl?.classList.remove('hidden');
      weatherSummaryEl?.classList.add('hidden');

      const { latitude, longitude } = await getCurrentCoords();
      let place = 'Unknown location';
      try {
        place = await getLocationName(latitude, longitude);
      } catch (nameError) {
        console.warn('Reverse geocode failed', nameError);
      }
      await fetchWeather(latitude, longitude, place);
    } catch (err) {
      console.error('Weather init failed', err);
      setWeatherStatus('Location unavailable', 'error');
      weatherSkeletonEl?.classList.add('hidden');
      weatherSummaryEl?.classList.add('hidden');
    } finally {
      isFetchingWeather = false;
    }
  }

  if (lessonForm){
    lessonForm.addEventListener('submit', handleLessonSubmit);
  }

  if (deadlineForm){
    deadlineForm.addEventListener('submit', handleDeadlineSubmit);
  }

  if (weatherRefreshBtn){
    weatherRefreshBtn.addEventListener('click', () => {
      initWeather('Refreshing forecast…');
    });
  }

  renderLessons();
  renderDeadlines();
  renderReminders();
  initWeather();

  setInterval(() => {
    renderLessons();
    renderDeadlines();
    renderReminders();
    updateActivityRelativeTimes();
  }, 60 * 1000);

  setInterval(() => {
    initWeather('Updating forecast…');
  }, 30 * 60 * 1000);

  return {
    setReminders(items){
      remindersState = Array.isArray(items) ? items.map(item => ({ ...item })) : [];
      renderReminders();
    },
  };
})();

if (dashboardController) {
  document.addEventListener('memoryCue:remindersUpdated', (event) => {
    const detail = event?.detail;
    const items = Array.isArray(detail?.items) ? detail.items : [];
    dashboardController.setReminders(items);
  });
}

resourcesController = (() => {
  if (resourcesControllerAbort){
    resourcesControllerAbort.abort();
  }
  const section = document.getElementById('view-resources');
  if (!section) {
    resourcesControllerAbort = null;
    return null;
  }

  const log = createLogger('resources');
  const eventController = new AbortController();
  resourcesControllerAbort = eventController;
  const { signal } = eventController;

  log.debug('Initialising resources controller');

  const subjectButtons = [...section.querySelectorAll('[data-subject]')];
  const phaseButtons = [...section.querySelectorAll('[data-phase]')];
  const pinnedToggle = section.querySelector('#activity-pinned-toggle');
  const searchInput = section.querySelector('#activity-search');
  const ideaForm = section.querySelector('#idea-form');
  const ideaSubjectInput = section.querySelector('#idea-subject');
  const ideaPhaseInput = section.querySelector('#idea-phase');
  const ideaSubmitBtn = section.querySelector('#idea-save');
  const mineFilterBtn = section.querySelector('#filter-mine');
  const allFilterBtn = section.querySelector('#filter-all');
  const resultsGrid = section.querySelector('#activity-results');
  const emptyEl = section.querySelector('#activity-empty');
  const loadingEl = section.querySelector('#activity-loading');
  const statusEl = section.querySelector('#activity-status');
  const ideasButton = section.querySelector('#activity-ideas-button');
  const ideasButtonIcon = ideasButton?.querySelector('[data-idea-icon]') || null;
  const ideasButtonLabel = ideasButton?.querySelector('[data-idea-label]') || null;
  const ideaButtonDefaultIcon = ideasButtonIcon?.textContent?.trim() || '✨';
  const ideaButtonDefaultLabel = ideasButtonLabel?.textContent?.trim() || 'Get ideas';
  const ideasSection = section.querySelector('#activity-ideas');
  const ideasLoadingEl = section.querySelector('#activity-ideas-loading');
  const ideasList = section.querySelector('#activity-ideas-list');
  const ideasSummaryEl = section.querySelector('#activity-ideas-summary');
  const ideasClearBtn = section.querySelector('#activity-ideas-clear');
  const ideasEmptyEl = section.querySelector('#activity-ideas-empty');
  const ideaModalEl = document.getElementById('activity-ideas-modal');
  const ideaModalForm = document.getElementById('activity-ideas-form');
  const ideaModalSubject = ideaModalForm?.querySelector('[name="subject"]') || null;
  const ideaModalPhase = ideaModalForm?.querySelector('[name="phase"]') || null;
  const ideaModalNotes = ideaModalForm?.querySelector('[name="notes"]') || null;
  const closeIdeaModal = () => {
    if (!ideaModalEl) return;
    if (typeof ideaModalEl.closeActivityIdeasModal === 'function') {
      ideaModalEl.closeActivityIdeasModal();
      return;
    }
    ideaModalEl.classList.add('hidden');
    ideaModalEl.setAttribute('inert', '');
    ideaModalEl.setAttribute('aria-hidden', 'true');
  };

  const SUBJECT_ACTIVE_CLASSES = ['bg-emerald-500', 'border-emerald-500', 'text-white', 'shadow'];
  const SUBJECT_INACTIVE_CLASSES = ['bg-white/80', 'border-slate-200', 'dark:border-slate-700', 'text-slate-600', 'dark:text-slate-200'];
  const PHASE_ACTIVE_CLASSES = ['bg-blue-500', 'border-blue-500', 'text-white', 'shadow'];
  const PHASE_INACTIVE_CLASSES = ['bg-white/70', 'border-slate-200', 'dark:border-slate-700', 'text-slate-600', 'dark:text-slate-200'];
  const PIN_FILTER_ACTIVE_CLASSES = ['border-amber-400', 'bg-amber-100', 'text-amber-700', 'shadow', 'dark:border-amber-400', 'dark:bg-amber-500/20', 'dark:text-amber-200'];
  const PIN_FILTER_INACTIVE_CLASSES = ['border-slate-200', 'bg-white/80', 'text-slate-600', 'dark:border-slate-700', 'dark:bg-slate-900/40', 'dark:text-slate-200'];
  const PIN_FILTER_DISABLED_CLASSES = ['opacity-60', 'cursor-not-allowed'];
  const STATUS_TONE_CLASSES = {
    info: ['text-slate-500', 'dark:text-slate-400'],
    success: ['text-emerald-600', 'dark:text-emerald-300'],
    warning: ['text-amber-600', 'dark:text-amber-300'],
    error: ['text-rose-600', 'dark:text-rose-300'],
  };
  const ALL_STATUS_CLASSES = Object.values(STATUS_TONE_CLASSES).flat();
  const PINNED_PREF_STORAGE_KEY = 'memoryCue.resourcesPinnedPreference';
  const PIN_BUTTON_ACTIVE_CLASSES = ['border-amber-400', 'bg-amber-100', 'text-amber-700', 'dark:border-amber-400', 'dark:bg-amber-500/20', 'dark:text-amber-200'];
  const PIN_BUTTON_INACTIVE_CLASSES = ['border-slate-200', 'bg-white/70', 'text-slate-500', 'dark:border-slate-700', 'dark:bg-slate-900/40', 'dark:text-slate-300'];
  const PIN_BUTTON_PENDING_CLASSES = ['opacity-60'];
  const MINE_ACTIVE_CLASSES = ['border-emerald-400', 'bg-emerald-500', 'text-white', 'shadow', 'dark:border-emerald-400', 'dark:bg-emerald-500/20', 'dark:text-emerald-200'];
  const MINE_INACTIVE_CLASSES = ['border-slate-200', 'bg-white/80', 'text-slate-600', 'dark:border-slate-700', 'dark:bg-slate-900/40', 'dark:text-slate-200'];
  const MINE_DISABLED_CLASSES = ['opacity-60', 'cursor-not-allowed'];
  const TOAST_TONE_CLASSES = {
    info: ['bg-slate-900/90', 'text-white'],
    success: ['bg-emerald-600', 'text-white'],
    warning: ['bg-amber-400', 'text-slate-900'],
    error: ['bg-rose-600', 'text-white'],
  };
  const ALL_TOAST_CLASSES = Object.values(TOAST_TONE_CLASSES).flat();

  const ideaState = {
    items: [],
    loading: false,
    editingIndex: null,
    lastRequest: null,
    lastSelection: null,
    pendingFocus: null,
  };

  let ideaRequestController = null;
  const showToast = createToast();
  const state = {
    subject: subjectButtons.find(btn => btn.dataset.default === 'true')?.dataset.subject || 'all',
    phase: 'any',
    search: '',
    items: [],
    pinnedOnly: false,
    mineOnly: false,
  };

  const pendingPinUpdates = new Set();

  let searchDebounce = null;

  eventController.signal.addEventListener('abort', () => {
    if (searchDebounce) {
      window.clearTimeout(searchDebounce);
      searchDebounce = null;
    }
    if (ideaRequestController){
      ideaRequestController.abort();
      ideaRequestController = null;
    }
  });

  if (authUser?.id){
    state.pinnedOnly = loadPinnedFilterPreference(authUser.id);
  }

  function loadPinnedFilterPreference(userId){
    if (!userId || typeof localStorage === 'undefined') return false;
    try {
      const raw = localStorage.getItem(PINNED_PREF_STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, userId)){
        return Boolean(parsed[userId]);
      }
    } catch (error) {
      log.warn('Unable to load pinned filter preference', error);
    }
    return false;
  }

  function savePinnedFilterPreference(userId, value){
    if (!userId || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(PINNED_PREF_STORAGE_KEY);
      let parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') parsed = {};
      parsed[userId] = Boolean(value);
      localStorage.setItem(PINNED_PREF_STORAGE_KEY, JSON.stringify(parsed));
    } catch (error) {
      log.warn('Unable to persist pinned filter preference', error);
    }
  }

  function updatePinnedToggle(){
    if (!pinnedToggle) return;
    const canUsePinned = Boolean(authUser?.id);
    const isActive = Boolean(canUsePinned && state.pinnedOnly);
    pinnedToggle.setAttribute('aria-pressed', String(isActive));
    pinnedToggle.classList.remove(...PIN_FILTER_ACTIVE_CLASSES, ...PIN_FILTER_INACTIVE_CLASSES, ...PIN_FILTER_DISABLED_CLASSES);
    if (isActive){
      pinnedToggle.classList.add(...PIN_FILTER_ACTIVE_CLASSES);
    } else {
      pinnedToggle.classList.add(...PIN_FILTER_INACTIVE_CLASSES);
    }
    if (!canUsePinned){
      pinnedToggle.classList.add(...PIN_FILTER_DISABLED_CLASSES);
      pinnedToggle.setAttribute('aria-disabled', 'true');
      pinnedToggle.setAttribute('title', 'Sign in to view pinned activities');
    } else {
      pinnedToggle.removeAttribute('aria-disabled');
      pinnedToggle.setAttribute('title', isActive ? 'Showing pinned activities' : 'Show only pinned activities');
    }
  }

  function updateStatusMessage(){
    if (!statusEl) return;
    if (!supabaseClient) return;
    const filters = buildFilters(state);
    const showingMine = Boolean(state.mineOnly && authUser?.id);
    if (!state.items.length){
      if (showingMine){
        setStatus('No saved ideas yet. Use the form above to add one.', 'warning');
      } else if (state.mineOnly && !authUser?.id){
        setStatus('Sign in to view your saved ideas.', 'warning');
      } else if (filters.pinnedOnly && authUser?.id){
        setStatus('No pinned activities match your filters yet.', 'warning');
      } else if (filters.search || (filters.subject && filters.subject !== 'all') || filters.phase !== 'any'){
        setStatus('No activities match your filters yet.', 'warning');
      } else if (filters.pinnedOnly && !authUser?.id){
        setStatus('Sign in to view your pinned activities.', 'warning');
      } else {
        setStatus('No activities available yet.', 'warning');
      }
      return;
    }
    const label = state.items.length === 1 ? 'activity' : 'activities';
    if (filters.pinnedOnly && showingMine){
      setStatus(`Showing ${state.items.length} of your pinned ${label}.`, 'info');
      return;
    }
    if (filters.pinnedOnly && authUser?.id){
      setStatus(`Showing ${state.items.length} pinned ${label}.`, 'info');
      return;
    }
    if (showingMine){
      setStatus(`Showing ${state.items.length} of your ${label}.`, 'info');
      return;
    }
    setStatus(`Showing ${state.items.length} ${label}.`, 'info');
  }

  function applyPinButtonState(button, pinned, { pending } = {}){
    if (!button) return;
    const isPinned = Boolean(pinned);
    button.setAttribute('aria-pressed', String(isPinned));
    button.classList.remove(...PIN_BUTTON_ACTIVE_CLASSES, ...PIN_BUTTON_INACTIVE_CLASSES, ...PIN_BUTTON_PENDING_CLASSES);
    if (isPinned){
      button.classList.add(...PIN_BUTTON_ACTIVE_CLASSES);
    } else {
      button.classList.add(...PIN_BUTTON_INACTIVE_CLASSES);
    }
    const icon = button.querySelector('[data-pin-icon]');
    if (icon) icon.textContent = isPinned ? '★' : '☆';
    const activityTitle = button.dataset.activityTitle || 'activity';
    const srText = button.querySelector('[data-pin-label]');
    const actionLabel = isPinned ? 'Unpin' : 'Pin';
    if (srText){
      srText.textContent = `${actionLabel} ${activityTitle}`;
      button.setAttribute('aria-label', srText.textContent);
    } else {
      button.setAttribute('aria-label', `${actionLabel} activity`);
    }
    if (!authUser?.id){
      button.setAttribute('title', 'Sign in to pin');
      button.dataset.requiresAuth = 'true';
    } else {
      button.setAttribute('title', `${actionLabel} activity`);
      button.removeAttribute('data-requires-auth');
    }
    if (pending){
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('data-pin-pending', 'true');
      button.classList.add(...PIN_BUTTON_PENDING_CLASSES);
    } else {
      button.setAttribute('data-pin-pending', 'false');
      if (!authUser?.id){
        button.setAttribute('aria-disabled', 'true');
        button.classList.add(...PIN_BUTTON_PENDING_CLASSES);
      } else {
        button.removeAttribute('aria-disabled');
      }
    }
  }

  function applyActivityPinnedToState(activityId, pinned){
    if (!activityId) return;
    const index = state.items.findIndex((item) => item.id === activityId);
    if (index === -1) return;
    if (state.pinnedOnly && !pinned){
      state.items = state.items.filter((item) => item.id !== activityId);
      return;
    }
    const current = state.items[index];
    state.items[index] = { ...current, pinned: Boolean(pinned) };
  }

  async function handlePinButtonClick(event){
    const button = event.target.closest('[data-activity-pin]');
    if (!button) return;
    const activityId = button.dataset.activityPin;
    if (!activityId) return;
    if (!authUser?.id){
      setStatus('Sign in to pin activities for quick access.', 'warning');
      return;
    }
    if (pendingPinUpdates.has(activityId)) return;

    const nextPinned = !activityPinState.ids.has(activityId);
    log.debug('Pin toggle requested', { activityId, nextPinned });
    const previousPins = new Set(activityPinState.ids);
    const previousItems = state.items.map((item) => ({ ...item }));

    pendingPinUpdates.add(activityId);
    setActivityPinLocally(activityId, nextPinned);
    applyActivityPinnedToState(activityId, nextPinned);
    updateStatusMessage();
    render();

    let hadError = false;
    try {
      await togglePin(activityId, nextPinned);
    } catch (error) {
      hadError = true;
      activityPinState.ids = previousPins;
      state.items = previousItems;
      log.error('Activity pin toggle failed', error);
      setStatus('Unable to update pin right now.', 'error');
    } finally {
      pendingPinUpdates.delete(activityId);
      render();
    }
  }

  function setStatus(message = '', tone = 'info'){
    if (!statusEl) return;
    statusEl.classList.remove(...ALL_STATUS_CLASSES);
    if (!message){
      statusEl.textContent = '';
      statusEl.classList.add('hidden');
      return;
    }
    statusEl.classList.remove('hidden');
    const toneClasses = STATUS_TONE_CLASSES[tone] || STATUS_TONE_CLASSES.info;
    statusEl.classList.add(...toneClasses);
    statusEl.textContent = message;
  }

  function setLoading(flag){
    if (!loadingEl) return;
    if (flag){
      loadingEl.classList.remove('hidden');
      resultsGrid?.classList.add('hidden');
      emptyEl?.classList.add('hidden');
    } else {
      loadingEl.classList.add('hidden');
    }
  }

  function createToast(){
    let container = null;
    let messageEl = null;
    let hideTimer = null;

    function ensureElements(){
      if (container && messageEl) return;
      container = document.getElementById('memory-cue-toast');
      if (!container){
        container = document.createElement('div');
        container.id = 'memory-cue-toast';
        container.className = 'pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4 sm:top-6';
        messageEl = document.createElement('div');
        messageEl.className = 'pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ring-1 ring-black/10 transition duration-200 ease-out transform opacity-0 translate-y-2';
        messageEl.setAttribute('role', 'status');
        messageEl.setAttribute('aria-live', 'polite');
        messageEl.setAttribute('aria-atomic', 'true');
        container.appendChild(messageEl);
        document.body.appendChild(container);
      } else {
        messageEl = container.firstElementChild;
      }
    }

    return function toast(message, tone = 'info'){
      if (!message) return;
      ensureElements();
      if (!messageEl) return;
      messageEl.classList.remove(...ALL_TOAST_CLASSES);
      messageEl.classList.add(...(TOAST_TONE_CLASSES[tone] || TOAST_TONE_CLASSES.info));
      messageEl.textContent = message;
      window.clearTimeout(hideTimer);
      messageEl.classList.remove('opacity-100', 'translate-y-0');
      messageEl.classList.add('opacity-0', 'translate-y-2');
      void messageEl.offsetWidth;
      messageEl.classList.remove('opacity-0', 'translate-y-2');
      messageEl.classList.add('opacity-100', 'translate-y-0');
      hideTimer = window.setTimeout(() => {
        if (!messageEl) return;
        messageEl.classList.remove('opacity-100', 'translate-y-0');
        messageEl.classList.add('opacity-0', 'translate-y-2');
      }, 3800);
    };
  }

  function updateIdeaButtonState(){
    if (!ideasButton) return;
    const busy = Boolean(ideaState.loading);
    ideasButton.disabled = busy;
    if (busy){
      ideasButton.setAttribute('aria-busy', 'true');
      if (ideasButtonLabel) ideasButtonLabel.textContent = 'Generating…';
      if (ideasButtonIcon) ideasButtonIcon.textContent = '⏳';
    } else {
      ideasButton.removeAttribute('aria-busy');
      if (ideasButtonLabel) ideasButtonLabel.textContent = ideaButtonDefaultLabel;
      if (ideasButtonIcon) ideasButtonIcon.textContent = ideaButtonDefaultIcon;
    }
  }

  function getIdeaFormDefaults(){
    const defaults = {
      subject: ACTIVITY_SUBJECTS.has(state.subject) ? state.subject : 'HPE',
      phase: ACTIVITY_PHASES.has(state.phase) ? state.phase : 'start',
      notes: '',
    };
    const selection = ideaState.lastSelection;
    if (selection){
      if (ACTIVITY_SUBJECTS.has(selection.subject)){
        defaults.subject = selection.subject;
      }
      if (ACTIVITY_PHASES.has(selection.phase)){
        defaults.phase = selection.phase;
      }
      if (typeof selection.notes === 'string'){
        defaults.notes = selection.notes;
      }
    }
    return defaults;
  }

  function requestIdeaFocus(type, index){
    ideaState.pendingFocus = { type, index };
  }

  function applyPendingIdeaFocus(){
    if (!ideaState.pendingFocus) return;
    const { type, index } = ideaState.pendingFocus;
    ideaState.pendingFocus = null;
    if (!ideasList) return;
    const card = ideasList.querySelector(`[data-idea-index="${index}"]`);
    if (!card) return;
    if (type === 'edit'){
      const target = card.querySelector('[data-idea-edit-title]');
      if (target){
        requestAnimationFrame(() => {
          try {
            target.focus();
            if (typeof target.select === 'function'){
              target.select();
            }
          } catch {
            // ignore focus errors
          }
        });
      }
    } else if (type === 'action'){
      const target = card.querySelector('[data-idea-action="edit"]') || card.querySelector('[data-idea-action="save"]');
      if (target){
        requestAnimationFrame(() => {
          try {
            target.focus();
          } catch {
            // ignore focus errors
          }
        });
      }
    }
  }

  function normaliseKeywords(value){
    if (Array.isArray(value)){
      return value.map((kw) => String(kw).trim()).filter(Boolean);
    }
    if (typeof value === 'string'){
      return value.split(',').map((kw) => kw.trim()).filter(Boolean);
    }
    return [];
  }

  function buildIdeaCard(idea, index, { editing = false } = {}){
    const card = document.createElement('article');
    card.className = 'flex h-full flex-col gap-4 rounded-2xl border border-emerald-200/70 bg-white/90 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-within:outline-none focus-within:ring-2 focus-within:ring-emerald-400 dark:border-emerald-500/30 dark:bg-slate-900/60';
    card.dataset.ideaIndex = String(index);

    const header = document.createElement('div');
    header.className = 'flex flex-col gap-3';

    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-start justify-between gap-3';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'min-w-0 flex-1';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold text-emerald-900 dark:text-emerald-100';
    const titleText = (idea?.title && String(idea.title).trim()) || 'Lesson idea';
    title.textContent = titleText;

    titleWrap.appendChild(title);
    titleRow.appendChild(titleWrap);
    header.appendChild(titleRow);

    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'flex flex-wrap gap-2 text-xs font-semibold';
    if (idea?.subject && ACTIVITY_SUBJECTS.has(idea.subject)){
      const badge = document.createElement('span');
      badge.className = `inline-flex items-center rounded-full px-3 py-1 ${subjectBadgeClass(idea.subject)}`;
      badge.textContent = idea.subject;
      badgeWrap.appendChild(badge);
    }
    if (idea?.phase && ACTIVITY_PHASES.has(idea.phase)){
      const badge = document.createElement('span');
      badge.className = `inline-flex items-center rounded-full px-3 py-1 ${phaseBadgeClass(idea.phase)}`;
      badge.textContent = `${capitalise(idea.phase)} phase`;
      badgeWrap.appendChild(badge);
    }
    if (badgeWrap.childElementCount){
      header.appendChild(badgeWrap);
    }

    card.appendChild(header);

    if (editing){
      const form = document.createElement('form');
      form.className = 'mt-2 space-y-4';
      form.dataset.ideaEditForm = 'true';
      form.dataset.ideaIndex = String(index);

      const titleField = document.createElement('label');
      titleField.className = 'block text-sm font-semibold text-emerald-900 dark:text-emerald-100';
      titleField.textContent = 'Title';
      const titleInput = document.createElement('input');
      titleInput.name = 'title';
      titleInput.type = 'text';
      titleInput.required = true;
      titleInput.value = titleText;
      titleInput.dataset.ideaEditTitle = 'true';
      titleInput.className = 'mt-1 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-slate-100';
      titleField.appendChild(titleInput);
      form.appendChild(titleField);

      const descField = document.createElement('label');
      descField.className = 'block text-sm font-semibold text-emerald-900 dark:text-emerald-100';
      descField.textContent = 'Description';
      const descArea = document.createElement('textarea');
      descArea.name = 'description';
      descArea.rows = 3;
      descArea.className = 'mt-1 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-slate-100';
      descArea.value = (idea?.description && String(idea.description)) || '';
      descField.appendChild(descArea);
      form.appendChild(descField);

      const urlField = document.createElement('label');
      urlField.className = 'block text-sm font-semibold text-emerald-900 dark:text-emerald-100';
      urlField.textContent = 'Link (optional)';
      const urlInput = document.createElement('input');
      urlInput.name = 'url';
      urlInput.type = 'url';
      urlInput.value = typeof idea?.url === 'string' ? idea.url : '';
      urlInput.placeholder = 'https://…';
      urlInput.className = 'mt-1 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-slate-100';
      urlField.appendChild(urlInput);
      form.appendChild(urlField);

      const keywordsField = document.createElement('label');
      keywordsField.className = 'block text-sm font-semibold text-emerald-900 dark:text-emerald-100';
      keywordsField.textContent = 'Keywords (comma separated)';
      const keywordsInput = document.createElement('input');
      keywordsInput.name = 'keywords';
      keywordsInput.type = 'text';
      keywordsInput.value = Array.isArray(idea?.keywords) ? idea.keywords.join(', ') : '';
      keywordsInput.placeholder = 'movement, warm-up, teamwork';
      keywordsInput.className = 'mt-1 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-slate-100';
      keywordsField.appendChild(keywordsInput);
      form.appendChild(keywordsField);

      const actions = document.createElement('div');
      actions.className = 'flex flex-wrap items-center gap-3 pt-2';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'submit';
      saveBtn.dataset.ideaAction = 'save-edit';
      saveBtn.dataset.ideaIndex = String(index);
      saveBtn.className = 'inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-60';
      if (idea?.saving){
        saveBtn.textContent = 'Saving…';
        saveBtn.disabled = true;
      } else {
        saveBtn.textContent = 'Save activity';
      }
      actions.appendChild(saveBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.dataset.ideaAction = 'cancel-edit';
      cancelBtn.dataset.ideaIndex = String(index);
      cancelBtn.className = 'text-sm font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 dark:text-emerald-200 dark:hover:text-emerald-100';
      cancelBtn.textContent = 'Cancel';
      actions.appendChild(cancelBtn);

      form.appendChild(actions);
      card.appendChild(form);
      return card;
    }

    const description = document.createElement('p');
    description.className = 'text-sm leading-6 text-emerald-900/80 dark:text-emerald-100/80';
    description.textContent = (idea?.description && String(idea.description).trim()) || 'No description provided yet.';
    card.appendChild(description);

    if (idea?.url){
      const link = document.createElement('a');
      link.className = 'inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 dark:text-emerald-200 dark:hover:text-emerald-100';
      link.href = idea.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = 'Open resource';
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '↗';
      link.appendChild(icon);
      card.appendChild(link);
    }

    if (Array.isArray(idea?.keywords) && idea.keywords.length){
      const keywordWrap = document.createElement('div');
      keywordWrap.className = 'flex flex-wrap gap-2 pt-2';
      idea.keywords.forEach((kw) => {
        const label = String(kw || '').trim();
        if (!label) return;
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100/80 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/20 dark:text-emerald-100';
        chip.textContent = `#${label}`;
        keywordWrap.appendChild(chip);
      });
      if (keywordWrap.childElementCount){
        card.appendChild(keywordWrap);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'mt-auto flex flex-wrap items-center gap-3';
    actions.dataset.ideaActions = 'true';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.dataset.ideaAction = 'save';
    saveBtn.dataset.ideaIndex = String(index);
    saveBtn.className = 'inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-60';
    if (idea?.saved){
      saveBtn.textContent = 'Saved to Activities';
      saveBtn.disabled = true;
    } else if (idea?.saving){
      saveBtn.textContent = 'Saving…';
      saveBtn.disabled = true;
    } else {
      saveBtn.textContent = '➕ Save to Activities';
    }
    actions.appendChild(saveBtn);

    if (idea?.saved){
      const savedLabel = document.createElement('span');
      savedLabel.className = 'inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 dark:text-emerald-200';
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '✓';
      savedLabel.append(icon, document.createTextNode('Saved to Activities'));
      actions.appendChild(savedLabel);
    } else {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.dataset.ideaAction = 'edit';
      editBtn.dataset.ideaIndex = String(index);
      editBtn.className = 'text-sm font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 dark:text-emerald-200 dark:hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-60';
      editBtn.textContent = 'Edit before saving';
      editBtn.disabled = Boolean(idea?.saving);
      actions.appendChild(editBtn);
    }

    card.appendChild(actions);
    return card;
  }

  function renderIdeas(){
    updateIdeaButtonState();
    if (!ideasSection) return;
    const hasIdeas = Array.isArray(ideaState.items) && ideaState.items.length > 0;
    const showEmpty = !ideaState.loading && !hasIdeas && Boolean(ideaState.lastRequest);
    const shouldShowSection = ideaState.loading || hasIdeas || showEmpty;
    ideasSection.classList.toggle('hidden', !shouldShowSection);

    if (ideasLoadingEl){
      ideasLoadingEl.classList.toggle('hidden', !ideaState.loading);
    }

    if (ideasList){
      ideasList.innerHTML = '';
      if (hasIdeas){
        const fragment = document.createDocumentFragment();
        ideaState.items.forEach((idea, index) => {
          fragment.appendChild(buildIdeaCard(idea, index, { editing: ideaState.editingIndex === index }));
        });
        ideasList.appendChild(fragment);
        ideasList.classList.remove('hidden');
      } else {
        ideasList.classList.add('hidden');
      }
    }

    if (ideasEmptyEl){
      ideasEmptyEl.classList.toggle('hidden', !showEmpty);
    }

    if (ideasSummaryEl){
      if (!shouldShowSection){
        ideasSummaryEl.textContent = '';
        ideasSummaryEl.classList.add('hidden');
      } else if (ideaState.lastRequest){
        const { subject, phase } = ideaState.lastRequest;
        const parts = [];
        if (subject && ACTIVITY_SUBJECTS.has(subject)){
          parts.push(subject);
        }
        if (phase && ACTIVITY_PHASES.has(phase)){
          parts.push(`${capitalise(phase)} phase`);
        }
        const summary = parts.join(' • ');
        if (ideaState.loading){
          ideasSummaryEl.textContent = summary ? `Generating ideas for ${summary}…` : 'Generating lesson ideas…';
        } else if (hasIdeas){
          ideasSummaryEl.textContent = summary ? `Ideas for ${summary}` : 'Lesson ideas ready';
        } else {
          ideasSummaryEl.textContent = summary ? `No ideas generated for ${summary}. Try adjusting your notes.` : 'No ideas generated yet.';
        }
        ideasSummaryEl.classList.toggle('hidden', !ideasSummaryEl.textContent);
      } else {
        ideasSummaryEl.textContent = '';
        ideasSummaryEl.classList.add('hidden');
      }
    }

    if (ideasClearBtn){
      const shouldShowClear = hasIdeas || showEmpty;
      ideasClearBtn.classList.toggle('hidden', !shouldShowClear);
      const disableClear = Boolean(ideaState.loading);
      ideasClearBtn.disabled = disableClear;
      ideasClearBtn.classList.toggle('opacity-60', disableClear);
      ideasClearBtn.classList.toggle('cursor-not-allowed', disableClear);
      ideasClearBtn.setAttribute('aria-disabled', String(disableClear));
    }

    applyPendingIdeaFocus();
  }

  function prepareIdeaForSave(idea, overrides = {}){
    const merged = { ...idea, ...overrides };
    return {
      title: typeof merged.title === 'string' ? merged.title.trim() : '',
      description: typeof merged.description === 'string' ? merged.description.trim() : '',
      url: typeof merged.url === 'string' ? merged.url.trim() : '',
      keywords: normaliseKeywords(merged.keywords),
      subject: ACTIVITY_SUBJECTS.has(merged.subject) ? merged.subject : null,
      phase: ACTIVITY_PHASES.has(merged.phase) ? merged.phase : null,
    };
  }

  async function requestIdeas(payload){
    if (!payload || !payload.subject || !payload.phase) return;
    ideaState.lastSelection = {
      subject: ACTIVITY_SUBJECTS.has(payload.subject) ? payload.subject : 'HPE',
      phase: ACTIVITY_PHASES.has(payload.phase) ? payload.phase : 'start',
      notes: typeof payload.notes === 'string' ? payload.notes.trim() : '',
    };
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY){
      showToast('Add Supabase credentials to generate lesson ideas.', 'warning');
      return;
    }
    if (ideaRequestController){
      ideaRequestController.abort();
    }
    const controller = new AbortController();
    ideaRequestController = controller;

    ideaState.loading = true;
    ideaState.items = [];
    ideaState.editingIndex = null;
    ideaState.lastRequest = { ...ideaState.lastSelection };
    log.debug('Requesting lesson ideas', ideaState.lastRequest);
    renderIdeas();

    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const url = `${baseUrl}/functions/v1/ideas`;
    const requestBody = {
      subject: ideaState.lastRequest.subject,
      phase: ideaState.lastRequest.phase,
    };
    if (ideaState.lastRequest.notes){
      requestBody.notes = ideaState.lastRequest.notes;
    }

    let aborted = false;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!response.ok){
        let detail = `Request failed (${response.status})`;
        try {
          const text = await response.text();
          if (text) detail = text.slice(0, 160);
        } catch {
          // ignore
        }
        throw new Error(detail);
      }
      const result = await response.json();
      const ideas = Array.isArray(result?.ideas) ? result.ideas : [];
      ideaState.items = ideas.map((item) => ({
        title: typeof item?.title === 'string' ? item.title.trim() : '',
        description: typeof item?.description === 'string' ? item.description.trim() : '',
        url: typeof item?.url === 'string' ? item.url.trim() : '',
        keywords: normaliseKeywords(item?.keywords),
        subject: ideaState.lastRequest.subject,
        phase: ideaState.lastRequest.phase,
        saved: false,
        saving: false,
      }));
      log.debug('Idea generation complete', { count: ideaState.items.length });
      if (!ideaState.items.length){
        showToast('No ideas generated this time. Try adding more notes.', 'warning');
      }
    } catch (error) {
      if (controller.signal.aborted){
        aborted = true;
      } else {
        log.error('Idea generation failed', error);
        ideaState.items = [];
        showToast('Unable to generate lesson ideas right now.', 'error');
      }
    } finally {
      ideaState.loading = false;
      if (ideaRequestController === controller){
        ideaRequestController = null;
      }
      if (!aborted){
        renderIdeas();
      }
    }
  }

  async function handleIdeaSave(index, overrides = {}, { fromEdit = false } = {}){
    if (!Array.isArray(ideaState.items)) return;
    if (index < 0 || index >= ideaState.items.length) return;
    const current = ideaState.items[index];
    if (!current || current.saving || current.saved) return;
    if (!authUser?.id){
      showToast('Sign in to save ideas to your Activities.', 'warning');
      return;
    }
    const payload = prepareIdeaForSave(current, overrides);
    if (!payload.title){
      showToast('Add a title before saving this idea.', 'warning');
      ideaState.editingIndex = index;
      requestIdeaFocus('edit', index);
      renderIdeas();
      return;
    }
    const savingState = { ...current, ...payload, keywords: payload.keywords, saving: true, saved: false };
    ideaState.items[index] = savingState;
    renderIdeas();
    try {
      await addActivity(payload);
      ideaState.items[index] = { ...savingState, saving: false, saved: true };
      ideaState.editingIndex = null;
      renderIdeas();
      showToast('Idea saved to Activities.', 'success');
    } catch (error) {
      log.error('Idea save failed', error);
      ideaState.items[index] = { ...current, saving: false, saved: false };
      if (fromEdit){
        ideaState.editingIndex = index;
        requestIdeaFocus('edit', index);
      }
      renderIdeas();
      showToast('Unable to save idea right now.', 'error');
    }
  }

  function updateSubjectButtons(){
    const states = setActive(subjectButtons, (btn) => (btn.dataset.subject || 'all') === state.subject);
    states.forEach(({ element, active }) => {
      if (!element) return;
      if (active){
        element.classList.add(...SUBJECT_ACTIVE_CLASSES);
        element.classList.remove(...SUBJECT_INACTIVE_CLASSES);
      } else {
        element.classList.remove(...SUBJECT_ACTIVE_CLASSES);
        element.classList.add(...SUBJECT_INACTIVE_CLASSES);
      }
    });
  }

  function updatePhaseButtons(){
    const states = setActive(phaseButtons, (btn) => (btn.dataset.phase || 'any') === state.phase);
    states.forEach(({ element, active }) => {
      if (!element) return;
      if (active){
        element.classList.add(...PHASE_ACTIVE_CLASSES);
        element.classList.remove(...PHASE_INACTIVE_CLASSES);
      } else {
        element.classList.remove(...PHASE_ACTIVE_CLASSES);
        element.classList.add(...PHASE_INACTIVE_CLASSES);
      }
    });
  }

  function updateMineFilterButtons(){
    if (allFilterBtn){
      const allActive = !state.mineOnly;
      allFilterBtn.setAttribute('aria-pressed', String(allActive));
      allFilterBtn.classList.remove(...MINE_ACTIVE_CLASSES, ...MINE_INACTIVE_CLASSES);
      if (allActive){
        allFilterBtn.classList.add(...MINE_ACTIVE_CLASSES);
      } else {
        allFilterBtn.classList.add(...MINE_INACTIVE_CLASSES);
      }
    }
    if (mineFilterBtn){
      const canShowMine = Boolean(authUser?.id);
      const mineActive = Boolean(state.mineOnly && canShowMine);
      mineFilterBtn.setAttribute('aria-pressed', String(mineActive));
      mineFilterBtn.classList.remove(...MINE_ACTIVE_CLASSES, ...MINE_INACTIVE_CLASSES, ...MINE_DISABLED_CLASSES);
      if (mineActive){
        mineFilterBtn.classList.add(...MINE_ACTIVE_CLASSES);
      } else {
        mineFilterBtn.classList.add(...MINE_INACTIVE_CLASSES);
      }
      if (!canShowMine){
        mineFilterBtn.classList.add(...MINE_DISABLED_CLASSES);
        mineFilterBtn.setAttribute('aria-disabled', 'true');
        if (!mineFilterBtn.getAttribute('title')){
          mineFilterBtn.setAttribute('title', 'Sign in to view your saved ideas');
        }
      } else {
        mineFilterBtn.removeAttribute('aria-disabled');
        mineFilterBtn.removeAttribute('title');
      }
    }
  }

  function assignItems(items){
    const nextItems = Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
    state.items = nextItems;
    updateStatusMessage();
    render();
  }

  function render(){
    updatePinnedToggle();
    updateMineFilterButtons();
    renderIdeas();
    if (!resultsGrid) return;
    resultsGrid.innerHTML = '';
    if (!state.items.length){
      resultsGrid.classList.add('hidden');
      emptyEl?.classList.remove('hidden');
      log.debug('Render skipped – no activities to show');
      return;
    }
    emptyEl?.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    const pinnedIds = activityPinState.ids instanceof Set ? activityPinState.ids : new Set();
    state.items.forEach((activity) => {
      const { card, isPinned } = renderCard(activity, { pinnedIds });
      if (!card) return;
      const button = card.querySelector('[data-activity-pin]');
      if (button){
        const activityId = button.dataset.activityPin || '';
        const pending = activityId ? pendingPinUpdates.has(activityId) : false;
        applyPinButtonState(button, isPinned, { pending });
      }
      fragment.appendChild(card);
    });
    resultsGrid.appendChild(fragment);
    resultsGrid.classList.remove('hidden');
    log.debug('Rendered activity cards', { count: state.items.length });
  }

  async function refresh({ showLoading = true } = {}){
    if (showLoading) setLoading(true);
    const filters = buildFilters(state);
    log.debug('Refreshing activities', { filters, mineOnly: state.mineOnly });
    try {
      const client = supabaseClient || await ensureSupabase();
      if (!client){
        state.items = [];
        setStatus('Add Supabase credentials to browse shared activities.', 'warning');
        render();
        return;
      }
      const data = await listIdeas({
        subject: filters.subject,
        phase: filters.phase,
        q: filters.search,
        mine: state.mineOnly,
      });
      const filteredItems = applyFilters(data, filters);
      assignItems(filteredItems);
      log.debug('Refresh complete', { count: filteredItems.length });
    } catch (error) {
      log.error('Activities fetch failed', error);
      state.items = [];
      setStatus('Unable to load activities right now.', 'error');
      render();
    } finally {
      setLoading(false);
    }
  }

  subjectButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.subject || 'all';
      if (value === state.subject) return;
      state.subject = value;
      log.debug('Subject filter updated', { subject: state.subject });
      updateSubjectButtons();
      refresh();
    }, { signal });
  });

  phaseButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.phase || 'any';
      if (value === state.phase) return;
      state.phase = value;
      log.debug('Phase filter updated', { phase: state.phase });
      updatePhaseButtons();
      refresh();
    }, { signal });
  });

  if (pinnedToggle){
    pinnedToggle.addEventListener('click', () => {
      if (!authUser?.id){
        setStatus('Sign in to view pinned activities.', 'warning');
        return;
      }
      state.pinnedOnly = !state.pinnedOnly;
      savePinnedFilterPreference(authUser.id, state.pinnedOnly);
      log.debug('Pinned filter toggled', { pinnedOnly: state.pinnedOnly });
      updatePinnedToggle();
      refresh({ showLoading: true });
    }, { signal });
  }

  if (searchInput){
    const runSearch = (showLoading) => {
      state.search = searchInput.value || '';
      log.debug('Applying search filter', { value: state.search, showLoading });
      refresh({ showLoading });
    };
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value || '';
      if (searchDebounce) window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => {
        runSearch(false);
        searchDebounce = null;
      }, 150);
    }, { signal });
    searchInput.addEventListener('search', () => {
      if (searchDebounce) window.clearTimeout(searchDebounce);
      searchDebounce = null;
      runSearch(true);
    }, { signal });
  }

  if (allFilterBtn){
    allFilterBtn.addEventListener('click', () => {
      if (!state.mineOnly) return;
      state.mineOnly = false;
      updateMineFilterButtons();
      refresh({ showLoading: true });
    }, { signal });
  }

  if (mineFilterBtn){
    mineFilterBtn.addEventListener('click', () => {
      if (!authUser?.id){
        setStatus('Sign in to view your saved ideas.', 'warning');
        return;
      }
      if (state.mineOnly) return;
      state.mineOnly = true;
      updateMineFilterButtons();
      refresh({ showLoading: true });
    }, { signal });
  }

  if (ideaForm){
    ideaForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!authUser?.id){
        alert('Sign in to save ideas first.');
        return;
      }
      const formData = new FormData(ideaForm);
      const payload = {
        title: String(formData.get('idea-title') || ''),
        subject: String(formData.get('idea-subject') || ''),
        phase: String(formData.get('idea-phase') || ''),
        description: String(formData.get('idea-description') || ''),
        url: String(formData.get('idea-url') || ''),
        keywords: String(formData.get('idea-keywords') || ''),
      };
      const submitBtn = ideaSubmitBtn || ideaForm.querySelector('button[type="submit"]');
      if (submitBtn){
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
      }
      try {
        await createIdea(payload);
        ideaForm.reset();
        if (ideaSubjectInput && state.subject && ACTIVITY_SUBJECTS.has(state.subject) && state.subject !== 'all'){
          ideaSubjectInput.value = state.subject;
        }
        if (ideaPhaseInput && state.phase && ACTIVITY_PHASES.has(state.phase) && state.phase !== 'any'){
          ideaPhaseInput.value = state.phase;
        }
        const filters = buildFilters(state);
        const data = await listIdeas({
          subject: filters.subject,
          phase: filters.phase,
          q: filters.search,
          mine: state.mineOnly,
        });
        const filtered = applyFilters(data, filters);
        renderActivities(filtered);
      } catch (error) {
        console.error('Idea creation failed', error);
        alert(error?.message || 'Unable to save idea right now.');
      } finally {
        if (submitBtn){
          submitBtn.disabled = false;
          submitBtn.removeAttribute('aria-busy');
        }
      }
    }, { signal });
  }

  if (ideasButton){
    ideasButton.addEventListener('click', (event) => {
      if (ideaState.loading){
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const defaults = getIdeaFormDefaults();
      if (ideaModalSubject) ideaModalSubject.value = defaults.subject;
      if (ideaModalPhase) ideaModalPhase.value = defaults.phase;
      if (ideaModalNotes) ideaModalNotes.value = defaults.notes || '';
      log.debug('Opening idea modal', defaults);
    }, { signal });
  }

  ideaModalForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (ideaState.loading) return;
    const formData = new FormData(ideaModalForm);
    const subject = String(formData.get('subject') || '').trim();
    const phase = String(formData.get('phase') || '').trim();
    const notesValue = String(formData.get('notes') || '').trim();
    if (!ACTIVITY_SUBJECTS.has(subject)){
      showToast('Choose a subject to generate ideas.', 'warning');
      ideaModalSubject?.focus();
      return;
    }
    if (!ACTIVITY_PHASES.has(phase)){
      showToast('Choose a lesson phase to generate ideas.', 'warning');
      ideaModalPhase?.focus();
      return;
    }
    closeIdeaModal();
    requestIdeas({ subject, phase, notes: notesValue });
  }, { signal });

  ideasClearBtn?.addEventListener('click', () => {
    if (ideaState.loading) return;
    ideaState.items = [];
    ideaState.editingIndex = null;
    ideaState.pendingFocus = null;
    ideaState.lastRequest = null;
    renderIdeas();
  }, { signal });

  if (ideasList){
    ideasList.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-idea-action]');
      if (!actionBtn) return;
      const index = Number.parseInt(actionBtn.dataset.ideaIndex || '', 10);
      if (Number.isNaN(index)) return;
      const action = actionBtn.dataset.ideaAction;
      if (action === 'save'){
        handleIdeaSave(index);
      } else if (action === 'edit'){
        const item = ideaState.items[index];
        if (!item || item.saving || item.saved) return;
        ideaState.editingIndex = index;
        requestIdeaFocus('edit', index);
        renderIdeas();
      } else if (action === 'cancel-edit'){
        ideaState.editingIndex = null;
        requestIdeaFocus('action', index);
        renderIdeas();
      }
    }, { signal });
    ideasList.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-idea-edit-form]');
      if (!form) return;
      event.preventDefault();
      const index = Number.parseInt(form.dataset.ideaIndex || '', 10);
      if (Number.isNaN(index)) return;
      const formData = new FormData(form);
      const overrides = {
        title: String(formData.get('title') || ''),
        description: String(formData.get('description') || ''),
        url: String(formData.get('url') || ''),
        keywords: String(formData.get('keywords') || ''),
      };
      handleIdeaSave(index, overrides, { fromEdit: true });
    }, { signal });
  }

  resultsGrid?.addEventListener('click', handlePinButtonClick, { signal });

  function handleAuthChange(user){
    log.debug('Auth change received', { userId: user?.id || null });
    pendingPinUpdates.clear();
    if (!user?.id){
      state.pinnedOnly = false;
      state.mineOnly = false;
      state.items = state.items.map((item) => ({ ...item, pinned: false }));
      updatePinnedToggle();
      updateMineFilterButtons();
      updateStatusMessage();
      render();
      return;
    }
    state.pinnedOnly = loadPinnedFilterPreference(user.id);
    updatePinnedToggle();
    updateMineFilterButtons();
    updateStatusMessage();
    render();
  }

  updateSubjectButtons();
  updatePhaseButtons();
  updatePinnedToggle();
  updateMineFilterButtons();

  return {
    refresh: (options) => refresh(options || {}),
    handleAuthChange,
    setItems: (items) => assignItems(Array.isArray(items) ? items : []),
  };
})();

function renderActivities(items){
  if (resourcesController && typeof resourcesController.setItems === 'function'){
    resourcesController.setItems(Array.isArray(items) ? items : []);
    return;
  }
  const section = document.getElementById('view-resources');
  if (!section) return;
  const resultsGrid = section.querySelector('#activity-results');
  const emptyEl = section.querySelector('#activity-empty');
  if (!resultsGrid) return;
  const nextItems = Array.isArray(items) ? items : [];
  const fragment = document.createDocumentFragment();
  const pinnedIds = activityPinState.ids instanceof Set ? activityPinState.ids : new Set();
  nextItems.forEach((activity) => {
    const { card } = renderCard(activity, { pinnedIds });
    if (card) fragment.appendChild(card);
  });
  resultsGrid.replaceChildren(fragment);
  if (!nextItems.length){
    resultsGrid.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
  } else {
    resultsGrid.classList.remove('hidden');
    emptyEl?.classList.add('hidden');
  }
}

async function createIdea({ title = '', subject, phase, description = '', url = '', keywords = [] } = {}){
  const client = supabaseClient || await ensureSupabase();
  if (!client) throw new Error('Supabase client not available');
  await waitForInitialAuth();
  if (!authUser?.id) throw new Error('Sign in to save ideas first.');
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('Add a title for your idea.');
  const cleanSubject = ACTIVITY_SUBJECTS.has(subject) ? subject : null;
  if (!cleanSubject) throw new Error('Choose a subject for your idea.');
  const cleanPhase = ACTIVITY_PHASES.has(phase) ? phase : null;
  if (!cleanPhase) throw new Error('Choose a lesson phase for your idea.');
  const cleanDescription = String(description || '').trim();
  const cleanUrl = String(url || '').trim();
  const keywordList = Array.isArray(keywords)
    ? keywords.map((kw) => String(kw).trim()).filter(Boolean)
    : String(keywords || '').split(',').map((kw) => kw.trim()).filter(Boolean);
  const { data, error } = await client
    .from('activities')
    .insert({
      title: cleanTitle,
      subject: cleanSubject,
      phase: cleanPhase,
      description: cleanDescription,
      url: cleanUrl,
      keywords: keywordList,
      created_by: authUser.id,
    })
    .select('id,title,subject,phase,description,url,keywords,created_by')
    .single();
  if (error) throw error;
  return data;
}

async function listIdeas({ subject, phase, q, mine } = {}){
  const client = supabaseClient || await ensureSupabase();
  if (!client) return [];
  await waitForInitialAuth();
  let query = client
    .from('activities')
    .select('id,title,subject,phase,description,url,keywords,created_by')
    .order('title', { ascending: true });
  if (mine){
    if (!authUser?.id) return [];
    query = query.eq('created_by', authUser.id);
  }
  if (subject && subject !== 'all' && ACTIVITY_SUBJECTS.has(subject)){
    query = query.eq('subject', subject);
  }
  if (phase && phase !== 'any' && ACTIVITY_PHASES.has(phase)){
    query = query.eq('phase', phase);
  }
  if (q && String(q).trim()){
    const pattern = `%${escapeIlike(String(q).trim())}%`;
    query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  let pinnedIds = new Set();
  if (authUser?.id){
    pinnedIds = await ensureActivityPins();
  }
  return rows.map((row) => {
    const keywordValue = Array.isArray(row?.keywords)
      ? row.keywords
      : String(row?.keywords || '')
          .split(',')
          .map((kw) => kw.trim())
          .filter(Boolean);
    return {
      ...row,
      keywords: keywordValue,
      pinned: row?.id ? pinnedIds.has(row.id) : false,
    };
  });
}

async function togglePin(activityId, shouldPin){
  if (!authUser?.id) throw new Error('User must be signed in to pin activities');
  if (!activityId) throw new Error('Activity ID is required to update pin state.');
  await persistActivityPin(activityId, shouldPin);
  return { activityId, pinned: shouldPin };
}

resourcesController?.refresh({ showLoading: true });

if (typeof window !== 'undefined') {
  (function initSupabaseResourcesFallback(){
    if (resourcesController) return;
    if (!window.supabase) return;

    // ====== Resources: Add/Filter My Ideas (Supabase) ======
    const sb = window.supabase;
    if (!sb) return;

    // Helpers
    async function getUser(){
      const { data } = await sb.auth.getUser();
      return data.user || null;
    }
    function parseKeywords(s){
      return (s || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    }

    // Create idea
    async function createIdea({ title, subject, phase, description, url, keywords }){
      const user = await getUser();
      if (!user) throw new Error('Please sign in to save your ideas.');
      const { data, error } = await sb
        .from('activities')
        .insert([
          {
            title,
            subject,
            phase,
            description: description || '',
            url: url || '',
            keywords: parseKeywords(keywords),
            created_by: user.id,
          },
        ])
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    // Load ideas (with filters)
    async function loadIdeas({ subject = null, phase = 'any', q = '', mine = false } = {}){
      let query = sb.from('activities').select('*').order('created_at', { ascending: false });

      if (subject && subject !== 'all') query = query.eq('subject', subject);
      if (phase && phase !== 'any') query = query.eq('phase', phase);
      if (q && q.trim()) {
        const like = `%${q.trim()}%`;
        query = query.or(`title.ilike.${like},description.ilike.${like}`);
      }
      if (mine) {
        const user = await getUser();
        if (!user) return [];
        query = query.eq('created_by', user.id);
      }

      const { data, error } = await query;
      if (error) {
        console.error('[resources] loadIdeas error', error);
        return [];
      }
      return data || [];
    }

    // Optional: per-user pin toggle
    async function togglePin(activityId, shouldPin){
      const user = await getUser();
      if (!user) throw new Error('Please sign in to pin ideas.');
      if (shouldPin) {
        const { error } = await sb.from('activity_pins').upsert({ user_id: user.id, activity_id: activityId });
        if (error) throw error;
      } else {
        const { error } = await sb.from('activity_pins').delete().eq('user_id', user.id).eq('activity_id', activityId);
        if (error) throw error;
      }
    }

    // Minimal renderer fallback if renderActivities doesn't exist
    async function ensureRenderer(){
      if (typeof window.renderActivities === 'function') return;
      const grid = document.getElementById('activity-results');
      const empty = document.getElementById('activity-empty');
      window.renderActivities = function(items){
        if (!grid || !empty) return;
        grid.innerHTML = '';
        if (!items.length){
          empty.classList.remove('hidden');
          return;
        }
        empty.classList.add('hidden');
        for (const a of items) {
          const card = document.createElement('article');
          card.className = 'rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/40';
          card.innerHTML = `
        <h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">${a.title}</h3>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">${a.subject} • ${a.phase}</p>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">${a.description || ''}</p>
        ${a.url ? `<a class="mt-3 inline-block text-sm text-emerald-700 hover:underline" href="${a.url}" target="_blank" rel="noopener">Open resource →</a>` : ''}
        <div class="mt-3 flex gap-2">
          <button type="button" class="pin-btn rounded-full border px-3 py-1.5 text-xs" data-id="${a.id}">★ Pin</button>
        </div>
      `;
          grid.appendChild(card);
        }
        // wire pins (fallback only)
        grid.querySelectorAll('.pin-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            try {
              await togglePin(btn.dataset.id, true);
              btn.textContent = '★ Pinned';
            } catch (e) {
              alert(e.message);
            }
          });
        });
      };
    }
    ensureRenderer();

    // Wire the Add Idea form + quick filters
    (function wireIdeaUI(){
      const form = document.getElementById('idea-form');
      const results = document.getElementById('activity-results');
      if (!form || !results) return;

      const titleEl = document.getElementById('idea-title');
      const subjEl = document.getElementById('idea-subject');
      const phaseEl = document.getElementById('idea-phase');
      const descEl = document.getElementById('idea-description');
      const urlEl = document.getElementById('idea-url');
      const kwEl = document.getElementById('idea-keywords');
      const btnMine = document.getElementById('filter-mine');
      const btnAll = document.getElementById('filter-all');
      const searchEl = document.getElementById('activity-search');

      async function refresh({ mine = false } = {}){
        const activeSubject = document.querySelector('.subject-filter[aria-pressed="true"]')?.dataset.subject || null;
        const activePhase = document.querySelector('.phase-filter[aria-pressed="true"]')?.dataset.phase || 'any';
        const q = (searchEl?.value || '').trim();
        const items = await loadIdeas({ subject: activeSubject, phase: activePhase, q, mine });
        window.renderActivities(items);
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await createIdea({
            title: titleEl.value.trim(),
            subject: subjEl.value,
            phase: phaseEl.value,
            description: descEl.value.trim(),
            url: urlEl.value.trim(),
            keywords: kwEl.value,
          });
          form.reset();
          await refresh({ mine: true }); // show yours after saving
        } catch (err) {
          console.error('[resources] createIdea failed', err);
          alert(err.message || 'Could not save idea');
        }
      });

      btnMine?.addEventListener('click', () => refresh({ mine: true }));
      btnAll?.addEventListener('click', () => refresh({ mine: false }));

      // Re-render when search input changes (debounced)
      let t;
      searchEl?.addEventListener('input', () => {
        window.clearTimeout(t);
        t = window.setTimeout(() => refresh({}), 250);
      });

      // Initial load
      refresh({});
    })();
  })();
}

// Planner
const plannerWeekEl = document.getElementById('planner-week');
const plannerGrid = document.getElementById('planner-grid');
const plannerPrevBtn = document.getElementById('planner-prev');
const plannerTodayBtn = document.getElementById('planner-today');
const plannerNextBtn = document.getElementById('planner-next');
const PLANNER_STORAGE_KEY = 'memoryCue.desktopPlanner';
let plannerWeekOffset = 0;
let plannerNotes = loadPlannerNotes();

const plannerRangeFormatter = new Intl.DateTimeFormat('en-AU', { month: 'long', day: 'numeric' });
const plannerDayFormatter = new Intl.DateTimeFormat('en-AU', { weekday: 'long' });

function loadPlannerNotes(){
  try {
    const raw = localStorage.getItem(PLANNER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('Unable to load planner notes', err);
    return {};
  }
}

function persistPlannerNotes(){
  try {
    localStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(plannerNotes));
  } catch (err) {
    console.warn('Unable to save planner notes', err);
  }
}

function getWeekStart(offset = 0){
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay();
  const diff = (day + 6) % 7;
  start.setDate(start.getDate() - diff + offset * 7);
  start.setHours(0, 0, 0, 0);
  return start;
}

function buildPlannerDay(date){
  const dayName = plannerDayFormatter.format(date);
  const rangeLabel = plannerRangeFormatter.format(date);
  const key = toDateKey(date);
  const column = document.createElement('div');
  column.className = 'p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 shadow-sm flex flex-col';
  const heading = document.createElement('h4');
  heading.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
  heading.textContent = dayName;
  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-slate-500 dark:text-slate-400';
  subtitle.textContent = rangeLabel;
  const noteArea = document.createElement('textarea');
  noteArea.className = 'mt-4 min-h-[120px] w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white/70 dark:bg-slate-900/50 p-3 text-sm text-slate-700 dark:text-slate-200';
  noteArea.placeholder = 'Capture lesson focuses, to-dos or reminders…';
  noteArea.value = plannerNotes[key] || '';
  noteArea.dataset.date = key;
  noteArea.addEventListener('input', () => {
    plannerNotes[key] = noteArea.value;
    persistPlannerNotes();
  });
  column.append(heading, subtitle, noteArea);
  return column;
}

function renderPlanner(){
  if (!plannerWeekEl || !plannerGrid) return;
  const start = getWeekStart(plannerWeekOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  plannerWeekEl.textContent = `Week of ${plannerRangeFormatter.format(start)} – ${plannerRangeFormatter.format(end)}`;
  plannerGrid.innerHTML = '';
  for (let i = 0; i < 7; i += 1) {
    const dayDate = new Date(start);
    dayDate.setDate(start.getDate() + i);
    plannerGrid.appendChild(buildPlannerDay(dayDate));
  }
}

function changePlannerWeek(delta){
  if (delta === 0) {
    plannerWeekOffset = 0;
  } else {
    plannerWeekOffset += delta;
  }
  renderPlanner();
}

plannerPrevBtn?.addEventListener('click', () => changePlannerWeek(-1));
plannerTodayBtn?.addEventListener('click', () => changePlannerWeek(0));
plannerNextBtn?.addEventListener('click', () => changePlannerWeek(1));

if (plannerWeekEl && plannerGrid) {
  renderPlanner();
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

// Notes
const noteEl = document.getElementById('quick-note');
const savedSelect = document.getElementById('saved-notes');
let activeNoteIndex = null;

function getNotes(){
  return JSON.parse(localStorage.getItem('saved-notes') || '[]');
}

function saveNotes(notes){
  localStorage.setItem('saved-notes', JSON.stringify(notes));
}

function refreshSelect(selectedValue = ''){
  if(!savedSelect) return;
  const notes = getNotes();
  savedSelect.innerHTML = '<option value="">Select a note</option>' +
    notes.map((n, i) => `<option value="${i}">${escapeHtml(n.title)}</option>`).join('');

  if(selectedValue !== ''){
    const parsed = Number.parseInt(selectedValue, 10);
    if(!Number.isNaN(parsed) && notes[parsed]){
      savedSelect.value = String(parsed);
      return;
    }
  }
  savedSelect.value = '';
}

if(noteEl){
  refreshSelect();

  document.getElementById('save-note')?.addEventListener('click', () => {
    const content = noteEl.innerHTML;
    const title = content.replace(/<[^>]+>/g, '').slice(0, 20) || 'Untitled';
    const notes = getNotes();
    notes.push({ title, content });
    saveNotes(notes);
    const newIndex = notes.length - 1;
    refreshSelect(String(newIndex));
    activeNoteIndex = newIndex;
  });

  document.getElementById('load-note')?.addEventListener('click', () => {
    const idx = savedSelect?.value;
    if(idx === '' || idx == null) return;
    const parsedIndex = Number.parseInt(idx, 10);
    if(Number.isNaN(parsedIndex)) return;
    const notes = getNotes();
    if(notes[parsedIndex]){
      noteEl.innerHTML = notes[parsedIndex].content;
      activeNoteIndex = parsedIndex;
    }
  });

  document.getElementById('delete-note')?.addEventListener('click', () => {
    const idx = savedSelect?.value;
    if(idx === '' || idx == null) return;
    const indexNum = Number.parseInt(idx, 10);
    if(Number.isNaN(indexNum)) return;
    const notes = getNotes();
    if(!notes[indexNum]) return;
    notes.splice(indexNum, 1);
    saveNotes(notes);
    refreshSelect();
    if(activeNoteIndex === indexNum){
      noteEl.innerHTML = '';
      activeNoteIndex = null;
    } else if(activeNoteIndex !== null && activeNoteIndex > indexNum){
      activeNoteIndex -= 1;
    }
  });

  document.getElementById('clear-note')?.addEventListener('click', () => {
    noteEl.innerHTML = '';
    activeNoteIndex = null;
  });

  document.getElementById('bullet-btn')?.addEventListener('click', () => {
    document.execCommand('insertUnorderedList');
  });

  document.getElementById('number-btn')?.addEventListener('click', () => {
    document.execCommand('insertOrderedList');
  });
}

// === Activity Ideas Modal (a11y-safe) ===
(() => {
  const modal = document.getElementById('activity-ideas-modal');
  if (!modal) return;

  const openers = document.querySelectorAll('[data-open-modal="activity-ideas"]');
  const closers = modal.querySelectorAll('[data-close-modal]');
  const dialog = modal.querySelector('[role="dialog"]') || modal;
  const backdrop = modal.firstElementChild || modal;

  if (!dialog.hasAttribute('tabindex')) {
    dialog.setAttribute('tabindex', '-1');
  }

  let lastFocused = null;

  const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const getFocusables = () =>
    Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(
      el =>
        !el.hasAttribute('disabled') &&
        !el.getAttribute('aria-hidden') &&
        !el.closest('[aria-hidden="true"]')
    );

  const focusFirst = () => {
    const focusables = getFocusables();
    const target =
      focusables.find(el => el.dataset.autofocus === 'true') ||
      focusables[0] ||
      dialog;
    try {
      target.focus();
    } catch (error) {
      // ignore focus issues
    }
  };

  function openModal() {
    if (!modal.classList.contains('hidden')) return;

    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    modal.setAttribute('aria-hidden', 'false');

    focusFirst();

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focus', trapFocus, true);
    backdrop.addEventListener('click', onBackdropClick);
  }

  function closeModal() {
    if (modal.classList.contains('hidden')) return;

    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
    modal.setAttribute('aria-hidden', 'true');

    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focus', trapFocus, true);
    backdrop.removeEventListener('click', onBackdropClick);

    if (lastFocused && typeof lastFocused.focus === 'function') {
      try {
        lastFocused.focus();
      } catch (error) {
        // ignore focus restoration issues
      }
    }
  }

  function onKeyDown(event) {
    if (modal.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      closeModal();
    } else if (event.key === 'Tab') {
      const focusables = getFocusables();
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function trapFocus(event) {
    if (modal.classList.contains('hidden')) return;
    if (!dialog.contains(event.target)) {
      event.stopPropagation();
      focusFirst();
    }
  }

  function onBackdropClick(event) {
    if (!dialog.contains(event.target)) closeModal();
  }

  openers.forEach(btn => {
    if (btn._wiredIdeasModal) return;
    btn._wiredIdeasModal = true;
    btn.addEventListener('click', openModal);
  });

  closers.forEach(btn => {
    if (btn._wiredIdeasModalClose) return;
    btn._wiredIdeasModalClose = true;
    btn.addEventListener('click', event => {
      event.preventDefault();
      closeModal();
    });
  });

  if (modal.classList.contains('hidden')) {
    modal.setAttribute('inert', '');
    modal.setAttribute('aria-hidden', 'true');
  } else {
    modal.removeAttribute('inert');
    modal.setAttribute('aria-hidden', 'false');
  }

  modal.openActivityIdeasModal = openModal;
  modal.closeActivityIdeasModal = closeModal;
})();
// === /Activity Ideas Modal ===

