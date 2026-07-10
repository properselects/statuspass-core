// Console UI — one served HTML file, zero dependencies.

export function renderConsolePage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StatusPass</title>
<style>
  :root{--ink:#0B0E16;--card:#151A28;--line:#262D40;--text:#F2F4F9;--mute:#8A93AB;--foil:#C9A96A;
        --green:#5FB98A;--amber:#D9A441;--red:#D96C6C;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{margin:0;background:var(--ink);color:var(--text);font:16px/1.5 -apple-system,system-ui,sans-serif;min-height:100vh}
  main{max-width:680px;margin:0 auto;padding:16px 16px 100px}

  /* header */
  .topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
  .topbar h1{font-size:1.1rem;margin:0;font-weight:700;letter-spacing:.01em}
  .topbar .badge{font-size:.65rem;font-family:var(--mono);color:var(--foil);letter-spacing:.14em;border:1px solid var(--foil);border-radius:4px;padding:2px 6px;margin-left:8px}
  .add-btn{background:var(--foil);color:var(--ink);border:none;border-radius:10px;padding:9px 18px;font-size:.9rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap}
  .add-btn svg{width:16px;height:16px;fill:currentColor}

  /* tabs */
  nav{display:flex;gap:4px;margin-bottom:20px;background:var(--card);border-radius:12px;padding:4px;border:1px solid var(--line)}
  nav button{flex:1;padding:9px 0;border-radius:9px;border:none;background:none;color:var(--mute);font-size:.88rem;cursor:pointer;transition:all .15s;font-weight:500}
  nav button[aria-current="true"]{background:var(--ink);color:var(--text);box-shadow:0 1px 4px rgba(0,0,0,.4)}
  button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--foil);outline-offset:2px}

  /* client pass cards */
  .pass{position:relative;background:var(--card);border:1px solid var(--line);border-radius:16px;
        padding:16px 20px 14px 24px;margin-bottom:12px;overflow:hidden;cursor:pointer;
        display:flex;align-items:center;justify-content:space-between;gap:12px}
  .pass::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--band,#2E3A5C);border-radius:16px 0 0 16px}
  .pass:hover{border-color:var(--foil)}
  .pass-left{flex:1;min-width:0}
  .pass-name{font-size:1rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pass-status{font-size:.8rem;color:var(--mute);margin-top:2px}
  .pass-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0}
  .phase-pill{font-family:var(--mono);font-size:.75rem;letter-spacing:.06em;padding:4px 10px;border-radius:99px;
              background:var(--ink);border:1px solid var(--line);white-space:nowrap}
  .chip{font-size:.72rem;padding:2px 8px;border-radius:99px;border:1px solid var(--line);font-family:var(--mono)}
  .chip.fresh{color:var(--green);border-color:var(--green)}
  .chip.quiet{color:var(--amber);border-color:var(--amber)}
  .chip.stale{color:var(--red);border-color:var(--red)}
  .arrow{color:var(--mute);font-size:1.1rem}

  /* panels / forms */
  .panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:14px}
  .panel-title{font-size:1rem;font-weight:700;margin:0 0 16px}
  .field-label{font-size:.72rem;letter-spacing:.09em;color:var(--mute);text-transform:uppercase;margin:14px 0 6px;display:block}
  .hint{font-size:.78rem;color:var(--mute);margin-top:3px;line-height:1.4}
  input,select,textarea{width:100%;padding:11px 13px;border-radius:10px;border:1px solid var(--line);
        background:var(--ink);color:var(--text);font-size:.95rem;font-family:inherit}
  textarea{min-height:80px;resize:vertical}
  .row{display:flex;gap:10px}.row>*{flex:1}
  .btn{margin-top:14px;padding:13px 18px;border-radius:12px;border:none;background:var(--foil);color:var(--ink);
        font-weight:700;font-size:.95rem;cursor:pointer;width:100%;display:block}
  .btn.secondary{background:none;border:1px solid var(--line);color:var(--mute)}
  .btn.danger{background:none;border:1px solid var(--red);color:var(--red)}
  .btn-row{display:flex;gap:8px;margin-top:14px}.btn-row .btn{margin-top:0}
  .msg{margin-top:10px;font-size:.85rem;padding:8px 12px;border-radius:8px;display:none}
  .msg.show{display:block}
  .msg.ok{background:rgba(95,185,138,.12);color:var(--green)}
  .msg.err{background:rgba(217,108,108,.12);color:var(--red)}

  /* board */
  .board-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
  .board{display:flex;gap:10px;min-width:max-content;padding:4px 0 8px}
  .col{width:160px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 10px 14px}
  .col-head{font-size:.7rem;font-family:var(--mono);letter-spacing:.1em;color:var(--mute);text-transform:uppercase;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .col.dragover,.col.tapover{border-color:var(--foil);background:rgba(201,169,106,.06)}
  .tk{background:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px 10px 10px 14px;
      margin-bottom:8px;font-size:.84rem;cursor:grab;position:relative;line-height:1.35}
  .tk::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:10px 0 0 10px;background:var(--band,#2E3A5C)}
  .tk:active{cursor:grabbing;opacity:.7}
  .tk.selected{border-color:var(--foil);box-shadow:0 0 0 2px rgba(201,169,106,.3)}
  .board-hint{font-size:.78rem;color:var(--mute);text-align:center;margin-bottom:12px;padding:8px;background:var(--card);border-radius:8px;border:1px solid var(--line)}

  /* setup link box */
  .link-box{background:var(--ink);border:1px solid var(--foil);border-radius:10px;padding:12px 14px;margin:12px 0;
            font-family:var(--mono);font-size:.8rem;color:var(--foil);word-break:break-all;line-height:1.5}
  .success-banner{background:rgba(95,185,138,.1);border:1px solid var(--green);border-radius:12px;
                  padding:14px 16px;margin-bottom:14px;font-size:.9rem;color:var(--green)}
  .success-banner strong{display:block;margin-bottom:4px;font-size:.95rem}

  /* empty states */
  .empty{text-align:center;padding:48px 20px;color:var(--mute)}
  .empty .emoji{font-size:2.5rem;display:block;margin-bottom:12px}
  .empty h3{margin:0 0 6px;color:var(--text);font-size:1.05rem}
  .empty p{margin:0 auto;max-width:28ch;font-size:.9rem;line-height:1.5}

  /* back link */
  .back-link{display:inline-flex;align-items:center;gap:6px;color:var(--mute);font-size:.88rem;
             background:none;border:none;cursor:pointer;padding:0;margin-bottom:16px}
  .back-link:hover{color:var(--text)}

  /* deliverables */
  .deliv-item{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line);gap:10px}
  .deliv-item:last-child{border-bottom:none}
  .del-x{background:none;border:none;color:var(--mute);cursor:pointer;font-size:1.1rem;padding:4px 8px;border-radius:6px;flex-shrink:0}
  .del-x:hover{color:var(--red)}

  /* history rows */
  .hrow{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
  .hrow:last-child{border-bottom:none}
  .hicon{width:32px;height:32px;border-radius:8px;background:var(--ink);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
  .hbody{flex:1;min-width:0}
  .hhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:3px}
  .hlabel{font-size:.72rem;color:var(--foil);font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .hwhen{font-size:.7rem;color:var(--mute);font-family:var(--mono);white-space:nowrap;flex-shrink:0}
  .hsummary{font-size:.9rem;color:var(--text);line-height:1.4}
  .hdetail{font-size:.82rem;color:var(--mute);margin-top:4px;line-height:1.45;font-style:italic}

  /* map rows */
  .maprow{display:flex;gap:8px;margin-bottom:8px;align-items:center}
  .maprow span{color:var(--mute);flex-shrink:0}
  .maprow input{font-size:.88rem;padding:8px 10px}
  .del-row{background:none;border:none;color:var(--mute);cursor:pointer;font-size:1.1rem;padding:4px 6px}

  @media(max-width:480px){
    .col{width:140px}
    .add-btn span{display:none}
  }
</style></head>
<body><main>

<div class="topbar">
  <div style="display:flex;align-items:center">
    <h1>StatusPass</h1>
    <span class="badge">CONSOLE</span>
  </div>
  <button class="add-btn" id="globalAdd" onclick="showIssue()">
    <svg viewBox="0 0 20 20"><path d="M10 4a1 1 0 011 1v4h4a1 1 0 010 2h-4v4a1 1 0 01-2 0v-4H5a1 1 0 010-2h4V5a1 1 0 011-1z"/></svg>
    <span>Add Client</span>
  </button>
</div>

<nav role="tablist">
  <button data-tab="clients" aria-current="true">👤 Clients</button>
  <button data-tab="board">📋 Board</button>
  <button data-tab="history">🕒 History</button>
  <button data-tab="settings">⚙ Settings</button>
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
const msg = (el,type,text) => { el.textContent=text; el.className='msg show '+type; };
async function copy(text, btn){ try{ await navigator.clipboard.writeText(text);
  const t=btn.textContent; btn.textContent='Copied!'; setTimeout(()=>btn.textContent=t,1500); }
  catch{ window.prompt('Copy this link:', text); } }
function setTab(name){
  document.querySelectorAll('nav button').forEach(x=>x.removeAttribute('aria-current'));
  const b=document.querySelector('nav button[data-tab="'+name+'"]');
  if(b) b.setAttribute('aria-current','true');
}

// ── Clients tab ──
async function showClients(){
  setTab('clients');
  view.innerHTML = '<div class="empty"><span class="emoji">⏳</span><h3>Loading your clients...</h3></div>';
  try {
    const {passes} = await api('/api/passes');
    if (!passes.length){
      view.innerHTML = '';
      view.appendChild(el('<div class="empty">'+
        '<span class="emoji">👥</span>'+
        '<h3>No clients yet</h3>'+
        '<p>Click <strong>Add Client</strong> above to create your first wallet pass.</p>'+
        '</div>').firstChild);
      return;
    }
    view.innerHTML = '';
    const sortedPasses = [...passes].sort((a,b)=>a.recipientLabel.localeCompare(b.recipientLabel));
    for (const p of sortedPasses){
      const wear = p.quietDays <= 5 ? 'fresh' : p.quietDays <= 9 ? 'quiet' : 'stale';
      const wearLabel = p.quietDays === 0 ? 'Updated today' : p.quietDays===1 ? 'Updated yesterday' : 'Updated '+p.quietDays+' days ago';
      const typeLabel = p.profile==='client-delivery' ? 'Client project' : 'Internal project';
      const card = el('<div class="pass" tabindex="0" style="--band:'+(p.profile==='client-delivery'?'#2E3A5C':'#3C3450')+'">'+
        '<div class="pass-left">'+
          '<div class="pass-name">'+esc(p.recipientLabel)+'</div>'+
          '<div class="pass-status">'+typeLabel+' · <span class="chip '+wear+'" style="font-size:.7rem">'+wearLabel+'</span></div>'+
        '</div>'+
        '<div class="pass-right">'+
          '<div class="phase-pill">'+esc(p.currentPhase)+'</div>'+
        '</div>'+
        '<span class="arrow">›</span>'+
        '</div>').firstChild;
      card.onclick = () => showDetail(p.id);
      card.onkeydown = (e) => { if(e.key==='Enter') showDetail(p.id); };
      view.appendChild(card);
    }
  } catch(e){ view.innerHTML = '<div class="empty"><span class="emoji">⚠️</span><h3>Something went wrong</h3><p>'+esc(e.message)+'</p></div>'; }
}

// ── Detail / manage a client pass ──
async function showDetail(id){
  setTab('clients');
  view.innerHTML = '<div class="empty"><span class="emoji">⏳</span><h3>Loading...</h3></div>';
  try {
    const {pass} = await api('/api/passes/'+id);
    view.innerHTML = '';
    const back = el('<button class="back-link" id="bk">← Back to clients</button>').firstChild;
    back.onclick = showClients;
    view.appendChild(back);

    // Info card
    view.appendChild(el('<div class="panel">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div>'+
          '<div style="font-size:1.2rem;font-weight:700">'+esc(pass.recipientLabel)+'</div>'+
          '<div style="color:var(--mute);font-size:.85rem;margin-top:2px">'+(pass.profile==='client-delivery'?'Client project':'Internal project')+'</div>'+
        '</div>'+
        '<div class="phase-pill" style="font-size:.85rem;padding:6px 14px">'+esc(pass.currentPhase)+'</div>'+
      '</div>'+
      (pass.addUrl ? '<div style="margin-top:12px;font-size:.82rem;color:var(--mute)">✅ Pass installed — wallet updates go to this client</div>' :
                     '<div style="margin-top:12px;font-size:.82rem;color:var(--amber)">⏳ Waiting for client to install their wallet pass</div>')+
      '</div>').firstChild);

    // Send update form
    const updatePanel = el('<div class="panel">'+
      '<div class="panel-title">📤 Send an update to their phone</div>'+
      '<label class="field-label">What happened?</label>'+
      '<textarea id="note" placeholder="Example: Finished the homepage design, moving to development next week"></textarea>'+
      '<span class="hint">Keep it brief and client-friendly. The AI will clean it up before sending.</span>'+
      '<label class="field-label">Change their status to (optional)</label>'+
      '<input id="phase" placeholder="Example: In Development">'+
      '<span class="hint">Leave blank to keep current status: '+esc(pass.currentPhase)+'</span>'+
      '<button class="btn" id="sendBtn">Send Update 📱</button>'+
      '<div class="msg" id="sendMsg"></div></div>').firstChild;
    view.appendChild(updatePanel);
    updatePanel.querySelector('#sendBtn').onclick = async () => {
      const m = updatePanel.querySelector('#sendMsg');
      const note = updatePanel.querySelector('#note').value.trim();
      if (!note){ msg(m,'err','Please describe what happened.'); return; }
      msg(m,'','Sending...');
      try {
        const {outcome} = await api('/api/passes/'+id+'/update', {method:'POST', body: JSON.stringify({
          note, phase: updatePanel.querySelector('#phase').value.trim() || undefined })});
        if (outcome.action==='shipped'){
          msg(m,'ok','✅ Sent to phone: "'+outcome.text+'"');
          updatePanel.querySelector('#note').value='';
          updatePanel.querySelector('#phase').value='';
          showDetail(id);
        } else {
          msg(m,'err','Not sent — '+outcome.reason.replace(/-/g,' ')+'. Try again in a few minutes.');
        }
      } catch(e){ msg(m,'err',e.message); }
    };

    // Branding / setup link
    if (pass.brandingToken || !pass.addUrl){
      const brandPanel = el('<div class="panel">'+
        '<div class="panel-title">🔗 Client setup link</div>'+
        '<p style="color:var(--mute);font-size:.88rem;margin:0 0 10px">Send this link to your client. They upload a logo, pick a color, and get the wallet pass — all in one page.</p>'+
        '<div id="brandLinkArea"></div></div>').firstChild;
      view.appendChild(brandPanel);
      try {
        const {brandingUrl} = await api('/api/passes/'+id+'/branding-link');
        const area = brandPanel.querySelector('#brandLinkArea');
        area.innerHTML = '<div class="link-box">'+esc(brandingUrl)+'</div>';
        const cb = el('<button class="btn secondary">Copy Setup Link</button>').firstChild;
        cb.onclick = ()=>copy(brandingUrl, cb);
        area.appendChild(cb);
      } catch(_){}
    }

    // Deliverables
    const dPanel = el('<div class="panel">'+
      '<div class="panel-title">📁 Deliverables & demos</div>'+
      '<p style="color:var(--mute);font-size:.88rem;margin:0 0 14px">Add links to demos, Looms, or pictures of finished work. These go into a gallery your client can tap from their wallet pass.</p>'+
      '<div id="delivList"></div>'+
      '<label class="field-label">Add a link (Loom, Figma, live site…)</label>'+
      '<input id="dlTitle" placeholder="What is it? e.g. Sprint 4 demo recording">'+
      '<input id="dlUrl" placeholder="https://" style="margin-top:8px">'+
      '<button class="btn secondary" id="addLink" style="margin-top:10px">Add Link</button>'+
      '<label class="field-label" style="margin-top:16px">Add a photo or screenshot</label>'+
      '<input type="file" id="dlImg" accept="image/*" style="padding:8px">'+
      '<div class="msg" id="dMsg"></div>'+
      '<div id="galLink"></div></div>').firstChild;
    view.appendChild(dPanel);
    async function loadDeliverables(){
      try {
        const {items, galleryUrl} = await api('/api/passes/'+id+'/deliverables');
        const list = dPanel.querySelector('#delivList');
        list.innerHTML = '';
        if (!items.length){
          list.innerHTML = '<div style="color:var(--mute);font-size:.85rem;margin-bottom:10px">Nothing added yet.</div>';
        }
        for (const d of items){
          const row = el('<div class="deliv-item">'+
            '<span style="font-size:.88rem">'+esc(d.title)+' <span style="color:var(--mute)">('+d.kind+')</span></span>'+
            '<button class="del-x" title="Remove">×</button></div>').firstChild;
          row.querySelector('button').onclick = async ()=>{
            await api('/api/passes/'+id+'/deliverables',{method:'DELETE',body:JSON.stringify({id:d.id})});
            loadDeliverables();
          };
          list.appendChild(row);
        }
        const galDiv = dPanel.querySelector('#galLink');
        galDiv.innerHTML = '<label class="field-label">Client gallery link</label><div class="link-box">'+esc(galleryUrl)+'</div>';
        const gb = el('<button class="btn secondary">Copy Gallery Link</button>').firstChild;
        gb.onclick=()=>copy(galleryUrl,gb);
        galDiv.appendChild(gb);
      } catch(_){}
    }
    const dm = dPanel.querySelector('#dMsg');
    dPanel.querySelector('#addLink').onclick = async ()=>{
      const t=dPanel.querySelector('#dlTitle').value.trim(), u=dPanel.querySelector('#dlUrl').value.trim();
      if(!t||!u){ msg(dm,'err','Fill in both the title and the link.'); return; }
      msg(dm,'','Adding...');
      try { await api('/api/passes/'+id+'/deliverables',{method:'POST',body:JSON.stringify({kind:'link',title:t,url:u})});
        dPanel.querySelector('#dlTitle').value=''; dPanel.querySelector('#dlUrl').value='';
        msg(dm,'ok','Added!'); loadDeliverables(); }
      catch(e){ msg(dm,'err',e.message); }
    };
    dPanel.querySelector('#dlImg').onchange = async (ev)=>{
      const f=ev.target.files[0]; if(!f) return;
      msg(dm,'','Uploading...');
      try {
        const r=await fetch('/api/passes/'+id+'/deliverables/upload?title='+encodeURIComponent(f.name.replace(/\\.[^.]+$/,'')),
          {method:'POST',headers:{'content-type':f.type,authorization:'Bearer '+KEY},body:f});
        if(!r.ok) throw new Error((await r.json()).error||'Upload failed');
        msg(dm,'ok','Uploaded!'); loadDeliverables();
      } catch(e){ msg(dm,'err',e.message); }
    };
    loadDeliverables();
  } catch(e){ view.innerHTML = '<div class="empty"><span class="emoji">⚠️</span><h3>Could not load</h3><p>'+esc(e.message)+'</p></div>'; }
}

// ── Board tab ──
let _selectedTk = null;
async function showBoard(){
  setTab('board');
  view.innerHTML = '<div class="empty"><span class="emoji">⏳</span><h3>Loading...</h3></div>';
  try {
    const {profiles} = await api('/api/board');
    const names = Object.keys(profiles);
    if (!names.length){
      view.innerHTML = '';
      view.appendChild(el('<div class="empty"><span class="emoji">📋</span><h3>No clients on the board yet</h3><p>Add a client first, then drag or tap their card to move it through stages.</p></div>').firstChild);
      return;
    }
    view.innerHTML = '';
    view.appendChild(el('<div class="board-hint">📱 On mobile: tap a card to select it, then tap the column to move it. On desktop: drag and drop.</div>').firstChild);
    _selectedTk = null;
    for (const prof of names){
      const group = document.createElement('div');
      const typeLabel = prof==='client-delivery' ? 'Client projects' : 'Internal projects';
      group.innerHTML = '<div class="field-label" style="margin-bottom:10px">'+typeLabel+'</div>';
      const wrap = document.createElement('div'); wrap.className='board-wrap';
      const board = document.createElement('div'); board.className='board';
      for (const phase of profiles[prof].phases){
        const col = el('<div class="col" data-phase="'+esc(phase)+'"><div class="col-head">'+esc(phase)+'</div></div>').firstChild;
        for (const p of (profiles[prof].passes[phase]||[])){
          const tk = el('<div class="tk" draggable="true" data-id="'+esc(p.id)+'" style="--band:'+(prof==='client-delivery'?'#2E3A5C':'#3C3450')+'">'+esc(p.recipientLabel)+'</div>').firstChild;
          tk.ondragstart = (e)=>{ e.dataTransfer.setData('text/plain', p.id); tk.style.opacity='.5'; };
          tk.ondragend = ()=>{ tk.style.opacity='1'; };
          // Tap-to-select (mobile)
          tk.onclick = (e)=>{
            e.stopPropagation();
            if(_selectedTk){ _selectedTk.classList.remove('selected'); }
            if(_selectedTk===tk){ _selectedTk=null; return; }
            _selectedTk=tk; tk.classList.add('selected');
          };
          col.appendChild(tk);
        }
        // Drop (desktop)
        col.ondragover=(e)=>{e.preventDefault();col.classList.add('dragover')};
        col.ondragleave=()=>col.classList.remove('dragover');
        col.ondrop=async(e)=>{
          e.preventDefault();col.classList.remove('dragover');
          const id=e.dataTransfer.getData('text/plain'); if(!id)return;
          await doMove(id, col.dataset.phase);
        };
        // Tap-to-move (mobile)
        col.onclick=async()=>{
          if(!_selectedTk)return;
          const id=_selectedTk.dataset.id;
          const phase=col.dataset.phase;
          _selectedTk.classList.remove('selected'); _selectedTk=null;
          await doMove(id, phase);
        };
        board.appendChild(col);
      }
      wrap.appendChild(board);
      group.appendChild(wrap);
      view.appendChild(group);
    }
  } catch(e){ view.innerHTML = '<div class="empty"><span class="emoji">⚠️</span><h3>Could not load board</h3><p>'+esc(e.message)+'</p></div>'; }
}

async function doMove(id, phase){
  const note = window.prompt('Add a short note for the client update (optional)\\n\\nExample: Wrapped up the designs, heading into development') || undefined;
  try {
    const {outcome} = await api('/api/passes/'+id+'/move',{method:'POST',body:JSON.stringify({phase,note})});
    if (outcome.action==='shipped'){
      alert('✅ Update sent! The client will see "'+outcome.text+'" on their lock screen.');
    } else if (outcome.reason==='cooldown'){
      alert('⏳ Moved — but the client was updated very recently, so no new notification was sent to avoid spam.');
    } else {
      alert('Moved, but update not sent — '+outcome.reason.replace(/-/g,' ')+'.');
    }
  } catch(e){ alert('Error: '+e.message); }
  showBoard();
}

// ── Add Client (Issue) ──
function showIssue(){
  setTab('clients');
  view.innerHTML = '';
  const back = el('<button class="back-link">← Back to clients</button>').firstChild;
  back.onclick = showClients;
  view.appendChild(back);
  const panel = el('<div class="panel">'+
    '<div class="panel-title">👤 Add a new client</div>'+
    '<label class="field-label">Client name</label>'+
    '<input id="who" placeholder="e.g. Acme Corp — Sarah (CEO)" autofocus>'+
    '<span class="hint">Who is receiving project updates? Be specific so you can identify them later.</span>'+
    '<label class="field-label">Project type</label>'+
    '<select id="prof">'+
      '<option value="client-delivery">Client delivery — for a paying client</option>'+
      '<option value="internal-program">Internal project — for your own team</option>'+
    '</select>'+
    '<details style="margin-top:20px;border:1px solid var(--line);border-radius:10px;padding:12px">'+
      '<summary style="color:var(--mute);font-size:.85rem;cursor:pointer;font-weight:600">🔌 Connect Trello or Jira (optional)</summary>'+
      '<div style="margin-top:12px">'+
        '<span class="hint">Skip this if you plan to move cards manually from the Board tab. You can always add this later.</span>'+
        '<label class="field-label">Board or Project ID</label>'+
        '<input id="boardId" placeholder="Trello board ID or Jira project key">'+
        '<label class="field-label">Card or Issue (optional)</label>'+
        '<input id="cardId" placeholder="Leave blank to track the whole board">'+
      '</div>'+
    '</details>'+
    '<button class="btn" id="createBtn">Create Pass & Get Client Link →</button>'+
    '<div class="msg" id="cm"></div><div id="out"></div></div>').firstChild;
  view.appendChild(panel);
  panel.querySelector('#createBtn').onclick = async ()=>{
    const name=panel.querySelector('#who').value.trim();
    const cm=panel.querySelector('#cm');
    if(!name){ msg(cm,'err','Please enter the client name.'); return; }
    msg(cm,'','Creating pass...');
    try {
      const r=await api('/api/passes',{method:'POST',body:JSON.stringify({
        recipientLabel:name, profile:panel.querySelector('#prof').value,
        boardId:panel.querySelector('#boardId').value.trim()||'internal',
        cardId:panel.querySelector('#cardId').value.trim()||undefined})});
      cm.className='msg'; cm.style.display='none';
      const out=panel.querySelector('#out');
      out.innerHTML='';
      out.appendChild(el('<div class="success-banner">'+
        '<strong>🎉 Pass created for '+esc(name)+'!</strong>'+
        'Send them the link below. They open it, add a logo and brand color, and tap "Add to Wallet" — done. You can then update their lock screen from this console anytime.</div>').firstChild);
      out.appendChild(el('<div style="margin-top:4px"><div class="field-label">Send this link to your client (valid for 72 hours)</div>'+
        '<div class="link-box">'+esc(r.brandingUrl)+'</div></div>').firstChild);
      const copyBtn=el('<button class="btn">Copy Client Link</button>').firstChild;
      copyBtn.onclick=()=>copy(r.brandingUrl,copyBtn);
      out.appendChild(copyBtn);
      const viewBtn=el('<button class="btn secondary" style="margin-top:8px">View in Clients List</button>').firstChild;
      viewBtn.onclick=showClients;
      out.appendChild(viewBtn);
      panel.querySelector('#createBtn').style.display='none';
    } catch(e){ msg(cm,'err',e.message); }
  };
}

// ── Settings tab ──
async function showSettings(){
  setTab('settings');
  view.innerHTML = '<div class="empty"><span class="emoji">⏳</span><h3>Loading...</h3></div>';
  try {
    const {columnToPhase} = await api('/api/mapping');
    view.innerHTML = '';
    const panel = el('<div class="panel">'+
      '<div class="panel-title">🔌 Trello / Jira column mapping</div>'+
      '<p style="color:var(--mute);font-size:.88rem;margin:0 0 14px">When a card moves to one of these columns in Trello or Jira, the client sees the matching status on their wallet pass.</p>'+
      '<div id="rows"></div>'+
      '<button class="btn secondary" id="addRow" style="margin-top:10px">+ Add a mapping</button>'+
      '<button class="btn" id="saveMap" style="margin-top:8px">Save Changes</button>'+
      '<div class="msg" id="mapMsg"></div></div>').firstChild;
    const rows=panel.querySelector('#rows');
    const addRow=(col='',phase='')=>{
      const r=el('<div class="maprow">'+
        '<input value="'+esc(col)+'" placeholder="Trello/Jira column" style="flex:1" aria-label="Board column">'+
        '<span>→</span>'+
        '<input value="'+esc(phase)+'" placeholder="Client status" style="flex:1" aria-label="Status shown to client">'+
        '<button class="del-row" title="Remove">×</button></div>').firstChild;
      r.querySelector('.del-row').onclick=()=>r.remove();
      rows.appendChild(r);
    };
    Object.entries(columnToPhase).forEach(([c,p])=>addRow(c,p));
    if(!Object.keys(columnToPhase).length) addRow();
    panel.querySelector('#addRow').onclick=()=>addRow();
    panel.querySelector('#saveMap').onclick=async()=>{
      const m=panel.querySelector('#mapMsg'); msg(m,'','Saving...');
      const map={};
      rows.querySelectorAll('.maprow').forEach(r=>{const [a,b]=r.querySelectorAll('input');
        if(a.value.trim()&&b.value.trim()) map[a.value.trim()]=b.value.trim();});
      try{ await api('/api/mapping',{method:'PUT',body:JSON.stringify({columnToPhase:map})});
        msg(m,'ok','Saved!'); }
      catch(e){ msg(m,'err',e.message); }
    };
    view.innerHTML=''; view.appendChild(panel);

    // Webhook info
    view.appendChild(el('<div class="panel">'+
      '<div class="panel-title">📡 Webhook URLs</div>'+
      '<p style="color:var(--mute);font-size:.88rem;margin:0 0 12px">Point your Trello or Jira webhook at these URLs to auto-trigger client updates when cards move.</p>'+
      '<label class="field-label">Trello webhook URL</label>'+
      '<div class="link-box">'+esc(location.origin+'/webhooks/trello')+'</div>'+
      '<label class="field-label" style="margin-top:14px">Jira webhook URL</label>'+
      '<div class="link-box">'+esc(location.origin+'/webhooks/jira/[your-jira-secret]')+'</div>'+
      '</div>').firstChild);
  } catch(e){ view.innerHTML = '<div class="empty"><span class="emoji">⚠️</span><h3>Could not load settings</h3><p>'+esc(e.message)+'</p></div>'; }
}

// ── History tab ──
async function showHistory(){
  setTab('history');
  view.innerHTML = '<div class="empty"><span class="emoji">⏳</span><h3>Loading history…</h3></div>';
  try {
    const {events} = await api('/api/activity');
    view.innerHTML = '';
    if (!events.length) {
      view.appendChild(el('<div class="empty">'+
        '<span class="emoji">🕒</span>'+
        '<h3>No activity yet</h3>'+
        '<p>Every phase move, deliverable, and update to any client pass will show up here.</p>'+
        '</div>').firstChild);
      return;
    }
    const iconFor = (k) => ({
      phase_move:'📋', custom_push:'📣', pass_issued:'✨',
      deliverable_added:'📁', deliverable_removed:'🗑️',
      manual_update:'✉️', notification:'🔔'
    }[k] || '•');
    const list = el('<div class="panel"><div class="panel-title">📜 Recent activity ('+events.length+')</div><div id="hlist"></div></div>').firstChild;
    view.appendChild(list);
    const hlist = list.querySelector('#hlist');
    const fmtWhen = (iso) => {
      const d = new Date(iso), now = new Date();
      const s = Math.floor((now.getTime()-d.getTime())/1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s/60)+'m ago';
      if (s < 86400) return Math.floor(s/3600)+'h ago';
      return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    };
    for (const ev of events) {
      const row = el('<div class="hrow">'+
        '<div class="hicon">'+iconFor(ev.kind)+'</div>'+
        '<div class="hbody">'+
          '<div class="hhead">'+
            (ev.passLabel ? '<span class="hlabel">'+esc(ev.passLabel)+'</span>' : '')+
            '<span class="hwhen">'+esc(fmtWhen(ev.at))+'</span>'+
          '</div>'+
          '<div class="hsummary">'+esc(ev.summary)+'</div>'+
          (ev.detail ? '<div class="hdetail">"'+esc(ev.detail)+'"</div>' : '')+
        '</div></div>').firstChild;
      hlist.appendChild(row);
    }
  } catch(e){ view.innerHTML = '<div class="empty"><span class="emoji">⚠️</span><h3>Could not load history</h3><p>'+esc(e.message)+'</p></div>'; }
}

const tabs = { clients: showClients, board: showBoard, history: showHistory, settings: showSettings };
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  tabs[b.dataset.tab]();
});
showClients();
</script>
</main></body></html>`;
}
