/* Global state, screen registry and the two application shells */
const SCREENS = [
  {id:'setup', g:'First run', n:'Set up this Mac'},
  {id:'signin', g:'First run', n:'Sign in (private workspace)'},
  {id:'shorts', g:'Workspace', n:'Shorts — home'},
  {id:'new', g:'Workspace', n:'New short (sheet)'},
  {id:'ideas', g:'Workspace', n:'Ideas & SAP news'},
  {id:'formats', g:'Workspace', n:'Formats'},
  {id:'voices', g:'Workspace', n:'Voices & presenters'},
  {id:'addvoice', g:'Workspace', n:'Add a voice style (sheet)'},
  {id:'settings', g:'Workspace', n:'Settings'},
  {id:'script', g:'Episode', n:'1 · Script'},
  {id:'voice', g:'Episode', n:'2 · Voice & presenter'},
  {id:'produce', g:'Episode', n:'3 · Produce'},
  {id:'review', g:'Episode', n:'4 · Review & publish'},
  {id:'deck', g:'Episode', n:'Deck preview'},
];
const state = {
  screen:'shorts', device:'desktop', theme:'light',
  shortsView:'list', shortsFilter:'all', open:'NEWS-06',
  ideasTab:'news', scene:0, voiceSel:'mp', presenterSel:'moty1', render:'real', delivery:'Conversational', move:55,
  produce:'ready', checks:[false,false,false,false], approved:false, published:false, rvTab:'transcript',
  settings:'writing', provider:'local', newFmt:'explainer', newTone:'Professional', newLen:55, newSrc:'news', avStep:1, deckScene:0,
};

const navItems = [
  {id:'shorts', n:'Shorts', i:'film', c:'9'},
  {id:'ideas', n:'Ideas', i:'bulb', c:'6 new', badge:true},
  {id:'voices', n:'Voices & presenters', i:'mic'},
  {id:'formats', n:'Formats', i:'layers'},
];
const activeNav = () => ({new:'shorts', addvoice:'voices'}[state.screen] || state.screen);

function wsShell(content, {title, sub, acts=''} = {}) {
  const cur = activeNav();
  return `<div class="shell">
    <aside class="side" aria-label="Workspace">
      <a class="brandmark" href="#" data-go="shorts"><span class="logo">S</span><div><b>SAP Shorts</b><small>Creator studio</small></div></a>
      <button class="btn primary new" data-go="new">${ic('plus')}<span class="new-txt">New short</span></button>
      <nav class="nav">
        ${navItems.map(n=>`<button data-go="${n.id}" ${cur===n.id?'aria-current="page"':''} title="${n.n}">${ic(n.i)}<span class="lbl-t">${n.n}</span>${n.c?`<span class="n ${n.badge?'badge':''}">${n.c}</span>`:''}</button>`).join('')}
      </nav>
      <div class="foot">
        <button class="job" data-go="produce" data-st='{"produce":"running"}' title="Producing NEWS-07">
          <span class="row" style="gap:6px">${ic('refresh','sm spin')}<b>Producing · Joule Work platform</b></span>
          <span>Portrait animation · ~3 min left</span>
          <span class="bar"><i style="width:62%"></i></span>
        </button>
        <nav class="nav"><button data-go="settings" ${cur==='settings'?'aria-current="page"':''} title="Settings">${ic('gear')}<span class="lbl-t">Settings</span></button></nav>
        <button class="mac-status" data-go="setup" title="This Mac">${ic('mac')}<div><b>This Mac is ready</b><span class="faint">4 of 4 tools · local only</span></div></button>
      </div>
    </aside>
    <div class="main">
      <div class="mtop"><span class="logo">S</span><b>${esc(title||'SAP Shorts')}</b><span class="sp"></span>
        <button class="btn ghost sm icon" aria-label="Search">${ic('search')}</button>
        <button class="btn ghost sm icon" data-go="produce" data-st='{"produce":"running"}' aria-label="Production running" style="color:var(--info)">${ic('refresh','spin')}</button>
        <span class="avatar">M</span></div>
      <div class="topbar">
        <label class="search">${ic('search','sm')}<input placeholder="Search shorts, scripts, ideas and voices…" aria-label="Search"><span class="kbd">⌘K</span></label>
        <span class="sp"></span>
        <button class="btn ghost sm" data-go="settings">${ic('spark','sm')}Gemma · local</button>
        <span class="avatar" title="Moty">M</span>
      </div>
      <div class="page">
        ${title ? `<div class="page-h"><div><h1 class="title">${esc(title)}</h1>${sub?`<p class="sub">${sub}</p>`:''}</div><div class="acts">${acts}</div></div>` : ''}
        ${content}
      </div>
      <nav class="mtabs" aria-label="Sections">
        <button data-go="shorts" ${cur==='shorts'?'aria-current="page"':''}>${ic('film')}Shorts</button>
        <button data-go="ideas" ${cur==='ideas'?'aria-current="page"':''}>${ic('bulb')}Ideas</button>
        <button data-go="new" aria-label="New short"><span class="plus">${ic('plus','lg')}</span></button>
        <button data-go="voices" ${cur==='voices'?'aria-current="page"':''}>${ic('mic')}Voices</button>
        <button data-go="settings" ${['settings','formats'].includes(cur)?'aria-current="page"':''}>${ic('menu')}More</button>
      </nav>
    </div>
  </div>`;
}

