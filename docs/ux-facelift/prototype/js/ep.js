/* Episode screens: one shell, four steps */
const pv = (s, i, extra='') => `<div class="preview" style="--g:${s.g}">
  <div class="pv-top"><span>SAP News</span><span>${esc(s.visual)}</span></div>
  <div class="pv-h">${esc(s.h)}</div>
  <div class="pv-cap">${esc(s.n)}</div>
  <div class="pv-prog">${scenes.map((_,j)=>`<i class="${j<=i?'on':''}"></i>`).join('')}</div>${extra}</div>`;
const meter = s => { const e = est(s), pct = Math.min(100, e/s.p*100);
  return `<div class="meter ${isOver(s)?'over':''}"><span>${words(s.n)} words</span><span class="bar ${isOver(s)?'warn':''}"><i style="width:${pct}%"></i></span><span class="est">${fmt1(e)}s / ${s.p}s</span></div>`; };
const checks = () => { const o=[]; scenes.forEach((s,i)=>{ if (isOver(s)) o.push({i, t:`${s.name} runs long`, b:`~${fmt1(est(s))}s of narration for a ${s.p}s slot. Trim about ${Math.ceil((est(s)-s.p)*WPS)} words.`}); }); return o; };

S.script = () => {
  const i = state.scene, s = scenes[i], ch = checks();
  const total = scenes.reduce((a,x)=>a+x.p,0), spoken = scenes.reduce((a,x)=>a+est(x),0);
  return epShell(`<div class="ed">
    <nav class="card rail" aria-label="Scenes">
      <h4>Scenes</h4>
      ${scenes.map((x,j)=>`<button class="rail-item ${j===i?'active':''}" data-st='{"scene":${j}}'><span class="n">${String(j+1).padStart(2,'0')}</span><span>${esc(x.name)}</span><span class="d ${isOver(x)?'over':''}">${x.p}s</span><span class="bar ${isOver(x)?'warn':''}"><i style="width:${Math.min(100,est(x)/x.p*100)}%"></i></span></button>`).join('')}
      <div class="rail-total"><span>Narration</span><b>${Math.round(spoken)}s / ${total}s</b></div>
    </nav>
    <div>
      <article class="card scene-card">
        <div class="head"><span class="num">${i+1}</span><div style="min-width:0"><h2 style="font-size:17px">${esc(s.name)}</h2><div class="hint">Visual · ${esc(s.visual)}</div></div><span class="sp"></span><span class="chip">${scenes.slice(0,i).reduce((a,x)=>a+x.p,0)}–${scenes.slice(0,i+1).reduce((a,x)=>a+x.p,0)}s</span></div>
        <div class="fields">
          <label class="field"><span class="lbl">On-screen headline <span class="count">${s.h.length}/40</span></span><textarea class="ta headline" rows="1" maxlength="40" data-edit="h">${esc(s.h)}</textarea></label>
          <label class="field"><span class="lbl">Narration <span class="count">Speaks at ~${WPS} words/s</span></span><textarea class="ta narr" rows="4" data-edit="n">${esc(s.n)}</textarea></label>
          <div class="row wrap" style="gap:6px"><span class="hint">Assistant:</span>${['Make it punchier','Shorten to fit','Simplify jargon','Fact-check vs source'].map(t=>`<button class="chip" style="height:28px" data-toast="“${t}” — proposal appears inline for you to accept or reject">${ic('spark','sm')}${t}</button>`).join('')}</div>
        </div>
        <div class="foot"><button class="btn sm" data-toast="Playing scene ${i+1} in Moty · Professional">${ic('play','sm')}Hear this scene</button>${meter(s)}</div>
      </article>
      <div class="scene-nav"><button class="btn" data-st='{"scene":${Math.max(0,i-1)}}' ${i===0?'disabled':''}>${ic('chevL','sm')}Previous</button><span class="pos">Scene ${i+1} of ${scenes.length} <span class="kbd">⌥↑</span> <span class="kbd">⌥↓</span></span><button class="btn" data-st='{"scene":${Math.min(scenes.length-1,i+1)}}' ${i===scenes.length-1?'disabled':''}>Next scene ${ic('chevR','sm')}</button></div>
      <details class="card pad flat" style="margin-top:16px"><summary style="cursor:pointer;font-weight:600">Episode details · title, version note, presentation design</summary>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:12px">
          <label class="field"><span class="lbl">Title</span><input class="input" value="SAP expands Joule agents for supply chain"></label>
          <label class="field"><span class="lbl">Version note <span class="count">optional</span></span><input class="input" value="Tighter hook, fixed captions"></label>
        </div>
        <label class="row" style="margin-top:12px;font-size:14px"><span class="switch"><input type="checkbox" checked><span></span></span>Automatic presentation design · visuals picked for each scene</label>
      </details>
    </div>
    <aside class="side-col">
      ${pv(s,i,'<span class="face"></span>')}
      <section class="card"><div class="card-h" style="padding:12px 14px"><h3>${ic('spark','sm')} Checks</h3><span class="sp"></span><span class="chip ${ch.length?'warn':'brand'}">${ch.length||'All good'}</span></div>
        <div class="card-b stack sm" style="padding:12px 14px">
          ${ch.map(c=>`<div class="chk"><span class="d">!</span><div><b>${esc(c.t)}</b><p>${esc(c.b)}</p><div class="row" style="gap:6px"><button class="btn xs primary" data-toast="Assistant proposal: trimmed to 28 words">Suggest trim</button><button class="btn xs" data-st='{"scene":${c.i}}'>Go to scene</button></div></div></div>`).join('')}
          <div class="chk ok"><span class="d">✓</span><div><b>Claims match source</b><p>3 dated claims · news.sap.com · valid through Nov 2</p></div></div>
          <div class="chk ok"><span class="d">✓</span><div><b>Total length fits</b><p>~${Math.round(spoken)}s narration · target 45–60s</p></div></div>
        </div></section>
    </aside>
  </div>`);
};

