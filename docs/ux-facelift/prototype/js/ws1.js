/* Workspace screens, part 1 */
const S = {};

S.setup = () => {
  const tools = [
    {i:'wave', n:'Stock narration', d:'Kokoro voices Heart and Michael', size:'420 MB', st:'ready', req:true},
    {i:'image', n:'Photo alignment', d:'Finds the mouth automatically when you add a photo', size:'12 MB', st:'ready', req:true},
    {i:'user', n:'Realistic portraits', d:'Ditto animates a photo with speech on Apple Silicon', size:'2.32 GB', st:'installing', pct:64},
    {i:'mic', n:'Your own voice', d:'Qwen narrates from a short recording of you', size:'5.42 GB', st:'optional'},
  ];
  const stc = t => t.st==='ready' ? `<span class="chip brand">${ic('check','sm')}Ready</span>`
    : t.st==='installing' ? `<div style="min-width:180px;display:grid;gap:4px"><span class="row" style="font-size:12.5px;color:var(--info);font-weight:600">${ic('refresh','sm spin')}Installing · ${t.pct}%<span class="sp"></span><span class="faint">~4 min</span></span><span class="bar"><i style="width:${t.pct}%;background:var(--info)"></i></span></div>`
    : `<button class="btn sm" data-toast="Downloading Qwen voice cloning (5.42 GB)…">${ic('dl','sm')}Install · ${t.size}</button>`;
  return `<div class="setup">
    <div class="row wrap" style="gap:12px;margin-bottom:28px"><span class="logo">S</span><b style="font-size:17px">SAP Shorts</b><span class="sp"></span><span class="chip">${ic('shield','sm')}Everything stays on this Mac</span></div>
    <div class="row top" style="gap:20px;margin-bottom:24px">
      <div class="ring" style="--p:75" data-l="3/4"></div>
      <div><div class="eyebrow">Welcome</div><h1 class="title">Let’s get this Mac ready to make shorts</h1>
      <p class="muted" style="margin:4px 0 0">You can start writing right away. Rendering tools finish installing in the background.</p></div>
    </div>
    <section class="card">
      <div class="card-h"><h3>Rendering tools</h3><span class="sp"></span><span class="faint" style="font-size:13px">Apple M3 Pro · 41 GB free</span></div>
      <div class="card-b" style="padding-top:0;padding-bottom:0">
        ${tools.map(t=>`<div class="tool"><span class="ic">${ic(t.i)}</span><div><b>${t.n} ${t.req?'<span class="chip" style="font-size:11px;padding:0 7px">Required</span>':t.st==='optional'?'<span class="chip" style="font-size:11px;padding:0 7px">Optional</span>':''}</b><small>${t.d} · ${t.size}</small></div>${stc(t)}</div>`).join('')}
      </div>
    </section>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:18px">
      <button class="card pad" style="text-align:left;display:grid;gap:6px;border-color:var(--brand)" data-go="new">${ic('plus','lg')}<b>Start your first short</b><span class="muted" style="font-size:13.5px">Pick an SAP news story or a tutorial idea. Writing doesn’t need the render tools.</span></button>
      <button class="card pad" style="text-align:left;display:grid;gap:6px" data-toast="Renders the CAP sample with Heart narration (~2 min)">${ic('play','lg')}<b>Make a sample video</b><span class="muted" style="font-size:13.5px">See the whole workflow end to end with the CAP tutorial sample.</span></button>
    </div>
    <details style="margin-top:18px" class="card pad flat"><summary style="cursor:pointer;font-weight:600">Activity log &amp; troubleshooting</summary><pre style="font-size:12px;color:var(--muted);white-space:pre-wrap">18:42:10  Kokoro voices verified (af_heart, am_michael)\n18:42:11  MediaPipe face landmarker verified\n18:42:15  Downloading Ditto MPS runtime… 1.48 / 2.32 GB</pre></details>
  </div>`;
};

