// Console UI — one served HTML file, zero dependencies.
// Design tokens (locked in the plan): ink #0B0E16, card #151A28, line #262D40,
// text #F2F4F9, mute #8A93AB, foil #C9A96A. RAG green/amber/red reserved for
// meaning. Signature: ticket-shaped pass cards with notched edges; staleness
// as a visible wear state. ui-monospace carries the boarding-pass vernacular.

export function renderConsolePage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StatusPass — Console</title>
<style>
  :root{--ink:#0B0E16;--card:#151A28;--line:#262D40;--text:#F2F4F9;--mute:#8A93AB;--foil:#C9A96A;
        --green:#5FB98A;--amber:#D9A441;--red:#D96C6C;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ink);color:var(--text);font:16px/1.5 -apple-system,system-ui,sans-serif}
  main{max-width:720px;margin:0 auto;padding:20px 16px 80px}
  header{display:flex;align-items:baseline;gap:10px;margin:8px 0 20px}
  header h1{font-size:1.05rem;margin:0;letter-spacing:.02em}
  header .foil{color:var(--foil);font-family:var(--mono);font-size:.75rem;letter-spacing:.14em}
  nav{display:flex;gap:6px;margin-bottom:22px}
  nav button{flex:1;padding:10px 0;border-radius:10px;border:1px solid var(--line);background:none;color:var(--mute);font-size:.9rem;cursor:pointer}
  nav button[aria-current="true"]{background:var(--card);color:var(--text);border-color:var(--foil)}
  nav button:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--foil);outline-offset:2px}

  /* ── the signature: ticket cards ── */
  .pass{position:relative;background:var(--card);border:1px solid var(--line);border-radius:14px;
        padding:16px 18px 14px 22px;margin-bottom:14px;overflow:hidden;cursor:pointer}
  .pass::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--band,#2E3A5C)}
  .pass::after{content:"";position:absolute;right:-8px;top:50%;width:16px;height:16px;border-radius:50%;
        background:var(--ink);border:1px solid var(--line);transform:translateY(-50%)}
  .pass .who{font-size:.8rem;color:var(--mute);letter-spacing:.08em;text-transform:uppercase}
  .pass .phase{font-family:var(--mono);font-size:1.3rem;letter-spacing:.04em;margin:2px 0 8px}
  .pass .meta{display:flex;gap:8px;align-items:center;font-size:.78rem;font-family:var(--mono);color:var(--mute)}
  .chip{padding:2px 8px;border-radius:99px;border:1px solid var(--line)}
  .chip.fresh{color:var(--green);border-color:var(--green)}
  .chip.quiet{color:var(--amber);border-color:var(--amber)}
  .chip.stale{color:var(--red);border-color:var(--red)}
  .chip.rag-green{color:var(--green)}.chip.rag-yellow{color:var(--amber)}.chip.rag-red{color:var(--red)}

  /* ── internal status board ── */
  .board{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;-webkit-overflow-scrolling:touch}
  .col{min-width:150px;flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px}
  .col h3{margin:0 0 10px;font-family:var(--mono);font-size:.72rem;letter-spacing:.1em;color:var(--mute);text-transform:uppercase}
  .col.dragover{border-color:var(--foil)}
  .tk{background:var(--ink);border:1px solid var(--line);border-radius:9px;padding:9px 10px;margin-bottom:8px;
      font-size:.82rem;cursor:grab;position:relative}
  .tk::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:3px 0 0 3px;background:var(--band,#2E3A5C)}
  .tk:active{cursor:grabbing}
  .boardgroup{margin-bottom:20px}
  .boardgroup>label{margin-top:0}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}
  label{display:block;font-size:.72rem;letter-spacing:.09em;color:var(--mute);text-transform:uppercase;margin:14px 0 6px}
  input,select,textarea{width:100%;padding:11px;border-radius:10px;border:1px solid var(--line);
        background:var(--ink);color:var(--text);font-size:.95rem}
  textarea{font-family:var(--mono);min-height:84px;resize:vertical}
  .row{display:flex;gap:10px}.row>*{flex:1}
  .btn{margin-top:16px;padding:12px 18px;border-radius:11px;border:none;background:var(--foil);color:var(--ink);
        font-weight:650;font-size:.95rem;cursor:pointer;width:100%}
  .btn.ghost{background:none;border:1px solid var(--line);color:var(--mute)}
  .msg{margin-top:12px;font-size:.88rem}.msg.ok{color:var(--green)}.msg.err{color:var(--red)}
  .empty{color:var(--mute);text-align:center;padding:40px 0;font-size:.95rem}
  /* ── first-run onboarding ── */
  .ob{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 22px;text-align:center}
  .ob .step{font-family:var(--mono);font-size:.7rem;letter-spacing:.16em;color:var(--foil);margin-bottom:10px}
  .ob h2{font-size:1.25rem;margin:0 0 10px;line-height:1.35}
  .ob p{color:var(--mute);font-size:.95rem;margin:0 auto 6px;max-width:34ch;line-height:1.55}
  .ob .dots{display:flex;gap:8px;justify-content:center;margin:22px 0 4px}
  .ob .dots i{width:7px;height:7px;border-radius:50%;background:var(--line)}
  .ob .dots i.on{background:var(--foil)}
  .ob .skip{display:block;margin-top:14px;color:var(--mute);font-size:.82rem;background:none;border:none;cursor:pointer;width:100%}
  .ob code{display:block;margin:14px 0 4px}
  .maprow{display:flex;gap:8px;margin-bottom:8px;font-family:var(--mono);font-size:.9rem}
  .maprow span{align-self:center;color:var(--mute)}
  code{font-family:var(--mono);font-size:.82rem;color:var(--foil);word-break:break-all}
  @media (prefers-reduced-motion:no-preference){.pass{transition:border-color .15s}.pass:hover{border-color:var(--foil)}}