S.voice = () => {
  const allV = [...myVoices.filter(v=>v.st==='ready'), ...stockVoices.filter(v=>v.st==='installed')];
  const p = presenters.find(x=>x.id===state.presenterSel);
  return epShell(`<div class="vp">
    <section class="card"><div class="card-h"><h3>${ic('mic','sm')} Voice</h3><span class="sp"></span><button class="btn xs ghost" data-go="voices">Manage voices</button></div>
      <div class="card-b stack">
        <div class="stack sm"><span class="lbl">Narrator</span>
          ${allV.map(v=>`<button class="voice ${state.voiceSel===v.id?'sel':''}" style="text-align:left;grid-template-columns:34px 1fr auto" data-st='{"voiceSel":"${v.id}"}'>
            <span class="playbtn sm" data-toast="Hear scene 1 in ${esc(v.n)}">${ic('play','sm')}</span><span><b>${esc(v.n)}</b><small>${v.s}</small></span>${state.voiceSel===v.id?`<span class="chip brand">${ic('check','sm')}Selected</span>`:''}</button>`).join('')}
        </div>
        <div class="stack sm"><span class="lbl">Delivery</span><div class="segc block">${['Calm','Conversational','Expressive'].map(t=>`<button aria-pressed="${state.delivery===t}" data-st='{"delivery":"${t}"}'>${t}</button>`).join('')}</div></div>
        <div class="stack sm"><span class="lbl">Pronunciation <span class="count">applies to this episode</span></span>
          <div class="pron"><span class="chip">Joule → “jool”</span><span class="chip">SAP → “S-A-P”</span><span class="chip">Q4 → “Q four”</span><button class="chip" style="border-style:dashed">${ic('plus','sm')}Add word</button></div></div>
      </div></section>
    <section class="card"><div class="card-h"><h3>${ic('user','sm')} Presenter</h3><span class="sp"></span><button class="btn xs ghost" data-go="voices">Manage presenters</button></div>
      <div class="card-b stack">
        <div class="pres-stage">
          <span class="portrait lg" style="--p:${p.p}"><span class="mouth"></span></span>
          <div class="stack sm"><b style="font-size:16px">${esc(p.n)}</b><span class="hint">${p.s}</span>
            <div class="thumbs">${presenters.map(x=>`<span class="portrait ${x.id===state.presenterSel?'sel':''}" style="--p:${x.p}" data-st='{"presenterSel":"${x.id}"}' title="${esc(x.n)}" role="button" tabindex="0"></span>`).join('')}<button class="add" aria-label="Upload photo">${ic('plus')}</button></div>
            <button class="btn sm" data-toast="Rendering a 5-second motion preview…">${ic('play','sm')}Preview 5s of motion</button></div>
        </div>
        <div class="stack sm"><span class="lbl">Rendering</span>
          <div class="opt-grid">${[['real','Realistic portrait','Ditto · ~9 min'],['light','Light photo effect','~1 min'],['none','No presenter','Slides only']].map(([k,n,d])=>`<button class="opt ${state.render===k?'sel':''}" data-st='{"render":"${k}"}'><b>${n}</b><small>${d}</small></button>`).join('')}</div></div>
        <div class="stack sm"><span class="lbl">Movement <span class="count">${state.move<35?'Restrained':state.move<70?'Natural':'Lively'}</span></span>
          <input type="range" class="range" min="0" max="100" value="${state.move}" style="--v:${state.move}%" data-range="move" aria-label="Movement amount"></div>
        <details><summary style="cursor:pointer;font-weight:600;font-size:14px">Fine-tune mouth alignment</summary><p class="hint">Drag the green outline on the portrait, or <a href="#" data-toast="Detecting face and mouth…">detect automatically</a>.</p></details>
      </div></section>
  </div>`);
};

