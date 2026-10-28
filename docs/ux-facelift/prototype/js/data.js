/* Icons, helpers and realistic data taken from the local studio library */
const P = {
  plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  play:'<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>', pause:'<path d="M8 5v14M16 5v14"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>', chev:'<path d="m6 9 6 6 6-6"/>', chevR:'<path d="m9 6 6 6-6 6"/>', chevL:'<path d="m15 6-6 6 6 6"/>',
  more:'<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  spark:'<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  film:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M19 19v2H6"/>',
  bulb:'<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', alert:'<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  dl:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  up:'<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>', grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>', x:'<path d="M6 6l12 12M18 6 6 18"/>',
  left:'<path d="M19 12H5M11 18l-6-6 6-6"/>', right:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  mac:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', wave:'<path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h-2"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', news:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>', send:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  db:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>', ext:'<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
};
const ic = (n, cls='') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]||''}</svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const STAGES = {
  ideas:{label:'Idea', cls:'s-ideas'}, editing:{label:'Editing', cls:'s-editing'}, producing:{label:'Producing', cls:'s-producing'},
  review:{label:'To review', cls:'s-review'}, publish:{label:'To publish', cls:'s-publish'}, live:{label:'Published', cls:'s-live'}
};
const stagePill = k => `<span class="stage-pill ${STAGES[k].cls}"><span class="dot"></span>${STAGES[k].label}</span>`;
const G = {
  teal:'linear-gradient(160deg,#0f3d3a,#123049 70%)', blue:'linear-gradient(165deg,#0d3b5c,#14294b 60%,#0a1424)',
  green:'linear-gradient(150deg,#0f5132,#1d6b4e 55%,#52b788)', violet:'linear-gradient(150deg,#2b1a4a,#5b3a9b 60%,#a98bf0)',
  rose:'linear-gradient(150deg,#3d1530,#8a2c5f 60%,#e47aa9)', amber:'linear-gradient(150deg,#4a2508,#a2541a 60%,#f2a65a)',
  navy:'linear-gradient(150deg,#14213d,#1d4e89 60%,#5aa9e6)', slate:'linear-gradient(150deg,#1b2a22,#2f4a3c 60%,#8fb9a3)'
};

/* The real library lists 62 saved versions; they belong to only 9 stories. */
const stories = [
  {id:'NEWS-06', title:'SAP expands Joule agents for supply chain', short:'Joule agents advance', type:'News', stage:'editing', versions:8, latest:'v8', note:'Tighter hook, fixed captions', planned:55, upd:'25 min ago', g:G.green, draft:true, voice:'Moty · Professional',
    attn:{kind:'warn', text:'Sources valid through Nov 2 — 5 days left'}},
  {id:'NEWS-10', title:'SAP finance: follow the money', short:'Follow the money', type:'News', stage:'review', versions:2, latest:'v2', note:'Quality review', dur:47.6, upd:'2 h ago', g:G.blue, voice:'Moty · Upbeat'},
  {id:'NEWS-07', title:'Joule Work and the SAP Business AI platform', short:'Joule Work platform', type:'News', stage:'producing', versions:1, latest:'v1', note:'First draft', planned:52, upd:'Now', g:G.navy, voice:'Heart', progress:62},
  {id:'NEWS-09', title:'Real cash beats chatty bots', short:'Real cash', type:'News', stage:'review', versions:3, latest:'v3', note:'Shorter opening', dur:53.4, upd:'Yesterday', g:G.amber, voice:'Moty · Professional',
    attn:{kind:'danger', text:'v2 stopped on old timing limits — can be retried'}},
  {id:'NEWS-03', title:'SAP puts the autonomous enterprise to work', short:'Autonomous enterprise', type:'News', stage:'publish', versions:3, latest:'v3', note:'Approved', dur:56.2, upd:'Yesterday', g:G.violet, voice:'Heart'},
  {id:'NEWS-02', title:'Joule Work: rollout, context and access', short:'Joule Work rollout', type:'News', stage:'review', versions:8, latest:'v8', note:'Myth vs fact', dur:48.3, upd:'Oct 24', g:G.rose, voice:'Mira & Max',
    attn:{kind:'danger', text:'Source review expired Oct 20 — recheck before sharing'}},
  {id:'NEWS-01', title:'SAP Connect: available now or still planned?', short:'Now or planned?', type:'News', stage:'review', versions:12, latest:'v12', note:'New ending', dur:51.0, upd:'Oct 22', g:G.teal, voice:'Heart'},
  {id:'CAP-01', title:'Your CAP model needs a service', short:'CAP needs a service', type:'Tutorial', stage:'review', versions:23, latest:'v23', note:'Feed pop edition', dur:47.6, upd:'Oct 21', g:G.slate, voice:'Moty · Casual'},
  {id:'CAP-02', title:'Seed and query local CAP data', short:'Seed CAP data', type:'Tutorial', stage:'review', versions:2, latest:'v2', note:'Quiz format', dur:53.7, upd:'Oct 19', g:G.teal, voice:'Michael'},
];
const versionsOf = {
  'NEWS-06':[
    {v:'v8', note:'Tighter hook, fixed captions', stage:'editing', len:'55s planned', voice:'Moty · Professional', when:'25 min ago', cur:true},
    {v:'v7', note:'Professional · clear explainer', stage:'editing', len:'55s planned', voice:'Moty · Professional', when:'Today 18:02'},
    {v:'v6', note:'Shorter middle scenes', stage:'review', len:'47.1s MP4', voice:'Moty · Professional', when:'Today 15:40'},
    {v:'v5', note:'Expressive delivery', stage:'review', len:'49.5s MP4', voice:'Moty · Upbeat', when:'Yesterday'},
    {v:'v4', note:'Original import', stage:'review', len:'49.5s MP4', voice:'Heart', when:'Oct 26'},
  ]
};

