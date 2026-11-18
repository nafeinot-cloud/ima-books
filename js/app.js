/* האתר הציבורי: קטלוג לפי מדפים, בחירה ושליחת בקשה */
(() => {
  'use strict';
  const CAT = window.CATALOG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const items = CAT.items.map((i) => Object.assign({}, i, { category: i.category === 'לא ידוע' ? 'אחר' : i.category }));
  const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
  const shelfOfItem = {};
  CAT.shelves.forEach((s) => s.items.forEach((id) => { shelfOfItem[id] = s; }));

  const S = {
    states: {},          // itemId -> { state, rid }
    loaded: false,       // האם התקבל לפחות רענון תקין אחד
    selected: new Set(),
    filter: 'all',       // all | free | set  (free ו-set ניתנים לשילוב)
    onlyFree: false, onlySets: false,
    q: '', group: '', cat: '', view: 'shelves',
    maxItems: 0,
  };

  /* ---------- כלים ---------- */
  const norm = (s) => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/["'׳״`]/g, '').replace(/[-־‐-―]/g, ' ').replace(/\s+/g, ' ').trim();
  const stateOf = (id) => (S.states[id] ? S.states[id].state : 'free');
  const isFree = (id) => !S.states[id];
  const isMine = (id) => {
    const st = S.states[id]; if (!st) return false;
    const m = Api.getMine().find((x) => x.itemId === id);
    return !!m && m.requestId === st.rid;
  };
  const itemsText = (n) => (n === 1 ? 'פריט אחד' : n + ' פריטים');
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function ssGet(k, d) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  /* ---------- בניית DOM ---------- */
  function badges(i) {
    let h = '';
    if (i.kind === 'set') h += `<span class="badge set">סט שלם${i.volumes ? ' · ' + i.volumes + ' כרכים' : ''}</span>`;
    else if (i.kind === 'collection') h += `<span class="badge set">אוסף${i.volumes ? ' · כ-' + i.volumes : ''}</span>`;
    return h;
  }
  function itemRow(i, flat) {
    const shelf = shelfOfItem[i.id];
    return `<li class="item" data-id="${i.id}"><label>
      <input type="checkbox" data-id="${i.id}" aria-label="בחירת ${esc(i.title)}">
      <span class="txt"><span class="title">${esc(i.title)}</span>${i.author ? `<span class="sub"> · ${esc(i.author)}</span>` : ''}
        ${i.desc ? `<span class="desc">${esc(i.desc)}</span>` : ''}<span class="meta"><span class="badge free" data-status>פנוי</span>${badges(i)}<span class="sub">${esc(i.category)}</span>${flat ? ` <button type="button" class="shelf-link" data-shelf="${shelf.id}">${esc(shelf.name)} ←</button>` : ''}</span></span>
    </label></li>`;
  }
  function buildShelves() {
    let html = '';
    CAT.groups.forEach((g) => {
      const shelves = CAT.shelves.filter((s) => s.group === g);
      html += `<section class="group" data-group="${esc(g)}"><h2 class="group-title">${esc(g)}</h2>`;
      shelves.forEach((s) => {
        html += `<article class="shelf" id="shelf-${s.id}" data-shelf="${s.id}">
          <div class="shelf-head"><h3>${esc(s.name)}</h3><span class="shelf-count" data-count></span></div>
          <div class="shelf-body">
            <button type="button" class="shelf-img" data-zoom="${s.id}" aria-label="הגדלת תמונת המדף: ${esc(s.name)}">
              <img src="${s.image}" width="${s.w}" height="${s.h}" loading="lazy" alt=""><span class="zoom" aria-hidden="true">הגדלה</span>
            </button>
          </div>
          <p class="shelf-note">הספרים שבתמונה זו (${s.items.length}):</p>
          <ul class="items">${s.items.map((id) => itemRow(itemById[id], false)).join('')}</ul>
          </article>`;
      });
      html += '</section>';
    });
    $('#shelves-view').innerHTML = html;
  }
  function buildList() {
    const sorted = items.slice().sort((a, b) => a.title.localeCompare(b.title, 'he'));
    $('#list-view').innerHTML = `<ul class="items" style="padding:0">${sorted.map((i) => itemRow(i, true)).join('')}</ul>`;
  }
  function buildSelects() {
    CAT.groups.forEach((g) => $('#sel-group').insertAdjacentHTML('beforeend', `<option>${esc(g)}</option>`));
    Array.from(new Set(items.map((i) => i.category))).sort((a, b) => a.localeCompare(b, 'he'))
      .forEach((c) => $('#sel-cat').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`));
  }

  /* ---------- סינון ---------- */
  function matches(i) {
    if (S.onlyFree && !isFree(i.id) && !isMine(i.id)) return false;
    if (S.onlyFree && !isFree(i.id)) return false;
    if (S.onlySets && i.kind === 'single') return false;
    if (S.group && shelfOfItem[i.id].group !== S.group) return false;
    if (S.cat && i.category !== S.cat) return false;
    if (S.q) {
      const hay = norm(i.title + ' ' + i.author + ' ' + i.category + ' ' + shelfOfItem[i.id].name);
      if (!norm(S.q).split(' ').every((t) => hay.includes(t))) return false;
    }
    return true;
  }
  function applyFilter() {
    const vis = {};
    items.forEach((i) => { vis[i.id] = matches(i); });
    $$('.item').forEach((li) => { li.hidden = !vis[li.dataset.id]; });
    $$('.shelf').forEach((sh) => {
      const s = CAT.shelves.find((x) => x.id === sh.dataset.shelf);
      sh.hidden = s.items.every((id) => !vis[id]);
      const free = s.items.filter((id) => isFree(id)).length;
      $('[data-count]', sh).textContent = (free === 0 ? 'אין פריטים פנויים' : free === 1 ? 'פריט אחד פנוי' : free + ' פריטים פנויים') + ' מתוך ' + s.items.length;
    });
    $$('.group').forEach((g) => { g.hidden = $$('.shelf', g).every((x) => x.hidden); });
    $('#empty').hidden = items.some((i) => vis[i.id]);
    $('#reset').hidden = !(S.onlyFree || S.onlySets || S.q || S.group || S.cat);
    $$('.chip').forEach((c) => {
      const f = c.dataset.filter;
      c.setAttribute('aria-pressed', f === 'all' ? !(S.onlyFree || S.onlySets) : (f === 'free' ? S.onlyFree : S.onlySets));
    });
  }

  /* ---------- מצבים ובחירה ---------- */
  const STATUS_TEXT = { free: 'פנוי', reserved: 'נשמר', collected: 'נמסר', mine: 'שמור עבורכם' };
  function applyStates() {
    // ניקוי רשומות "הבקשות שלי" שכבר אינן שלי (שוחררו, או נשמרו ע"י אחר)
    if (S.loaded) Api.getMine().forEach((m) => { const st = S.states[m.itemId]; if (!st || st.rid !== m.requestId) Api.removeMine(m.itemId); });
    let dropped = 0;
    $$('.item').forEach((li) => {
      const id = li.dataset.id;
      const st = isMine(id) ? 'mine' : stateOf(id);
      const cb = $('input', li);
      const unavailable = st !== 'free';
      li.classList.toggle('unavailable', unavailable);
      cb.disabled = unavailable;
      const b = $('[data-status]', li);
      b.className = 'badge ' + (st === 'mine' ? 'mine' : st); b.textContent = STATUS_TEXT[st];
      if (unavailable && S.selected.has(id)) { S.selected.delete(id); dropped++; }
      li.classList.toggle('selected', S.selected.has(id));
      cb.checked = S.selected.has(id);
    });
    if (dropped) toast(dropped === 1 ? 'אחד הספרים שבחרתם כבר נשמר על ידי מישהו אחר' : dropped + ' מהספרים שבחרתם כבר נשמרו על ידי אחרים');
    $('#stat-free').textContent = items.filter((i) => isFree(i.id)).length;
    $('#stat-total').textContent = items.length;
    $('#stat-vols').textContent = items.reduce((n, i) => n + (i.volumes || 1), 0);
    updateSelBar(); updateMine(); applyFilter();
  }
  function updateSelBar() {
    const n = S.selected.size;
    $('#selbar').hidden = n === 0;
    $('#sel-text').textContent = 'בסל שלי: ' + itemsText(n);
    ssSet('sel', Array.from(S.selected));
  }
  function toggleSelect(id, on) {
    if (on && !isFree(id)) return;
    if (on) S.selected.add(id); else S.selected.delete(id);
    $$(`.item[data-id="${id}"]`).forEach((li) => { li.classList.toggle('selected', on); $('input', li).checked = on; });
    updateSelBar();
  }

  /* ---------- רענון זמינות ---------- */
  async function refreshStates() {
    try {
      S.states = await Api.getStates();
      S.loaded = true;
      $('#net-banner').hidden = true;
      applyStates();
    } catch (e) {
      $('#net-banner').hidden = false;
    }
  }

  /* ---------- דיאלוגים + כפתור "אחורה" ---------- */
  function openDialog(d) {
    if (d.open) return;
    d.showModal();
    try { history.pushState({ dlg: d.id }, ''); } catch (e) { /* ignore */ }
  }
  function closeDialog(d) { if (d.open) d.close(); }
  $$('dialog').forEach((d) => d.addEventListener('close', () => {
    if (history.state && history.state.dlg === d.id) { try { history.back(); } catch (e) { /* ignore */ } }
  }));
  window.addEventListener('popstate', () => { $$('dialog[open]').forEach((d) => d.close()); });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeDialog(e.target.closest('dialog'));
    else if (e.target.tagName === 'DIALOG' && e.target.id !== 'lightbox') closeDialog(e.target);
  });

  /* ---------- שליחת בקשה ---------- */
  const CONTACT_KEY = 'ima_books_contact_v1';
  const PHONE_RE = /^[\d\s+\-().]{7,20}$/;
  let sending = false;
  function loadContact() { try { return JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}'); } catch (e) { return {}; } }
  function renderChosen() {
    const ul = $('#req-list');
    ul.innerHTML = Array.from(S.selected).map((id) => `<li><span>${esc(itemById[id].title)}</span><button type="button" data-rm="${id}" aria-label="הסרת ${esc(itemById[id].title)}">×</button></li>`).join('');
    $('#req-submit').disabled = S.selected.size === 0;
    const w = $('#req-limit');
    if (S.maxItems > 0) {
      w.hidden = false;
      w.textContent = S.selected.size > S.maxItems
        ? `אפשר לשמור עד ${itemsText(S.maxItems)} לכל אדם. בחרתם ${itemsText(S.selected.size)}, ולכן רק חלק מהם יישמרו.`
        : `אפשר לשמור עד ${itemsText(S.maxItems)} לכל אדם.`;
    } else w.hidden = true;
  }
  const SLOTS = (window.SITE_CONFIG || {}).PICKUP_SLOTS || [];
  const slotLabel = (id) => (SLOTS.find((s) => s.id === id) || {}).label || '';
  function buildSlots() {
    $('#slot-options').innerHTML = SLOTS.map((s, i) => `<label class="slot-opt"><input type="radio" name="slot" value="${esc(s.id)}" ${i === 0 && SLOTS.length === 1 ? 'checked' : ''}> ${esc(s.label)}</label>`).join('');
    $('#pickup-dates').textContent = SLOTS.map((s) => s.label).join(' או ');
  }
  function addressBox(address, email, slot) {
    return `<div class="addr-box"><b>פרטי האיסוף</b><br>${slot ? 'מועד שבחרתם: <b>' + esc(slotLabel(slot)) + '</b><br>' : ''}${address ? 'כתובת: ' + esc(address) + '<br>' : ''}${email ? 'לשאלות: <a href="mailto:' + esc(email) + '" dir="ltr">' + esc(email) + '</a><br>' : ''}<span class="hint">אם לא תגיעו לאסוף, הספרים יחזרו להיות מסומנים כפנויים.</span></div>`;
  }
  function openRequest() {
    if (!S.selected.size) return;
    $$('#req-form input[name="slot"]').forEach((x) => { x.checked = SLOTS.length === 1; });
    $('#e-slot').textContent = '';
    const c = loadContact();
    $('#f-name').value = c.name || ''; $('#f-phone').value = c.phone || ''; $('#f-email').value = c.email || '';
    $('#f-note').value = ''; $('#f-website').value = '';
    ['name', 'phone', 'email', 'form'].forEach((k) => { $('#e-' + k).textContent = ''; });
    $$('#req-form input').forEach((x) => x.removeAttribute('aria-invalid'));
    $('#req-form-wrap').hidden = false; $('#req-result').hidden = true;
    renderChosen(); openDialog($('#request-dialog'));
    $('#req-title').focus();
  }
  function validate() {
    const name = $('#f-name').value.trim(), phone = $('#f-phone').value.trim(), email = $('#f-email').value.trim();
    const errs = {};
    if (name.length < 2) errs.name = 'נא למלא שם מלא';
    const d = Api.digits(phone);
    if (!PHONE_RE.test(phone) || d.length < 9 || d.length > 15) errs.phone = 'נא למלא מספר טלפון תקין, למשל 050-1234567';
    if (email && !/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(email)) errs.email = 'כתובת המייל אינה תקינה';
    ['name', 'phone', 'email'].forEach((k) => {
      $('#e-' + k).textContent = errs[k] || '';
      if (errs[k]) $('#f-' + k).setAttribute('aria-invalid', 'true'); else $('#f-' + k).removeAttribute('aria-invalid');
    });
    const slotOk = !!$('#req-form input[name="slot"]:checked');
    $('#e-slot').textContent = slotOk ? '' : 'נא לבחור מועד איסוף';
    if (!slotOk && !Object.keys(errs).length) { const r = $('#req-form input[name="slot"]'); if (r) r.focus(); return false; }
    const first = ['name', 'phone', 'email'].find((k) => errs[k]);
    if (first) $('#f-' + first).focus();
    return !first && slotOk;
  }
  async function submitRequest(ev) {
    ev.preventDefault();
    if (sending || !S.selected.size || !validate()) return;
    sending = true;
    const btn = $('#req-submit'); btn.disabled = true; btn.textContent = 'שולח…';
    $('#e-form').textContent = '';
    const payload = {
      itemIds: Array.from(S.selected), name: $('#f-name').value.trim(), phone: $('#f-phone').value.trim(),
      email: $('#f-email').value.trim(), note: $('#f-note').value.trim(), website: $('#f-website').value,
      slot: ($('#req-form input[name="slot"]:checked') || {}).value || '',
    };
    try {
      const res = await Api.submitRequest(payload);
      try { localStorage.setItem(CONTACT_KEY, JSON.stringify({ name: payload.name, phone: payload.phone, email: payload.email })); } catch (e) { /* ignore */ }
      res.claimed.forEach((c) => S.selected.delete(c.id));
      await refreshStates();
      showResult(res);
    } catch (e) {
      $('#e-form').textContent = e && e.message === 'storage_unavailable'
        ? 'הדפדפן חוסם שמירת נתונים (אולי מצב גלישה פרטית). נסו דפדפן אחר.'
        : 'לא הצלחנו לשלוח את הבקשה. בדקו את החיבור ונסו שוב. אם זה חוזר, פנו אליי ישירות.';
    } finally {
      sending = false; btn.disabled = S.selected.size === 0; btn.textContent = 'שליחת הבקשה';
    }
  }
  function showResult(res) {
    const w = $('#req-result');
    const reasons = { taken: 'כבר נשמר על ידי מישהו אחר', limit: 'חרגתם מהמספר המותר לאדם', unknown: 'לא ניתן היה לשמור' };
    let h = '';
    if (res.claimed.length) {
      const n = res.claimed.length;
      h += `<h2 tabindex="-1" id="res-title">הבקשה נשלחה, תודה!</h2><div class="notice ok">${n === 1 ? 'נשמר עבורכם פריט אחד' : 'נשמרו עבורכם ' + n + ' פריטים'}. הם שמורים עבורכם עד האיסוף.</div>
        ${addressBox(res.address, res.contact_email, res.slot)}
        <ul>${res.claimed.map((c) => `<li>${esc(itemById[c.id].title)}</li>`).join('')}</ul>`;
      h += res.canCancel === false
        ? '<div class="notice warn">לא הצלחנו לשמור במכשיר הזה את האפשרות לבטל בעצמכם. אם תרצו לבטל, פנו אליי ישירות.</div>'
        : '<p class="hint">אפשר לבטל בקשה ולבדוק את מצבה בכל עת דרך "הבקשות שלי" באתר.</p>';
      if (res.canCancel !== false && Api.personalLink()) h += linkBox(Api.personalLink());
    } else {
      h += '<h2 tabindex="-1" id="res-title">לא נשמר אף פריט</h2>';
    }
    if (res.failed.length) {
      h += `<div class="notice warn"><b>לא נשמרו:</b><ul>${res.failed.map((f) => `<li>${esc(itemById[f.id] ? itemById[f.id].title : f.id)} – ${reasons[f.reason] || reasons.unknown}</li>`).join('')}</ul></div>`;
    }
    h += '<div class="actions"><button class="btn primary" type="button" data-close>סגירה</button></div>';
    w.innerHTML = h; w.hidden = false; $('#req-form-wrap').hidden = true;
    $('#res-title').focus();
  }

  /* ---------- הבקשות שלי ---------- */
  const myList = () => Api.getMine().filter((m) => isMine(m.itemId));
  function updateMine() {
    const n = myList().length;
    $('#mine-btn').hidden = n === 0; $('#mine-count').textContent = n;
  }
  const MINE_TEXT = { reserved: 'ממתין לתיאום', arranged: 'איסוף נקבע', collected: 'נמסר' };
  function linkBox(link) {
    return `<div class="linkbox"><b>הקישור האישי שלכם</b>
      <p class="hint">פתחו אותו מכל מכשיר כדי לראות את מצב הבקשות. שמרו אותו (למשל שלחו לעצמכם בוואטסאפ) ואל תשתפו עם אחרים.</p>
      <input type="text" readonly dir="ltr" class="ltr linkinput" value="${esc(link)}" aria-label="קישור אישי">
      <button class="btn small" type="button" data-copy-link>העתקת הקישור</button></div>`;
  }
  async function openMine() {
    const box = $('#mine-list');
    box.innerHTML = '<p class="hint">טוען…</p>';
    openDialog($('#mine-dialog'));
    let rows;
    try { rows = (await Api.myClaims()).filter((r) => itemById[r.item_id]); }
    catch (e) { box.innerHTML = '<p class="notice warn">לא הצלחנו לטעון את הבקשות. נסו שוב בעוד רגע.</p>'; return; }
    // רשומות מקומיות שכבר אינן בשרת (בוטלו ע"י המנהל) מוסרות
    Api.getMine().forEach((m) => { if (!rows.some((r) => r.item_id === m.itemId && r.token === m.token)) Api.removeMine(m.itemId); });
    updateMine();
    const notes = Array.from(new Set(rows.filter((r) => r.pickup_note).map((r) => r.pickup_note)));
    let h = '';
    if (rows.length) {
      let info = { address: '', contact_email: '' };
      try { info = await Api.pickupInfo(); } catch (e) { /* ignore */ }
      const slots = Array.from(new Set(rows.map((r) => r.pickup_slot).filter(Boolean)));
      h += addressBox(info.address, info.contact_email, '').replace('<br><span class="hint">', (slots.length ? 'מועד האיסוף שבחרתם: <b>' + slots.map((s) => esc(slotLabel(s))).join(', ') + '</b><br>' : '') + '<span class="hint">');
    }
    h += notes.map((n) => `<div class="notice ok"><b>הודעה לגבי האיסוף:</b> ${esc(n)}</div>`).join('');
    h += rows.length ? rows.map((r) => {
      const i = itemById[r.item_id];
      return `<div class="mine-item"><span>${esc(i.title)}<br><span class="badge ${r.state}">${MINE_TEXT[r.state] || r.state}</span></span>${r.state !== 'collected' ? `<button class="btn danger" type="button" data-cancel="${r.item_id}">בטלו בקשה</button>` : ''}</div>`;
    }).join('') : '<p class="hint">אין בקשות פעילות.</p>';
    const link = Api.personalLink();
    if (link && rows.length) h += linkBox(link);
    box.innerHTML = h;
  }

  /* ---------- תצוגות ---------- */
  function setView(v) {
    S.view = v;
    $('#shelves-view').hidden = v !== 'shelves'; $('#list-view').hidden = v !== 'list';
    $('#view-shelves').setAttribute('aria-pressed', v === 'shelves'); $('#view-list').setAttribute('aria-pressed', v === 'list');
  }
  function resetFilters() {
    S.onlyFree = S.onlySets = false; S.q = ''; S.group = ''; S.cat = '';
    $('#q').value = ''; $('#sel-group').value = ''; $('#sel-cat').value = '';
    applyFilter();
  }
  function goToShelf(id) {
    setView('shelves');
    const el = $('#shelf-' + id);
    if (el.hidden) resetFilters();
    el.scrollIntoView({ block: 'start' });
    el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true });
  }
  // גובה סרגל הכלים (דביק) משמש ל-scroll-margin
  function measureToolbar() {
    const t = $('.toolbar'); if (t) document.documentElement.style.setProperty('--toolbar-h', (getComputedStyle(t).position === 'sticky' ? t.offsetHeight : 0) + 'px');
  }

  /* ---------- Lightbox ---------- */
  const LB = { idx: 0, s: 1, x: 0, y: 0, fit: 1, pts: new Map(), startDist: 0, startScale: 1 };
  const stage = () => $('#lb-stage'); const img = () => $('#lb-img');
  function lbApply() {
    const st = stage(), im = img();
    const w = im.naturalWidth * LB.s, h = im.naturalHeight * LB.s;
    LB.x = w <= st.clientWidth ? (st.clientWidth - w) / 2 : Math.min(0, Math.max(st.clientWidth - w, LB.x));
    LB.y = h <= st.clientHeight ? (st.clientHeight - h) / 2 : Math.min(0, Math.max(st.clientHeight - h, LB.y));
    im.style.transform = `translate(${LB.x}px, ${LB.y}px) scale(${LB.s})`;
  }
  function lbFit() {
    const st = stage(), im = img();
    if (!im.naturalWidth) return;
    LB.fit = Math.min(st.clientWidth / im.naturalWidth, st.clientHeight / im.naturalHeight);
    LB.s = LB.fit; LB.x = 0; LB.y = 0; lbApply();
  }
  function lbZoomAt(factor, cx, cy) {
    const ns = Math.min(Math.max(LB.s * factor, LB.fit), Math.max(LB.fit * 4, 2));
    const k = ns / LB.s;
    LB.x = cx - (cx - LB.x) * k; LB.y = cy - (cy - LB.y) * k; LB.s = ns; lbApply();
  }
  function openLightbox(shelfId) {
    LB.idx = Math.max(0, CAT.shelves.findIndex((s) => s.id === shelfId));
    const s = CAT.shelves[LB.idx];
    $('#lb-title').textContent = s.group + ' · ' + s.name;
    const im = img(); im.alt = 'תמונת מדף: ' + s.name;
    im.onload = lbFit; im.src = s.image;
    openDialog($('#lightbox'));
    requestAnimationFrame(lbFit);
  }
  function lbStep(d) { const open = $('#lightbox').open; const s = CAT.shelves[(LB.idx + d + CAT.shelves.length) % CAT.shelves.length]; if (open) { LB.idx = CAT.shelves.indexOf(s); $('#lb-title').textContent = s.group + ' · ' + s.name; const im = img(); im.alt = 'תמונת מדף: ' + s.name; im.onload = lbFit; im.src = s.image; } }
  function initLightbox() {
    const st = stage();
    st.addEventListener('wheel', (e) => { e.preventDefault(); const r = st.getBoundingClientRect(); lbZoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    st.addEventListener('pointerdown', (e) => { st.setPointerCapture(e.pointerId); LB.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); st.classList.add('grabbing');
      if (LB.pts.size === 2) { const [a, b] = Array.from(LB.pts.values()); LB.startDist = Math.hypot(a.x - b.x, a.y - b.y); LB.startScale = LB.s; } });
    st.addEventListener('pointermove', (e) => {
      if (!LB.pts.has(e.pointerId)) return;
      const prev = LB.pts.get(e.pointerId); const cur = { x: e.clientX, y: e.clientY };
      if (LB.pts.size === 1) { LB.x += cur.x - prev.x; LB.y += cur.y - prev.y; LB.pts.set(e.pointerId, cur); lbApply(); }
      else if (LB.pts.size === 2) {
        LB.pts.set(e.pointerId, cur);
        const [a, b] = Array.from(LB.pts.values()); const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = st.getBoundingClientRect();
        if (LB.startDist) lbZoomAt((LB.startScale * d / LB.startDist) / LB.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      }
    });
    const up = (e) => { LB.pts.delete(e.pointerId); if (!LB.pts.size) st.classList.remove('grabbing'); LB.startDist = 0; };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    st.addEventListener('dblclick', (e) => { const r = st.getBoundingClientRect(); if (LB.s > LB.fit * 1.05) lbFit(); else lbZoomAt(2.5, e.clientX - r.left, e.clientY - r.top); });
    $('#lb-zoom-in').onclick = () => lbZoomAt(1.3, st.clientWidth / 2, st.clientHeight / 2);
    $('#lb-zoom-out').onclick = () => lbZoomAt(1 / 1.3, st.clientWidth / 2, st.clientHeight / 2);
    $('#lb-fit').onclick = lbFit;
    $('#lb-prev').onclick = () => lbStep(-1); $('#lb-next').onclick = () => lbStep(1);
    $('#lb-goto').onclick = () => { const id = CAT.shelves[LB.idx].id; closeDialog($('#lightbox')); setTimeout(() => goToShelf(id), 60); };
    $('#lightbox').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') lbStep(1); else if (e.key === 'ArrowRight') lbStep(-1);
      else if (e.key === '+' || e.key === '=') $('#lb-zoom-in').click(); else if (e.key === '-') $('#lb-zoom-out').click();
    });
    window.addEventListener('resize', () => { if ($('#lightbox').open) lbFit(); });
  }

  /* ---------- אירועים ---------- */
  function bind() {
    document.addEventListener('change', (e) => { const cb = e.target.closest('.item input[type=checkbox]'); if (cb) toggleSelect(cb.dataset.id, cb.checked); });
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy-link]'); if (!c) return;
      const inp = c.parentElement.querySelector('.linkinput');
      const done = () => toast('הקישור הועתק');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, () => { inp.select(); toast('סמנו והעתיקו את הקישור'); });
      else { inp.select(); try { document.execCommand('copy'); done(); } catch (err) { toast('סמנו והעתיקו את הקישור'); } }
    });
    document.addEventListener('click', (e) => {
      const z = e.target.closest('[data-zoom]'); if (z) { openLightbox(z.dataset.zoom); return; }
      const sl = e.target.closest('[data-shelf].shelf-link'); if (sl) { e.preventDefault(); openLightbox(sl.dataset.shelf); return; }
      const rm = e.target.closest('[data-rm]'); if (rm) { toggleSelect(rm.dataset.rm, false); renderChosen(); if (!S.selected.size) closeDialog($('#request-dialog')); return; }
      const cn = e.target.closest('[data-cancel]');
      if (cn) {
        const id = cn.dataset.cancel;
        if (!confirm('לבטל את הבקשה? הספר יחזור להיות פנוי לאחרים.')) return;
        cn.disabled = true;
        Api.cancelMine(id).then(() => { toast('הבקשה בוטלה'); return refreshStates(); }).then(() => { closeDialog($('#mine-dialog')); if (myList().length) setTimeout(openMine, 80); }).catch(() => { toast('הביטול לא הצליח, נסו שוב'); cn.disabled = false; });
      }
    });
    let qt; $('#q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; applyFilter(); }, 120); });
    $$('.chip').forEach((c) => c.addEventListener('click', () => {
      const f = c.dataset.filter;
      if (f === 'all') { S.onlyFree = S.onlySets = false; } else if (f === 'free') S.onlyFree = !S.onlyFree; else S.onlySets = !S.onlySets;
      applyFilter();
    }));
    $('#sel-group').addEventListener('change', (e) => { S.group = e.target.value; applyFilter(); });
    $('#sel-cat').addEventListener('change', (e) => { S.cat = e.target.value; applyFilter(); });
    $('#reset').addEventListener('click', resetFilters); $('#empty-reset').addEventListener('click', resetFilters);
    $('#view-shelves').addEventListener('click', () => setView('shelves')); $('#view-list').addEventListener('click', () => setView('list'));
    $('#sel-clear').addEventListener('click', () => { Array.from(S.selected).forEach((id) => toggleSelect(id, false)); });
    $('#sel-send').addEventListener('click', openRequest);
    $('#req-form').addEventListener('submit', submitRequest);
    $('#mine-btn').addEventListener('click', openMine);
    $('#forget-contact').addEventListener('click', () => { try { localStorage.removeItem(CONTACT_KEY); } catch (e) { /* ignore */ } ['f-name', 'f-phone', 'f-email'].forEach((id) => { $('#' + id).value = ''; }); toast('הפרטים השמורים נמחקו'); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStates(); });
    // במסך רחב פותחים את "עוד סינון" כברירת מחדל
    const more = $('#more'); const mq = window.matchMedia('(min-width: 641px)');
    const sync = () => { more.open = mq.matches; setTimeout(measureToolbar, 0); };
    sync(); (mq.addEventListener ? mq.addEventListener('change', sync) : mq.addListener(sync));
    more.addEventListener('toggle', measureToolbar);
    window.addEventListener('resize', measureToolbar);
  }

  /* ---------- אתחול ---------- */
  function init() {
    buildSlots(); buildShelves(); buildList(); buildSelects(); initLightbox(); bind();
    ssGet('sel', []).forEach((id) => { if (itemById[id]) S.selected.add(id); });
    $('#demo-banner').hidden = Api.live;
    applyStates(); measureToolbar();
    refreshStates();
    const r = new URLSearchParams(location.search).get('r');
    if (r) {
      Api.restoreFromTokens(r.split(',')).then(async (n) => {
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
        await refreshStates();
        if (n) { toast('הבקשות שלכם נטענו'); openMine(); } else toast('הקישור אינו תקף, או שהבקשות כבר בוטלו');
      }).catch(() => toast('לא הצלחנו לטעון את הבקשות מהקישור'));
    }
    Api.getSettings().then((s) => { S.maxItems = s.maxItems || 0; }).catch(() => { /* ignore */ });
    setInterval(() => { if (!document.hidden) refreshStates(); }, ((window.SITE_CONFIG || {}).POLL_SECONDS || 25) * 1000);
  }
  init();
})();