</style></head>
<body><main>
  <header><h1>StatusPass</h1><span class="foil">CONSOLE</span></header>
  <nav role="tablist">
    <button data-tab="passes" aria-current="true">Passes</button>
    <button data-tab="board">Board</button>
    <button data-tab="mapping">Mapping</button>
    <button data-tab="issue">Issue a pass</button>
  </nav>
  <section id="view"></section>
<script>
const KEY = new URLSearchParams(location.search).get('key') || localStorage.getItem('sp_key') || '';
if (KEY) localStorage.setItem('sp_key', KEY);
const api = (path, opts={}) => fetch(path, {...opts, headers:{'content-type':'application/json',
  authorization:'Bearer '+KEY, ...(opts.headers||{})}}).then(async r => {
    const b = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(b.error || ('Request failed ('+r.status+')'));
    return b;
  });
const view = document.getElementById('view');
const el = (h) => { const d=document.createElement('div'); d.innerHTML=h; return d; };
const esc = (s) => String(s??'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function copy(text, btn){
  try{ await navigator.clipboard.writeText(text); const t=btn.textContent; btn.textContent='Copied';
    setTimeout(()=>btn.textContent=t,1500); }catch{ window.prompt('Copy this link:', text); }
}

// ── Passes tab ──
async function showPasses(){
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const {passes} = await api('/api/passes');
    if (!passes.length){
      if (localStorage.getItem('sp_onboarded')) {
        view.innerHTML = '<div class="empty">No passes yet — issue one from the Issue tab.</div>';
      } else {
        showOnboarding();
      }
      return; }
    view.innerHTML = '';
    for (const p of passes){
      const wear = p.quietDays <= 5 ? 'fresh' : p.quietDays <= 9 ? 'quiet' : 'stale';
      const wearText = p.quietDays === 0 ? 'updated today' : 'updated '+p.quietDays+'d ago';
      const card = el('<article class="pass" tabindex="0" style="--band:'+(p.profile==='client-delivery'?'#2E3A5C':'#3C3450')+'">'+
        '<div class="who">'+esc(p.recipientLabel)+' · '+(p.profile==='client-delivery'?'Client':'Program')+'</div>'+
        '<div class="phase">'+esc(p.currentPhase.toUpperCase())+'</div>'+
        '<div class="meta"><span class="chip '+wear+'">'+wearText+'</span>'+
        (p.currentRag?'<span class="chip rag-'+p.currentRag+'">'+p.currentRag.toUpperCase()+'</span>':'')+
        '</div></article>').firstChild;
      card.onclick = () => showDetail(p.id);
      card.onkeydown = (e) => { if(e.key==='Enter') showDetail(p.id); };
      view.appendChild(card);
    }
  } catch(e){ view.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; }
}