const ideas = [
  {t:'SAP Expands Joule Assistants and Agents to Advance Autonomous Supply Chain Management', d:'Oct 8', rel:4, tags:['Joule','Supply chain'], angle:'Separate what is generally available in Q4 from roadmap agents, then ask which decision you would automate first.', drafted:'NEWS-06 · 8 versions'},
  {t:'SAP Empowers AI Developers to Build What Matters', d:'Oct 27', rel:5, tags:['BTP','Developers','TechEd'], angle:'Show one concrete developer workflow from intent to deployed agent, naming the exact tools in the release.'},
  {t:'AI Release Highlights Q3 2026', d:'Oct 26', rel:5, tags:['Business AI','Roundup'], angle:'Three quick takeaways: the three capabilities with confirmed availability dates; skip the rest.'},
  {t:'SAP Showcases the Autonomous Enterprise in Action', d:'Oct 7', rel:3, tags:['Cloud ERP','Customers'], angle:'Myth vs fact: “autonomous” does not mean unattended. Show the human approval step.', drafted:'NEWS-03 · 3 versions'},
  {t:'How Joule Work and SAP Business AI Platform Are Powering the Next Generation of Business AI', d:'Oct 8', rel:3, tags:['Joule','Platform'], angle:'Explain the platform layering in one diagram: data → agents → Joule Work.', drafted:'NEWS-07 · producing'},
  {t:'SAP Advances Finance Operations with Embedded Payments and New Consolidation', d:'Oct 12', rel:2, tags:['Finance','Cloud ERP'], angle:'Follow the money: payments inside ERP today, consolidation early adopter in Q1 2027.', drafted:'NEWS-09, NEWS-10'},
];

const formats = [
  {k:'explainer', n:'Clear explainer', d:'One useful idea, a working example and a practical takeaway.', best:'Announcements, single features', beats:[3,7,11,10,12,6,6], ex:3, g:G.blue},
  {k:'duo', n:'Two-person conversation', d:'A curious developer and a helpful colleague, with two distinct voices.', best:'Tutorials, “why should I care?”', beats:[4,8,8,8,8,8,6], ex:2, g:G.violet},
  {k:'myth', n:'Myth vs fact', d:'Open with a misconception, then demonstrate what actually happens.', best:'Hype corrections, rollout timing', beats:[5,10,10,12,8,6], ex:1, g:G.rose},
  {k:'three', n:'Three quick takeaways', d:'A numbered roundup with a short payoff for each point.', best:'Release roundups, events', beats:[3,6,12,12,12,6,4], ex:1, g:G.amber},
  {k:'problem', n:'Problem to solution', d:'Start with a familiar developer problem and show the turning point.', best:'Hands-on tutorials', beats:[6,10,14,14,8,6], ex:0, g:G.green},
  {k:'quiz', n:'Quick challenge', d:'Ask viewers to predict a result, then reveal the verified answer.', best:'Engagement, CAP / CDS quirks', beats:[5,6,16,10,10,6], ex:1, g:G.navy},
];