S.signin = () => `<div class="auth">
  <div class="auth-art">
    <div class="row"><span class="logo" style="background:#e2efe8;color:#145239">S</span><b style="color:#fff">SAP Shorts</b><span class="chip" style="background:transparent;border-color:rgba(255,255,255,.25);color:#cfe3d8">Private workspace</span></div>
    <div class="phones"><div class="thumb" style="--g:${G.blue}">Follow the money</div><div class="thumb" style="--g:${G.violet};margin-top:40px">Autonomous enterprise</div></div>
    <h1>Make technical stories worth watching.</h1>
    <p style="margin:0;max-width:440px;color:#b9d6c7">Your scripts, voices and presenters, in one place. Render on your own registered Macs, from any device.</p>
  </div>
  <div class="auth-form"><form onsubmit="return false">
    <div><h2 style="font-size:24px">Sign in</h2><p class="muted" style="margin:4px 0 0">Access is by invitation. Same studio as on your Mac.</p></div>
    <label class="field"><span class="lbl">Work email</span><input class="input" type="email" value="moty@example.com" autocomplete="email"></label>
    <label class="field"><span class="lbl">Password <a href="#" class="count" data-toast="Password reset email sent">Forgot?</a></span><input class="input" type="password" value="••••••••••" autocomplete="current-password"></label>
    <label class="row" style="font-size:14px"><span class="switch"><input type="checkbox" checked><span></span></span>Keep me signed in on this device</label>
    <button class="btn primary lg block" data-go="shorts">Sign in</button>
    <div class="divider"></div>
    <p class="hint" style="margin:0;text-align:center">New here? <a href="#" data-toast="Request sent to workspace admin">Request an invite</a></p>
  </form></div>
</div>`;

const counts = () => { const c = {all:stories.length}; for (const s of stories) c[s.stage]=(c[s.stage]||0)+1; return c; };
const thumb = (s, w=56) => s.draft ? `<span class="thumb draft" style="width:${w}px">${esc(s.short)}</span>`
  : `<span class="thumb" style="--g:${s.g};width:${w}px">${esc(s.short)}${s.stage!=='producing'?'<span class="play"><i>'+ic('play','sm')+'</i></span>':''}</span>`;
const primaryFor = s => ({
  editing:['Continue editing','script'], producing:['View progress','produce'], review:['Review video','review'], publish:['Finish publishing','review'], live:['View post','review']
}[s.stage]);

function storyRow(s){
  const [pl, pg] = primaryFor(s);
  const open = state.open === s.id && versionsOf[s.id];
  const len = s.dur ? `${s.dur}s` : `${s.planned}s planned`;
  return `<article class="story ${open?'open':''}">
    ${thumb(s)}
    <div class="t"><b>${esc(s.title)}</b>
      <div class="meta"><span class="chip mono" style="padding:0 6px">${s.id}</span><span>${s.type}</span><span class="sep">·</span><span>${len}</span><span class="sep">·</span>
      <button class="ver-btn" data-open="${s.id}" aria-expanded="${!!open}">${s.versions} version${s.versions>1?'s':''} ${ic('chev','sm')}</button></div></div>
    <div class="stage-col">${stagePill(s.stage)}${s.stage==='producing'?`<div class="bar" style="margin-top:6px;max-width:120px"><i style="width:${s.progress}%;background:var(--info)"></i></div>`:''}</div>
    <span class="upd">${s.upd}</span>
    <div class="acts"><button class="btn sm ${s.stage==='editing'||s.stage==='review'||s.stage==='publish'?'primary':''}" data-go="${pg}">${pl}</button>
      <button class="btn sm icon mprimary" style="display:none" data-go="${pg}" aria-label="${pl}">${ic('chevR')}</button>
      <button class="btn sm ghost icon" aria-label="More actions" data-toast="More: Preview deck · Edit new version · Download package · Duplicate as new format · Archive">${ic('more')}</button></div>
    ${s.attn?`<div class="warnline" style="color:var(--${s.attn.kind})">${ic('alert','sm')}${s.attn.text}</div>`:''}
    ${open?`<div class="versions">
      <div class="vrow head"><span>Version</span><span>Note</span><span>Stage</span><span>Length</span><span>Voice</span><span></span></div>
      ${versionsOf[s.id].map(v=>`<div class="vrow"><span class="vn">${v.v}${v.cur?' <span class="chip brand" style="font-size:11px;padding:0 6px">Latest</span>':''}</span><span class="note">${esc(v.note)} <span class="faint">· ${v.when}</span></span><span>${stagePill(v.stage)}</span><span class="faint">${v.len}</span><span class="faint">${v.voice}</span>
      <span class="row" style="justify-content:flex-end;gap:4px">${v.stage==='review'?`<button class="btn xs" data-go="review">Watch</button>`:`<button class="btn xs" data-go="script">Open</button>`}<button class="btn xs ghost" data-toast="Compare ${v.v} with v8 side by side">Compare</button></span></div>`).join('')}
      <div class="row" style="padding:8px 4px 2px;font-size:12.5px"><span class="faint">+ 3 older versions</span><span class="sp"></span><button class="btn xs ghost" data-toast="Archived versions are hidden but kept on disk">Archive old versions</button></div>
    </div>`:''}
  </article>`;
}