// ── Detail + manual update ──
async function showDetail(id){
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const {pass, resolvedRules} = await api('/api/passes/'+id);
    view.innerHTML = '';
    view.appendChild(el('<div class="panel">'+
      '<div class="who" style="color:var(--mute);font-size:.8rem;text-transform:uppercase;letter-spacing:.08em">'+esc(pass.recipientLabel)+'</div>'+
      '<div class="phase" style="font-family:var(--mono);font-size:1.4rem;margin:4px 0 10px">'+esc(pass.currentPhase.toUpperCase())+'</div>'+
      (pass.primaryLink?'<div style="font-size:.85rem;color:var(--mute)">Pass link: <code>'+esc(pass.primaryLink.label)+'</code></div>':'')+
      '<div style="font-size:.82rem;color:var(--mute);margin-top:10px">Voice: '+esc(resolvedRules.voice.tone)+
      ' · Notifies on: <span style="font-family:var(--mono)">'+resolvedRules.significance.notifyOn.map(esc).join(', ')+'</span></div>'+
      '</div>').firstChild);
    const form = el('<div class="panel"><label>Send an update</label>'+
      '<textarea id="note" placeholder="finished the homepage build, moving to review"></textarea>'+
      '<label>Move to phase (optional)</label><input id="phase" placeholder="Review">'+
      '<button class="btn" id="send">Send update</button>'+
      '<button class="btn ghost" id="back">Back to passes</button><div class="msg" id="m"></div></div>').firstChild;
    view.appendChild(form);
    form.querySelector('#back').onclick = showPasses;
    // Deliverables — the artifact repo behind the pass's gallery link
    const dpanel = el('<div class="panel"><label>Deliverables (demos & finished work)</label><div id="items"></div>'+
      '<label>Add a demo or link</label><div class="row"><input id="dt" placeholder="Title"><input id="du" placeholder="https://…"></div>'+
      '<button class="btn ghost" id="addlink">Add link</button>'+
      '<label>Add a picture of finished work</label><input type="file" id="dimg" accept="image/png,image/jpeg,image/webp">'+
      '<div class="msg" id="dmsg"></div><div id="gal"></div></div>').firstChild;
    view.appendChild(dpanel);
    const dmsg = dpanel.querySelector('#dmsg');
    async function loadDeliverables(){
      const {items, galleryUrl} = await api('/api/passes/'+id+'/deliverables');
      const list = dpanel.querySelector('#items');
      list.innerHTML = items.length ? '' : '<div style="color:var(--mute);font-size:.85rem">Nothing here yet — the pass links here automatically at Delivered.</div>';
      for (const d of items){
        const row = el('<div class="maprow"><span style="flex:1;color:var(--text)">'+esc(d.title)+
          ' <span style="color:var(--mute)">('+d.kind+')</span></span>'+
          '<button class="btn ghost" style="margin:0;width:auto;padding:6px 12px">Remove</button></div>').firstChild;
        row.querySelector('button').onclick = async ()=>{ 
          await api('/api/passes/'+id+'/deliverables',{method:'DELETE',body:JSON.stringify({id:d.id})});
          loadDeliverables();
        };
        list.appendChild(row);
      }
      const gal = dpanel.querySelector('#gal');
      gal.innerHTML = '<label>Client gallery link</label><code>'+esc(galleryUrl)+'</code>';
      const cb = el('<button class="btn ghost">Copy gallery link</button>').firstChild;
      cb.onclick = ()=>copy(galleryUrl, cb);
      gal.appendChild(cb);
    }
    dpanel.querySelector('#addlink').onclick = async ()=>{
      dmsg.className='msg'; dmsg.textContent='Adding…';
      try {
        await api('/api/passes/'+id+'/deliverables',{method:'POST',body:JSON.stringify({
          kind:'link', title: dpanel.querySelector('#dt').value, url: dpanel.querySelector('#du').value})});
        dmsg.className='msg ok'; dmsg.textContent='Added.';
        dpanel.querySelector('#dt').value=''; dpanel.querySelector('#du').value='';
        loadDeliverables();
      } catch(e){ dmsg.className='msg err'; dmsg.textContent=e.message; }
    };
    dpanel.querySelector('#dimg').onchange = async (ev)=>{
      const f = ev.target.files[0]; if(!f) return;
      dmsg.className='msg'; dmsg.textContent='Uploading…';
      try {
        const r = await fetch('/api/passes/'+id+'/deliverables/upload?title='+encodeURIComponent(f.name.replace(/\.[^.]+$/,'')),
          {method:'POST',headers:{'content-type':f.type,authorization:'Bearer '+KEY},body:f});
        if(!r.ok) throw new Error((await r.json()).error||'Upload failed');
        dmsg.className='msg ok'; dmsg.textContent='Uploaded.';
        loadDeliverables();
      } catch(e){ dmsg.className='msg err'; dmsg.textContent=e.message; }
    };
    loadDeliverables().catch(()=>{});
    form.querySelector('#send').onclick = async () => {
      const m = form.querySelector('#m'); m.className='msg'; m.textContent='Sending…';
      try {
        const {outcome} = await api('/api/passes/'+id+'/update', {method:'POST', body: JSON.stringify({
          note: form.querySelector('#note').value, phase: form.querySelector('#phase').value || undefined })});
        if (outcome.action==='shipped'){ m.className='msg ok';
          m.textContent = 'Sent: \u201C'+outcome.text+'\u201D' + (outcome.usedFallback ? ' (auto-language was suppressed; a plain status line went out)' : ''); }
        else { m.className='msg err'; m.textContent = 'Not sent — '+outcome.reason.replace(/-/g,' ')+'.'; }
      } catch(e){ m.className='msg err'; m.textContent = e.message; }
    };
  } catch(e){ view.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; }
}