const scenes = [
  {name:'Hook', visual:'Opening hook', p:3, g:G.green, h:'Autonomous enterprise arrives', n:'Autonomous enterprise is finally here.'},
  {name:'Context', visual:'As of Oct 26, 2026', p:7, g:'linear-gradient(150deg,#123c4a,#1f6f7a 60%,#6cc5c0)', h:'What changed today', n:'Checked today from official SAP news. Supply chain teams never lack decisions to make. What they increasingly lack is time.'},
  {name:'Headline 1', visual:'Official announcement', p:11, g:G.navy, h:'1. Core announcement', n:'First, general availability for these new capabilities is planned for Q4 2026.'},
  {name:'Headline 2', visual:'Architecture & impact', p:10, g:G.violet, h:'2. Why it matters', n:'Second, that is the direction behind everything SAP is introducing at SAP Connect in 2026.'},
  {name:'Headline 3', visual:'Rollout & availability', p:12, g:G.rose, h:'3. When it ships', n:'Third, even the most intelligent supply chains can struggle to turn a meaningful signal into a well-governed response. I think of that as decision velocity: how quickly an organization can recognize change.'},
  {name:'Payoff', visual:'Editorial takeaway', p:6, g:G.amber, h:'Editorial takeaway', n:'My takeaway: agents are only as useful as the tabular enterprise data behind them.'},
  {name:'Call to action', visual:'Discussion & CTA', p:6, g:G.slate, h:'Read source. Share thoughts.', n:'Read the official announcement linked below. How will this change your architecture?'},
];
const WPS = 2.5;
const words = t => t.trim().split(/\s+/).filter(Boolean).length;
const est = s => words(s.n) / WPS;
const fmt1 = n => (Math.round(n*10)/10).toFixed(1).replace(/\.0$/,'');
const isOver = s => est(s) > s.p + 0.4;

const myVoices = [
  {id:'mp', n:'Moty · Professional', s:'My voice · Qwen', st:'ready'},
  {id:'mu', n:'Moty · Upbeat', s:'My voice · Qwen', st:'ready'},
  {id:'mc', n:'Moty · Casual', s:'My voice · Qwen', st:'ready'},
  {id:'mk', n:'Moty · Calm', s:'My voice · Qwen', st:'listen'},
];
const stockVoices = [
  {id:'heart', n:'Heart', s:'US English · warm', st:'installed', def:true},
  {id:'michael', n:'Michael', s:'US English · steady', st:'installed'},
  {id:'bella', n:'Bella', s:'US English · bright', st:'available', size:'330 MB'},
  {id:'emma', n:'Emma', s:'UK English · crisp', st:'available', size:'330 MB'},
  {id:'george', n:'George', s:'UK English · deep', st:'available', size:'330 MB'},
  {id:'nicole', n:'Nicole', s:'US English · soft', st:'available', size:'330 MB'},
];
const presenters = [
  {id:'moty1', n:'Moty — office', s:'Photo · mouth aligned', p:'linear-gradient(135deg,#d5b28e,#8a6444)'},
  {id:'moty2', n:'Moty — studio', s:'Photo · needs alignment', p:'linear-gradient(135deg,#c9a27f,#6c4c33)', warn:true},
  {id:'mira', n:'Mira', s:'Animated host', p:'linear-gradient(135deg,#9fd8c8,#2f8f79)'},
  {id:'max', n:'Max', s:'Animated host', p:'linear-gradient(135deg,#a9b9f2,#4d5fb8)'},
];
const wave = (n=28, seed=3) => { let o=''; for (let i=0;i<n;i++){ const h = 4 + Math.abs(Math.sin(i*1.7+seed)*14) + (i%5===0?3:0); o += `<i style="height:${Math.min(20,h)}px"></i>`; } return o; };