function board(){
  const cols = ['editing','producing','review','publish','live'];
  return `<div class="board">${cols.map(c=>{ const items = stories.filter(s=>s.stage===c);
    return `<section class="col"><div class="col-h">${stagePill(c)}<span class="c">${items.length}</span></div>
    ${items.map(s=>`<button class="kcard" data-go="${primaryFor(s)[1]}" style="text-align:left">${thumb(s,38)}<div><b>${esc(s.title)}</b><small>${s.id} · ${s.versions} versions</small>${s.attn?`<div style="color:var(--${s.attn.kind});font-size:12px;margin-top:4px">${ic('alert','sm')} Needs attention</div>`:''}</div></button>`).join('') || '<p class="empty-note">Nothing here yet.<br>Approved videos you record as posted land here.</p>'}
    </section>`;}).join('')}</div>`;
}

S.shorts = () => {
  const c = counts();
  const f = state.shortsFilter;
  const list = stories.filter(s => f==='all' || s.stage===f || (f==='attn' && s.attn));
  const pipe = [['all','All'],['editing','Editing'],['producing','Producing'],['review','To review'],['publish','To publish'],['live','Published']];
  const attn = `<div class="attn">
    <button class="attn-card" data-go="review"><span class="ic" style="background:var(--warn-soft);color:var(--warn)">${ic('eye')}</span><div><b>Review “Follow the money”</b><p>47.6s video is ready · produced 2 h ago</p><span class="btn xs primary">Review video</span></div></button>
    <button class="attn-card" data-go="produce"><span class="ic" style="background:var(--danger-soft);color:var(--danger)">${ic('alert')}</span><div><b>Retry “Real cash beats chatty bots”</b><p>v2 stopped on old timing limits. It fits the new 15–90s range.</p><span class="btn xs">Retry production</span></div></button>
    <button class="attn-card" data-go="ideas"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${ic('news')}</span><div><b>2 new SAP stories worth a short</b><p>“Empower AI developers” and “AI release highlights Q3”</p><span class="btn xs">See ideas</span></div></button>
  </div>`;
  return wsShell(`
    <h2 class="sect-h">Needs you</h2>${attn}
    <div class="pipe" role="group" aria-label="Filter by stage">
      ${pipe.map(([k,l],i)=>`${i>1?`<span class="arrow">${ic('chevR','sm')}</span>`:''}<button class="pipe-btn" aria-pressed="${f===k}" data-filter="${k}">${k!=='all'?`<span class="${STAGES[k].cls}" style="color:var(--c)"><span class="dot"></span></span>`:''}${l}<span class="c">${c[k]||0}</span></button>`).join('')}
    </div>
    <div class="toolbar">
      <label class="search" style="max-width:340px;height:36px">${ic('search','sm')}<input placeholder="Filter shorts…" aria-label="Filter shorts"></label>
      <div class="segc desk"><button aria-pressed="true">All types</button><button aria-pressed="false">News 7</button><button aria-pressed="false">Tutorials 2</button></div>
      <span class="sp"></span>
      <select class="select desk" style="width:auto;height:36px;font-size:13.5px" aria-label="Sort"><option>Recently updated</option><option>Needs attention first</option><option>Title A–Z</option></select>
      <div class="segc" role="group" aria-label="View"><button aria-pressed="${state.shortsView==='list'}" data-view="list" aria-label="List">${ic('list','sm')}</button><button aria-pressed="${state.shortsView==='board'}" data-view="board" aria-label="Board">${ic('grid','sm')}</button></div>
    </div>
    ${state.shortsView==='board' ? board() : `<div class="list">${list.map(storyRow).join('') || '<p class="empty-note">No shorts in this stage.</p>'}</div>
      <p class="hint" style="text-align:center;margin-top:16px">9 stories · 62 versions saved on this Mac</p>`}
  `, {title:'Shorts', sub:'Good evening, Moty. One video is waiting for your review.', acts:`<button class="btn" data-go="ideas">${ic('bulb','sm')}Browse ideas</button><button class="btn primary" data-go="new">${ic('plus','sm')}New short</button>`});
};