// ── Mapping tab ──
async function showMapping(){
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const {columnToPhase} = await api('/api/mapping');
    const panel = el('<div class="panel"><label>Board column → phase your stakeholder sees</label><div id="rows"></div>'+
      '<button class="btn ghost" id="add">Add a mapping</button>'+
      '<button class="btn" id="save">Save mapping</button><div class="msg" id="m"></div></div>').firstChild;
    const rows = panel.querySelector('#rows');
    const addRow = (col='', phase='') => rows.appendChild(el('<div class="maprow">'+
      '<input value="'+esc(col)+'" placeholder="Trello column" aria-label="Board column">'+
      '<span>→</span><input value="'+esc(phase)+'" placeholder="Client-facing phase" aria-label="Phase"></div>').firstChild);
    Object.entries(columnToPhase).forEach(([c,p])=>addRow(c,p));
    panel.querySelector('#add').onclick = () => addRow();
    panel.querySelector('#save').onclick = async () => {
      const m = panel.querySelector('#m'); m.className='msg'; m.textContent='Saving…';
      const map = {};
      rows.querySelectorAll('.maprow').forEach(r=>{ const [a,b]=r.querySelectorAll('input');
        if(a.value.trim()&&b.value.trim()) map[a.value.trim()]=b.value.trim(); });
      try { await api('/api/mapping',{method:'PUT',body:JSON.stringify({columnToPhase:map})});
        m.className='msg ok'; m.textContent='Mapping saved.'; }
      catch(e){ m.className='msg err'; m.textContent=e.message; }
    };
    view.innerHTML=''; view.appendChild(panel);
  } catch(e){ view.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; }
}

