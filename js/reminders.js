// Shared reminder logic used by both the mobile and desktop pages.
// This module wires up Firebase/Firestore and all reminder UI handlers.

const ACTIVITY_EVENT_NAME = 'memoryCue:activity';
const activeNotifications = new Map();
let notificationCleanupBound = false;
const SERVICE_WORKER_SCRIPT = 'service-worker.js';
let serviceWorkerReadyPromise = null;

function getGlobalScope() {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof self !== 'undefined') return self;
  if (typeof window !== 'undefined') return window;
  return {};
}

function getTimestampTriggerCtor() {
  const scope = getGlobalScope();
  const Trigger = scope && scope.TimestampTrigger;
  return typeof Trigger === 'function' ? Trigger : null;
}

function supportsNotificationTriggers() {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (typeof ServiceWorkerRegistration === 'undefined') return false;
  if (typeof ServiceWorkerRegistration.prototype?.showNotification !== 'function') return false;
  return !!getTimestampTriggerCtor();
}

function resolveServiceWorkerUrl() {
  if (typeof window === 'undefined' || !window.location) {
    return SERVICE_WORKER_SCRIPT;
  }
  try {
    return new URL(SERVICE_WORKER_SCRIPT, window.location.href).href;
  } catch {
    return SERVICE_WORKER_SCRIPT;
  }
}

async function ensureServiceWorkerRegistration() {
  if (serviceWorkerReadyPromise) {
    return serviceWorkerReadyPromise;
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  serviceWorkerReadyPromise = (async () => {
    try {
      const existing = await navigator.serviceWorker.getRegistration();
      if (!existing) {
        await navigator.serviceWorker.register(resolveServiceWorkerUrl());
      }
      return await navigator.serviceWorker.ready;
    } catch (err) {
      console.warn('Service worker registration failed', err);
      return null;
    }
  })();
  return serviceWorkerReadyPromise;
}

async function cancelTriggerNotification(id, registrationOverride) {
  if (!supportsNotificationTriggers()) return;
  try {
    const registration = registrationOverride || (await ensureServiceWorkerRegistration());
    if (!registration) return;
    let notifications = [];
    try {
      notifications = await registration.getNotifications({ tag: id, includeTriggered: true });
    } catch {
      notifications = await registration.getNotifications({ tag: id });
    }
    for (const notification of notifications) {
      try { notification.close(); } catch { /* ignore close issues */ }
    }
  } catch {
    // ignore cancellation errors
  }
}

function closeActiveNotifications() {
  for (const notification of Array.from(activeNotifications.values())) {
    try {
      notification.close();
    } catch {
      // Ignore close errors so cleanup can continue for remaining notifications.
    }
  }
  activeNotifications.clear();
}

function bindNotificationCleanupHandlers() {
  if (notificationCleanupBound) {
    return;
  }
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return;
  }
  const cleanup = () => closeActiveNotifications();
  ['pagehide', 'beforeunload'].forEach((eventName) => {
    try {
      window.addEventListener(eventName, cleanup);
    } catch {
      // Ignore environments that do not support these events.
    }
  });
  notificationCleanupBound = true;
}

/**
 * Initialise the reminders UI and sync logic.
 * Pass in selectors for the elements the module should control.
 * Any selector can be omitted if the corresponding feature is not needed.
 *
 * @param {Object} sel - Map of selector strings for DOM elements.
 */