S.produce = () => {
  const running = state.produce === 'running';
  const items = [
    ['check','Script','7 scenes · 109 words · ~51s of narration','script','Edit'],
    ['check','Voice','Moty · Professional · Conversational delivery','voice','Change'],
    ['check','Presenter','Moty — office · realistic portrait · mouth aligned','voice','Change'],
    ['check','Sources','news.sap.com · reviewed Oct 26 · valid through Nov 2','', 'View'],
    ['check','Companion post','212 characters · LinkedIn draft ready','review','Edit'],
  ];
  const left = running ? `
    <section class="card"><div class="card-h"><h3>${ic('refresh','sm spin')} Producing v8</h3><span class="sp"></span><span class="chip info">About 4 min left</span></div>
      <div class="card-b">
        <div class="bar" style="height:10px;margin:4px 0 14px"><i style="width:62%;background:var(--info)"></i></div>
        ${[['done','Saved as v8','<1s'],['done','Narration · Moty · Professional','1m 25s'],['done','Captions aligned to speech','12s'],['now','Animating presenter · scene 5 of 7','4m 51s'],['','Encoding vertical MP4',''],['','Quality checks · duration, captions, faces','']]
        .map(([c,n,t])=>`<div class="pstage ${c}"><span class="ic">${c==='done'?ic('check','sm'):c==='now'?ic('refresh','sm spin'):'·'}</span><b style="font-weight:${c?'600':'500'}">${n}</b><span class="t">${t}</span></div>`).join('')}
        <div class="callout" style="margin-top:12px">${ic('clock')}<div><b>You can leave this page</b><span class="muted">Production keeps running on this Mac. You’ll get a notification when the video is ready to review.</span></div></div>
      </div>
      <div class="card-b row" style="border-top:1px solid var(--border)"><button class="btn sm ghost danger" data-st='{"produce":"ready"}'>Cancel production</button><span class="sp"></span><button class="btn sm" data-go="shorts">Back to Shorts</button><button class="btn sm primary" data-go="review">Skip to finished (demo)</button></div>
    </section>` : `
    <section class="card"><div class="card-h"><h3>Ready to produce</h3><span class="sp"></span><span class="chip brand">${ic('check','sm')}5 of 5 ready</span></div>
      ${items.map(([i,n,d,go,a])=>`<div class="pf-item"><span class="ic">${ic(i,'sm')}</span><div><b>${n}</b><small>${d}</small></div>${go?`<button class="btn xs ghost" data-go="${go}">${a}</button>`:`<button class="btn xs ghost" data-toast="Sources drawer">${a}</button>`}</div>`).join('')}
      <div class="pf-item opt"><span class="ic">${ic('spark','sm')}</span><div><b>AI content review <span class="chip" style="font-size:11px;padding:0 7px">Optional</span></b><small>Checks script, post and headlines against saved evidence. Text only.</small></div>
        <button class="btn xs" data-toast="Running review with Gemma (local, free)…">Run with Gemma · free</button></div>
    </section>`;
  return epShell(`<div class="pf">
    <div>${left}</div>
    <aside class="stack">
      <section class="card pad stack sm" style="text-align:center;justify-items:center">
        ${pv(scenes[0],0).replace('class="preview"','class="preview mini"')}
        <b style="font-size:15px">${running?'Producing on this Mac':'About 10 minutes on this Mac'}</b>
        <span class="hint">Last similar short: 10m 4s · audio 1m 25s · portrait 8m 38s</span>
        ${running?'':`<button class="btn primary lg block" data-st='{"produce":"running"}'>${ic('film','sm')}Save &amp; produce v8</button><button class="btn sm ghost block" data-toast="Downloaded NEWS-06-v8.json">${ic('dl','sm')}Download script instead</button>`}
      </section>
      <details class="card pad flat"><summary style="cursor:pointer;font-weight:600">What changed since v7</summary><ul class="hint" style="padding-left:18px"><li>Hook headline rewritten</li><li>Scene 2: removed stray “&amp;nbsp”</li><li>Scenes 3–4: fixed capitalisation after “First,” / “Second,”</li></ul></details>
    </aside>
  </div>`, {mbar: running ? `<button class="btn" data-go="shorts">Back to Shorts</button><button class="btn primary" data-go="review">Finished (demo)</button>` : `<button class="btn icon" data-go="deck" aria-label="Preview deck">${ic('eye')}</button><button class="btn primary" data-st='{"produce":"running"}'>Save &amp; produce</button>`});
};

