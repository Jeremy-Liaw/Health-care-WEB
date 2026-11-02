/* 健康平衡 — 介面 */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = Charts.esc;
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const fmtMD = k => { const d = HB.parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const fmtLong = k => { const d = HB.parseKey(k); return `${d.getMonth() + 1}月${d.getDate()}日（週${WD[d.getDay()]}）`; };
  const fmtWeek = s => `${fmtMD(s)} – ${fmtMD(HB.addDays(s, 6))}`;
  const TYPES = ['重訓', '跑步', '健走', '游泳', '腳踏車', '球類', '瑜伽/伸展', 'HIIT', '其他'];
  const view = $('#view');
  const today0 = HB.todayKey();
  const ui = { date: today0, range: 30, gWeek: HB.weekStart(today0), wWeek: HB.weekStart(today0), editing: null, lastLoad: 0 };
  const data = () => Store.data();
  const goals = () => data().goals;

  const badge = (light, text) =>
    `<span class="badge ${light}"><i></i>${esc(text || HB.LIGHT_LABEL[light])}</span>`;
  const meter = (ratio, light) =>
    `<div class="meter"><i class="${light}" style="width:${Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)))}%"></i></div>`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ================= 今日 ================= */
  function viewToday() {
    const g = goals(), d = Store.getDay(ui.date), t = HB.todayKey();
    const isToday = ui.date === t;
    const mealRows = HB.MEALS.map(({ key, label }) => {
      const m = (d.meals && d.meals[key]) || {};
      return `<div class="meal">
        <div class="meal-name">${label}</div>
        <label class="fld">蛋白質<span class="inp"><input type="number" inputmode="decimal" min="0" step="5" placeholder="0" data-f="meals.${key}.protein" value="${m.protein ?? ''}"><em>g</em></span></label>
        <label class="fld">澱粉<span class="inp"><input type="number" inputmode="decimal" min="0" step="5" placeholder="0" data-f="meals.${key}.starch" value="${m.starch ?? ''}"><em>g</em></span></label>
      </div>`;
    }).join('');
    return `
    <div class="datebar">
      <button class="icon-btn" data-act="date-prev" aria-label="前一天">‹</button>
      <div class="date-mid"><input type="date" id="dateInput" value="${ui.date}" max="${t}"><span>${fmtLong(ui.date)}${isToday ? ' · 今天' : ''}</span></div>
      <button class="icon-btn" data-act="date-next" aria-label="後一天" ${ui.date >= t ? 'disabled' : ''}>›</button>
    </div>
    ${isToday ? '' : '<button class="link" data-act="date-today">回到今天</button>'}
    <div id="doneChips" class="chips"></div>

    <section class="card">
      <h2>🌙 睡眠 <small>昨晚入睡 → 這天早上起床</small></h2>
      <div class="row2">
        <label class="fld">入睡時間<input type="time" data-f="sleep.bed" value="${(d.sleep && d.sleep.bed) || ''}"></label>
        <label class="fld">起床時間<input type="time" data-f="sleep.wake" value="${(d.sleep && d.sleep.wake) || ''}"></label>
      </div>
      <p id="sleepOut" class="out"></p>
    </section>

    <section class="card">
      <h2>🍽️ 三餐 <small>記錄食物重量（克）；沒吃請填 0</small></h2>
      ${mealRows}
      <p id="mealOut" class="out"></p>
    </section>

    <section class="card">
      <h2>💧 喝水 <small>以瓶數計算（1 瓶 ${g.bottleMl} ml）</small></h2>
      <div class="stepper">
        <button class="step-btn" data-act="water-dec" aria-label="減少一瓶">−</button>
        <div class="step-val"><b id="waterVal">${d.water ?? '—'}</b><span>瓶</span></div>
        <button class="step-btn" data-act="water-inc" aria-label="增加一瓶">＋</button>
      </div>
      <div id="waterOut" class="out"></div>
    </section>`;
  }

  function updateToday() {
    const g = goals(), d = Store.getDay(ui.date);
    // 睡眠
    const sm = HB.sleepMinutes(d.sleep);
    const so = $('#sleepOut');
    if (so) so.innerHTML = sm
      ? `睡了 <b>${HB.fmtDur(sm)}</b> ${badge(HB.rate(sm, g.sleepHours * 60, 'min').light)} <span class="muted">目標 ≥ ${g.sleepHours} 小時</span>`
      : '<span class="muted">填入入睡與起床時間後，會自動計算睡眠時數</span>';
    // 飲食
    const tot = HB.dayTotals(d);
    const mo = $('#mealOut');
    if (mo) {
      if (tot.meals === 0) mo.innerHTML = '<span class="muted">每餐填入蛋白質與澱粉的重量</span>';
      else if (tot.meals < 3) mo.innerHTML = `已記錄 ${tot.meals}/3 餐 · 目前合計 蛋白質 <b>${Math.round(tot.protein || 0)} g</b>、澱粉 <b>${Math.round(tot.starch || 0)} g</b>`;
      else {
        const p = HB.rate(tot.protein, g.proteinG, 'min'), s = HB.rate(tot.starch, g.starchG, 'range', g.starchTolerance);
        mo.innerHTML = `<div class="sumrow"><span>蛋白質 <b>${Math.round(tot.protein || 0)} g</b> <span class="muted">/ ≥ ${g.proteinG}</span></span>${badge(p.light)}</div>${meter(p.ratio, p.light)}
        <div class="sumrow"><span>澱粉 <b>${Math.round(tot.starch || 0)} g</b> <span class="muted">/ ${g.starchG} ±${Math.round(g.starchTolerance * 100)}%</span></span>${badge(s.light, s.light === 'green' ? '達標' : s.light === 'none' ? '' : (tot.starch > g.starchG ? '偏高' : '偏低'))}</div>${meter(s.ratio, s.light)}`;
      }
    }
    // 喝水
    const wv = HB.num(d.water);
    const wo = $('#waterOut'), wval = $('#waterVal');
    if (wval) wval.textContent = wv == null ? '—' : wv;
    if (wo) {
      if (wv == null) wo.innerHTML = '<span class="muted">按 ＋ 記錄今天喝了幾瓶</span>';
      else {
        const r = HB.rate(wv, g.waterBottles, 'min');
        wo.innerHTML = `<div class="sumrow"><span>約 <b>${wv * g.bottleMl} ml</b> <span class="muted">/ 目標 ≥ ${g.waterBottles} 瓶</span></span>${badge(r.light)}</div>${meter(r.ratio, r.light)}`;
      }
    }
    // 完成度
    const chips = [
      [!!sm, '睡眠'], [tot.meals === 3, `三餐 ${tot.meals}/3`], [wv != null, '喝水'],
      [HB.workoutMinutesOn(data(), ui.date) > 0, '運動']
    ];
    const dc = $('#doneChips');
    if (dc) dc.innerHTML = chips.map(([ok, l]) => `<span class="chip ${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${l}</span>`).join('');
  }

  function onField(path, raw) {
    const p = path.split('.');
    Store.updateDay(ui.date, day => {
      if (p[0] === 'sleep') {
        day.sleep = day.sleep || {};
        if (raw) day.sleep[p[1]] = raw; else delete day.sleep[p[1]];
      } else if (p[0] === 'meals') {
        day.meals = day.meals || {};
        const m = (day.meals[p[1]] = day.meals[p[1]] || {});
        const n = HB.num(raw);
        if (n == null) delete m[p[2]]; else m[p[2]] = n;
      }
    });
    updateToday();
  }

  /* ================= 儀表板 ================= */
  function viewDashboard() {
    const g = goals(), today = HB.todayKey();
    const n = ui.range, start = HB.addDays(today, -(n - 1));
    const rows = HB.series(data(), start, today);
    const S = HB.rangeSummary(rows, data());
    const labels = rows.map(r => fmtMD(r.key)), tips = rows.map(r => fmtLong(r.key));
    const mealSeries = field => HB.MEALS.map(m => ({ name: m.label, cls: 'c-' + m.key, values: rows.map(r => r.perMeal[m.key][field] || null) }));
    const mealLegend = Charts.legend(HB.MEALS.map(m => ({ name: m.label, cls: 'c-' + m.key })));
    const wk = HB.weeklyWorkout(data(), HB.weekStart(today), 8);

    const tile = (icon, label, value, light, sub) =>
      `<div class="tile"><div class="tile-h">${icon} ${label}</div><div class="tile-v">${value}</div><div class="tile-f">${badge(light)}<span class="muted">${sub}</span></div></div>`;

    // 運動項目分佈
    const byType = {};
    data().workouts.filter(w => w.date >= start && w.date <= today).forEach(w => { byType[w.type] = (byType[w.type] || 0) + (HB.num(w.minutes) || 0); });
    const typeRows = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    const typeMax = typeRows.length ? typeRows[0][1] : 1;

    const heatRows = [
      { label: '睡眠', cells: rows.map(r => (r.logged.sleep ? 1 : 0)), tips: tips },
      { label: '三餐', cells: rows.map(r => (r.mealsLogged === 3 ? 2 : r.mealsLogged > 0 ? 1 : 0)), tips: tips },
      { label: '喝水', cells: rows.map(r => (r.logged.water ? 1 : 0)), tips: tips },
      { label: '運動', cells: rows.map(r => (r.logged.workout ? 1 : 0)), tips: tips }
    ];

    return `
    <div class="seg" role="tablist">
      ${[7, 30, 90].map(v => `<button class="${ui.range === v ? 'on' : ''}" data-act="range" data-v="${v}">近 ${v} 天</button>`).join('')}
    </div>
    <div class="tiles">
      ${tile('🌙', '平均睡眠', S.sleep == null ? '—' : HB.fmtHours(S.sleep), S.light.sleep, `目標 ≥ ${g.sleepHours} 小時`)}
      ${tile('💧', '平均喝水', S.water == null ? '—' : HB.r1(S.water) + ' 瓶', S.light.water, `目標 ≥ ${g.waterBottles} 瓶`)}
      ${tile('🍗', '蛋白質 / 天', S.protein == null ? '—' : Math.round(S.protein) + ' g', S.light.protein, `目標 ≥ ${g.proteinG} g`)}
      ${tile('🍚', '澱粉 / 天', S.starch == null ? '—' : Math.round(S.starch) + ' g', S.light.starch, `目標 ${g.starchG} g`)}
      ${tile('🏃', '每週運動', S.workoutPerWeek == null ? '—' : Math.round(S.workoutPerWeek) + ' 分', S.light.workout, `目標 ≥ ${g.workoutMinutes} 分`)}
    </div>
    <p class="muted small">飲食只統計「三餐都有填」的日子（${S.nDiet} 天）。</p>

    <section class="card"><h2>紀錄完成度</h2>${Charts.heat(heatRows, rows.length)}
      <div class="legend"><span><i class="sw hc on two"></i>完整</span><span><i class="sw hc on"></i>部分</span><span><i class="sw hc"></i>未填</span></div></section>

    <section class="card"><h2>🌙 睡眠時數</h2>
      ${Charts.bar({ title: '睡眠時數', labels, tipLabels: tips, series: [{ name: '睡眠', cls: 'c-sleep', values: rows.map(r => (r.sleepMin ? r.sleepMin / 60 : null)) }], goal: g.sleepHours, fmt: v => HB.r1(v) + 'h' })}</section>

    <section class="card"><h2>💧 喝水（瓶）</h2>
      ${Charts.bar({ title: '喝水瓶數', labels, tipLabels: tips, series: [{ name: '喝水', cls: 'c-water', values: rows.map(r => r.water) }], goal: g.waterBottles, fmt: v => HB.r1(v) })}</section>

    <section class="card"><h2>🍗 蛋白質（每餐堆疊）</h2>
      ${Charts.bar({ title: '蛋白質', labels, tipLabels: tips, stacked: true, series: mealSeries('protein'), goal: g.proteinG, fmt: v => Math.round(v) + 'g' })}${mealLegend}</section>

    <section class="card"><h2>🍚 澱粉（每餐堆疊）</h2>
      ${Charts.bar({ title: '澱粉', labels, tipLabels: tips, stacked: true, series: mealSeries('starch'), goal: g.starchG, goalLabel: '目標', fmt: v => Math.round(v) + 'g' })}${mealLegend}</section>

    <section class="card"><h2>🏃 每週運動分鐘（近 8 週）</h2>
      ${Charts.bar({ title: '每週運動分鐘', labels: wk.map(w => fmtMD(w.start)), tipLabels: wk.map(w => fmtWeek(w.start) + '（' + w.sessions + ' 次）'), series: [{ name: '運動', cls: 'c-work', values: wk.map(w => w.total) }], goal: g.workoutMinutes, fmt: v => Math.round(v) })}
      <p class="muted small">橫軸為每週一的日期</p></section>

    <section class="card"><h2>運動項目分佈 <small>近 ${n} 天</small></h2>
      ${typeRows.length ? typeRows.map(([t, m]) => `<div class="hbar"><span>${esc(t)}</span><div><i style="width:${Math.round((m / typeMax) * 100)}%"></i></div><b>${m} 分</b></div>`).join('') : '<div class="empty">還沒有運動紀錄</div>'}</section>`;
  }

  /* ================= 目標與週報 ================= */
  function viewGoals() {
    const t = HB.todayKey();
    const rep = HB.weekReport(data(), ui.gWeek, t);
    const g = goals();
    const isCur = ui.gWeek === HB.weekStart(t);
    const metric = m => `
      <div class="metric">
        <div class="metric-h"><span>${m.icon} ${m.label}</span>${badge(m.light)}</div>
        <div class="metric-v"><b>${esc(m.valueText)}</b><span class="muted">${esc(m.targetText)}</span></div>
        ${m.light === 'none' ? '' : meter(Math.min(1, m.ratio || 0), m.light)}
      </div>`;
    const field = (k, label, unit, step, v) =>
      `<label class="fld">${label}<span class="inp"><input type="number" inputmode="decimal" min="0" step="${step}" data-goal="${k}" value="${v}"><em>${unit}</em></span></label>`;
    return `
    <div class="datebar">
      <button class="icon-btn" data-act="gweek-prev" aria-label="上一週">‹</button>
      <div class="date-mid static"><span>${fmtWeek(ui.gWeek)}${isCur ? ' · 本週' : ''}</span></div>
      <button class="icon-btn" data-act="gweek-next" aria-label="下一週" ${isCur ? 'disabled' : ''}>›</button>
    </div>
    ${isCur ? '' : '<button class="link" data-act="gweek-cur">回到本週</button>'}

    <section class="card overall ${rep.overall}">
      <div class="big-light"><i></i></div>
      <div><div class="overall-t">週總評：${HB.LIGHT_LABEL[rep.overall]}</div>
      <div class="muted small">${rep.complete ? '整週資料' : `統計到今天（${rep.elapsed}/7 天）`}・紅黃綠依「達成目標比例」判定：≥90% 綠、≥70% 黃、其餘紅</div></div>
    </section>

    <section class="card"><h2>各項指標</h2><div class="metrics">${rep.metrics.map(metric).join('')}</div></section>

    <section class="card"><h2>本週建議</h2>
      <ul class="tips">${rep.suggestions.map(s => `<li class="${s.level}"><i></i><span>${esc(s.text)}</span></li>`).join('')}</ul>
      <p class="muted small">每週一早上 9:00 也會自動寄出上週報告到你的 Email。</p></section>

    <section class="card"><h2>🎯 目標設定</h2>
      <div class="goals-grid">
        ${field('sleepHours', '每晚睡眠（至少）', '小時', 0.5, g.sleepHours)}
        ${field('waterBottles', '每日喝水（至少）', '瓶', 1, g.waterBottles)}
        ${field('bottleMl', '一瓶容量', 'ml', 50, g.bottleMl)}
        ${field('workoutMinutes', '每週運動（至少）', '分鐘', 10, g.workoutMinutes)}
        ${field('strengthSessions', '每週重訓（至少，0＝不追蹤）', '次', 1, g.strengthSessions)}
        ${field('proteinG', '每日蛋白質（至少）', 'g', 10, g.proteinG)}
        ${field('starchG', '每日澱粉（目標）', 'g', 10, g.starchG)}
        ${field('starchPct', '澱粉允許誤差', '± %', 5, Math.round(g.starchTolerance * 100))}
      </div>
      <p class="muted small">蛋白質、澱粉皆以「食物重量（克）」計算；目標值依你的身體與訓練目標自行調整。</p></section>`;
  }

  /* ================= 運動 ================= */
  function viewWorkouts() {
    const t = HB.todayKey(), g = goals();
    const keys = HB.weekDays(ui.wWeek), end = keys[6];
    const list = data().workouts.filter(w => w.date >= ui.wWeek && w.date <= end);
    const total = HB.sum(list.map(w => HB.num(w.minutes) || 0));
    const rate = HB.rate(total, g.workoutMinutes, 'min');
    const isCur = ui.wWeek === HB.weekStart(t);
    const ed = ui.editing ? data().workouts.find(w => w.id === ui.editing) : null;
    const defDate = ed ? ed.date : (t >= ui.wWeek && t <= end ? t : ui.wWeek);
    const isCustom = ed && !TYPES.includes(ed.type);
    const selType = ed ? (isCustom ? '其他' : ed.type) : '重訓';
    const wk = HB.weeklyWorkout(data(), HB.weekStart(t), 8);
    return `
    <div class="datebar">
      <button class="icon-btn" data-act="wweek-prev" aria-label="上一週">‹</button>
      <div class="date-mid static"><span>${fmtWeek(ui.wWeek)}${isCur ? ' · 本週' : ''}</span></div>
      <button class="icon-btn" data-act="wweek-next" aria-label="下一週" ${isCur ? 'disabled' : ''}>›</button>
    </div>
    ${isCur ? '' : '<button class="link" data-act="wweek-cur">回到本週</button>'}

    <section class="card">
      <div class="bigstat"><b>${total}</b><span>分鐘 · ${list.length} 次</span>${badge(rate.light)}</div>
      ${meter(Math.min(1, rate.ratio || 0), rate.light)}
      <p class="muted small">本週目標 ≥ ${g.workoutMinutes} 分鐘${g.strengthSessions ? `，重訓 ≥ ${g.strengthSessions} 次（本週 ${list.filter(HB.isStrength).length} 次）` : ''}</p>
    </section>

    <section class="card">
      <h2>${ed ? '✏️ 編輯運動紀錄' : '＋ 新增運動紀錄'}</h2>
      <div class="row2">
        <label class="fld">日期<input type="date" id="wDate" value="${defDate}" max="${t}"></label>
        <label class="fld">時間<span class="inp"><input type="number" inputmode="numeric" min="1" step="5" id="wMin" placeholder="60" value="${ed ? ed.minutes : ''}"><em>分鐘</em></span></label>
      </div>
      <div class="row2">
        <label class="fld">項目<select id="wType">${TYPES.map(x => `<option ${x === selType ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="fld ${selType === '其他' ? '' : 'hidden'}" id="wCustomWrap">自訂項目名稱<input type="text" id="wCustom" maxlength="20" value="${isCustom ? esc(ed.type) : ''}"></label>
      </div>
      <label class="fld">備註（選填）<input type="text" id="wNote" maxlength="80" placeholder="例如：胸推 5×5、組數、感受" value="${ed ? esc(ed.note || '') : ''}"></label>
      <div class="actions">
        <button class="btn primary" data-act="w-save">${ed ? '更新' : '新增'}</button>
        ${ed ? '<button class="btn" data-act="w-cancel">取消</button>' : ''}
      </div>
    </section>

    <section class="card"><h2>本週紀錄</h2>
      ${list.length ? `<ul class="wlist">${list.slice().reverse().map(w => `
        <li><div><b>${esc(w.type)}</b> · ${w.minutes} 分鐘<div class="muted small">${fmtLong(w.date)}${w.note ? ' · ' + esc(w.note) : ''}</div></div>
        <div class="li-btns"><button class="icon-btn sm" data-act="w-edit" data-id="${esc(w.id)}" aria-label="編輯">✏️</button><button class="icon-btn sm" data-act="w-del" data-id="${esc(w.id)}" aria-label="刪除">🗑️</button></div></li>`).join('')}</ul>`
        : '<div class="empty">這週還沒有運動紀錄</div>'}</section>

    <section class="card"><h2>每週運動時間（近 8 週）</h2>
      ${Charts.bar({ title: '每週運動分鐘', labels: wk.map(w => fmtMD(w.start)), tipLabels: wk.map(w => fmtWeek(w.start) + '（' + w.sessions + ' 次）'), series: [{ name: '運動', cls: 'c-work', values: wk.map(w => w.total) }], goal: g.workoutMinutes, fmt: v => Math.round(v) })}</section>`;
  }

  function saveWorkout() {
    const date = $('#wDate').value, minutes = Math.round(Number($('#wMin').value));
    let type = $('#wType').value;
    if (type === '其他') type = $('#wCustom').value.trim() || '其他';
    if (!date) return toast('請選擇日期');
    if (!(minutes > 0)) return toast('請填入運動時間（分鐘）');
    const w = { id: ui.editing || uid(), date, type, minutes, note: $('#wNote').value.trim() };
    Store.upsertWorkout(w);
    ui.editing = null;
    if (date < ui.wWeek || date > HB.addDays(ui.wWeek, 6)) ui.wWeek = HB.weekStart(date);
    toast('已記錄');
    render();
  }

  /* ================= 設定 ================= */
  function viewSettings() {
    const c = Store.config(), s = Store.status();
    const first = !Store.hasConfig();
    return `
    ${first ? `<section class="card hero"><h2>👋 歡迎使用健康平衡</h2><p>第一次在這台裝置使用，請輸入資料 Repo 與 GitHub Token。設定只會存在這台裝置的瀏覽器裡，之後會自動帶入。</p></section>` : ''}
    <section class="card">
      <h2>🔑 連線設定</h2>
      <label class="fld">資料 Repo<input type="text" id="cRepo" placeholder="帳號/health-data" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(c ? c.repo : '')}"></label>
      <label class="fld">Fine-grained Token<input type="password" id="cToken" placeholder="${c ? '（已儲存；要更換才需重新輸入）' : 'github_pat_…'}" autocomplete="off"></label>
      <div class="row2">
        <label class="fld">分支<input type="text" id="cBranch" autocapitalize="off" value="${esc(c ? c.branch : 'main')}"></label>
        <label class="fld">資料檔路徑<input type="text" id="cPath" autocapitalize="off" value="${esc(c ? c.path : 'data/health.json')}"></label>
      </div>
      <div class="actions"><button class="btn primary" data-act="connect">${first ? '連線並開始使用' : '測試並更新連線'}</button></div>
      <p id="connMsg" class="out"></p>
      <details class="help"><summary>怎麼取得 Token？</summary>
        <ol><li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
        <li>Repository access 選 <b>Only select repositories</b>，只勾你的資料 Repo</li>
        <li>Permissions → Repository permissions → <b>Contents: Read and write</b></li>
        <li>產生後複製 Token 貼上（只會顯示一次）</li></ol></details>
    </section>
    ${first ? '' : `
    <section class="card">
      <h2>🔄 同步</h2>
      <p class="out">目前狀態：<b>${esc(statusText(s))}</b>${s.msg ? `<br><span class="muted">${esc(s.msg)}</span>` : ''}</p>
      <div class="actions">
        <button class="btn" data-act="sync">立即同步</button>
        <button class="btn" data-act="export">匯出 JSON</button>
        <button class="btn danger" data-act="disconnect">清除此裝置設定</button>
      </div>
    </section>`}`;
  }
  const statusText = s => ({ idle: '尚未連線', loading: '載入中…', saving: '儲存中…', pending: '等待儲存', saved: '已同步', error: '同步失敗' }[s.state] || '');

  /* ================= 路由 / 繪製 ================= */
  const ROUTES = { today: viewToday, dashboard: viewDashboard, goals: viewGoals, workouts: viewWorkouts, settings: viewSettings };
  const routeName = () => {
    const r = (location.hash.replace(/^#\/?/, '') || 'today');
    return ROUTES[r] ? r : 'today';
  };
  let lastRoute = null;
  function render() {
    let r = routeName();
    if (!Store.hasConfig() && r !== 'settings') { location.hash = '#/settings'; return; }
    view.innerHTML = ROUTES[r]();
    document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.r === r));
    if (r === 'today') updateToday();
    if (r !== lastRoute) window.scrollTo(0, 0);
    lastRoute = r;
  }
  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && view.contains(a); };

  /* ================= 事件 ================= */
  view.addEventListener('input', e => {
    const f = e.target.dataset.f;
    if (f) onField(f, e.target.value);
  });
  view.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'dateInput') { if (t.value) { ui.date = t.value; render(); } return; }
    if (t.id === 'wType') { $('#wCustomWrap').classList.toggle('hidden', t.value !== '其他'); return; }
    if (t.dataset.goal) {
      const k = t.dataset.goal, v = Number(t.value);
      if (!Number.isFinite(v) || v < 0) { toast('請輸入有效的數字'); render(); return; }
      Store.setGoals(k === 'starchPct' ? { starchTolerance: v / 100 } : { [k]: v });
      render();
    }
  });

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act, t = HB.todayKey();
    switch (a) {
      case 'date-prev': ui.date = HB.addDays(ui.date, -1); return render();
      case 'date-next': if (ui.date < t) ui.date = HB.addDays(ui.date, 1); return render();
      case 'date-today': ui.date = t; return render();
      case 'water-inc': case 'water-dec': {
        const cur = HB.num(Store.getDay(ui.date).water);
        const next = a === 'water-inc' ? (cur == null ? 1 : cur + 1) : Math.max(0, (cur == null ? 0 : cur) - 1);
        Store.updateDay(ui.date, d => { d.water = next; });
        return updateToday();
      }
      case 'range': ui.range = Number(b.dataset.v); return render();
      case 'gweek-prev': ui.gWeek = HB.addDays(ui.gWeek, -7); return render();
      case 'gweek-next': if (ui.gWeek < HB.weekStart(t)) ui.gWeek = HB.addDays(ui.gWeek, 7); return render();
      case 'gweek-cur': ui.gWeek = HB.weekStart(t); return render();
      case 'wweek-prev': ui.wWeek = HB.addDays(ui.wWeek, -7); ui.editing = null; return render();
      case 'wweek-next': if (ui.wWeek < HB.weekStart(t)) ui.wWeek = HB.addDays(ui.wWeek, 7); ui.editing = null; return render();
      case 'wweek-cur': ui.wWeek = HB.weekStart(t); ui.editing = null; return render();
      case 'w-save': return saveWorkout();
      case 'w-edit': ui.editing = b.dataset.id; render(); return window.scrollTo(0, 0);
      case 'w-cancel': ui.editing = null; return render();
      case 'w-del':
        if (confirm('確定要刪除這筆運動紀錄嗎？')) { Store.deleteWorkout(b.dataset.id); ui.editing = null; toast('已刪除'); render(); }
        return;
      case 'sync': await Store.flush(); await Store.load(); render(); return toast(Store.status().state === 'error' ? '同步失敗：' + Store.status().msg : '已同步');
      case 'export': {
        const blob = new Blob([JSON.stringify(Store.data(), null, 2)], { type: 'application/json' });
        const el = document.createElement('a');
        el.href = URL.createObjectURL(blob); el.download = `health-${t}.json`; el.click();
        setTimeout(() => URL.revokeObjectURL(el.href), 1000);
        return;
      }
      case 'disconnect':
        if (confirm('清除這台裝置上的連線設定與快取？\n（雲端資料不會被刪除；尚未同步的修改會遺失）')) { Store.disconnect(); location.hash = '#/settings'; render(); }
        return;
      case 'connect': return connect(b);
    }
  });

  async function connect(btn) {
    const msg = $('#connMsg');
    const old = Store.config();
    const token = $('#cToken').value;
    if (!token && old) { msg.textContent = '要更換連線設定，請重新輸入 Token。'; return; }
    btn.disabled = true; msg.textContent = '連線中…';
    try {
      const r = await Store.connect({ repo: $('#cRepo').value, token, branch: $('#cBranch').value, path: $('#cPath').value });
      toast(r.created ? '已連線，並建立新的資料檔' : '已連線');
      location.hash = '#/today';
      if (routeName() === 'today') render();
    } catch (err) {
      msg.textContent = '⚠ ' + err.message;
      btn.disabled = false;
    }
  }

  /* 同步狀態晶片 */
  const chip = $('#sync');
  const CHIP = { idle: ['', ''], loading: ['同步中…', 'busy'], saving: ['儲存中…', 'busy'], pending: ['待儲存', 'warn'], saved: ['已同步', 'ok'], error: ['同步失敗，點此重試', 'err'] };
  Store.onStatus(s => {
    const [txt, cls] = CHIP[s.state] || ['', ''];
    chip.textContent = txt; chip.className = 'sync ' + cls; chip.title = s.msg || '';
    chip.hidden = !txt;
  });
  chip.addEventListener('click', async () => {
    const s = Store.status();
    if (s.state === 'error') { toast(s.msg || '同步失敗'); await Store.flush(); await Store.load(); if (!typing()) render(); }
  });

  window.addEventListener('hashchange', () => { ui.editing = null; render(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && Store.hasConfig() && Date.now() - ui.lastLoad > 60000) {
      ui.lastLoad = Date.now();
      await Store.load();
      if (!typing()) render();
    }
  });

  /* 啟動 */
  (async function boot() {
    render();
    if (Store.hasConfig()) {
      ui.lastLoad = Date.now();
      await Store.load();
      if (!typing()) render();
    }
  })();
})();
