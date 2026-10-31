/* Workspace screens, part 2 */
S.ideas = () => {
  const tabs = [['news','SAP news',6],['drafts','Drafts in progress',7],['backlog','News backlog',9],['tutorial','Tutorial ideas',4]];
  const pips = n => `<span class="rel"><span class="pips">${[1,2,3,4,5].map(i=>`<i class="${i<=n?'on':''}"></i>`).join('')}</span>${n>=5?'High':n>=3?'Good':'Low'} fit</span>`;
  return wsShell(`
    <div class="url-bar">${ic('link')}<input placeholder="Paste an SAP article URL to start a short…" aria-label="SAP article URL"><button class="btn primary" data-go="new" data-st='{"newSrc":"url"}'>${ic('spark','sm')}Draft from URL</button></div>
    <div class="row wrap" style="margin-bottom:16px">
      <div class="segc" role="tablist">${tabs.map(([k,l,c])=>`<button role="tab" aria-pressed="${state.ideasTab===k}" data-st='{"ideasTab":"${k}"}'>${l} <span class="faint">${c}</span></button>`).join('')}</div>
      <span class="sp"></span><span class="hint">Scanned news.sap.com 12 min ago</span><button class="btn sm ghost" data-toast="Scanning official SAP news…">${ic('refresh','sm')}Rescan</button>
    </div>
    <div class="ideas">${ideas.map(x=>`<article class="idea">
      <div class="row wrap" style="gap:6px">${pips(x.rel)}<span class="sp"></span><span class="hint">${x.d}</span></div>
      <h3>${esc(x.t)}</h3>
      <div class="row wrap" style="gap:4px">${x.tags.map(t=>`<span class="chip" style="font-size:11.5px;padding:1px 8px">${t}</span>`).join('')}</div>
      <p class="angle"><b style="color:var(--text)">Angle · </b>${esc(x.angle)}</p>
      ${x.drafted?`<div class="drafted">${ic('film','sm')}Already a short · ${x.drafted}<span class="sp"></span><a href="#" data-go="shorts">Open</a></div>`:''}
      <div class="foot"><a class="btn sm ghost" href="#" data-toast="Opens news.sap.com in your browser">${ic('ext','sm')}Read</a><span class="sp"></span>
        <button class="btn sm ${x.drafted?'':'primary'}" data-go="new">${x.drafted?'New angle':`${ic('plus','sm')}Start short`}</button></div>
    </article>`).join('')}</div>
  `, {title:'Ideas', sub:'Official SAP stories ranked for a 45–60 second short, plus your backlog.', acts:`<button class="btn primary" data-go="new">${ic('plus','sm')}New short</button>`});
};

S.formats = () => wsShell(`
  <div class="formats">${formats.map(f=>`<article class="fmt">
    <span class="thumb" style="--g:${f.g};width:96px;font-size:11px;padding:10px">${f.n}<span class="play"><i>${ic('play','sm')}</i></span></span>
    <div><h3>${f.n}</h3><p>${f.d}</p>
      <div class="hint">Best for: ${f.best}</div>
      <div class="beats" title="Scene rhythm">${f.beats.map((w,i)=>`<i style="--w:${w};--o:${.35+i*.1}"></i>`).join('')}</div>
      <div class="row wrap" style="gap:6px"><button class="btn xs primary" data-go="new" data-st='{"newFmt":"${f.k}"}'>Use format</button>${f.ex?`<button class="btn xs ghost" data-go="review">${ic('play','sm')}${f.ex} example${f.ex>1?'s':''}</button>`:'<span class="hint">No example yet</span>'}</div>
    </div></article>`).join('')}</div>
  <h2 style="margin:34px 0 6px">Same story, four tones</h2>
  <p class="muted" style="margin:0 0 14px">“Your CAP model needs a service”, recorded in each tone. Tap to play.</p>
  <div class="tones">${[['Professional','Heart · 58.7s',G.blue],['Casual','Moty · Casual · 47.6s',G.green],['Comic','Michael · 52.1s',G.amber],['Conversation','Mira & Max · 55.0s',G.violet]].map(([n,m,g])=>`<button class="tone" data-toast="Playing ${n} example" style="padding:0;text-align:left"><span class="thumb" style="--g:${g}">Your CAP model needs a service<span class="play"><i>${ic('play','sm')}</i></span></span><div class="b"><b>${n}</b><div class="hint">${m}</div></div></button>`).join('')}</div>
`, {title:'Formats', sub:'Storytelling structures and tones. Pick one when you start a short, or switch on a new version.'});