S.review = () => {
  const c = state.checks, all = c.every(Boolean), ap = state.approved, pub = state.published;
  const items = [['Speech sounds natural','Pronunciation of Joule, SAP, Q4'],['Face and lip movement look right','Especially scenes 3 and 5'],['Captions match what is said','Auto-aligned from narration'],['Facts match the sources','news.sap.com · valid through Nov 2']];
  const st = (n) => n===1 ? (ap?'done':'cur') : n===2 ? (pub?'done':ap?'cur':'locked') : (pub?'done':ap?'':'locked');
  const tabs = [['transcript','Transcript'],['sources','Sources'],['details','Details']];
  return epShell(`<div class="rv">
    <div class="stack">
      <div class="player">
        <div class="row" style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#6cf0e0"><span>SAP / DEVELOPER SHORTS</span><span class="sp"></span><span>01 / 07</span></div>
        <div class="big">Autonomous enterprise arrives</div>
        <div class="lst"><div><span>01</span>GA planned for Q4 2026</div><div><span>02</span>Agents for supply chain</div><div><span>03</span>Decision velocity</div></div>
        <div class="cap">Autonomous enterprise is finally here.</div><span class="face"></span>
        <div class="ctrl"><button class="playbtn sm" style="background:#fff;color:#0a1424" aria-label="Play">${ic('play','sm')}</button><span>0:00</span><span class="chapters">${[3,7,11,10,12,6,6].map((w,i)=>`<i style="--w:${w}" class="${i===0?'on':''}"></i>`).join('')}</span><span>0:51</span></div>
      </div>
      <div class="card"><div class="card-h" style="padding:8px 10px"><div class="segc" style="border:0;background:transparent">${tabs.map(([k,l])=>`<button aria-pressed="${state.rvTab===k}" data-st='{"rvTab":"${k}"}'>${l}</button>`).join('')}</div></div>
        <div class="card-b" style="font-size:13.5px">${state.rvTab==='transcript' ? `<div class="stack sm">${[scenes[0].n, scenes[1].n, scenes[2].n].map((t,i)=>`<div class="row top"><span class="chip mono" style="padding:0 6px">0:${String([0,3,10][i]).padStart(2,'0')}</span><span>${t}</span></div>`).join('')}</div>`
          : state.rvTab==='sources' ? `<div class="stack sm"><a class="row" href="#" data-toast="Opens news.sap.com">${ic('ext','sm')}SAP Expands Joule Assistants and Agents to Advance Autonomous Supply Chain…</a><span class="hint">Reviewed Oct 26 · valid through Nov 2 (UTC). Re-read before sharing current news.</span></div>`
          : `<b>Produced in 10m 4s</b><div class="gen-bar"><i style="flex:.2;background:var(--faint)"></i><i style="flex:14;background:var(--info)"></i><i style="flex:86;background:var(--brand)"></i></div><div class="legend"><span><i style="background:var(--faint)"></i>Prep &lt;1s</span><span><i style="background:var(--info)"></i>Audio 1m 25s</span><span><i style="background:var(--brand)"></i>Portrait 8m 38s</span></div><p class="hint">Moty · Professional (Qwen) · Ditto realistic · 50.8s · 1080×1920</p>`}</div></div>
    </div>
    <section class="card">
      <div class="pub-step ${st(1)}"><span class="n">${ap?ic('check','sm'):1}</span>
        <div class="row"><h3>Final check</h3><span class="sp"></span>${ap?`<span class="chip brand">Approved</span>`:`<span class="chip warn">To review</span>`}</div>
        ${ap?`<p class="hint" style="margin:0">Approved for this exact MP4 · <a href="#" data-st='{"approved":false,"published":false,"checks":[false,false,false,false]}'>Undo approval</a></p>`:`
        <p class="hint" style="margin:0 0 6px">Watch the whole short, then confirm each point.</p>
        ${items.map(([t,s],i)=>`<label class="rcheck"><input type="checkbox" ${c[i]?'checked':''} data-check="${i}"><span>${t}<small>${s}</small></span></label>`).join('')}
        <div class="row wrap" style="margin-top:8px"><button class="btn primary" ${all?'':'disabled'} data-st='{"approved":true}'>${ic('check','sm')}Approve video</button><button class="btn ghost" data-go="script">${ic('edit','sm')}Needs changes · edit as v9</button></div>`}
      </div>
      <div class="pub-step ${st(2)}"><span class="n">${pub?ic('check','sm'):ap?2:ic('lock','sm')}</span>
        <h3>Download &amp; post</h3>
        <p class="hint" style="margin:0 0 10px">${ap?'Post it on your channel. The studio never uploads for you.':'Unlocks after approval.'}</p>
        ${ap?`<div class="row wrap" style="margin-bottom:12px"><button class="btn sm primary" data-toast="Downloading NEWS-06-v8.mp4 (19.4 MB)">${ic('dl','sm')}MP4 · 19 MB</button><button class="btn sm" data-toast="Downloading package ZIP">${ic('dl','sm')}Full package</button></div>
        <div class="post-prev"><div class="who"><span class="avatar">M</span><div><b>Moty</b><small>LinkedIn preview · 612 / 3,000</small></div><span class="sp"></span><button class="btn xs" data-toast="Post text copied">${ic('copy','sm')}Copy</button></div>
        Supply chain teams don’t lack decisions. They lack time.<br><br>Three details from SAP’s Joule announcement:<br>• General availability of the new capabilities is planned for Q4 2026.<br>• …<br><a href="#" data-toast="Opens the post editor">Edit post</a></div>`:''}
      </div>
      <div class="pub-step ${st(3)}"><span class="n">${pub?ic('check','sm'):ap?3:ic('lock','sm')}</span>
        <h3>Record where it’s live</h3>
        ${pub?`<p style="margin:4px 0 0;font-size:14px">${ic('link','sm')} <a href="#">linkedin.com/posts/moty_joule-agents…</a> <span class="chip" style="margin-left:6px">Recorded Oct 28</span></p>`
        : `<p class="hint" style="margin:0 0 10px">${ap?'Paste the post link. This is your record — the studio doesn’t check it.':'Unlocks after you post.'}</p>
        ${ap?`<div class="row"><input class="input" placeholder="https://www.linkedin.com/posts/…" aria-label="Post URL"><button class="btn primary" data-st='{"published":true}'>Save</button></div>`:''}`}
      </div>
    </section>
  </div>`, {mbar: ap ? (pub ? `<button class="btn primary" data-go="shorts">Done · back to Shorts</button>` : `<button class="btn" data-toast="Post text copied">${ic('copy','sm')}Copy post</button><button class="btn primary" data-toast="Downloading MP4">${ic('dl','sm')}Download MP4</button>`)
      : `<button class="btn" data-go="script">Needs changes</button><button class="btn primary" ${all?'':'disabled'} data-st='{"approved":true}'>Approve</button>`});
};

