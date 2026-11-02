/* 輕量 SVG 圖表（不依賴外部套件，離線也能顯示） */
const Charts = (() => {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const niceMax = v => {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  };
  const trim = v => (Math.round(v * 10) / 10).toString();

  /**
   * opts: labels[], series[{name, cls, values[]}], stacked, goal, goalLabel, fmt(v), height, tipLabels[]
   */
  function bar(opts) {
    const { labels, series, stacked = false, goal = null, fmt = trim, height = 210 } = opts;
    const tips = opts.tipLabels || labels;
    const W = 640, H = height, m = { l: 36, r: 8, t: 12, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, n = labels.length;
    const val = (s, i) => (s.values[i] == null ? 0 : s.values[i]);
    const totals = labels.map((_, i) => stacked
      ? series.reduce((a, s) => a + val(s, i), 0)
      : Math.max(...series.map(s => val(s, i))));
    if (!totals.some(t => t > 0)) return '<div class="empty">這段期間還沒有資料</div>';

    const max = niceMax(Math.max(...totals, goal || 0) * 1.08);
    const y = v => m.t + ih - (v / max) * ih;
    const band = iw / n;
    const groups = stacked ? 1 : series.length;
    const barW = Math.max(2, Math.min(30, (band * 0.72) / groups));
    let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || '圖表')}" preserveAspectRatio="xMidYMid meet">`;

    for (let i = 0; i <= 4; i++) {
      const v = (max * i) / 4, yy = y(v);
      out += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      out += `<text class="tick" x="${m.l - 6}" y="${yy + 3.5}" text-anchor="end">${esc(fmt(v))}</text>`;
    }

    labels.forEach((_, i) => {
      const cx = m.l + band * i + band / 2;
      let acc = 0;
      series.forEach((s, si) => {
        const v = val(s, i);
        if (v <= 0) return;
        const h = (v / max) * ih;
        let x, yy;
        if (stacked) { x = cx - barW / 2; yy = y(acc + v); acc += v; }
        else { x = cx - (barW * groups) / 2 + si * barW; yy = y(v); }
        out += `<rect class="${s.cls}" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${(barW - (groups > 1 ? 1 : 0)).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(tips[i])}　${esc(s.name)}：${esc(fmt(v))}</title></rect>`;
      });
    });

    const every = n <= 10 ? 1 : Math.ceil(n / 8);
    labels.forEach((l, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      if (i === n - 1 && i % every !== 0 && n - 1 - (Math.floor((n - 1) / every) * every) < every / 2) return;
      out += `<text class="tick" x="${(m.l + band * i + band / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
    });

    if (goal != null && goal > 0) {
      const gy = y(goal);
      out += `<line class="goal" x1="${m.l}" x2="${W - m.r}" y1="${gy}" y2="${gy}"/>`;
      out += `<text class="goal-t" x="${W - m.r - 2}" y="${gy - 4}" text-anchor="end">${esc(opts.goalLabel || '目標')} ${esc(fmt(goal))}</text>`;
    }
    out += '</svg>';
    return out;
  }

  const legend = items => `<div class="legend">${items.map(i => `<span><i class="sw ${i.cls}"></i>${esc(i.name)}</span>`).join('')}</div>`;

  /** rows: [{label, cells:[bool|number]}], dates: [label] */
  function heat(rows, count) {
    return `<div class="heat" style="--n:${count}">` + rows.map(r =>
      `<div class="heat-row"><span class="heat-l">${esc(r.label)}</span><div class="heat-c">` +
      r.cells.map((c, i) => `<i class="hc ${c ? 'on' + (c === 2 ? ' two' : '') : ''}" title="${esc(r.tips[i])}"></i>`).join('') +
      '</div></div>').join('') + '</div>';
  }

  return { bar, legend, heat, esc };
})();
