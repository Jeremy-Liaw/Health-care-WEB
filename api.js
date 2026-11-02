/* 資料層：以 GitHub Contents API 讀寫私人 repo 內的 JSON 檔 */
const Store = (() => {
  'use strict';
  const CFG_KEY = 'hb.config.v1', CACHE_KEY = 'hb.cache.v1', DIRTY_KEY = 'hb.dirty.v1';
  const API = 'https://api.github.com';

  const read = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 隱私模式等情況 */ } };

  let cfg = read(CFG_KEY, null);
  let data = HB.normalize(read(CACHE_KEY, null));
  let dirty = normDirty(read(DIRTY_KEY, null));
  let sha = null, saving = false, again = false, timer = null;
  let status = { state: 'idle', msg: '' };
  const statusCbs = [];

  function normDirty(d) {
    d = d || {};
    return { days: d.days || [], up: d.up || [], del: d.del || [], goals: !!d.goals };
  }
  const hasDirty = () => dirty.days.length || dirty.up.length || dirty.del.length || dirty.goals;
  const addTo = (arr, v) => { if (!arr.includes(v)) arr.push(v); };

  function setStatus(state, msg = '') {
    status = { state, msg };
    statusCbs.forEach(f => f(status));
  }
  function persist() { write(CACHE_KEY, data); write(DIRTY_KEY, dirty); }

  /* ----- Base64（UTF-8 安全） ----- */
  const b64enc = str => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64dec = b64 => {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  };

  /* ----- GitHub 請求 ----- */
  function headers(extra) {
    return {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra
    };
  }
  const fileUrl = () => `${API}/repos/${cfg.repo}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;

  async function explain(res) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
    const err = new Error(
      res.status === 401 ? 'Token 無效或已過期（401）'
        : res.status === 403 ? `沒有權限或超過 API 次數限制（403）${detail ? '：' + detail : ''}`
          : `GitHub 回應 ${res.status}${detail ? '：' + detail : ''}`);
    err.status = res.status;
    return err;
  }

  async function getRemote() {
    const res = await fetch(`${fileUrl()}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(), cache: 'no-store' });
    if (res.status === 404) return { missing: true };
    if (!res.ok) throw await explain(res);
    const j = await res.json();
    let text;
    if (j.content && j.encoding === 'base64') text = b64dec(j.content);
    else {
      const raw = await fetch(`${fileUrl()}?ref=${encodeURIComponent(cfg.branch)}`, {
        headers: headers({ Accept: 'application/vnd.github.raw+json' }), cache: 'no-store'
      });
      if (!raw.ok) throw await explain(raw);
      text = await raw.text();
    }
    return { sha: j.sha, data: HB.normalize(JSON.parse(text)) };
  }

  async function putRemote(obj, baseSha, message) {
    const body = { message, content: b64enc(JSON.stringify(obj, null, 1) + '\n'), branch: cfg.branch };
    if (baseSha) body.sha = baseSha;
    const res = await fetch(fileUrl(), { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (res.status === 409 || res.status === 422) { const e = new Error('版本衝突'); e.conflict = true; throw e; }
    if (!res.ok) throw await explain(res);
    return (await res.json()).content.sha;
  }

  /* ----- 合併：只覆寫「這台裝置有改動」的項目 ----- */
  function applyDirty(base, local, d) {
    const out = JSON.parse(JSON.stringify(base));
    for (const k of d.days) { if (local.days[k]) out.days[k] = local.days[k]; else delete out.days[k]; }
    for (const id of d.up) {
      const w = local.workouts.find(x => x.id === id);
      if (!w) continue;
      const i = out.workouts.findIndex(x => x.id === id);
      if (i >= 0) out.workouts[i] = w; else out.workouts.push(w);
    }
    if (d.del.length) out.workouts = out.workouts.filter(w => !d.del.includes(w.id));
    if (d.goals) out.goals = local.goals;
    out.workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }

  async function flush() {
    if (!cfg) return;
    if (saving) { again = true; return; }
    if (!hasDirty()) return;
    clearTimeout(timer);
    saving = true;
    setStatus('saving');
    const snap = JSON.parse(JSON.stringify(dirty));
    dirty = normDirty(null);
    const msg = 'log: ' + (snap.days.slice(-1)[0] || (snap.up.length || snap.del.length ? 'workout' : 'goals'));
    try {
      for (let attempt = 0; ; attempt++) {
        const remote = await getRemote();
        const base = remote.missing ? HB.emptyData() : remote.data;
        const merged = applyDirty(base, data, snap);
        try {
          sha = await putRemote(merged, remote.missing ? null : remote.sha, msg);
          data = applyDirty(merged, data, dirty); // 保留儲存期間新增的修改
          break;
        } catch (e) {
          if (e.conflict && attempt < 2) continue;
          throw e;
        }
      }
      persist();
      setStatus(hasDirty() ? 'pending' : 'saved');
    } catch (e) {
      snap.days.forEach(k => addTo(dirty.days, k));
      snap.up.forEach(k => addTo(dirty.up, k));
      snap.del.forEach(k => addTo(dirty.del, k));
      dirty.goals = dirty.goals || snap.goals;
      persist();
      setStatus('error', navigator.onLine === false ? '目前離線，連線後會自動同步' : e.message);
    } finally {
      saving = false;
      if (again) { again = false; schedule(300); }
    }
  }
  function schedule(ms = 1200) {
    persist();
    setStatus('pending');
    clearTimeout(timer);
    timer = setTimeout(flush, ms);
  }

  /* ----- 對外 API ----- */
  async function load() {
    if (!cfg) return;
    setStatus('loading');
    try {
      const remote = await getRemote();
      if (remote.missing) throw new Error('找不到資料檔，請到「設定」重新連線');
      sha = remote.sha;
      data = hasDirty() ? applyDirty(remote.data, data, dirty) : remote.data;
      persist();
      setStatus(hasDirty() ? 'pending' : 'saved');
      if (hasDirty()) flush();
    } catch (e) {
      setStatus('error', navigator.onLine === false ? '目前離線，顯示的是上次同步的資料' : e.message);
    }
  }

  async function connect(input) {
    const next = {
      repo: input.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''),
      branch: (input.branch || 'main').trim(),
      path: (input.path || 'data/health.json').trim().replace(/^\//, ''),
      token: input.token.trim()
    };
    if (!/^[\w.-]+\/[\w.-]+$/.test(next.repo)) throw new Error('Repo 格式應為「帳號/名稱」，例如 jeremy/health-data');
    if (!next.token) throw new Error('請輸入 Token');
    const prev = cfg;
    cfg = next;
    try {
      const probe = await fetch(`${API}/repos/${next.repo}`, { headers: headers(), cache: 'no-store' });
      if (!probe.ok) throw probe.status === 404
        ? new Error('找不到這個 Repo，或這個 Token 沒有它的權限')
        : await explain(probe);
      const remote = await getRemote();
      if (remote.missing) {
        data = HB.emptyData();
        sha = await putRemote(data, null, 'init: health data');
        dirty = normDirty(null);
      } else {
        sha = remote.sha;
        data = hasDirty() ? applyDirty(remote.data, data, dirty) : remote.data;
      }
      write(CFG_KEY, cfg);
      persist();
      setStatus('saved');
      return { created: !!remote.missing };
    } catch (e) {
      cfg = prev;
      throw e;
    }
  }

  function disconnect() {
    cfg = null; sha = null;
    data = HB.emptyData(); dirty = normDirty(null);
    try { localStorage.removeItem(CFG_KEY); localStorage.removeItem(CACHE_KEY); localStorage.removeItem(DIRTY_KEY); } catch { /* ignore */ }
    setStatus('idle');
  }

  function updateDay(key, fn) {
    const day = data.days[key] || {};
    fn(day);
    // 清掉空值，避免留下空殼
    if (day.sleep && !day.sleep.bed && !day.sleep.wake) delete day.sleep;
    if (day.meals) {
      for (const m of Object.keys(day.meals)) {
        const x = day.meals[m];
        if (x.protein == null) delete x.protein;
        if (x.starch == null) delete x.starch;
        if (!Object.keys(x).length) delete day.meals[m];
      }
      if (!Object.keys(day.meals).length) delete day.meals;
    }
    if (day.water == null) delete day.water;
    if (Object.keys(day).length) data.days[key] = day; else delete data.days[key];
    addTo(dirty.days, key);
    schedule();
  }
  function upsertWorkout(w) {
    const i = data.workouts.findIndex(x => x.id === w.id);
    if (i >= 0) data.workouts[i] = w; else data.workouts.push(w);
    data.workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    addTo(dirty.up, w.id);
    dirty.del = dirty.del.filter(x => x !== w.id);
    schedule(600);
  }
  function deleteWorkout(id) {
    data.workouts = data.workouts.filter(w => w.id !== id);
    dirty.up = dirty.up.filter(x => x !== id);
    addTo(dirty.del, id);
    schedule(600);
  }
  function setGoals(g) {
    data.goals = { ...data.goals, ...g };
    dirty.goals = true;
    schedule(800);
  }

  window.addEventListener('online', () => { if (hasDirty()) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && hasDirty()) flush(); });

  return {
    hasConfig: () => !!cfg,
    config: () => (cfg ? { ...cfg, token: '' } : null),
    data: () => data,
    getDay: k => data.days[k] || {},
    status: () => status,
    onStatus: f => statusCbs.push(f),
    hasDirty, load, flush: () => { clearTimeout(timer); return flush(); },
    connect, disconnect, updateDay, upsertWorkout, deleteWorkout, setGoals
  };
})();