S.deck = () => {
  const i = state.deckScene, s = scenes[i];
  let t = 0;
  return epShell(`<div class="deck">
    <div class="deck-stage">
      ${pv(s,i,'<span class="face"></span>')}
      <div class="deck-ctrl"><button class="btn sm icon" data-st='{"deckScene":${Math.max(0,i-1)}}' aria-label="Previous">${ic('chevL','sm')}</button><button class="btn sm" data-toast="Playing deck with narration">${ic('play','sm')}Play with narration</button><button class="btn sm icon" data-st='{"deckScene":${Math.min(6,i+1)}}' aria-label="Next">${ic('chevR','sm')}</button><button class="btn sm" data-toast="Focus view">${ic('eye','sm')}Focus</button></div>
    </div>
    <aside class="stack">
      <div class="row"><h2>Story &amp; evidence</h2><span class="sp"></span><span class="chip">Saved v7 deck</span></div>
      <div class="scene-list">${scenes.map((x,j)=>{ const a=t; t+=x.p; return `<button class="scene-li ${j===i?'on':''}" data-st='{"deckScene":${j}}'><span class="chip mono" style="padding:0 6px">${String(j+1).padStart(2,'0')}</span><span>${esc(x.h)}</span><small>${a}–${t}s</small></button>`;}).join('')}</div>
      <div class="callout info">${ic('spark')}<div><b>Restyle the deck</b><span class="muted">“Ocean colors, punchier headlines.” The assistant proposes; you apply.</span><div style="margin-top:8px"><button class="btn xs" data-go="script">Open assistant</button></div></div></div>
    </aside>
  </div>`);
};
