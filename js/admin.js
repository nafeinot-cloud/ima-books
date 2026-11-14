/* מסך ניהול */
(() => {
  'use strict';
  const CAT = window.CATALOG; const A = Api.admin;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const itemById = Object.fromEntries(CAT.items.map((i) => [i.id, i]));
  const shelfOf = {}; CAT.shelves.forEach((s) => s.items.forEach((id) => { shelfOf[id] = s; }));
  const STATE = { claims: [], tab: 'people', q: '' };
  const STATE_TEXT = { reserved: 'שמור', collected: 'נמסר' };
  let tt;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2800); }
  const fmt = (iso) => { try { return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };

  function people() {
    const map = new Map();
    STATE.claims.forEach((c) => {
      const key = Api.normPhone(c.phone) || c.name;
      if (!map.has(key)) map.set(key, { key, name: c.name, phone: c.phone, email: c.email, notes: new Set(), items: [], last: c.created_at });
      const p = map.get(key); p.items.push(c); if (c.note) p.notes.add(c.note);
      if (c.created_at > p.last) p.last = c.created_at;
    });
    return Array.from(map.values()).sort((a, b) => (a.last < b.last ? 1 : -1));
  }

  function render() {
    const reserved = STATE.claims.filter((c) => c.state === 'reserved').length;
    const collected = STATE.claims.filter((c) => c.state === 'collected').length;
    $('#c-people').textContent = people().length; $('#c-reserved').textContent = reserved;
    $('#c-collected').textContent = collected; $('#c-free').textContent = CAT.items.length - STATE.claims.length;
    $('#people').hidden = STATE.tab !== 'people'; $('#free').hidden = STATE.tab !== 'free';
    $('#tab-people').setAttribute('aria-pressed', STATE.tab === 'people'); $('#tab-free').setAttribute('aria-pressed', STATE.tab === 'free');
    renderPeople(); renderFree();
  }

  function renderPeople() {
    const q = STATE.q.trim().toLowerCase(); const qd = Api.digits(q);
    const list = people().filter((p) => !q || p.name.toLowerCase().includes(q) || (qd && (Api.digits(p.phone).includes(qd) || Api.normPhone(p.phone).includes(Api.normPhone(qd)))));
    $('#people').innerHTML = list.length ? list.map((p) => `
      <section class="panel person" data-key="${esc(p.key)}">
        <h3>${esc(p.name)}</h3>
        <div class="contact"><a href="tel:${esc((/^\s*\+/.test(p.phone) ? '+' : '') + Api.digits(p.phone))}" dir="ltr">${esc(p.phone)}</a>${/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(p.email || '') ? `<a href="mailto:${esc(p.email)}" dir="ltr">${esc(p.email)}</a>` : (p.email ? `<span dir="ltr">${esc(p.email)}</span>` : '')}<span>${esc(fmt(p.last))}</span></div>
        ${p.notes.size ? `<p class="hint">הערה: ${Array.from(p.notes).map(esc).join(' | ')}</p>` : ''}
        ${p.items.map((c) => { const i = itemById[c.item_id] || { title: c.item_id }; const sh = shelfOf[c.item_id];
          return `<div class="pitem"><span><b>${esc(i.title)}</b>${sh ? `<span class="hint"> · ${esc(sh.name)}</span>` : ''} <span class="badge ${c.state}">${STATE_TEXT[c.state] || c.state}</span></span>
            <span class="btns">${c.state === 'reserved' ? `<button class="btn small" data-act="collected" data-id="${esc(c.item_id)}">נמסר</button>` : `<button class="btn small" data-act="reserved" data-id="${esc(c.item_id)}">החזר לשמור</button>`}
            <button class="btn small danger" data-act="release" data-id="${esc(c.item_id)}">שחרור</button></span></div>`; }).join('')}
        <div class="actions no-print"><button class="btn small" data-act="all-collected" data-key="${esc(p.key)}">סמן הכול כנמסר</button></div>
      </section>`).join('') : '<p class="empty">אין בקשות להצגה.</p>';
  }

  function renderFree() {
    const taken = new Set(STATE.claims.map((c) => c.item_id));
    const free = CAT.items.filter((i) => !taken.has(i.id));
    $('#free').innerHTML = `<div class="panel"><h2 style="font-size:1.1rem">${free.length} פריטים פנויים</h2><ul class="free-list">${free.map((i) => `<li>${esc(i.title)}${i.volumes ? ` (${i.volumes} כרכים)` : ''}</li>`).join('')}</ul></div>`;
  }

  async function load() {
    try { STATE.claims = await A.listClaims(); render(); }
    catch (e) { if (e.status === 401 || e.status === 403) { showLogin(); } else toast('הטעינה נכשלה: ' + e.message); }
  }

  function csv() {
    const rows = [['תאריך', 'שם', 'טלפון', 'מייל', 'הערה', 'ספר', 'מדף', 'סטטוס']];
    STATE.claims.slice().sort((a, b) => (a.name > b.name ? 1 : -1)).forEach((c) => {
      const i = itemById[c.item_id] || { title: c.item_id };
      rows.push([fmt(c.created_at), c.name, c.phone, c.email || '', c.note || '', i.title, shelfOf[c.item_id] ? shelfOf[c.item_id].name : '', STATE_TEXT[c.state] || c.state]);
    });
    // הגנה מפני הזרקת נוסחאות באקסל
    const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=@\t\r]/.test(s) || /^[+\-](?![\d\s().\-]+$)/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'בקשות-ספרים-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function act(btn) {
    const act = btn.dataset.act; btn.disabled = true;
    try {
      if (act === 'collected' || act === 'reserved') await A.setState(btn.dataset.id, act);
      else if (act === 'release') {
        const i = itemById[btn.dataset.id];
        if (!confirm('לשחרר את "' + (i ? i.title : btn.dataset.id) + '"? הוא יחזור להיות פנוי לכולם.')) { btn.disabled = false; return; }
        await A.cancel(btn.dataset.id);
      } else if (act === 'all-collected') {
        const p = people().find((x) => x.key === btn.dataset.key);
        if (p) for (const c of p.items) if (c.state === 'reserved') await A.setState(c.item_id, 'collected');
      }
      await load(); toast('עודכן');
    } catch (e) { if (e.status === 401 || e.status === 403) { showLogin(); return; } toast('הפעולה נכשלה: ' + e.message); btn.disabled = false; }
  }

  function showLogin() { $('#login-wrap').hidden = false; $('#admin-wrap').hidden = true; }
  async function showAdmin() {
    $('#login-wrap').hidden = true; $('#admin-wrap').hidden = false;
    $('#logout').hidden = !A.isLive; $('#demo-reset').hidden = A.isLive;
    try { const s = await Api.getSettings(); $('#limit').value = s.maxItems || 0; } catch (e) { /* ignore */ }
    load();
  }

  document.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act(b); });
  $('#refresh').onclick = load; $('#export').onclick = csv;
  $('#tab-people').onclick = () => { STATE.tab = 'people'; render(); }; $('#tab-free').onclick = () => { STATE.tab = 'free'; render(); };
  $('#a-search').oninput = (e) => { STATE.q = e.target.value; renderPeople(); };
  $('#logout').onclick = () => { A.logout(); location.reload(); };
  $('#demo-reset').onclick = () => { if (confirm('למחוק את כל נתוני ההדגמה?')) { A.demoReset(); load(); } };
  $('#limit-save').onclick = async () => {
    const n = Math.max(0, Math.min(200, parseInt($('#limit').value, 10) || 0));
    try { await A.setLimit(n); $('#limit').value = n; $('#limit-msg').textContent = n ? 'נשמר: עד ' + n + ' פריטים לאדם' : 'נשמר: ללא מגבלה'; }
    catch (e) { $('#limit-msg').textContent = 'השמירה נכשלה'; }
  };
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault(); $('#a-err').textContent = '';
    try { await A.login($('#a-email').value.trim(), $('#a-pass').value); showAdmin(); }
    catch (err) { $('#a-err').textContent = err.status === 400 ? 'מייל או סיסמה שגויים' : (err.message || 'הכניסה נכשלה'); }
  };

  $('#demo-banner').hidden = Api.live;
  A.hasSession().then((ok) => (ok ? showAdmin() : showLogin()));
})();
