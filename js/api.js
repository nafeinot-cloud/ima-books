/*
 * שכבת גישה לנתונים. שני מצבים:
 *  - live: Supabase (REST + Edge Function), בלי ספריות חיצוניות.
 *  - demo: localStorage, מתנהג זהה (ראשון זוכה, מגבלה לאדם) לצורך בדיקות והדגמה.
 */
const Api = (() => {
  const cfg = window.SITE_CONFIG || {};
  const live = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const base = (cfg.SUPABASE_URL || '').replace(/\/$/, '');
  const DEMO_KEY = 'ima_books_demo_v1';
  const MINE_KEY = 'ima_books_mine_v2';
  const TOKEN_KEY = 'ima_books_admin_token';

  const digits = (s) => String(s || '').replace(/\D/g, '');
  // זהה לפונקציה norm_phone ב-SQL: +972501234567 = 0501234567
  const normPhone = (s) => {
    const d = digits(s).replace(/^00/, '');
    return /^972/.test(d) ? '0' + d.slice(3) : d;
  };

  /* ---------- אחסון מקומי בטוח ---------- */
  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  /* ---------- "הבקשות שלי" (מקומי בכל מכשיר): [{itemId, token, requestId}] ---------- */
  function getMine() { return lsGet(MINE_KEY, []); }
  function addMine(entries) {
    const ids = new Set(entries.map((e) => e.itemId));
    return lsSet(MINE_KEY, getMine().filter((m) => !ids.has(m.itemId)).concat(entries));
  }
  function removeMine(itemId) { lsSet(MINE_KEY, getMine().filter((m) => m.itemId !== itemId)); }

  /* ---------- helpers ל-HTTP ---------- */
  async function http(path, { method = 'GET', body, token, headers = {} } = {}) {
    const key = cfg.SUPABASE_ANON_KEY;
    // מפתחות publishable חדשים (sb_publishable_...) אינם JWT ואסור לשלוח אותם כ-Bearer
    const bearer = token || (/^eyJ/.test(key) ? key : '');
    const h = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, headers);
    if (bearer) h.Authorization = 'Bearer ' + bearer;
    const res = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.error || data.msg)) || ('HTTP ' + res.status));
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------- demo store ---------- */
  function demoLoad() { return lsGet(DEMO_KEY, { claims: [], maxItems: 0 }); }
  function demoSave(s) { if (!lsSet(DEMO_KEY, s)) throw new Error('storage_unavailable'); }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Math.random().toString(16).slice(2) + Date.now());

  /* ---------- ציבורי ---------- */
  async function getStates() {
    // -> { itemId: { state: 'reserved'|'collected', rid: requestId } }
    const m = {};
    if (!live) { demoLoad().claims.forEach((c) => { m[c.item_id] = { state: c.state, rid: c.request_id }; }); return m; }
    const rows = await http('/rest/v1/item_state?select=item_id,state,request_id');
    rows.forEach((r) => { m[r.item_id] = { state: r.state, rid: r.request_id }; });
    return m;
  }

  async function getSettings() {
    if (!live) return { maxItems: demoLoad().maxItems || 0 };
    const rows = await http('/rest/v1/settings?select=max_items_per_person&id=eq.1');
    return { maxItems: rows && rows[0] ? rows[0].max_items_per_person : 0 };
  }

  /**
   * שולח בקשה. מחזיר { claimed: [{id}], failed: [{id, reason}], canCancel }
   * reason: 'taken' | 'limit' | 'unknown'.  canCancel=false אם לא הצלחנו לשמור במכשיר את אפשרות הביטול.
   */
  async function submitRequest({ itemIds, name, phone, email, note, website }) {
    if (!live) {
      const s = demoLoad();
      const taken = new Set(s.claims.map((c) => c.item_id));
      const mine = s.claims.filter((c) => normPhone(c.phone) === normPhone(phone)).length;
      const room = s.maxItems > 0 ? Math.max(0, s.maxItems - mine) : Infinity;
      const requestId = uuid(); const token = uuid();
      const claimed = []; const failed = [];
      itemIds.slice().sort().forEach((id) => {
        if (taken.has(id)) failed.push({ id, reason: 'taken' });
        else if (claimed.length >= room) failed.push({ id, reason: 'limit' });
        else {
          taken.add(id); claimed.push({ id });
          s.claims.push({ item_id: id, request_id: requestId, name, phone, email: email || '', note: note || '', token, state: 'reserved', created_at: new Date().toISOString() });
        }
      });
      demoSave(s);
      const canCancel = claimed.length ? addMine(claimed.map((c) => ({ itemId: c.id, token, requestId }))) : true;
      return { claimed, failed, canCancel };
    }
    const data = await http('/functions/v1/submit-request', {
      method: 'POST',
      body: { items: itemIds, name, phone, email: email || '', note: note || '', website: website || '' },
    });
    const claimed = data.claimed || [];
    const canCancel = claimed.length ? addMine(claimed.map((c) => ({ itemId: c.id, token: data.token, requestId: data.request_id }))) : true;
    return { claimed, failed: data.failed || [], canCancel };
  }

  async function cancelMine(itemId) {
    const mine = getMine().find((m) => m.itemId === itemId);
    if (!mine) return false;
    if (!live) {
      const s = demoLoad();
      s.claims = s.claims.filter((c) => !(c.item_id === itemId && c.token === mine.token && c.state === 'reserved'));
      demoSave(s);
    } else {
      await http('/rest/v1/rpc/cancel_claim', { method: 'POST', body: { p_item: itemId, p_token: mine.token } });
    }
    removeMine(itemId);
    return true;
  }

  /* ---------- מנהל ---------- */
  async function isAdminToken(t) {
    try { return (await http('/rest/v1/rpc/is_admin', { method: 'POST', body: {}, token: t })) === true; } catch (e) { return false; }
  }
  const admin = {
    isLive: live,
    token() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    async login(email, password) {
      if (!live) return true;
      const data = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      if (!(await isAdminToken(data.access_token))) throw new Error('אין הרשאת מנהל');
      try { sessionStorage.setItem(TOKEN_KEY, data.access_token); } catch (e) { /* ignore */ }
      return true;
    },
    logout() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } },
    async hasSession() {
      if (!live) return true;
      const t = this.token();
      return !!t && isAdminToken(t);
    },
    async listClaims() {
      if (!live) return demoLoad().claims.slice();
      return http('/rest/v1/claims?select=item_id,request_id,name,phone,email,note,state,created_at&order=created_at.desc', { token: this.token() });
    },
    async cancel(itemId) {
      if (!live) { const s = demoLoad(); s.claims = s.claims.filter((c) => c.item_id !== itemId); demoSave(s); return; }
      await http('/rest/v1/claims?item_id=eq.' + encodeURIComponent(itemId), { method: 'DELETE', token: this.token() });
    },
    async setState(itemId, state) {
      if (!live) { const s = demoLoad(); s.claims.forEach((c) => { if (c.item_id === itemId) c.state = state; }); demoSave(s); return; }
      await http('/rest/v1/claims?item_id=eq.' + encodeURIComponent(itemId), { method: 'PATCH', body: { state }, token: this.token(), headers: { Prefer: 'return=minimal' } });
    },
    async setLimit(n) {
      if (!live) { const s = demoLoad(); s.maxItems = n; demoSave(s); return; }
      await http('/rest/v1/settings?id=eq.1', { method: 'PATCH', body: { max_items_per_person: n }, token: this.token(), headers: { Prefer: 'return=minimal' } });
    },
    demoReset() { try { localStorage.removeItem(DEMO_KEY); localStorage.removeItem(MINE_KEY); } catch (e) { /* ignore */ } },
  };

  return { live, getStates, getSettings, submitRequest, cancelMine, getMine, removeMine, admin, digits, normPhone };
})();