// ── Issue tab ──
function showIssue(){
  const panel = el('<div class="panel">'+
    '<label>Who is this pass for?</label><input id="who" placeholder="Acme Corp — CEO">'+
    '<label>Type</label><select id="prof"><option value="client-delivery">Client delivery</option>'+
    '<option value="internal-program">Internal program</option></select>'+
    '<details style="margin-top:14px"><summary style="color:var(--mute);font-size:.85rem;cursor:pointer">'+
    'Connect a Trello or Jira board (optional — the Board tab works without one)</summary>'+
    '<div class="row"><div><label>Board / project ID</label><input id="board" placeholder="Trello board id or Jira project key"></div>'+
    '<div><label>Card / issue (optional)</label><input id="card" placeholder="* = whole board"></div></div></details>'+
    '<button class="btn" id="create">Create pass</button><div class="msg" id="m"></div><div id="out"></div></div>').firstChild;
  panel.querySelector('#create').onclick = async () => {
    const m = panel.querySelector('#m'); m.className='msg'; m.textContent='Creating…';
    try {
      const r = await api('/api/passes',{method:'POST',body:JSON.stringify({
        recipientLabel: panel.querySelector('#who').value, profile: panel.querySelector('#prof').value,
        boardId: panel.querySelector('#board').value || 'internal',
        cardId: panel.querySelector('#card').value || undefined })});
      m.className='msg ok'; m.textContent='Pass created. Send your client this one link — they add their logo, and their wallet pass is ready on the same page.';
      const out = panel.querySelector('#out');
      out.innerHTML = '<label>Client setup link (expires in 72h)</label><code>'+esc(r.brandingUrl)+'</code>';
      const b = el('<button class="btn ghost">Copy link</button>').firstChild;
      b.onclick = () => copy(r.brandingUrl, b);
      out.appendChild(b);
    } catch(e){ m.className='msg err'; m.textContent=e.message; }
  };
  view.innerHTML=''; view.appendChild(panel);
}

// ── First-run onboarding: three steps, one action each ──
function showOnboarding(step=1, demoLink=null){
  const dots = '<div class="dots">'+[1,2,3].map(i=>'<i class="'+(i<=step?'on':'')+'"></i>').join('')+'</div>';
  const skip = '<button class="skip" id="skip">Skip — I\\'ll explore on my own</button>';
  let html = '';
  if (step===1){
    html = '<div class="ob"><div class="step">HOW STATUSPASS WORKS</div>'+
      '<h2>Your client\\'s project status,<br>living in their wallet.</h2>'+
      '<p>No app. No login. You update once — their lock screen shows a clean, client-safe sentence.</p>'+
      '<p>Let\\'s prove it on your own phone. It takes about a minute.</p>'+
      dots+'<button class="btn" id="next">Show me</button>'+skip+'</div>';
  } else if (step===2){
    html = '<div class="ob"><div class="step">STEP 1 OF 2</div>'+
      '<h2>Put a pass on your phone</h2>'+
      (demoLink
        ? '<p>Open this link on your phone. Add any logo, pick a color, save — then tap <b style="color:var(--text)">Add to your wallet</b>.</p>'+
          '<code>'+esc(demoLink)+'</code><button class="btn ghost" id="copy">Copy link</button>'+
          dots+'<button class="btn" id="next">Done — it\\'s in my wallet</button>'
        : '<p>We\\'ll create a demo pass addressed to you.</p>'+
          dots+'<button class="btn" id="make">Create my demo pass</button>')+
      '<div class="msg" id="m"></div>'+skip+'</div>';
  } else {
    html = '<div class="ob"><div class="step">STEP 2 OF 2</div>'+
      '<h2>Now make your phone buzz</h2>'+
      '<p>Go to the <b style="color:var(--text)">Board</b> tab and drag your demo pass to the next phase. Add a short note if you like.</p>'+
      '<p>Within seconds, your lock screen shows the update. That\\'s the whole product.</p>'+
      dots+'<button class="btn" id="board">Open the Board</button>'+skip+'</div>';
  }
  view.innerHTML = html;
  const done = () => { localStorage.setItem('sp_onboarded','1'); };
  const sk = view.querySelector('#skip'); if (sk) sk.onclick = () => { done(); showPasses(); };
  const nx = view.querySelector('#next');
  if (nx) nx.onclick = () => showOnboarding(step+1, demoLink);
  const cp = view.querySelector('#copy'); if (cp) cp.onclick = () => copy(demoLink, cp);
  const mk = view.querySelector('#make');
  if (mk) mk.onclick = async () => {
    const m = view.querySelector('#m'); m.className='msg'; m.textContent='Creating…';
    try {
      const r = await api('/api/passes',{method:'POST',body:JSON.stringify({
        recipientLabel:'You — demo', profile:'client-delivery', boardId:'internal'})});
      showOnboarding(2, r.brandingUrl);
    } catch(e){ m.className='msg err'; m.textContent=e.message; }
  };
  const bd = view.querySelector('#board');
  if (bd) bd.onclick = () => {
    done();
    document.querySelectorAll('nav button').forEach(x=>x.removeAttribute('aria-current'));
    document.querySelector('nav button[data-tab="board"]').setAttribute('aria-current','true');
    showBoard();
  };
}