export async function initReminders(sel = {}) {
  const $ = (s) => (s ? document.querySelector(s) : null);
  const $$ = (s) => (s ? Array.from(document.querySelectorAll(s)) : []);

  // Elements
  const q = $(sel.qSel);
  const title = $(sel.titleSel);
  const date = $(sel.dateSel);
  const time = $(sel.timeSel);
  const priority = $(sel.prioritySel);
  const saveBtn = $(sel.saveBtnSel);
  const cancelEditBtn = $(sel.cancelEditBtnSel);
  const list = $(sel.listSel);
  const googleSignInBtn = $(sel.googleSignInBtnSel);
  const googleSignOutBtn = $(sel.googleSignOutBtnSel);
  const statusEl = $(sel.statusSel);
  const syncStatus = $(sel.syncStatusSel);
  const notesEl = $(sel.notesSel);
  const saveNotesBtn = $(sel.saveNotesBtnSel);
  const loadNotesBtn = $(sel.loadNotesBtnSel);
  const sortSel = $(sel.sortSel);
  const filterBtns = $$(sel.filterBtnsSel);
  const countTodayEl = $(sel.countTodaySel);
  const countWeekEl = $(sel.countWeekSel);
  const countOverdueEl = $(sel.countOverdueSel);
  const countTotalEl = $(sel.countTotalSel);
  const countCompletedEl = $(sel.countCompletedSel);
  const googleAvatar = $(sel.googleAvatarSel);
  const googleUserName = $(sel.googleUserNameSel);
  const dateFeedback = $(sel.dateFeedbackSel);
  const addQuickBtn = $(sel.addQuickBtnSel);
  const voiceBtn = $(sel.voiceBtnSel);
  const notifBtn = $(sel.notifBtnSel);
  const moreBtn = $(sel.moreBtnSel);
  const moreMenu = $(sel.moreMenuSel);
  const copyMtlBtn = $(sel.copyMtlBtnSel);
  const importFile = $(sel.importFileSel);
  const exportBtn = $(sel.exportBtnSel);
  const syncAllBtn = $(sel.syncAllBtnSel);
  const syncUrlInput = $(sel.syncUrlInputSel);
  const saveSettings = $(sel.saveSettingsSel);
  const testSync = $(sel.testSyncSel);
  const openSettings = $(sel.openSettingsSel);
  const settingsSection = $(sel.settingsSectionSel);
  const emptyStateEl = $(sel.emptyStateSel);
  const listWrapper = $(sel.listWrapperSel);
  const variant = sel.variant || 'mobile';
  const emptyInitialText = sel.emptyStateInitialText || 'Add your first reminder to see it here.';
  const emptyFilteredText = sel.emptyStateFilteredText || 'No reminders match this filter yet.';
  const reminderLandingPath = sel.reminderLandingPath || (variant === 'desktop' ? 'index.html#reminders' : 'mobile.html');

  if (supportsNotificationTriggers()) {
    ensureServiceWorkerRegistration();
  }

  function emitActivity(detail = {}) {
    const label = typeof detail.label === 'string' ? detail.label.trim() : '';
    if (!label) return;
    const payload = {
      type: 'reminder',
      target: { view: 'reminders' },
      ...detail,
    };
    if (!payload.target) {
      payload.target = { view: 'reminders' };
    } else if (typeof payload.target === 'string') {
      payload.target = { view: payload.target };
    } else if (typeof payload.target === 'object' && payload.target.view == null) {
      payload.target.view = 'reminders';
    }
    if (!payload.timestamp) {
      payload.timestamp = new Date().toISOString();
    }

    let handled = false;
    try {
      if (typeof window !== 'undefined' && window.memoryCueActivity && typeof window.memoryCueActivity.push === 'function') {
        window.memoryCueActivity.push(payload);
        handled = true;
      }
    } catch {
      handled = false;
    }

    if (handled) {
      return;
    }

    if (typeof window !== 'undefined') {
      const queue = Array.isArray(window.memoryCueActivityQueue) ? window.memoryCueActivityQueue : [];
      queue.push(payload);
      while (queue.length > 20) queue.shift();
      window.memoryCueActivityQueue = queue;
    }

    if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
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
      } catch {
        // ignore fallback dispatch errors
      }
    }
  }

  bindNotificationCleanupHandlers();

   // Placeholder for Firebase modules loaded later
   let initializeApp, initializeFirestore, getFirestore, doc, setDoc, deleteDoc,
     onSnapshot, collection, query, orderBy, persistentLocalCache, serverTimestamp,
     getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
      signInWithRedirect, getRedirectResult, signOut;

  const firebaseDeps = sel.firebaseDeps;

   // Notes (runs before Firebase modules load)
   function initNotebook() {
     let notesMemory = '';
     if (notesEl) {
       try {
         notesMemory = localStorage.getItem('mobileNotes') || '';
       } catch {
         toast('Unable to access saved notes');
       }
       notesEl.value = notesMemory;
       notesEl.addEventListener('input', () => {
         notesMemory = notesEl.value;
         try {
           localStorage.setItem('mobileNotes', notesMemory);
         } catch {
           toast('Notes saved for this session only');
         }
       });
       saveNotesBtn?.addEventListener('click', () => {
         notesMemory = notesEl.value;
         try {
           localStorage.setItem('mobileNotes', notesMemory);
           toast('Notes saved');
         } catch {
           toast('Notes saved for this session only');
         }
       });
       loadNotesBtn?.addEventListener('click', () => {
         try {
           notesMemory = localStorage.getItem('mobileNotes') || notesMemory;
           notesEl.value = notesMemory;
           toast('Notes loaded');
         } catch {
           notesEl.value = notesMemory;
           toast('Unable to load saved notes');
         }
       });
     }
   }
   initNotebook();

   if (firebaseDeps) {
     ({ initializeApp, initializeFirestore, getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, persistentLocalCache, serverTimestamp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } = firebaseDeps);
   } else {
     try {
       ({ initializeApp } = await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'));
       ({ initializeFirestore, getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, persistentLocalCache, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js'));
       ({ getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } = await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'));
     } catch (err) {
       console.warn('Firebase modules failed to load:', err);
       toast('Firebase failed to load; notes available offline');
       return;
     }
   }

   // Firebase
   const firebaseConfig = {
     apiKey: 'AIzaSyAmAMiz0zG3dAhZJhOy1DYj8fKVDObL36c',
     authDomain: 'memory-cue-app.firebaseapp.com',
     projectId: 'memory-cue-app',
     storageBucket: 'memory-cue-app.firebasestorage.app',
     messagingSenderId: '751284466633',
     appId: '1:751284466633:web:3b10742970bef1a5d5ee18',
     measurementId: 'G-R0V4M7VCE6'
   };
   const app = initializeApp(firebaseConfig);
   let db;
   try {
     db = initializeFirestore(app, { cache: persistentLocalCache() });
   } catch (err) {
     console.warn('Firestore persistence not enabled:', err?.code || err);
     db = getFirestore(app);
   }
   const auth = getAuth(app);

   // State
   let items = [];
   let filter = 'today';
   let sortKey = 'smart';
   let listening = false;
   let recog = null;
   let userId = null;
   let unsubscribe = null;
   let editingId = null;
   const reminderTimers = {};
   let scheduledReminders = {};
   try {
     scheduledReminders = JSON.parse(localStorage.getItem('scheduledReminders') || '{}');
   } catch {
     scheduledReminders = {};
   }

  // Formatting helpers
  const navigatorLocale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : '';
  let locale = navigatorLocale || 'en-US';
  let TZ = 'UTC';
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions();
    if (resolved.timeZone) TZ = resolved.timeZone;
    if (!navigatorLocale && resolved.locale) locale = resolved.locale;
  } catch {
    // Intl not supported; fall back to defaults already set
  }
  const timeFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const dateOnlyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const desktopDayLabelFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: 'long' });
  const desktopShortDateFmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, month: 'short', day: 'numeric' });
  function formatDateLocal(d) {
    const parts = dateOnlyFmt.formatToParts(d);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const da = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${da}`;
  }
  function localDateTimeToISO(dstr, tstr) {
    const [Y, M, D] = dstr.split('-').map(n => parseInt(n, 10));
    const [h, m] = tstr.split(':').map(n => parseInt(n, 10));
    const dt = new Date();
    dt.setFullYear(Y, (M || 1) - 1, D || 1);
    dt.setHours(h || 0, m || 0, 0, 0);
    return dt.toISOString();
  }
  const datePartsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timePartsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  function isoToLocalDate(iso) {
    try {
      const d = new Date(iso);
      const parts = datePartsFmt.formatToParts(d);
      const y = parts.find(p => p.type === 'year')?.value || '0000';
      const m = parts.find(p => p.type === 'month')?.value || '00';
      const da = parts.find(p => p.type === 'day')?.value || '00';
      return `${y}-${m}-${da}`;
    } catch { return ''; }
  }
  function isoToLocalTime(iso) {
    try {
      const d = new Date(iso);
      const parts = timePartsFmt.formatToParts(d);
      const h = parts.find(p => p.type === 'hour')?.value?.padStart(2, '0') || '00';
      const m = parts.find(p => p.type === 'minute')?.value?.padStart(2, '0') || '00';
      return `${h}:${m}`;
    } catch { return ''; }
  }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function todayISO() { return formatDateLocal(new Date()); }
  function startOfWeek(d) { const n = new Date(d); const day = (n.getDay() + 6) % 7; n.setDate(n.getDate() - day); n.setHours(0,0,0,0); return n; }
  function endOfWeek(d) { const s = startOfWeek(d); const e = new Date(s); e.setDate(e.getDate()+6); e.setHours(23,59,59,999); return e; }
  function priorityWeight(p) { return p === 'High' ? 3 : p === 'Medium' ? 2 : 1; }
  function smartCompare(a,b){ const pr = priorityWeight(b.priority)-priorityWeight(a.priority); if(pr) return pr; const at=+new Date(a.due||0), bt=+new Date(b.due||0); if(at!==bt) return at-bt; return (a.updatedAt||0)>(b.updatedAt||0)?-1:1; }
  function fmtDayDate(iso){ if(!iso) return '—'; try{ const d = new Date(iso+'T00:00:00'); return dayFmt.format(d); }catch{ return iso; } }
  function fmtTime(d){ return timeFmt.format(d); }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function toast(msg){ if(!statusEl) return; statusEl.textContent = msg; clearTimeout(toast._t); toast._t = setTimeout(()=> statusEl.textContent='',2500); }
  function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

  // Quick when parser (subset from mobile)
  function parseQuickWhen(text){
    text = String(text||'').toLowerCase();
    let when = { date: todayISO(), time: '' };
    const getNextDayOfWeek = (dayIndex)=>{ const today=new Date(); const current=today.getDay(); const days=(dayIndex-current+7)%7; const target=new Date(today); target.setDate(today.getDate()+(days===0?7:days)); return target; };
    const getThisDayOfWeek = (dayIndex)=>{ const today=new Date(); const current=today.getDay(); const days=(dayIndex-current+7)%7; const target=new Date(today); target.setDate(today.getDate()+days); return target; };
    const dayNames={ 'sunday':0,'sun':0,'monday':1,'mon':1,'tuesday':2,'tue':2,'tues':2,'wednesday':3,'wed':3,'thursday':4,'thu':4,'thur':4,'thurs':4,'friday':5,'fri':5,'saturday':6,'sat':6 };
    const monthNames={ 'january':0,'jan':0,'february':1,'feb':1,'march':2,'mar':2,'april':3,'apr':3,'may':4,'june':5,'jun':5,'july':6,'jul':6,'august':7,'aug':7,'september':8,'sep':8,'sept':8,'october':9,'oct':9,'november':10,'nov':10,'december':11,'dec':11 };
    if(/\btomorrow\b/.test(text)){ const d=new Date(); d.setDate(d.getDate()+1); when.date=formatDateLocal(d); }
    else if(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/.test(text)){ const m=text.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/); const dayIndex=dayNames[m[1]]; const d=getNextDayOfWeek(dayIndex); when.date=formatDateLocal(d); }
    else if(/\bthis\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/.test(text)){ const m=text.match(/\bthis\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/); const dayIndex=dayNames[m[1]]; const d=getThisDayOfWeek(dayIndex); when.date=formatDateLocal(d); }
    else if(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/.test(text)){ const m=text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/); const dayIndex=dayNames[m[1]]; const d=getNextDayOfWeek(dayIndex); when.date=formatDateLocal(d); }
    else if(/\bin\s+(\d+)\s+days?\b/.test(text)){ const m=text.match(/\bin\s+(\d+)\s+days?\b/); const days=parseInt(m[1],10); const d=new Date(); d.setDate(d.getDate()+days); when.date=formatDateLocal(d); }
    else if(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.test(text)){ const m=text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); const day=parseInt(m[1],10); const month=parseInt(m[2],10)-1; const year=m[3]?parseInt(m[3],10):(new Date()).getFullYear(); const d=new Date(year,month,day); when.date=formatDateLocal(d); }
    else {
      for (const [name, idx] of Object.entries(monthNames)) {
        const re = new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?`, 'i');
        if (re.test(text)) {
          const m = text.match(re);
          const day = parseInt(m[1], 10);
          const year = new Date().getFullYear();
          const d = new Date(year, idx, day);
          when.date = formatDateLocal(d);
          break;
        }
      }
    }
    const timeMatch = text.match(/(\d{1,2})(?:[:\.](\d{2}))?\s*(am|pm)?/);
    if(timeMatch){
      let h=parseInt(timeMatch[1],10);
      let m=timeMatch[2]?parseInt(timeMatch[2],10):0;
      const ap=timeMatch[3];
      if(ap){ if(ap==='pm' && h<12) h+=12; if(ap==='am' && h===12) h=0; }
      when.time=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    return when;
  }

  // Auth
  googleSignInBtn?.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); } catch (error) { try { await signInWithRedirect(auth, provider); } catch { toast('Google sign-in failed'); } }
  });
  getRedirectResult(auth).catch(()=>{});
  googleSignOutBtn?.addEventListener('click', async () => { try { await signOut(auth); toast('Signed out'); items=[]; render(); } catch { toast('Sign-out failed'); } });
  onAuthStateChanged(auth, (user) => {
    if (user) {
      userId = user.uid;
      syncStatus?.classList.remove('offline','error');
      syncStatus?.classList.add('online');
      if(syncStatus) syncStatus.textContent = 'Online';
      googleSignInBtn?.classList.add('hidden');
      googleSignOutBtn?.classList.remove('hidden');
      if(googleAvatar){ if(user.photoURL){ googleAvatar.classList.remove('hidden'); googleAvatar.src=user.photoURL; } else { googleAvatar.classList.add('hidden'); googleAvatar.src=''; } }
      if(googleUserName) googleUserName.textContent = user.displayName || user.email || '';
      setupFirestoreSync();
    } else {
      syncStatus?.classList.remove('online','error');
      if(syncStatus){
        syncStatus.classList.add('offline');
        syncStatus.textContent = 'Offline';
      }
      googleSignInBtn?.classList.remove('hidden');
      googleSignOutBtn?.classList.add('hidden');
      if(googleAvatar){ googleAvatar.classList.add('hidden'); googleAvatar.src=''; }
      if(googleUserName) googleUserName.textContent='';
      items=[]; render();
    }
  });

  // Firestore sync
  function setupFirestoreSync(){
    if(!userId){ items=[]; render(); return; }
    if(unsubscribe) unsubscribe();
    const userCollection = collection(db, 'users', userId, 'reminders');
    const qSnap = query(userCollection, orderBy('updatedAt','desc'));
    unsubscribe = onSnapshot(qSnap, (snapshot) => {
      const remoteItems = [];
      snapshot.forEach((d)=>{
        const data = d.data();
        remoteItems.push({ id: d.id, title: data.title, priority: data.priority, notes: data.notes || '', done: !!data.done, due: data.due || null, createdAt: data.createdAt?.toMillis?.() || 0, updatedAt: data.updatedAt?.toMillis?.() || 0 });
      });
      items = remoteItems;
      render();
    }, (error)=>{
      console.error('Firestore sync error:', error);
      if(syncStatus){ syncStatus.textContent='Sync Error'; syncStatus.className='sync-status error'; }
    });
  }

  async function saveToFirebase(item){
    if(!userId) return;
    try {
      await setDoc(doc(db, 'users', userId, 'reminders', item.id), {
        title: item.title, priority: item.priority, notes: item.notes || '', done: !!item.done, due: item.due || null,
        createdAt: item.createdAt ? new Date(item.createdAt) : serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('Save failed:', error); toast('Save queued (offline)');
    }
  }
  async function deleteFromFirebase(id){ if(!userId) return; try { await deleteDoc(doc(db,'users',userId,'reminders',id)); } catch { toast('Delete queued (offline)'); } }

  async function tryCalendarSync(task){ const url=(localStorage.getItem('syncUrl')||'').trim(); if(!url) return; const payload={ id: task.id, title: task.title, dueIso: task.due || null, priority: task.priority || 'Medium', done: !!task.done, source: 'memory-cue-mobile' }; try{ await fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); }catch{} }

  function resetForm(){ if(title) title.value=''; if(date) date.value=''; if(time) time.value=''; if(priority) priority.value='Medium'; editingId=null; if(saveBtn) saveBtn.textContent='Save Reminder'; cancelEditBtn?.classList.add('hidden'); }
  function loadForEdit(id){ const it = items.find(x=>x.id===id); if(!it) return; if(title) title.value=it.title||''; if(date&&time){ if(it.due){ date.value=isoToLocalDate(it.due); time.value=isoToLocalTime(it.due); } else { date.value=''; time.value=''; } } if(priority) priority.value=it.priority||'Medium'; editingId=id; if(saveBtn) saveBtn.textContent='Update Reminder'; cancelEditBtn?.classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'}); title?.focus(); }

  function addItem(obj){
    if(!userId){ toast('Sign in to add reminders'); return; }
    const nowMs = Date.now();
    const item = {
      id: uid(),
      title: obj.title.trim(),
      priority: obj.priority||'Medium',
      notes: obj.notes||'',
      done:false,
      createdAt: nowMs,
      updatedAt: nowMs,
      due: obj.due || null,
    };
    items = [item, ...items];
    render();
    saveToFirebase(item);
    tryCalendarSync(item);
    scheduleReminder(item);
    emitActivity({
      action: 'created',
      label: `Reminder added · ${item.title}`,
    });
    return item;
  }
  function addNoteToReminder(id, noteText){
    if(!userId){ toast('Sign in to add notes'); return null; }
    if(!id) return null;
    const reminder = items.find(x=>x.id===id);
    if(!reminder) return null;
    const incoming = noteText == null ? '' : (typeof noteText === 'string' ? noteText : String(noteText));
    const trimmed = incoming.trim();
    if(!trimmed) return reminder;
    const existing = typeof reminder.notes === 'string' ? reminder.notes : '';
    reminder.notes = existing ? `${existing}\n${trimmed}` : trimmed;
    reminder.updatedAt = Date.now();
    saveToFirebase(reminder);
    render();
    emitActivity({
      action: 'updated',
      label: `Reminder notes updated · ${reminder.title}`,
    });
    return reminder;
  }
  function toggleDone(id){
    const it = items.find(x=>x.id===id);
    if(!it) return;
    it.done = !it.done;
    it.updatedAt = Date.now();
    saveToFirebase(it);
    tryCalendarSync(it);
    render();
    if(it.done){
      cancelReminder(id);
      emitActivity({
        action: 'completed',
        label: `Reminder completed · ${it.title}`,
      });
    } else {
      scheduleReminder(it);
      emitActivity({
        action: 'reopened',
        label: `Reminder reopened · ${it.title}`,
      });
    }
  }
  function removeItem(id){
    const removed = items.find(x=>x.id===id);
    items = items.filter(x=>x.id!==id);
    render();
    deleteFromFirebase(id);
    cancelReminder(id);
    if(removed){
      emitActivity({
        action: 'deleted',
        label: `Reminder removed · ${removed.title}`,
      });
    } else {
      emitActivity({ action: 'deleted', label: 'Reminder removed' });
    }
  }

  function saveScheduled(){ localStorage.setItem('scheduledReminders', JSON.stringify(scheduledReminders)); }
  function clearReminderState(id, { closeNotification = true } = {}){
    if(closeNotification){
      const active = activeNotifications.get(id);
      if(active){
        try { active.close(); } catch {}
        activeNotifications.delete(id);
      }
    }
    if(reminderTimers[id]){ clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
    cancelTriggerNotification(id);
    if(scheduledReminders[id]){ delete scheduledReminders[id]; saveScheduled(); }
  }
  function cancelReminder(id){ clearReminderState(id); }
  function showReminder(item){
    if(!item || !item.id || !('Notification' in window)) return;
    try{
      const existing = activeNotifications.get(item.id);
      if(existing && typeof existing.close === 'function'){
        try { existing.close(); } catch {}
      }
      const notification = new Notification(item.title,{ body:'Due now', tag:item.id });
      activeNotifications.set(item.id, notification);
      const remove = () => {
        if(activeNotifications.get(item.id) === notification){
          activeNotifications.delete(item.id);
        }
      };
      if(typeof notification.addEventListener === 'function'){
        notification.addEventListener('close', remove);
        notification.addEventListener('click', remove);
      }
      notification.onclose = remove;
      notification.onclick = remove;
    }catch{}
  }
  async function scheduleTriggerNotification(item){
    if(!supportsNotificationTriggers()) return false;
    const Trigger = getTimestampTriggerCtor();
    if(!Trigger || !item?.due) return false;
    const dueTime = new Date(item.due).getTime();
    if(!Number.isFinite(dueTime)) return false;
    const registration = await ensureServiceWorkerRegistration();
    if(!registration) return false;
    await cancelTriggerNotification(item.id, registration);
    const data = {
      id: item.id,
      title: item.title,
      due: item.due,
      priority: item.priority || 'Medium',
      urlPath: reminderLandingPath,
    };
    let body = 'Due now';
    try {
      const dueDate = new Date(item.due);
      if(!Number.isNaN(dueDate.getTime())){
        const timeLabel = fmtTime(dueDate);
        if(timeLabel){
          body = `Due ${timeLabel}`;
        }
      }
    } catch {}
    const options = { body, tag: item.id, data, renotify: true };
    if(dueTime > Date.now()){
      options.showTrigger = new Trigger(dueTime);
    }
    try {
      await registration.showNotification(item.title, options);
      return true;
    } catch (err) {
      console.warn('Failed to schedule persistent notification', err);
      return false;
    }
  }
  function scheduleReminder(item){
    if(!item||!item.id) return;
    if(!item.due || item.done){ cancelReminder(item.id); return; }
    const stored = { id:item.id, title:item.title, due:item.due };
    scheduledReminders[item.id]=stored;
    saveScheduled();
    if(reminderTimers[item.id]){ clearTimeout(reminderTimers[item.id]); delete reminderTimers[item.id]; }
    if(!('Notification' in window) || Notification.permission!=='granted'){ return; }
    const dueTime = new Date(item.due).getTime();
    if(!Number.isFinite(dueTime)) return;
    const delay = dueTime - Date.now();
    if(delay<=0){
      if(scheduledReminders[item.id]?.viaTrigger){
        clearReminderState(item.id,{ closeNotification:false });
        return;
      }
      showReminder(item);
      clearReminderState(item.id,{ closeNotification:false });
      return;
    }
    const useTriggers = supportsNotificationTriggers();
    if(useTriggers){
      stored.viaTrigger = false;
      scheduleTriggerNotification(item).then((scheduled) => {
        if(scheduled && scheduledReminders[item.id]){
          scheduledReminders[item.id] = { ...scheduledReminders[item.id], viaTrigger: true };
          saveScheduled();
        }
      });
    }
    reminderTimers[item.id]=setTimeout(()=>{
      if(useTriggers){
        cancelTriggerNotification(item.id);
      }
      showReminder(item);
      clearReminderState(item.id,{ closeNotification:false });
    }, delay);
  }
  function rescheduleAllReminders(){ Object.values(scheduledReminders).forEach(it=>scheduleReminder(it)); }

  const desktopPriorityClasses = {
    High: 'border-red-200 text-red-600 bg-red-100/70 dark:border-red-400/30 dark:text-red-300 dark:bg-red-500/10',
    Medium: 'border-amber-200 text-amber-600 bg-amber-100/70 dark:border-amber-400/30 dark:text-amber-300 dark:bg-amber-500/10',
    Low: 'border-emerald-200 text-emerald-600 bg-emerald-100/70 dark:border-emerald-400/30 dark:text-emerald-300 dark:bg-emerald-500/10'
  };

  function formatDesktopDue(item){
    if(!item?.due) return 'No due date';
    try {
      const due = new Date(item.due);
      const dayLabel = desktopDayLabelFmt.format(due);
      const dateLabel = desktopShortDateFmt.format(due);
      const timeLabel = fmtTime(due);
      return `${dayLabel}, ${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}`;
    } catch {
      return 'No due date';
    }
  }

  function render(){
    const now = new Date();
    const localNow = new Date(now);
    const t0 = new Date(localNow); t0.setHours(0,0,0,0);
    const t1 = new Date(localNow); t1.setHours(23,59,59,999);
    const w0 = startOfWeek(localNow);
    const w1 = endOfWeek(localNow);
    const todays = items.filter(x => {
      if (!x.due || x.done) return false;
      const due = new Date(x.due);
      return due >= t0 && due <= t1;
    });
    const weeks  = items.filter(x => {
      if (!x.due || x.done) return false;
      const due = new Date(x.due);
      return due >= w0 && due <= w1;
    });
    const overdueCount = items.filter(x => {
      if (x.done || !x.due) return false;
      return new Date(x.due) < localNow;
    }).length;
    const completedCount = items.filter(x => x.done).length;
    if(countTodayEl) countTodayEl.textContent = String(todays.length);
    if(countWeekEl) countWeekEl.textContent = String(weeks.length);
    if(countOverdueEl) countOverdueEl.textContent = String(overdueCount);
    if(countTotalEl) countTotalEl.textContent = String(items.length);
    if(countCompletedEl) countCompletedEl.textContent = String(completedCount);

    if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      const payload = items.map(item => ({ ...item }));
      try {
        if (typeof CustomEvent === 'function') {
          document.dispatchEvent(new CustomEvent('memoryCue:remindersUpdated', { detail: { items: payload } }));
        } else if (document.createEvent) {
          const evt = document.createEvent('CustomEvent');
          if (evt && evt.initCustomEvent) {
            evt.initCustomEvent('memoryCue:remindersUpdated', false, false, { items: payload });
            document.dispatchEvent(evt);
          }
        }
      } catch {
        // Ignore dispatch errors so reminder rendering can continue.
      }
    }

    let rows = items.slice();
    const queryStr = q?.value.trim().toLowerCase() || '';
    if(queryStr){ rows = rows.filter(r => r.title.toLowerCase().includes(queryStr) || (r.notes||'').toLowerCase().includes(queryStr)); }
    rows = rows.filter(r => {
      if(filter==='done') return r.done;
      if(filter==='overdue') return !r.done && r.due && new Date(r.due) < localNow;
      if(filter==='today'){
        if(!r.due) return true;
        const dueLocal = new Date(r.due);
        return dueLocal >= t0 && dueLocal <= t1;
      }
      return true;
    });
    rows.sort((a,b)=>{
      if(sortKey==='time') return (+new Date(a.due||0))-(+new Date(b.due||0));
      if(sortKey==='priority') return priorityWeight(b.priority)-priorityWeight(a.priority);
      return smartCompare(a,b);
    });

    filterBtns.forEach(btn => {
      const isActive = btn.getAttribute('data-filter')===filter;
      btn.classList.toggle('active', isActive);
      btn.classList.toggle('ring-2', isActive);
      btn.classList.toggle('ring-offset-2', isActive);
      btn.classList.toggle('ring-purple-400', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });

    const hasAny = items.length > 0;
    const hasRows = rows.length > 0;

    if(emptyStateEl){
      if(!hasAny){
        emptyStateEl.textContent = emptyInitialText;
        emptyStateEl.classList.remove('hidden');
      } else if(!hasRows){
        emptyStateEl.textContent = emptyFilteredText;
        emptyStateEl.classList.remove('hidden');
      } else {
        emptyStateEl.classList.add('hidden');
      }
    }

    if(listWrapper){
      listWrapper.classList.toggle('has-items', hasRows);
    }

    if(!list){
      return;
    }

    if(!hasRows){
      if(emptyStateEl){
        list.innerHTML = '';
        list.classList.add('hidden');
      } else {
        list.innerHTML = '<div class="text-muted">No reminders found.</div>';
        list.classList.remove('hidden');
      }
      return;
    }

    list.classList.remove('hidden');
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    const listIsSemantic = list.tagName === 'UL' || list.tagName === 'OL';
    rows.forEach(r => {
      if(variant === 'desktop'){
        const itemEl = document.createElement(listIsSemantic ? 'li' : 'div');
        itemEl.dataset.id = r.id;
        itemEl.className = 'p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm';
        const dueLabel = formatDesktopDue(r);
        const priorityClass = desktopPriorityClasses[r.priority] || desktopPriorityClasses.Medium;
        const titleClasses = r.done ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100';
        const statusLabel = r.done ? 'Completed' : 'Active';
        const statusClasses = r.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400';
        const toggleClasses = r.done
          ? 'px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600'
          : 'px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600';
        itemEl.innerHTML = `
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p class="text-lg font-semibold ${titleClasses}">${escapeHtml(r.title)}</p>
        <div class="mt-2 flex flex-wrap gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span class="inline-flex items-center gap-2">
            <span class="inline-flex h-2 w-2 rounded-full bg-blue-400"></span>
            ${escapeHtml(dueLabel)}
          </span>
          <span class="inline-flex items-center gap-2 px-2 py-1 rounded-full border ${priorityClass}">
            ${escapeHtml(r.priority)} priority
          </span>
          <span class="${statusClasses}">${statusLabel}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 text-sm font-medium">
        <button data-action="toggle" class="${toggleClasses}">${r.done ? 'Mark active' : 'Mark done'}</button>
        <button data-action="edit" class="px-3 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600">Edit</button>
        <button data-action="delete" class="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600">Delete</button>
      </div>
    </div>`;
        itemEl.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleDone(r.id));
        itemEl.querySelector('[data-action="edit"]').addEventListener('click', () => loadForEdit(r.id));
        itemEl.querySelector('[data-action="delete"]').addEventListener('click', () => removeItem(r.id));
        frag.appendChild(itemEl);
        return;
      }

      const div = document.createElement('div');
      div.className = 'task-item' + (r.done ? ' completed' : '');
      const dueTxt = r.due ? `${fmtTime(new Date(r.due))} • ${fmtDayDate(r.due.slice(0,10))}` : 'No due date';
      const priorityClass = `priority-${r.priority.toLowerCase()}`;
      div.innerHTML = `
        <input type="checkbox" ${r.done ? 'checked' : ''} aria-label="Mark complete" />
        <div class="task-content">
          <div class="task-title">${escapeHtml(r.title)}</div>
          <div class="task-meta">
            <div class="task-meta-row">
              <span>${dueTxt}</span>
              <span class="priority-badge ${priorityClass}">${r.priority}</span>
            </div>
          </div>
        </div>
        <div class="task-actions">
          <button class="btn-ghost" data-edit type="button">Edit</button>
          <button class="btn-ghost" data-del type="button">Del</button>
        </div>`;
      div.querySelector('input').addEventListener('change', () => toggleDone(r.id));
      div.querySelector('[data-edit]').addEventListener('click', () => loadForEdit(r.id));
      div.querySelector('[data-del]').addEventListener('click', () => removeItem(r.id));
      frag.appendChild(div);
    });
    list.appendChild(frag);
  }

  function closeMenu(){ moreBtn?.setAttribute('aria-expanded','false'); moreMenu?.classList.add('hidden'); }
  function openMenu(){ moreBtn?.setAttribute('aria-expanded','true'); moreMenu?.classList.remove('hidden'); }
  moreBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); const open=moreBtn.getAttribute('aria-expanded')==='true'; open ? closeMenu() : openMenu(); });
  document.addEventListener('click', (e)=>{
    if (moreMenu && !moreMenu.classList.contains('hidden') && !moreMenu.contains(e.target) && e.target !== moreBtn) {
      closeMenu();
    }
  });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeMenu(); });

  openSettings?.addEventListener('click', () => {
    const willShow = settingsSection?.classList.contains('hidden');
    settingsSection?.classList.toggle('hidden');
    if(willShow) settingsSection?.scrollIntoView({ behavior:'smooth', block:'start' });
    closeMenu();
  });
  document.addEventListener('DOMContentLoaded', () => { settingsSection?.classList.add('hidden'); });

  saveBtn?.addEventListener('click', () => {
    if(editingId){
      const it = items.find(x=>x.id===editingId);
      if(!it){ resetForm(); return; }
      const tNew = title.value.trim(); if(!tNew){ toast('Add a reminder title'); return; }
      let due=null;
      if(date.value || time.value){ const d=(date.value || todayISO()); const tm=(time.value || '09:00'); due = localDateTimeToISO(d,tm); }
      else { const p=parseQuickWhen(tNew); if(p.time){ due = new Date(`${p.date}T${p.time}:00`).toISOString(); } }
      it.title = tNew;
      it.priority=priority.value;
      it.due = due;
      it.updatedAt=Date.now();
      saveToFirebase(it);
      tryCalendarSync(it);
      render();
      scheduleReminder(it);
      emitActivity({ action: 'updated', label: `Reminder updated · ${it.title}` });
      resetForm();
      toast('Reminder updated');
      return;
    }
    const t = title.value.trim(); if(!t){ toast('Add a reminder title'); return; }
    let due=null;
    if(date.value || time.value){ const d=(date.value || todayISO()); const tm=(time.value || '09:00'); due = localDateTimeToISO(d,tm); }
    else { const p=parseQuickWhen(t); if(p.time){ due=new Date(`${p.date}T${p.time}:00`).toISOString(); } }
    addItem({ title:t, priority:priority.value, due });
    title.value=''; time.value='';
  });
  title?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') saveBtn.click(); });

  function updateDateFeedback(){ if(!title || !dateFeedback) return; const text = title.value.trim(); if(!text){ dateFeedback.style.display='none'; return; } try{ const parsed=parseQuickWhen(text); const today=todayISO(); if(parsed.date !== today || parsed.time){ let feedback=''; if(parsed.date !== today){ const dateObj = new Date(parsed.date+'T00:00:00'); feedback+=`📅 ${fmtDayDate(parsed.date)}`; } if(parsed.time){ feedback+=`${feedback ? ' ' : ''}🕐 ${parsed.time}`; } if(feedback){ dateFeedback.textContent=`Parsed: ${feedback}`; dateFeedback.style.display='block'; } else { dateFeedback.style.display='none'; } } else { dateFeedback.style.display='none'; } } catch { dateFeedback.style.display='none'; } }

  title?.addEventListener('input', debounce(updateDateFeedback,300));
  cancelEditBtn?.addEventListener('click', () => { resetForm(); toast('Edit cancelled'); });
  window.addEventListener('load', ()=> title?.focus());
  addQuickBtn?.addEventListener('click', () => { if (!title.value.trim()) { title.focus(); toast('Type something like "email parents at 4pm"'); return; } saveBtn.click(); });
  q?.addEventListener('input', debounce(render,150));
  sortSel?.addEventListener('change', ()=>{ sortKey = sortSel.value; render(); });
  filterBtns.forEach(b => b.addEventListener('click', ()=>{ filter = b.getAttribute('data-filter'); render(); }));

  copyMtlBtn?.addEventListener('click', () => {
    const lines = items.filter(x=>!x.done).map(x=>{ const datePart = x.due ? fmtDayDate(x.due.slice(0,10)) : ''; const timePart = x.due ? new Date(x.due).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit', timeZone: TZ}) : ''; const pieces = [ 'mtl '+x.title, x.due ? `Due Date: ${datePart}` : '', x.due ? `Time: ${timePart}` : '', `Status: Not started` ].filter(Boolean); return pieces.join('\n'); });
    if(lines.length===0){ toast('No active tasks to copy'); return; }
    navigator.clipboard.writeText(lines.join('\n\n')).then(()=>toast('Copied for Master Task List')).catch(()=>toast('Copy failed'));
    closeMenu();
  });

  importFile?.addEventListener('change', () => {
    const f = importFile.files[0]; if(!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const importedItems = JSON.parse(String(rd.result) || '[]').slice(0,500);
        importedItems.forEach(item => { item.id = uid(); items=[item,...items]; saveToFirebase(item); });
        render(); toast('Import successful');
      } catch { toast('Invalid JSON'); }
    };
    rd.readAsText(f); importFile.value='';
    closeMenu();
  });
  exportBtn?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(items,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='memory-cue-mobile.json'; a.click(); URL.revokeObjectURL(url); closeMenu();
  });
  syncAllBtn?.addEventListener('click', async () => {
    const url=(localStorage.getItem('syncUrl')||'').trim();
    if(!url){ toast('Add your Apps Script URL in Settings first'); closeMenu(); return; }
    if(!items.length){ toast('No tasks to sync'); closeMenu(); return; }
    toast('Syncing all tasks…');
    const chunkSize=20; let fail=0;
    for(let i=0;i<items.length;i+=chunkSize){
      const chunk=items.slice(i,i+chunkSize);
      const results=await Promise.allSettled(chunk.map(task=>{ const payload={ id:task.id, title:task.title, dueIso:task.due||null, priority:task.priority||'Medium', done:!!task.done, source:'memory-cue-mobile' }; return fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); }));
      fail += results.filter(r=>r.status==='rejected').length;
      await new Promise(res=>setTimeout(res,400));
    }
    toast(`Sync complete: ${items.length - fail} ok${fail ? `, ${fail} failed` : ''}`);
    closeMenu();
  });

  if(syncUrlInput){ syncUrlInput.value = localStorage.getItem('syncUrl') || ''; }
  saveSettings?.addEventListener('click', () => { if(!syncUrlInput) return; localStorage.setItem('syncUrl', syncUrlInput.value.trim()); toast('Settings saved'); });
  testSync?.addEventListener('click', async () => { if(!syncUrlInput) return; const url = syncUrlInput.value.trim(); if(!url){ toast('Enter URL first'); return; } try{ const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ test:true }) }); toast(res.ok ? 'Test ok' : 'Test failed'); } catch { toast('Test failed'); } });

  try {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(SR){
      recog = new SR();
      recog.lang = locale;
      recog.interimResults = false;
      recog.onresult = (e)=>{ const t=e.results[0][0].transcript||''; if(title){ title.value = t; toast('Heard: '+t); } };
      recog.onend = ()=>{ listening=false; if(voiceBtn) voiceBtn.textContent='🎙️'; };
    }
  } catch {}
  voiceBtn?.addEventListener('click', () => {
    if(!recog) return;
    if(!listening){ try{ recog.start(); listening=true; if(voiceBtn) voiceBtn.textContent='👂'; }catch{} }
    else { try{ recog.stop(); }catch{} listening=false; if(voiceBtn) voiceBtn.textContent='🎙️'; }
  });
  notifBtn?.addEventListener('click', async () => {
    if(!('Notification' in window)){ toast('Notifications not supported'); return; }
    if(Notification.permission === 'granted'){
      toast('Notifications enabled');
      if(supportsNotificationTriggers()) ensureServiceWorkerRegistration();
      rescheduleAllReminders();
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if(perm==='granted'){
        toast('Notifications enabled');
        if(supportsNotificationTriggers()) ensureServiceWorkerRegistration();
        rescheduleAllReminders();
      } else {
        toast('Notifications blocked');
      }
    } catch {
      toast('Notifications blocked');
    }
  });

  rescheduleAllReminders();
  render();
  return {
    cancelReminder,
    scheduleReminder,
    closeActiveNotifications,
    getActiveNotifications: () => activeNotifications,
    addNoteToReminder,
  };
}
