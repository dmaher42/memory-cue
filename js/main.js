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

const ACTIVITY_SUBJECTS = new Set(['HPE', 'English', 'HASS']);
const ACTIVITY_PHASES = new Set(['start', 'middle', 'end']);

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

function setupSupabaseAuth(){
  if (!supabaseClient || setupSupabaseAuth.initialised) return;
  setupSupabaseAuth.initialised = true;
  supabaseClient.auth.getSession().then(({ data }) => {
    const session = data?.session || null;
    authUser = session?.user ?? null;
    updateAuthUI(authUser);
    if (authUser) {
      upsertProfile(authUser);
    }
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

async function loadActivities({ subject, phase, search } = {}){
  const client = await ensureSupabase();
  if (!client) return [];
  let query = client
    .from('activities')
    .select('id,title,subject,phase,description,url,keywords')
    .order('title', { ascending: true });
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
  return Array.isArray(data) ? data : [];
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
  if (record.id) payload.id = record.id;
  const { data, error } = await client
    .from('activities')
    .insert(payload)
    .select('id,title,subject,phase,description,url,keywords')
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
  authUser = session?.user ?? null;
  updateAuthUI(authUser);
  if (authUser) {
    await upsertProfile(authUser);
  }
  if (event === 'SIGNED_IN' && authUser?.email){
    setAuthFeedback(`Signed in as ${authUser.email}`, 'success');
  } else if (event === 'SIGNED_OUT') {
    setAuthFeedback('Signed out.', 'info');
  }
  resourcesController?.refresh();
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
  const DEFAULT_WEATHER_LOCATION = { latitude: -33.8688, longitude: 151.2093, label: 'Sydney, AU' };
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
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200'
        : soon
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200';
      let statusLabel = '';
      if (overdue){
        statusLabel = `Overdue by ${formatDuration(diff)}`;
      } else if (soon){
        statusLabel = `Due in ${formatDuration(diff)}`;
      } else {
        statusLabel = `Due today · ${timeFormatter.format(due)}`;
      }

      const li = document.createElement('li');
      li.className = 'rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 p-4';

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
      status.className = `inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${highlightClass}`;
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

  async function fetchWeather(lat, lon){
    const params = new URLSearchParams({
      latitude: lat.toFixed(2),
      longitude: lon.toFixed(2),
      current_weather: 'true',
      daily: 'precipitation_probability_max,sunrise,sunset',
      timezone: 'auto',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok){
      throw new Error('Weather fetch failed');
    }
    return res.json();
  }

  async function resolveLocationLabel(lat, lon, fallbackLabel){
    try {
      const params = new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), count: '1', language: 'en' });
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?${params.toString()}`);
      if (!res.ok) throw new Error('Reverse geocode failed');
      const data = await res.json();
      const result = data?.results?.[0];
      if (result){
        const pieces = [result.name, result.admin1, result.country_code].filter(Boolean);
        const unique = [];
        pieces.forEach((piece) => {
          if (!unique.includes(piece)) unique.push(piece);
        });
        return unique.join(', ');
      }
    } catch {
      // ignore, fallback below
    }
    return fallbackLabel || `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;
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
    if (weatherDescEl) weatherDescEl.textContent = code.label;
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

  async function loadWeatherFor(lat, lon, { fallback }){
    try {
      const data = await fetchWeather(lat, lon);
      const label = await resolveLocationLabel(lat, lon, fallback ? DEFAULT_WEATHER_LOCATION.label : '');
      renderWeather(data, label || DEFAULT_WEATHER_LOCATION.label, { fallback });
      setWeatherStatus(fallback ? 'Showing default location forecast.' : 'Forecast updated just now.', 'success');
    } catch (error) {
      console.error('Weather load failed', error);
      setWeatherStatus('Unable to load weather right now.', 'error');
      weatherSkeletonEl?.classList.add('hidden');
    }
  }

  function requestWeather({ preferGeolocation = true, message } = {}){
    if (!weatherStatusEl) return;
    if (isFetchingWeather) return;
    isFetchingWeather = true;
    setWeatherStatus(message || 'Fetching latest forecast…', 'info');
    weatherSkeletonEl?.classList.remove('hidden');
    weatherSummaryEl?.classList.add('hidden');

    const finish = () => {
      isFetchingWeather = false;
    };

    if (preferGeolocation && navigator?.geolocation){
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          loadWeatherFor(pos.coords.latitude, pos.coords.longitude, { fallback: false }).finally(finish);
        },
        () => {
          loadWeatherFor(DEFAULT_WEATHER_LOCATION.latitude, DEFAULT_WEATHER_LOCATION.longitude, { fallback: true }).finally(finish);
        },
        { maximumAge: 15 * 60 * 1000, timeout: 8000 }
      );
      return;
    }

    loadWeatherFor(DEFAULT_WEATHER_LOCATION.latitude, DEFAULT_WEATHER_LOCATION.longitude, { fallback: true }).finally(finish);
  }

  if (lessonForm){
    lessonForm.addEventListener('submit', handleLessonSubmit);
  }

  if (deadlineForm){
    deadlineForm.addEventListener('submit', handleDeadlineSubmit);
  }

  if (weatherRefreshBtn){
    weatherRefreshBtn.addEventListener('click', () => {
      requestWeather({ preferGeolocation: true, message: 'Refreshing forecast…' });
    });
  }

  renderLessons();
  renderDeadlines();
  renderReminders();
  requestWeather({ preferGeolocation: true });

  setInterval(() => {
    renderLessons();
    renderDeadlines();
    renderReminders();
    updateActivityRelativeTimes();
  }, 60 * 1000);

  setInterval(() => {
    requestWeather({ preferGeolocation: false, message: 'Updating forecast…' });
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
  const section = document.getElementById('view-resources');
  if (!section) return null;

  const subjectButtons = [...section.querySelectorAll('[data-subject]')];
  const phaseButtons = [...section.querySelectorAll('[data-phase]')];
  const searchInput = section.querySelector('#activity-search');
  const resultsGrid = section.querySelector('#activity-results');
  const emptyEl = section.querySelector('#activity-empty');
  const loadingEl = section.querySelector('#activity-loading');
  const statusEl = section.querySelector('#activity-status');

  const SUBJECT_ACTIVE_CLASSES = ['bg-emerald-500', 'border-emerald-500', 'text-white', 'shadow'];
  const SUBJECT_INACTIVE_CLASSES = ['bg-white/80', 'border-slate-200', 'dark:border-slate-700', 'text-slate-600', 'dark:text-slate-200'];
  const PHASE_ACTIVE_CLASSES = ['bg-blue-500', 'border-blue-500', 'text-white', 'shadow'];
  const PHASE_INACTIVE_CLASSES = ['bg-white/70', 'border-slate-200', 'dark:border-slate-700', 'text-slate-600', 'dark:text-slate-200'];
  const STATUS_TONE_CLASSES = {
    info: ['text-slate-500', 'dark:text-slate-400'],
    success: ['text-emerald-600', 'dark:text-emerald-300'],
    warning: ['text-amber-600', 'dark:text-amber-300'],
    error: ['text-rose-600', 'dark:text-rose-300'],
  };
  const ALL_STATUS_CLASSES = Object.values(STATUS_TONE_CLASSES).flat();

  const state = {
    subject: subjectButtons.find(btn => btn.dataset.default === 'true')?.dataset.subject || 'all',
    phase: 'any',
    search: '',
    items: [],
  };

  let searchDebounce = null;

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

  function updateSubjectButtons(){
    subjectButtons.forEach((btn) => {
      const value = btn.dataset.subject || 'all';
      const isActive = value === state.subject;
      btn.setAttribute('aria-pressed', String(isActive));
      if (isActive){
        btn.classList.add(...SUBJECT_ACTIVE_CLASSES);
        btn.classList.remove(...SUBJECT_INACTIVE_CLASSES);
      } else {
        btn.classList.remove(...SUBJECT_ACTIVE_CLASSES);
        btn.classList.add(...SUBJECT_INACTIVE_CLASSES);
      }
    });
  }

  function updatePhaseButtons(){
    phaseButtons.forEach((btn) => {
      const value = btn.dataset.phase || 'any';
      const isActive = value === state.phase;
      btn.setAttribute('aria-pressed', String(isActive));
      if (isActive){
        btn.classList.add(...PHASE_ACTIVE_CLASSES);
        btn.classList.remove(...PHASE_INACTIVE_CLASSES);
      } else {
        btn.classList.remove(...PHASE_ACTIVE_CLASSES);
        btn.classList.add(...PHASE_INACTIVE_CLASSES);
      }
    });
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

  function capitalise(value){
    if (!value) return '';
    const str = String(value);
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function buildActivityCard(activity){
    const card = document.createElement('article');
    card.className = 'flex h-full flex-col gap-4 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus-within:outline-none focus-within:ring-2 focus-within:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900/50';

    const header = document.createElement('div');
    header.className = 'flex flex-wrap items-start justify-between gap-3';
    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
    title.textContent = (activity?.title && String(activity.title).trim()) || 'Untitled activity';
    header.appendChild(title);

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

    return card;
  }

  function render(){
    if (!resultsGrid) return;
    resultsGrid.innerHTML = '';
    if (!state.items.length){
      resultsGrid.classList.add('hidden');
      emptyEl?.classList.remove('hidden');
      return;
    }
    emptyEl?.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    state.items.forEach((activity) => {
      fragment.appendChild(buildActivityCard(activity));
    });
    resultsGrid.appendChild(fragment);
    resultsGrid.classList.remove('hidden');
  }

  async function refresh({ showLoading = true } = {}){
    if (showLoading) setLoading(true);
    try {
      if (!supabaseClient){
        state.items = [];
        setStatus('Add Supabase credentials to browse shared activities.', 'warning');
        render();
        return;
      }
      const data = await loadActivities({
        subject: state.subject === 'all' ? undefined : state.subject,
        phase: state.phase,
        search: state.search,
      });
      state.items = data;
      if (data.length){
        const label = data.length === 1 ? 'activity' : 'activities';
        setStatus(`Showing ${data.length} ${label}.`, 'info');
      } else if (state.search || (state.subject && state.subject !== 'all') || state.phase !== 'any'){
        setStatus('No activities match your filters yet.', 'warning');
      } else {
        setStatus('No activities available yet.', 'warning');
      }
    } catch (error) {
      console.error('Activities fetch failed', error);
      state.items = [];
      setStatus('Unable to load activities right now.', 'error');
    } finally {
      setLoading(false);
      render();
    }
  }

  subjectButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.subject || 'all';
      if (value === state.subject) return;
      state.subject = value;
      updateSubjectButtons();
      refresh();
    });
  });

  phaseButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.phase || 'any';
      if (value === state.phase) return;
      state.phase = value;
      updatePhaseButtons();
      refresh();
    });
  });

  if (searchInput){
    const triggerSearch = () => {
      if (searchDebounce) window.clearTimeout(searchDebounce);
      state.search = searchInput.value || '';
      refresh({ showLoading: true });
    };
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value || '';
      if (searchDebounce) window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => {
        refresh({ showLoading: false });
      }, 250);
    });
    searchInput.addEventListener('search', triggerSearch);
  }

  updateSubjectButtons();
  updatePhaseButtons();

  return {
    refresh: (options) => refresh(options || {}),
  };
})();

resourcesController?.refresh({ showLoading: true });

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