// ── Board tab: the internal status board ──
async function showBoard(){
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const {profiles} = await api('/api/board');
    const names = Object.keys(profiles);
    if (!names.length){ view.innerHTML =
      '<div class="empty">No passes yet. Issue a pass, then move it through its phases here.</div>'; return; }
    view.innerHTML = '';
    for (const prof of names){
      const group = el('<div class="boardgroup"><label>'+
        (prof==='client-delivery'?'Client delivery':'Internal programs')+'</label><div class="board"></div></div>').firstChild;
      const board = group.querySelector('.board');
      for (const phase of profiles[prof].phases){
        const col = el('<div class="col" data-phase="'+esc(phase)+'"><h3>'+esc(phase)+'</h3></div>').firstChild;
        for (const p of (profiles[prof].passes[phase]||[])){
          const tk = el('<div class="tk" draggable="true" data-id="'+esc(p.id)+'" '+
            'style="--band:'+(prof==='client-delivery'?'#2E3A5C':'#3C3450')+'">'+esc(p.recipientLabel)+'</div>').firstChild;
          tk.ondragstart = (e)=>e.dataTransfer.setData('text/plain', p.id);
          col.appendChild(tk);
        }
        col.ondragover = (e)=>{e.preventDefault(); col.classList.add('dragover')};
        col.ondragleave = ()=>col.classList.remove('dragover');
        col.ondrop = async (e)=>{
          e.preventDefault(); col.classList.remove('dragover');
          const id = e.dataTransfer.getData('text/plain'); if(!id) return;
          const note = window.prompt('Add a note for this update (optional)') || undefined;
          try {
            const {outcome} = await api('/api/passes/'+id+'/move',{method:'POST',
              body: JSON.stringify({phase: col.dataset.phase, note})});
            if (outcome.action !== 'shipped' && outcome.reason !== 'cooldown')
              alert('Not sent — '+outcome.reason.replace(/-/g,' '));
          } catch(err){ alert(err.message); }
          showBoard();
        };
        board.appendChild(col);
      }
      view.appendChild(group);
    }
  } catch(e){ view.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; }
}

const tabs = { passes: showPasses, board: showBoard, mapping: showMapping, issue: showIssue };
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x=>x.removeAttribute('aria-current'));
  b.setAttribute('aria-current','true'); tabs[b.dataset.tab]();
});
showPasses();
</script>
</main></body></html>`;
}