const voiceCard = (v, mine) => `<div class="voice ${state.voiceSel===v.id?'sel':''}">
  <button class="playbtn" data-toast="Playing ${esc(v.n)} — “Let’s make SAP feel a little simpler…”" aria-label="Play ${esc(v.n)}">${ic('play')}</button>
  <div style="min-width:0"><b>${esc(v.n)} ${v.def?`<span class="chip brand" style="font-size:11px;padding:0 6px">${ic('star','sm')}Default</span>`:''}</b>
    <small>${v.s}</small><div class="wave ${v.st==='listen'?'':'on'}">${wave(26, v.n.length)}</div></div>
  ${v.st==='listen'?`<button class="btn xs primary" data-toast="Marked as listened — now available in episodes">Approve</button>`
   : v.st==='available'?`<button class="btn xs" title="${v.size} download" data-toast="Installing ${v.n} (${v.size})…">${ic('dl','sm')}Install</button>`
   : `<button class="btn xs ghost icon" aria-label="More" data-toast="Set as default · Rename · Re-record · Delete">${ic('more','sm')}</button>`}
</div>`;

S.voices = () => wsShell(`
  <div class="row" style="margin-bottom:10px"><h2>My voice</h2><span class="chip brand">${ic('check','sm')}Qwen ready</span><span class="sp"></span><button class="btn sm" data-go="addvoice">${ic('plus','sm')}Add a style</button></div>
  <p class="muted" style="margin:0 0 12px;font-size:14px">One recording per delivery style. Listen to each audition before it’s used in an episode.</p>
  <div class="voices">${myVoices.map(v=>voiceCard(v,true)).join('')}<button class="add-tile" data-go="addvoice">${ic('mic')}Record a new style</button></div>
  <div class="callout warn" style="margin-top:12px">${ic('alert')}<div><b>Moty · Calm needs your listen</b><span class="muted">The audition is generated. Approve it to use it in episodes.</span></div></div>

  <div class="row" style="margin:30px 0 10px"><h2>Stock voices</h2><span class="sp"></span><label class="search" style="max-width:260px;height:36px">${ic('search','sm')}<input placeholder="Search 28 voices…" aria-label="Search stock voices"></label></div>
  <div class="voices">${stockVoices.map(v=>voiceCard(v,false)).join('')}</div>
  <p class="hint" style="margin-top:10px">Showing 6 of 28 English voices · <a href="#" data-toast="Shows all 28 Kokoro voices">Show all</a></p>

  <div class="row" style="margin:30px 0 10px"><h2>Presenters</h2><span class="sp"></span><button class="btn sm" data-toast="Choose a photo — face and mouth are detected automatically">${ic('up','sm')}Upload photo</button></div>
  <div class="people">${presenters.map(p=>`<div class="person ${state.presenterSel===p.id?'sel':''}"><span class="portrait" style="--p:${p.p}"></span><b style="font-size:14px">${p.n}</b><small class="${p.warn?'':'faint'}" style="font-size:12px;${p.warn?'color:var(--warn);font-weight:600':''}">${p.warn?ic('alert','sm'):''} ${p.s}</small>
    ${p.warn?`<button class="btn xs" data-toast="Detecting face and mouth…">Align mouth</button>`:`<button class="btn xs ghost" data-toast="5-second motion preview">${ic('play','sm')}Preview</button>`}</div>`).join('')}
    <button class="add-tile" style="border-radius:18px;flex-direction:column" data-toast="Upload a front-facing photo">${ic('image','lg')}Add a photo</button></div>
`, {title:'Voices & presenters', sub:'Who speaks and who appears. Everything here stays on this Mac.'});

