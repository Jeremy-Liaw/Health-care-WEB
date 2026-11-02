/* 健康平衡 — 共用邏輯（瀏覽器與 Node 皆可使用）
 * 網站與 GitHub Actions 的週報共用這一份，請保持 site/core.js 與 data-repo/scripts/core.js 內容一致。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_GOALS = {
    sleepHours: 7,        // 每晚睡眠（小時）— 至少
    waterBottles: 4,      // 每日喝水（瓶）— 至少
    bottleMl: 600,        // 一瓶容量（ml），只用於換算顯示
    workoutMinutes: 150,  // 每週運動時間（分鐘）— 至少
    strengthSessions: 3,  // 每週重訓次數 — 至少（0 = 不追蹤）
    proteinG: 300,        // 每日蛋白質食物總重（g）— 至少
    starchG: 450,         // 每日澱粉食物總重（g）— 目標值
    starchTolerance: 0.2  // 澱粉允許誤差（±20%）
  };

  const MEALS = [
    { key: 'breakfast', label: '早餐' },
    { key: 'lunch', label: '午餐' },
    { key: 'dinner', label: '晚餐' }
  ];

  const LIGHT_EMOJI = { green: '🟢', yellow: '🟡', red: '🔴', none: '⚪' };
  const LIGHT_LABEL = { green: '達標', yellow: '接近', red: '需改進', none: '資料不足' };

  /* ---------- 日期 ---------- */
  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
  const weekStart = k => { const d = parseKey(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dateKey(d); };
  const weekDays = start => Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayKey = tz => tz
    ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
    : dateKey(new Date());

  /* ---------- 數值 / 時間 ---------- */
  const num = v => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const toMin = t => {
    if (typeof t !== 'string' || !/^\d{1,2}:\d{2}$/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const fromMin = m => {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  };
  // 睡眠分鐘數：入睡 → 起床，可跨午夜
  const sleepMinutes = s => {
    if (!s) return null;
    const b = toMin(s.bed), w = toMin(s.wake);
    if (b == null || w == null) return null;
    const diff = (((w - b) % 1440) + 1440) % 1440;
    return diff > 0 ? diff : null;
  };
  const bedShift = m => (m < 720 ? m + 1440 : m); // 凌晨入睡視為「更晚」
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const sum = a => a.reduce((x, y) => x + y, 0);
  const r1 = n => Math.round(n * 10) / 10;
  const fmtHours = min => `${r1(min / 60)} 小時`;
  const fmtDur = min => `${Math.floor(min / 60)} 小時 ${Math.round(min % 60)} 分`;

  /* ---------- 資料 ---------- */
  const emptyData = () => ({ version: 1, goals: { ...DEFAULT_GOALS }, days: {}, workouts: [] });
  const normalize = d => {
    d = d && typeof d === 'object' ? d : {};
    return {
      version: 1,
      goals: { ...DEFAULT_GOALS, ...(d.goals || {}) },
      days: d.days && typeof d.days === 'object' ? d.days : {},
      workouts: Array.isArray(d.workouts) ? d.workouts : []
    };
  };
  const mealLogged = m => !!m && (num(m.protein) != null || num(m.starch) != null);

  const dayTotals = day => {
    let protein = 0, starch = 0, meals = 0, hasP = false, hasS = false;
    for (const { key } of MEALS) {
      const m = day && day.meals && day.meals[key];
      if (!m) continue;
      const p = num(m.protein), s = num(m.starch);
      if (p != null) { protein += p; hasP = true; }
      if (s != null) { starch += s; hasS = true; }
      if (p != null || s != null) meals++;
    }
    return { protein: hasP ? protein : null, starch: hasS ? starch : null, meals };
  };
  const isStrength = w => w && w.type === '重訓';
  const workoutMinutesOn = (data, k) =>
    sum(data.workouts.filter(w => w.date === k).map(w => num(w.minutes) || 0));

  /* ---------- 紅黃綠燈 ---------- */
  // mode 'min'：越多越好（≥90% 綠、≥70% 黃）；mode 'range'：接近目標值（±tol 綠、±2tol 黃）
  const rate = (value, target, mode, tol) => {
    if (value == null || !target) return { light: 'none', ratio: null };
    if (mode === 'range') {
      const t = tol || 0.2;
      const dev = Math.abs(value - target) / target;
      return { light: dev <= t + 1e-9 ? 'green' : dev <= 2 * t + 1e-9 ? 'yellow' : 'red', ratio: value / target };
    }
    const r = value / target;
    return { light: r >= 0.9 - 1e-9 ? 'green' : r >= 0.7 - 1e-9 ? 'yellow' : 'red', ratio: r };
  };

  /* ---------- 週報 ---------- */
  // today 給定時，只評估到今天為止（進行中的週）；省略則視為整週已結束
  function weekReport(data, start, today) {
    data = normalize(data);
    const g = data.goals;
    const keys = weekDays(start);
    const end = keys[6];
    const evalKeys = keys.filter(k => !today || k <= today);
    const elapsed = evalKeys.length;
    const complete = elapsed === 7;
    const need = Math.max(1, Math.ceil(elapsed / 2));
    const metrics = [];

    // 睡眠
    const sl = [], beds = [];
    for (const k of evalKeys) {
      const d = data.days[k];
      const m = sleepMinutes(d && d.sleep);
      if (m) { sl.push(m); beds.push(bedShift(toMin(d.sleep.bed))); }
    }
    const sleepAvg = sl.length ? avg(sl) : null;
    const sleepRate = sl.length >= need ? rate(sleepAvg, g.sleepHours * 60, 'min') : { light: 'none', ratio: null };
    metrics.push({
      key: 'sleep', label: '睡眠', icon: '🌙', n: sl.length, avg: sleepAvg,
      light: sleepRate.light, ratio: sleepRate.ratio,
      valueText: sleepAvg == null ? '—' : `${fmtHours(sleepAvg)} / 晚`,
      targetText: `目標 ≥ ${g.sleepHours} 小時`,
      spread: beds.length > 1 ? Math.max(...beds) - Math.min(...beds) : 0
    });

    // 喝水
    const wv = evalKeys.map(k => num(data.days[k] && data.days[k].water)).filter(v => v != null);
    const waterAvg = wv.length ? avg(wv) : null;
    const waterRate = wv.length >= need ? rate(waterAvg, g.waterBottles, 'min') : { light: 'none', ratio: null };
    metrics.push({
      key: 'water', label: '喝水', icon: '💧', n: wv.length, avg: waterAvg,
      light: waterRate.light, ratio: waterRate.ratio,
      valueText: waterAvg == null ? '—' : `${r1(waterAvg)} 瓶 / 天`,
      targetText: `目標 ≥ ${g.waterBottles} 瓶（${g.waterBottles * g.bottleMl} ml）`
    });

    // 飲食：只評估三餐都有紀錄的日子（沒吃請填 0）
    const full = evalKeys.map(k => dayTotals(data.days[k])).filter(t => t.meals === 3);
    const pAvg = full.length ? avg(full.map(t => t.protein || 0)) : null;
    const sAvg = full.length ? avg(full.map(t => t.starch || 0)) : null;
    const pRate = full.length >= need ? rate(pAvg, g.proteinG, 'min') : { light: 'none', ratio: null };
    const sRate = full.length >= need ? rate(sAvg, g.starchG, 'range', g.starchTolerance) : { light: 'none', ratio: null };
    metrics.push({
      key: 'protein', label: '蛋白質', icon: '🍗', n: full.length, avg: pAvg,
      light: pRate.light, ratio: pRate.ratio,
      valueText: pAvg == null ? '—' : `${Math.round(pAvg)} g / 天`,
      targetText: `目標 ≥ ${g.proteinG} g`
    });
    metrics.push({
      key: 'starch', label: '澱粉', icon: '🍚', n: full.length, avg: sAvg,
      light: sRate.light, ratio: sRate.ratio,
      dir: sAvg == null ? null : sAvg > g.starchG * (1 + g.starchTolerance) ? 'high' : sAvg < g.starchG * (1 - g.starchTolerance) ? 'low' : 'ok',
      valueText: sAvg == null ? '—' : `${Math.round(sAvg)} g / 天`,
      targetText: `目標 ${g.starchG} g（±${Math.round(g.starchTolerance * 100)}%）`
    });

    // 運動
    const wk = data.workouts.filter(w => w.date >= start && w.date <= end && (!today || w.date <= today));
    const total = sum(wk.map(w => num(w.minutes) || 0));
    const strength = wk.filter(isStrength).length;
    const canRate = complete || elapsed >= 3;
    const expected = g.workoutMinutes * elapsed / 7;
    const wRate = canRate && g.workoutMinutes > 0 ? rate(total, expected, 'min') : { light: 'none', ratio: null };
    metrics.push({
      key: 'workout', label: '運動時間', icon: '🏃', n: wk.length, total, sessions: wk.length,
      light: wRate.light, ratio: total / (g.workoutMinutes || 1),
      valueText: `${total} 分鐘 / ${wk.length} 次`,
      targetText: `目標 ≥ ${g.workoutMinutes} 分鐘 / 週`
    });
    if (g.strengthSessions > 0) {
      // 次數是小整數，用「少一次」當黃燈，比百分比更直覺（3 次目標做到 2 次＝黃）
      const needS = complete ? g.strengthSessions : Math.ceil(g.strengthSessions * elapsed / 7 - 1e-9);
      const stRate = !canRate ? { light: 'none', ratio: null }
        : { light: strength >= needS ? 'green' : (strength >= needS - 1 && needS >= 2 ? 'yellow' : 'red'), ratio: null };
      metrics.push({
        key: 'strength', label: '重訓次數', icon: '🏋️', n: strength, sessions: strength,
        light: stRate.light, ratio: strength / g.strengthSessions,
        valueText: `${strength} 次`,
        targetText: `目標 ≥ ${g.strengthSessions} 次 / 週`
      });
    }

    // 總燈號
    const score = { green: 2, yellow: 1, red: 0 };
    const rated = metrics.filter(m => m.light !== 'none');
    let overall = 'none';
    if (rated.length) {
      const s = avg(rated.map(m => score[m.light]));
      overall = s >= 1.5 ? 'green' : s >= 0.75 ? 'yellow' : 'red';
    }

    // 紀錄情況
    const emptyDays = evalKeys.filter(k => {
      const d = data.days[k] || {};
      const t = dayTotals(d);
      return !sleepMinutes(d.sleep) && t.meals === 0 && num(d.water) == null && workoutMinutesOn(data, k) === 0;
    }).length;

    const M = Object.fromEntries(metrics.map(m => [m.key, m]));
    const S = [];
    const add = (level, text) => S.push({ level, text });

    // 睡眠建議
    if (M.sleep.light === 'none') {
      add('info', `睡眠紀錄只有 ${M.sleep.n} 天，每天早上記得填寫入睡與起床時間。`);
    } else if (M.sleep.light === 'green') {
      add('good', `睡眠平均 ${fmtHours(M.sleep.avg)}，已達標。`);
    } else {
      let t = `睡眠平均 ${fmtHours(M.sleep.avg)}，比目標少 ${fmtHours(g.sleepHours * 60 - M.sleep.avg)}。`;
      if (M.sleep.spread >= 90) t += `入睡時間前後差約 ${Math.round(M.sleep.spread / 10) * 10} 分鐘，固定就寢時間會更有幫助。`;
      else t += '試著把就寢時間提早 30 分鐘。';
      add(M.sleep.light === 'red' ? 'bad' : 'warn', t);
    }
    // 喝水
    if (M.water.light === 'none') {
      add('info', `喝水只記錄了 ${M.water.n} 天，晚上記得補記瓶數。`);
    } else if (M.water.light === 'green') {
      add('good', `喝水平均 ${r1(M.water.avg)} 瓶，已達標。`);
    } else {
      add(M.water.light === 'red' ? 'bad' : 'warn',
        `喝水平均 ${r1(M.water.avg)} 瓶，目標 ${g.waterBottles} 瓶；可以把水瓶放在桌上或書包旁，每餐搭配一瓶。`);
    }
    // 飲食
    if (M.protein.light === 'none') {
      if (elapsed >= 3) add('info', `三餐都有記錄的天數只有 ${full.length} 天；沒吃的餐請填 0，才會被納入評估。`);
    } else {
      if (M.protein.light === 'green') add('good', `蛋白質平均 ${Math.round(M.protein.avg)} g / 天，已達標。`);
      else add(M.protein.light === 'red' ? 'bad' : 'warn',
        `蛋白質平均 ${Math.round(M.protein.avg)} g / 天，低於目標 ${g.proteinG} g；每餐多加一份蛋白質（蛋、豆腐、雞胸、魚）。`);
      if (M.starch.light === 'green') add('good', `澱粉平均 ${Math.round(M.starch.avg)} g / 天，落在目標範圍內。`);
      else if (M.starch.dir === 'high') {
        const cut = Math.max(10, Math.round((M.starch.avg - g.starchG) / 3 / 10) * 10);
        add(M.starch.light === 'red' ? 'bad' : 'warn', `澱粉平均 ${Math.round(M.starch.avg)} g / 天，高於目標 ${g.starchG} g；每餐約減少 ${cut} g 即可回到範圍。`);
      } else if (M.starch.dir === 'low') {
        add(M.starch.light === 'red' ? 'bad' : 'warn', `澱粉平均 ${Math.round(M.starch.avg)} g / 天，低於目標 ${g.starchG} g；訓練日建議補足澱粉，維持表現與恢復。`);
      }
    }
    // 運動
    if (M.workout.light === 'green') {
      add('good', `本週運動 ${total} 分鐘，${complete ? '已達標' : '進度良好'}。`);
    } else if (M.workout.light !== 'none') {
      const gap = Math.max(0, g.workoutMinutes - total);
      add(M.workout.light === 'red' ? 'bad' : 'warn',
        complete ? `本週運動 ${total} 分鐘，距離目標還差 ${gap} 分鐘；下週先排好固定的運動日。`
          : `本週目前 ${total} 分鐘，還需要 ${gap} 分鐘才能達到目標。`);
    }
    if (M.strength) {
      if (M.strength.light === 'green') add('good', `重訓 ${strength} 次，已達標。`);
      else if (M.strength.light !== 'none') {
        add(M.strength.light === 'red' ? 'bad' : 'warn',
          `重訓 ${strength} 次，目標 ${g.strengthSessions} 次${complete ? '；下週把重訓日先寫進行事曆' : '，本週還有機會補上'}。`);
      }
    }
    // 重訓 × 飲食 × 睡眠的平衡
    const trainOK = M.workout.light === 'green' || (M.strength && M.strength.light === 'green');
    if (trainOK && ['yellow', 'red'].includes(M.protein.light))
      add('warn', '訓練量已經足夠，但蛋白質偏低，肌肉恢復與成長可能受限，建議優先補足蛋白質。');
    if (trainOK && ['yellow', 'red'].includes(M.sleep.light))
      add('warn', '訓練量足夠但睡眠不足，恢復不佳，容易影響表現並增加受傷風險。');
    if (M.workout.light === 'red' && M.starch.dir === 'high')
      add('warn', '運動量偏低的週，澱粉又高於目標，建議暫時縮減澱粉份量。');
    // 紀錄完整度
    if (emptyDays >= 2) add('info', `有 ${emptyDays} 天完全沒有紀錄，資料越完整，評估越準確。`);

    const rank = { bad: 0, warn: 1, info: 2, good: 3 };
    S.sort((a, b) => rank[a.level] - rank[b.level]);
    if (!S.length) add('info', '這週還沒有足夠的資料。');
    else if (rated.length && rated.every(m => m.light === 'green')) S.unshift({ level: 'good', text: '整週表現很穩，維持目前節奏！' });

    return { start, end, complete, elapsed, overall, metrics, suggestions: S, emptyDays, goals: g };
  }

  /* ---------- 儀表板用 ---------- */
  function series(data, startKey, endKey) {
    data = normalize(data);
    const out = [];
    for (let k = startKey; k <= endKey; k = addDays(k, 1)) {
      const d = data.days[k] || {};
      const t = dayTotals(d);
      const sm = sleepMinutes(d.sleep);
      const wm = workoutMinutesOn(data, k);
      const per = {};
      for (const { key } of MEALS) {
        const m = (d.meals && d.meals[key]) || {};
        per[key] = { protein: num(m.protein) || 0, starch: num(m.starch) || 0 };
      }
      out.push({
        key: k, sleepMin: sm, water: num(d.water), protein: t.protein, starch: t.starch, mealsLogged: t.meals,
        perMeal: per, workoutMin: wm,
        logged: { sleep: sm != null, meals: t.meals, water: num(d.water) != null, workout: wm > 0 }
      });
    }
    return out;
  }

  function rangeSummary(rows, data) {
    const g = normalize(data).goals;
    const sl = rows.map(r => r.sleepMin).filter(v => v != null);
    const wa = rows.map(r => r.water).filter(v => v != null);
    const full = rows.filter(r => r.mealsLogged === 3);
    const weeks = rows.length / 7;
    const workTotal = sum(rows.map(r => r.workoutMin));
    const s = {
      sleep: sl.length ? avg(sl) : null,
      water: wa.length ? avg(wa) : null,
      protein: full.length ? avg(full.map(r => r.protein || 0)) : null,
      starch: full.length ? avg(full.map(r => r.starch || 0)) : null,
      workoutPerWeek: weeks > 0 ? workTotal / weeks : null,
      nSleep: sl.length, nWater: wa.length, nDiet: full.length
    };
    s.light = {
      sleep: rate(s.sleep, g.sleepHours * 60, 'min').light,
      water: rate(s.water, g.waterBottles, 'min').light,
      protein: rate(s.protein, g.proteinG, 'min').light,
      starch: rate(s.starch, g.starchG, 'range', g.starchTolerance).light,
      workout: rows.length >= 7 ? rate(s.workoutPerWeek, g.workoutMinutes, 'min').light : 'none'
    };
    return s;
  }

  function weeklyWorkout(data, lastWeekStart, n) {
    data = normalize(data);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const start = addDays(lastWeekStart, -7 * i);
      const end = addDays(start, 6);
      const ws = data.workouts.filter(w => w.date >= start && w.date <= end);
      out.push({ start, end, total: sum(ws.map(w => num(w.minutes) || 0)), sessions: ws.length });
    }
    return out;
  }

  return {
    DEFAULT_GOALS, MEALS, LIGHT_EMOJI, LIGHT_LABEL,
    pad, dateKey, parseKey, addDays, weekStart, weekDays, todayKey,
    num, toMin, fromMin, sleepMinutes, fmtHours, fmtDur, r1, avg, sum,
    emptyData, normalize, mealLogged, dayTotals, isStrength, workoutMinutesOn,
    rate, weekReport, series, rangeSummary, weeklyWorkout
  };
});
