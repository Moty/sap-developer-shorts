/* Prototype controller: routing, device frame, theme and interactions */
const EP = new Set(['script','voice','produce','review','deck']);

function render(keepScroll){
  const vp = $('#viewport');
  const top = keepScroll ? vp.scrollTop : 0;
  const fn = S[state.screen] || S.shorts;
  $('#app').innerHTML = fn();
  $('#app').dataset.screen = state.screen;
  document.documentElement.dataset.theme = state.theme;
  $('#device').className = 'device ' + state.device;
  $('#screenSel').value = state.screen;
  $$('#devSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.dev === state.device));
  const i = SCREENS.findIndex(s=>s.id===state.screen);
  $('#pos').textContent = `${i+1} / ${SCREENS.length}`;
  vp.scrollTop = top;
  $$('#app .ta').forEach(t => { t.style.height='auto'; t.style.height = t.scrollHeight + 2 + 'px'; });
  const h = `#${state.screen}${state.device==='phone'?'~phone':''}`;
  if (location.hash !== h) history.replaceState(null,'',h);
}

function go(screen, patch){
  if (patch) Object.assign(state, patch);
  const changed = screen && screen !== state.screen;
  if (screen) state.screen = screen;
  if (screen === 'addvoice' && changed) state.avStep = 1;
  render(!changed);
}

let tt;
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove('show'),2600); }

document.addEventListener('click', e => {
  const scrim = e.target.classList?.contains('scrim') ? e.target : null;
  if (scrim){ go(state.screen==='addvoice'?'voices':'shorts'); return; }
  const el = e.target.closest('[data-go],[data-st],[data-toast],[data-filter],[data-view],[data-open],[data-dev]');
  if (!el || el.closest('.proto') && !el.dataset.dev) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.dataset.dev){ state.device = el.dataset.dev; render(true); return; }
  if (el.dataset.toast) toast(el.dataset.toast);
  if (el.dataset.filter){ state.shortsFilter = el.dataset.filter; state.shortsView='list'; render(true); return; }
  if (el.dataset.view){ state.shortsView = el.dataset.view; render(true); return; }
  if (el.dataset.open){ state.open = state.open===el.dataset.open ? null : el.dataset.open;
    if (!versionsOf[el.dataset.open]) toast(`${el.dataset.open}: version list (prototype shows NEWS-06)`); render(true); return; }
  const patch = el.dataset.st ? JSON.parse(el.dataset.st) : null;
  if (el.dataset.go || patch) go(el.dataset.go, patch);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.check !== undefined){ state.checks[+t.dataset.check] = t.checked; render(true); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.range){ state[t.dataset.range] = +t.value; t.style.setProperty('--v', ((t.value - t.min)/(t.max - t.min)*100)+'%');
    const c = t.closest('.stack')?.querySelector('.count'); if (c) c.textContent = t.dataset.range==='newLen' ? t.value+'s' : (t.value<35?'Restrained':t.value<70?'Natural':'Lively'); }
  if (t.dataset.edit){ scenes[state.scene][t.dataset.edit] = t.value; t.style.height='auto'; t.style.height=t.scrollHeight+2+'px';
    clearTimeout(t._r); t._r = setTimeout(()=>{ const pos = t.selectionStart, key = t.dataset.edit; render(true); const n = $(`[data-edit="${key}"]`); n.focus(); n.setSelectionRange(pos,pos); }, 500); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('.scrim')) { go(state.screen==='addvoice'?'voices':'shorts'); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    if (e.altKey && state.screen==='script' && /Arrow(Up|Down)/.test(e.key)){ e.preventDefault(); go(null,{scene:Math.max(0,Math.min(6,state.scene+(e.key==='ArrowDown'?1:-1)))}); }
    return;
  }
  if (e.key === ']' || e.key === '[') step(e.key === ']' ? 1 : -1);
  if (e.altKey && state.screen==='script' && /Arrow(Up|Down)/.test(e.key)) go(null,{scene:Math.max(0,Math.min(6,state.scene+(e.key==='ArrowDown'?1:-1)))});
});
function step(d){ const i = SCREENS.findIndex(s=>s.id===state.screen); const n = SCREENS[(i+d+SCREENS.length)%SCREENS.length]; go(n.id); }

function boot(){
  const groups = [...new Set(SCREENS.map(s=>s.g))];
  $('#screenSel').innerHTML = groups.map(g=>`<optgroup label="${g}">${SCREENS.filter(s=>s.g===g).map(s=>`<option value="${s.id}">${s.n}</option>`).join('')}</optgroup>`).join('');
  $('#screenSel').onchange = e => go(e.target.value);
  $('#prevS').onclick = () => step(-1);
  $('#nextS').onclick = () => step(1);
  $('#themeBtn').onclick = () => { state.theme = state.theme==='dark'?'light':'dark'; localStorage.setItem('ux-theme', state.theme); render(true); };
  const [h, dev] = location.hash.slice(1).split('~');
  if (SCREENS.some(s=>s.id===h)) state.screen = h;
  if (dev === 'phone' && innerWidth >= 700) state.device = 'phone';
  state.theme = localStorage.getItem('ux-theme') || 'light';
  if (innerWidth < 700) $('#devSeg').style.display='none';
  addEventListener('hashchange', () => { const [x, d] = location.hash.slice(1).split('~'); if (SCREENS.some(s=>s.id===x)){ state.screen=x; if (d==='phone' && innerWidth>=700) state.device='phone'; render(); } });
  render();
}
boot();
