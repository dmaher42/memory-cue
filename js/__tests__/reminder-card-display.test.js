/** @jest-environment jsdom */
const fs = require('fs');
const vm = require('vm');
function load() {
  const source = fs.readFileSync(require('path').resolve(__dirname, '../../src/ui/reminderCardDisplay.js'), 'utf8').replace(/export function /g, 'function ');
  const context = vm.createContext({document, localStorage, window});
  vm.runInContext(source, context);
  return context;
}
function card(api, id='one') {
  const el=document.createElement('div'); el.dataset.reminderItem='true';el.dataset.id=id;el.dataset.title='Long reminder';el.innerHTML='<div class="reminder-row-main"></div>';
  el.getBoundingClientRect=()=>({height:parseFloat(el.style.getPropertyValue('--reminder-card-height'))||60});document.body.append(el);api.attachReminderCardResize(el,{notes:'Extra detail'});return el;
}
beforeEach(()=>{localStorage.clear();document.body.innerHTML='<input type="checkbox" id="reminderResizableCards"><button id="resetReminderCardSizes"></button>';});
test('optional resizing saves per-card heights, restores them, and resets without touching reminders',()=>{
  localStorage.setItem('memoryCue:offlineReminders','[{"id":"one","title":"Keep me"}]');
  const api=load();api.initReminderCardDisplay();const a=card(api);const b=card(api,'two');expect(a.classList.contains('reminder-resizable')).toBe(false);
  const toggle=document.getElementById('reminderResizableCards');toggle.checked=true;toggle.dispatchEvent(new Event('change'));
  const handle=a.querySelector('.reminder-resize-handle');handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  expect(a.style.getPropertyValue('--reminder-card-height')).toBe('84px');expect(b.style.getPropertyValue('--reminder-card-height')).toBe('60px');
  const restored=card(load());expect(restored.style.getPropertyValue('--reminder-card-height')).toBe('84px');
  toggle.checked=false;toggle.dispatchEvent(new Event('change'));expect(a.style.getPropertyValue('--reminder-card-height')).toBe('');
  toggle.checked=true;toggle.dispatchEvent(new Event('change'));expect(a.style.getPropertyValue('--reminder-card-height')).toBe('84px');
  document.getElementById('resetReminderCardSizes').click();expect(a.style.getPropertyValue('--reminder-card-height')).toBe('60px');
  expect(localStorage.getItem('memoryCue:offlineReminders')).toBe('[{"id":"one","title":"Keep me"}]');
});
test('invalid stored preferences recover safely and pointer cancellation restores height',()=>{
  localStorage.setItem('memoryCue:reminderCardDisplay','bad json');const api=load();api.initReminderCardDisplay();const a=card(api);const toggle=document.getElementById('reminderResizableCards');toggle.checked=true;toggle.dispatchEvent(new Event('change'));
  const handle=a.querySelector('button');handle.setPointerCapture=()=>{};
  const pointer=(type, y)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.assign(e,{button:0,pointerId:1,clientY:y});handle.dispatchEvent(e);};
  pointer('pointerdown',100);pointer('pointermove',180);expect(a.style.getPropertyValue('--reminder-card-height')).toBe('140px');pointer('pointercancel',180);expect(a.style.getPropertyValue('--reminder-card-height')).toBe('60px');
  pointer('pointerdown',100);pointer('pointermove',200);pointer('pointerup',200);expect(JSON.parse(localStorage.getItem('memoryCue:reminderCardDisplay')).heights.one).toBe(160);
});

test('cards can shrink to the compact minimum and remember it',()=>{
 const api=load();api.initReminderCardDisplay();const a=card(api);const toggle=document.getElementById('reminderResizableCards');toggle.checked=true;toggle.dispatchEvent(new Event('change'));const handle=a.querySelector('button');
 for(let i=0;i<8;i++)handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));
 expect(a.style.getPropertyValue('--reminder-card-height')).toBe('60px');expect(card(load()).style.getPropertyValue('--reminder-card-height')).toBe('60px');
});
