import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { initializeFirestore, getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, persistentLocalCache, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';

export function initReminders(sel = {}) {
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
  let notesMemory = '';
  try {
    scheduledReminders = JSON.parse(localStorage.getItem('scheduledReminders') || '{}');
  } catch {
    scheduledReminders = {};
  }

  // Formatting helpers
  const TZ = 'Australia/Adelaide';
  const timeFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const dateOnlyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
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
  const datePartsFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timePartsFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
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

  // Notes
  if(notesEl){
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

  function addItem(obj){ if(!userId){ toast('Sign in to add reminders'); return; } const nowMs=Date.now(); const item={ id: uid(), title: obj.title.trim(), priority: obj.priority||'Medium', notes: obj.notes||'', done:false, createdAt: nowMs, updatedAt: nowMs, due: obj.due || null }; items=[item,...items]; render(); saveToFirebase(item); tryCalendarSync(item); scheduleReminder(item); return item; }
  function toggleDone(id){ const it=items.find(x=>x.id===id); if(!it) return; it.done=!it.done; it.updatedAt=Date.now(); saveToFirebase(it); tryCalendarSync(it); render(); if(it.done) cancelReminder(id); else scheduleReminder(it); }
  function removeItem(id){ items=items.filter(x=>x.id!==id); render(); deleteFromFirebase(id); cancelReminder(id); }

  function saveScheduled(){ localStorage.setItem('scheduledReminders', JSON.stringify(scheduledReminders)); }
  function cancelReminder(id){ if(reminderTimers[id]){ clearTimeout(reminderTimers[id]); delete reminderTimers[id]; } if(scheduledReminders[id]){ delete scheduledReminders[id]; saveScheduled(); } }
  function showReminder(item){ try{ new Notification(item.title,{ body:'Due now', tag:item.id }); }catch{} }
  function scheduleReminder(item){ if(!item||!item.id) return; if(!item.due || item.done){ cancelReminder(item.id); return; } scheduledReminders[item.id]={ id:item.id, title:item.title, due:item.due }; saveScheduled(); if(reminderTimers[item.id]){ clearTimeout(reminderTimers[item.id]); delete reminderTimers[item.id]; } if(!('Notification' in window) || Notification.permission!=='granted'){ return; } const delay=new Date(item.due).getTime()-Date.now(); if(delay<=0){ showReminder(item); cancelReminder(item.id); return; } reminderTimers[item.id]=setTimeout(()=>{ showReminder(item); cancelReminder(item.id); }, delay); }
  function rescheduleAllReminders(){ Object.values(scheduledReminders).forEach(it=>scheduleReminder(it)); }

  function render(){
    const now = new Date();
    const adlNow = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
    const t0 = new Date(adlNow); t0.setHours(0,0,0,0);
    const t1 = new Date(adlNow); t1.setHours(23,59,59,999);
    const w0 = startOfWeek(adlNow);
    const w1 = endOfWeek(adlNow);
    const todays = items.filter(x => x.due && new Date(x.due) >= t0 && new Date(x.due) <= t1 && !x.done);
    const weeks  = items.filter(x => x.due && new Date(x.due) >= w0 && new Date(x.due) <= w1 && !x.done);
    if(countTodayEl) countTodayEl.textContent = String(todays.length);
    if(countWeekEl) countWeekEl.textContent = String(weeks.length);

    let rows = items.slice();
    const queryStr = q?.value.trim().toLowerCase() || '';
    if(queryStr){ rows = rows.filter(r => r.title.toLowerCase().includes(queryStr) || (r.notes||'').toLowerCase().includes(queryStr)); }
    rows = rows.filter(r => {
      if(filter==='done') return r.done;
      if(filter==='overdue') return !r.done && r.due && new Date(r.due) < adlNow;
      if(filter==='today'){ if(!r.due) return true; const dueAdl = new Date(new Date(r.due).toLocaleString('en-US',{timeZone:TZ})); return dueAdl >= t0 && dueAdl <= t1; }
      return true;
    });
    rows.sort((a,b)=>{ if(sortKey==='time') return (+new Date(a.due||0))-(+new Date(b.due||0)); if(sortKey==='priority') return priorityWeight(b.priority)-priorityWeight(a.priority); return smartCompare(a,b); });
    filterBtns.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-filter')===filter));
    if(!list) return;
    if(rows.length===0){ list.innerHTML = '<div class="text-muted">No reminders found.</div>'; return; }
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    rows.forEach(r => {
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
      it.title = tNew; it.priority=priority.value; it.due = due; it.updatedAt=Date.now(); saveToFirebase(it); tryCalendarSync(it); render(); scheduleReminder(it); resetForm(); toast('Reminder updated'); return;
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
    const lines = items.filter(x=>!x.done).map(x=>{ const datePart = x.due ? fmtDayDate(x.due.slice(0,10)) : ''; const timePart = x.due ? new Date(x.due).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}) : ''; const pieces = [ 'mtl '+x.title, x.due ? `Due Date: ${datePart}` : '', x.due ? `Time: ${timePart}` : '', `Status: Not started` ].filter(Boolean); return pieces.join('\n'); });
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
      recog.lang = 'en-AU';
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
    if(Notification.permission === 'granted'){ toast('Notifications enabled'); return; }
    const perm = await Notification.requestPermission(); toast(perm==='granted'? 'Notifications enabled':'Notifications blocked');
  });

  rescheduleAllReminders();
  render();
}