S.addvoice = () => {
  const step = state.avStep;
  const sheet = `<div class="scrim" data-close><div class="sheet" style="width:min(640px,100%)" role="dialog" aria-modal="true" aria-labelledby="avT">
    <div class="sheet-h"><div><div class="eyebrow">Add a voice style · Step ${step} of 2</div><h2 id="avT">${step===1?'Record a short passage':'Listen and approve'}</h2></div><span class="sp"></span><button class="btn ghost icon" data-go="voices" aria-label="Close">${ic('x')}</button></div>
    <div class="sheet-b">
      ${step===1?`
      <div class="stack sm"><span class="lbl">Delivery style</span><div class="segc" style="flex-wrap:wrap">${['Professional','Upbeat','Calm','Casual','Comic','News'].map((t,i)=>`<button aria-pressed="${i===2}">${t}</button>`).join('')}</div></div>
      <div class="card pad flat" style="background:var(--surface-2);border:0"><div class="sect-h">Read this aloud, calmly</div><p style="font-size:19px;line-height:1.5;margin:0;font-weight:500">“Let’s slow down for a moment. A good data model is quiet and dependable. Today we’ll see how CAP turns it into a service you can trust.”</p></div>
      <div style="display:grid;justify-items:center;gap:10px;padding:8px 0">
        <button class="playbtn" style="width:76px;height:76px;background:var(--danger);color:#fff" data-toast="Recording… (prototype)" aria-label="Record">${ic('mic','lg')}</button>
        <div class="wave on" style="height:28px">${wave(40,2)}</div><span class="hint">0:07 / aim for 10–20 seconds · quiet room, normal distance</span>
      </div>
      <div class="row wrap"><button class="btn sm ghost">${ic('up','sm')}Upload a recording instead</button></div>`
      :`
      <div class="voice"><button class="playbtn">${ic('play')}</button><div><b>Your take</b><small>0:14 · Calm</small><div class="wave on">${wave(30,5)}</div></div><button class="btn xs ghost">Re-record</button></div>
      <div class="voice sel"><button class="playbtn">${ic('play')}</button><div><b>Qwen audition</b><small>Generated from your take · 0:11</small><div class="wave on">${wave(30,9)}</div></div><span class="chip brand">New</span></div>
      <label class="field"><span class="lbl">Name</span><input class="input" value="Moty · Calm"></label>
      <label class="rcheck"><input type="checkbox" checked><span>This is my voice and I consent to local cloning<small>Stored only on this Mac. Never sent to writing engines.</small></span></label>`}
    </div>
    <div class="sheet-f"><span class="sp"></span>${step===1?`<button class="btn ghost" data-go="voices">Cancel</button><button class="btn primary" data-st='{"avStep":2}'>Next: listen ${ic('chevR','sm')}</button>`
      :`<button class="btn ghost" data-st='{"avStep":1}'>${ic('chevL','sm')}Back</button><button class="btn primary" data-go="voices" data-toast="Moty · Calm is ready to use">Approve voice</button>`}</div>
  </div></div>`;
  return S.voices() + sheet;
};