const EP_STEPS = [
  {id:'script', n:'Script', sub:'7 scenes · 55s'},
  {id:'voice', n:'Voice & presenter', sub:'Moty · Ditto'},
  {id:'produce', n:'Produce', sub:'~10 min on this Mac'},
  {id:'review', n:'Review & publish', sub:'Approve · post · record'},
];
const NEXT = {script:['voice','Next: Voice'], voice:['produce','Next: Produce'], produce:['review','Review video'], review:['shorts','Back to Shorts'], deck:['script','Edit script']};

function epShell(content, {mbar} = {}) {
  const cur = state.screen;
  const idx = EP_STEPS.findIndex(s=>s.id===cur);
  const [nx, nl] = NEXT[cur];
  const dirty = ['script','voice'].includes(cur);
  return `
  <header class="ep-top">
    <button class="btn ghost sm icon" data-go="shorts" aria-label="Back to Shorts">${ic('chevL')}</button>
    <span class="thumb" style="--g:${G.green};width:30px;flex:none;border-radius:7px"></span>
    <div class="ep-id">
      <span class="t">SAP expands Joule agents for supply chain</span>
      <span class="s"><span class="chip mono" style="padding:0 6px">NEWS-06</span>
        <button class="ver-btn" data-toast="Version switcher: v8 (editing) · v7 · v6 (MP4) · v5 (MP4) · v4 — compare or restore">v8 · ${({script:'draft',voice:'draft',produce:'saved'})[cur]||'MP4 ready'} ${ic('chev','sm')}</button>
        <span class="desk">Professional · Clear explainer</span></span>
    </div>
    <span class="sp"></span>
    <span class="save-st ${dirty?'':'ok'} desk"><span class="dot"></span>${dirty?'Unsaved changes':'All changes saved'}</span>
    <button class="btn sm ghost desk" data-go="deck">${ic('eye','sm')}Preview deck</button>
    <button class="btn sm desk" data-toast="Saved as v8 — previous versions are kept">Save</button>
    <button class="btn sm primary desk" data-go="${nx}">${nl} ${ic('chevR','sm')}</button>
  </header>
  <nav class="steps" aria-label="Episode steps">
    ${EP_STEPS.map((s,i)=>`${i?'<span class="stp-sep"></span>':''}<button class="stp ${i<idx || (cur==='deck'&&i===0)?'done':''}" data-go="${s.id}" ${s.id===cur?'aria-current="step"':''}>
      <span class="n">${i<idx?ic('check','sm'):i+1}</span><span><span class="lbl-t">${s.n}</span><span class="sub"> · ${s.sub}</span></span></button>`).join('')}
    <span class="tools"><button class="btn sm ghost" data-toast="Sources drawer: 1 official source · reviewed Oct 26 · valid through Nov 2">${ic('book','sm')}Sources <span class="chip" style="padding:0 6px">1</span></button></span>
  </nav>
  <main class="ep-page">${content}</main>
  <div class="mbar">${mbar || `<button class="btn icon" data-go="deck" aria-label="Preview deck">${ic('eye')}</button><button class="btn" data-toast="Saved as v8">Save</button><button class="btn primary" data-go="${nx}">${nl}</button>`}</div>`;
}