S.new = () => {
  const srcs = [['news','SAP news story','Pick from today’s scanned stories',ic('news')],['url','Article URL','Paste any news.sap.com link',ic('link')],['tutorial','Tutorial idea','From your tutorial backlog',ic('book')],['blank','Blank script','Write it yourself',ic('edit')]];
  const sheet = `<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="newT">
    <div class="sheet-h"><div><div class="eyebrow">New short</div><h2 id="newT">What’s the story?</h2></div><span class="sp"></span><button class="btn ghost icon" data-go="shorts" aria-label="Close">${ic('x')}</button></div>
    <div class="sheet-b">
      <section class="stack sm"><span class="lbl">1 · Start from</span>
        <div class="opt-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${srcs.map(([k,n,d,i])=>`<button class="opt ${state.newSrc===k?'sel':''}" data-st='{"newSrc":"${k}"}'><b>${i}${n}</b><small>${d}</small></button>`).join('')}</div>
        ${state.newSrc==='url' ? `<input class="input" placeholder="https://news.sap.com/2026/10/…" aria-label="Article URL">` :
          `<div class="src-card"><span class="thumb draft" style="width:34px"></span><div><b style="font-size:14px">SAP Empowers AI Developers to Build What Matters</b><div class="hint">news.sap.com · Oct 27 · <span style="color:var(--brand);font-weight:600">High relevance</span> · no short yet</div></div><button class="btn xs ghost" data-go="ideas">Change</button></div>`}
      </section>
      <section class="stack sm"><div class="row"><span class="lbl">2 · Format</span><span class="sp"></span><button class="btn xs ghost" data-go="formats">Compare formats</button></div>
        <div class="opt-grid">${formats.map(f=>`<button class="opt ${state.newFmt===f.k?'sel':''}" data-st='{"newFmt":"${f.k}"}'><b>${f.n}</b><small>${f.d}</small><span class="beats" style="margin:4px 0 0">${f.beats.map((w,i)=>`<i style="--w:${w};--o:${.35+i*.1}"></i>`).join('')}</span></button>`).join('')}</div>
      </section>
      <section class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
        <div class="stack sm"><span class="lbl">3 · Tone</span><div class="segc block">${['Professional','Casual','Comic'].map(t=>`<button aria-pressed="${state.newTone===t}" data-st='{"newTone":"${t}"}'>${t}</button>`).join('')}</div></div>
        <div class="stack sm"><span class="lbl">4 · Target length <span class="count">${state.newLen}s</span></span><input type="range" class="range" min="30" max="90" step="5" value="${state.newLen}" style="--v:${(state.newLen-30)/60*100}%" data-range="newLen" aria-label="Target length"><span class="hint" style="margin-top:-6px">Shorts perform best at 45–60s. 15–90s is accepted.</span></div>
      </section>
      <section class="stack sm"><span class="lbl">5 · Narrator</span>
        <div class="row wrap">${['Moty · Professional','Heart','Michael'].map((v,i)=>`<button class="chip ${i===0?'brand':''}" style="height:32px;font-size:13px">${ic('play','sm')}${v}</button>`).join('')}<button class="chip" style="height:32px">Decide later</button></div>
      </section>
      <div class="callout brand">${ic('spark')}<div><b>Draft with Gemma (local, free)</b><span class="muted">Writes 7 scenes with dated claims from the article, plus a companion post. You review everything before recording. <a href="#" data-go="settings">Change engine</a></span></div></div>
    </div>
    <div class="sheet-f"><span class="hint">Creates NEWS-11 · v1. Nothing is recorded until you choose Produce.</span><span class="sp"></span><button class="btn ghost" data-go="shorts">Cancel</button><button class="btn primary" data-go="script">${ic('spark','sm')}Create draft</button></div>
  </div></div>`;
  return S.shorts() + sheet;
};