S.settings = () => {
  const sec = state.settings;
  const nav = [['writing','Writing engine','spark'],['mac','This Mac','mac'],['data','Storage & data','db'],['publishing','Publishing','send']];
  let body = '';
  if (sec==='writing') body = `
    <section class="card"><div class="card-h"><h3>Writing engine</h3><span class="sp"></span><span class="chip brand">${ic('check','sm')}Connected</span></div>
    <div class="card-b stack">
      <p class="muted" style="margin:0;font-size:14px">Used for drafting, rewrites, presentation design and the final AI review. Narration and portraits always run locally.</p>
      ${[['local','Local · LM Studio','Gemma 3 12B recommended. Free and private — nothing leaves this Mac.','Free'],['hyperspace','SAP Hyperspace','Claude, Gemini and GPT via SAP’s LiteLLM proxy. Script text and sources are sent; photos and voice data never are.','May incur cost']]
        .map(([k,n,d,t])=>`<button class="radio-card ${state.provider===k?'sel':''}" data-st='{"provider":"${k}"}'><span class="radio"></span><span><b>${n}</b><small>${d}</small></span><span class="chip ${k==='local'?'brand':'warn'}">${t}</span></button>`).join('')}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        <label class="field"><span class="lbl">Model</span><select class="select">${state.provider==='local'?'<option>gemma-3-12b-it</option><option>qwen3-14b</option>':'<option>gemini-3.8-flash</option><option>claude-sonnet-4-5</option>'}</select></label>
        <label class="field"><span class="lbl">Ask before paid requests</span><select class="select"><option>Once per session</option><option>Every request</option><option>Never ask</option></select></label>
      </div>
      <details><summary style="cursor:pointer;font-weight:600">Advanced · response length &amp; budgets</summary><p class="hint">Final review budget 16,384 tokens · rewrite 8,192 · ideas 2,048</p></details>
    </div></section>
    <section class="card" style="margin-top:16px"><div class="card-h"><h3>Recent requests</h3><span class="sp"></span><span class="hint">This month: 14 requests · ~$0.31</span></div>
    <div class="card-b" style="padding-top:4px"><table class="tbl"><thead><tr><th>When</th><th>Request</th><th class="h-m">Engine</th><th>Cost</th></tr></thead><tbody>
      <tr><td>18:40</td><td>Review current script · NEWS-06</td><td class="h-m">Gemma local</td><td>Free</td></tr>
      <tr><td>17:12</td><td>Final AI review · NEWS-10</td><td class="h-m">gemini-3.8-flash</td><td>$0.02</td></tr>
      <tr><td>Yesterday</td><td>Suggest 3 angles · NEWS-09</td><td class="h-m">gemini-3.8-flash</td><td>$0.01</td></tr></tbody></table></div></section>`;
  else if (sec==='mac') body = `<section class="card"><div class="card-h"><h3>Rendering tools on this Mac</h3><span class="sp"></span><button class="btn sm ghost">${ic('refresh','sm')}Check again</button></div><div class="card-b" style="padding-top:0;padding-bottom:0">
    ${[['wave','Stock narration · Kokoro','420 MB · 2 voices installed','Ready'],['image','Photo alignment · MediaPipe','12 MB','Ready'],['user','Realistic portraits · Ditto MPS','2.32 GB · avg. 8m 38s per short','Ready'],['mic','Your own voice · Qwen3-TTS','5.42 GB · 4 styles','Ready']]
    .map(([i,n,d,s])=>`<div class="tool"><span class="ic">${ic(i)}</span><div><b>${n}</b><small>${d}</small></div><span class="chip brand">${ic('check','sm')}${s}</span></div>`).join('')}</div></section>
    <section class="card pad" style="margin-top:16px"><h3>Other render engines</h3><p class="muted" style="font-size:14px">Register a Mac mini or MacBook Pro to render from the private workspace.</p><button class="btn sm">${ic('plus','sm')}Register a Mac</button></section>`;
  else if (sec==='data') body = `<section class="card pad stack"><h3>Storage &amp; data</h3>
    <div class="row"><span class="bar" style="height:10px"><i style="width:38%"></i></span><span class="hint">18.4 GB of 48 GB used by SAP Shorts</span></div>
    <div class="legend"><span><i style="background:var(--brand)"></i>Videos 9.1 GB</span><span><i style="background:var(--info)"></i>Models 8.1 GB</span><span><i style="background:var(--warn)"></i>Old versions 1.2 GB</span></div>
    <div class="row wrap"><button class="btn sm">${ic('dl','sm')}Export studio as ZIP</button><button class="btn sm ghost">Archive versions older than 30 days</button></div></section>`;
  else body = `<section class="card pad stack"><h3>Publishing</h3><p class="muted" style="margin:0;font-size:14px">The studio doesn’t post for you. These defaults fill the companion post and the publication record.</p>
    <label class="field"><span class="lbl">Default channel</span><select class="select"><option>LinkedIn</option><option>YouTube Shorts</option></select></label>
    <label class="field"><span class="lbl">Post signature</span><input class="input" value="#SAP #SAPDeveloper #Shorts"></label></section>`;
  return wsShell(`<div class="settings"><nav class="snav">${nav.map(([k,n,i])=>`<button aria-current="${sec===k}" data-st='{"settings":"${k}"}'>${ic(i,'sm')}${n}</button>`).join('')}</nav><div>${body}</div></div>`,
    {title:'Settings', sub:'Engines, this Mac and your data.'});
};
