/*
 * 퇴직연금 수익률 대시보드 화면
 * 데이터 계산은 pension-data.js(PensionData), 저장·권한·사용자 설정은 store.js(DashboardStore)를 쓴다.
 */
(function () {
  'use strict';
  const P = window.PensionData;
  const Store = window.DashboardStore;
  const DEFAULT_COMPANY = '한화투자증권';
  const DEFAULT_PEERS = ['미래에셋증권', '삼성증권', '한국투자증권', 'NH투자증권', '현대차증권'];
  const MAX_PEERS = 6;
  const TREND_N = 8;
  const SECTOR_TOKEN = { 은행: '--s-bank', 증권: '--s-sec', 생보: '--s-life', 손보: '--s-nonlife' };
  const PLAN_TOKEN = { DB: '--p-db', DC: '--p-dc', IRP: '--p-irp' };
  const RISK_TOKEN = { 초저위험: '--rk1', 저위험: '--rk2', 중위험: '--rk3', 고위험: '--rk4' };
  const TYPE_SHORT = { 원리금보장: '원리금보장', '예금성 원리금보장': '예금성', '시장성 원리금보장': '시장성', 실적배당: '실적배당' };
  const MIN_RESERVE = [0, 100, 500, 1000, 5000, 10000];

  const VIEWS = [
    { id: 'summary', label: '요약', filters: ['base', 'compare', 'plan', 'type', 'period', 'avg', 'minReserve'] },
    { id: 'sector', label: '업권별', filters: ['base', 'compare', 'sector', 'plan', 'type', 'period', 'avg', 'minReserve'] },
    { id: 'plan', label: '제도별', filters: ['base', 'compare', 'sector', 'type', 'period', 'avg', 'minReserve'] },
    { id: 'period', label: '기간별', filters: ['base', 'compare', 'sector', 'plan', 'type', 'avg', 'minReserve'] },
    { id: 'default', label: '디폴트옵션', filters: ['base', 'compare', 'sector', 'doPlan', 'risk', 'doPeriod', 'avg', 'minReserve'] },
    { id: 'fee', label: '수수료', filters: ['feeYear', 'feeCompare', 'sector', 'plan'] },
    { id: 'data', label: '데이터 관리', filters: [] },
  ];

  const S = {
    db: null, ix: null, view: 'summary', connected: Store.name !== 'bundled', canEdit: false, local: false,
    f: {
      base: null, compare: null, plan: 'DC', type: '원리금보장', period: 'r1', avg: 'weighted', minReserve: 0, sector: null,
      doPlan: 'DC', risk: '초저위험', doPeriod: 'r1', mapScope: 'sector', sharePlan: 'ALL', topPlan: 'ALL', trendPlan: 'ALL',
    },
    prefs: { company: DEFAULT_COMPANY, peers: DEFAULT_PEERS.slice() },
    upload: null, confirmDel: null, upKind: 'returns',
  };
  let charts = [];
  let pendingCharts = [];
  let tables = {};

  // ---------------------------------------------------------------- 작은 도구
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const alpha = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const plabel = (k) => P.PERIOD_LABEL[k] || k;
  const qlabel = (q) => (q ? P.quarterLabel(q) : '없음');
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const NA = '<span class="na">–</span>';
  const pct = (v, d = 2) => (isNum(v) ? v.toFixed(d) + '%' : NA);
  const num = (v) => (isNum(v) ? Math.round(v).toLocaleString('ko-KR') : NA);
  const jo = (v) => (!isNum(v) ? NA : Math.abs(v) >= 10000 ? (v / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + '조' : Math.round(v).toLocaleString('ko-KR') + '억');
  const signed = (v, d, unit) => {
    if (!isNum(v)) return NA;
    const r = Number(v.toFixed(d));
    const t = Math.abs(r).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
    return `<span class="${r > 0 ? 'up' : r < 0 ? 'down' : ''}">${r > 0 ? '+' : r < 0 ? '−' : ''}${t}${unit}</span>`;
  };
  // 평균 대비 차이: 수익률(%) 차이를 %p로, 소수 둘째 자리까지
  const gap = (a, b) => (isNum(a) && isNum(b) ? Math.round((a - b) * 100) / 100 : null);
  const gapText = (g) => (!isNum(g) ? '' : `${g > 0 ? '+' : ''}${g.toFixed(2)}%p`);
  const gapHtml = (g) => (!isNum(g) ? NA : `<span class="${g > 0 ? 'up' : g < 0 ? 'down' : ''}">${gapText(g)}</span>`);
  const rankHtml = (r, n) => (r == null ? NA : `<span class="rk">${r}위<small>/${n}</small></span>`);
  function moveOf(cur, prev) {
    if (cur == null) return null;
    if (prev == null) return 'new';
    return prev - cur;
  }
  function moveHtml(cur, prev) {
    const m = moveOf(cur, prev);
    if (m == null || !S.f.compare) return '';
    if (m === 'new') return '<span class="mv na">신규</span>';
    if (m > 0) return `<span class="mv up">▲${m}</span>`;
    if (m < 0) return `<span class="mv down">▼${-m}</span>`;
    return '<span class="mv na">–</span>';
  }
  function moveText(cur, prev) {
    const m = moveOf(cur, prev);
    if (m == null || !S.f.compare) return '';
    if (m === 'new') return '신규';
    return m > 0 ? '▲' + m : m < 0 ? '▼' + -m : '-';
  }
  const kindOf = (name) => (name === S.prefs.company ? 'ours' : S.prefs.peers.includes(name) ? 'peer' : '');
  const nameHtml = (name) => {
    const k = kindOf(name);
    return k ? `<span class="sec-tag"><span class="dot ${k}"></span>${esc(name)}</span>` : esc(name);
  };
  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  const safeFile = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- 데이터 색인
  function buildIndex(db) {
    const group = (arr, key) => {
      const m = new Map();
      for (const r of arr) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
      return m;
    };
    const providers = new Map();
    for (const kind of ['returns', 'fees', 'defaultOptions']) for (const r of db[kind]) if (!providers.has(r.provider)) providers.set(r.provider, r.sector);
    const ret = group(db.returns, 'quarter');
    const quarters = P.listQuarters(db).filter((q) => ret.has(q));
    return { ret, do: group(db.defaultOptions, 'quarter'), fee: group(db.fees, 'year'), providers, quarters };
  }
  function setDb(db) {
    S.db = db;
    S.ix = buildIndex(db);
    const qs = S.ix.quarters;
    if (!qs.includes(S.f.base)) S.f.base = qs[qs.length - 1] || null;
    if (S.f.compare && (!qs.includes(S.f.compare) || S.f.compare >= S.f.base)) S.f.compare = null;
    if (!S.f.compare && S.f.base) {
      const prev = qs.filter((q) => q < S.f.base);
      S.f.compare = prev[prev.length - 1] || null;
    }
    if (!S.ix.providers.has(S.prefs.company) && S.ix.providers.size) S.prefs.company = S.ix.providers.has(DEFAULT_COMPANY) ? DEFAULT_COMPANY : [...S.ix.providers.keys()][0];
  }
  const sectorOf = (name) => S.ix.providers.get(name) || null;
  const ourSector = () => sectorOf(S.prefs.company) || '증권';
  const curSector = () => S.f.sector || ourSector();
  const retsQ = (q) => (q && S.ix.ret.get(q)) || [];
  const rets = (q, plan, type) => retsQ(q).filter((r) => r.plan === plan && r.type === type);
  const avgOf = (rs, field, weightOf) => P.average(rs, field, S.f.avg, weightOf);
  const rankOf = (rs, field, opt = {}) => P.rank(rs, field, { minReserve: S.f.minReserve, ...opt });
  const totals = (q, plan) => (q ? P.providerTotals(retsQ(q), q, plan || 'ALL') : []);
  const sum = (arr, f = (t) => t.reserve) => arr.reduce((a, t) => a + (f(t) || 0), 0);
  const trendQuarters = () => S.ix.quarters.filter((q) => q <= S.f.base).slice(-TREND_N);
  const feeYear = (q) => (q ? P.feeYearFor(S.db, q) : null);
  // 포털 수수료 공시에는 펀드총비용이 없어 "수수료 비용부담률(운용관리+자산관리)"이다. 펀드총비용까지 있으면 총비용부담률
  let FN = '총비용부담률';
  const feeName = (y) => (feesOf(y).some((r) => typeof r.fundCost === 'number') ? '총비용부담률' : '수수료 비용부담률');
  const feesOf = (year, plan) => ((year != null && S.ix.fee.get(Number(year))) || []).filter((r) => !plan || r.plan === plan);
  // 디폴트옵션은 수익률보다 공시가 늦어 기준 분기 값이 없을 수 있다. 그때는 그 이전 가장 최근 분기를 쓴다
  function doQuarters() {
    const base = S.f.base;
    if (S.ix.do.get(base) && S.ix.do.get(base).length) return { q: base, cq: S.f.compare, fallback: false };
    const q = [...S.ix.do.keys()].filter((k) => k < base && S.ix.do.get(k).length).sort().pop();
    if (!q) return { q: base, cq: S.f.compare, fallback: false };
    const cq = S.f.compare && S.f.compare < q ? S.f.compare : P.shiftQuarter(q, -1);
    return { q, cq, fallback: true };
  }
  const doOf = (q, plan, risk) => ((q && S.ix.do.get(q)) || []).filter((r) => (!plan || r.plan === plan) && (!risk || r.risk === risk));

  // 레코드 묶음에서 한 사업자의 순위 정보
  function rankInfo(q, plan, type, field, provider, scopeSector) {
    const rs = rets(q, plan, type).filter((r) => !scopeSector || r.sector === scopeSector);
    const { ranks, count } = rankOf(rs, field);
    const rec = rs.find((r) => r.provider === provider);
    return { rank: ranks.get(provider) ?? null, count, value: rec ? rec[field] : null, rec, rs, ranks };
  }
  function reserveRank(q, plan, provider, scopeSector) {
    const ts = totals(q, plan).filter((t) => !scopeSector || t.sector === scopeSector);
    const { ranks, count } = P.rank(ts, 'reserve');
    return { rank: ranks.get(provider) ?? null, count, ts };
  }

  // ---------------------------------------------------------------- 예시 데이터 판정
  const srcOf = (q, kind) => (S.db.quarters[q] && S.db.quarters[q].datasets[kind] && S.db.quarters[q].datasets[kind].source) || null;
  const isSampleQ = (q, kind = 'returns') => !!q && srcOf(q, kind) != null && srcOf(q, kind) !== '공시';
  const isSampleFee = (y) => y != null && S.db.feeYears[y] && S.db.feeYears[y].source !== '공시';
  function rangeText(qs) {
    if (!qs.length) return '';
    const sorted = qs.slice().sort();
    const idx = (q) => { const p = P.splitQuarter(q); return p.year * 4 + p.q; };
    const parts = [];
    let start = sorted[0], prev = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      const q = sorted[i];
      if (q && idx(q) === idx(prev) + 1) { prev = q; continue; }
      parts.push(start === prev ? qlabel(start) : `${qlabel(start)}~${qlabel(prev)}`);
      start = prev = q;
    }
    return parts.join(', ');
  }
  // 화면별로 쓰는 데이터 중 예시인 것
  function sampleParts(view) {
    const parts = [];
    const base = S.f.base, cmp = S.f.compare;
    const usesTrend = ['summary', 'sector', 'plan'].includes(view);
    const qs = new Set([base, cmp].filter(Boolean));
    if (usesTrend) trendQuarters().forEach((q) => qs.add(q));
    if (view !== 'default') {
      const s = [...qs].filter((q) => isSampleQ(q, 'returns'));
      if (s.length) parts.push(`수익률·적립금 ${rangeText(s)}`);
    }
    if (view === 'summary' || view === 'fee') {
      const fs = view === 'fee' ? feeSel() : null;
      const ys = [...new Set((fs ? [fs.fy, fs.fyC] : [feeYear(base), feeYear(cmp)]).filter((y) => y != null))].filter(isSampleFee);
      if (ys.length) parts.push(`수수료 ${ys.join('·')}년`);
    }
    if (view === 'default') {
      const dq = doQuarters();
      const s = [dq.q, dq.cq].filter((q) => q && isSampleQ(q, 'defaultOptions'));
      if (s.length) parts.push(`디폴트옵션 ${rangeText(s)}`);
      const r = [dq.q, dq.cq].filter((q) => q && isSampleQ(q, 'returns'));
      if (r.length) parts.push(`적립금 기준 ${rangeText(r)}`);
    }
    return parts;
  }
  const chip = (on) => (on ? `<span class="chip sample" title="${esc(P.SAMPLE_LABEL)}">예시</span>` : '');
  const anySampleQ = (qs, kind) => qs.some((q) => isSampleQ(q, kind));

  // ---------------------------------------------------------------- 카드·표·차트
  function card(o) {
    const acts = (o.actions || '') + (o.chart ? `<button class="btn" type="button" data-act="png" data-id="${o.id}">PNG</button>` : '') + (o.table ? `<button class="btn" type="button" data-act="xlsx" data-id="${o.id}">엑셀</button>` : '');
    return `<section class="card span-${o.span || 12}" id="card-${o.id}" aria-labelledby="h-${o.id}">
      <div class="card-h"><div class="ttl"><h2 id="h-${o.id}">${esc(o.title)} ${chip(o.sample)}</h2>${o.sub ? `<div class="sub">${o.sub}</div>` : ''}</div>
      <div class="acts">${acts}</div></div>
      ${o.body}${o.foot ? `<div class="legend-note">${o.foot}</div>` : ''}</section>`;
  }
  function seg(key, options, cur, small) {
    return `<div class="seg" role="group">${options.map(([v, l]) => `<button type="button" data-act="set" data-k="${key}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('')}</div>`;
  }

  /**
   * 표. cols: {label, group, num, v(row) 원값, f(raw,row) HTML, x(row) 엑셀 값, cls}
   * opt: rowClass(row), title(엑셀 파일 이름)
   */
  function table(id, title, cols, rows, opt = {}) {
    const hasGroup = cols.some((c) => c.group);
    let head = '';
    if (hasGroup) {
      const cells = [];
      cols.forEach((c, i) => {
        const g = c.group || '';
        const last = cells[cells.length - 1];
        if (last && last.g === g && g) last.n++;
        else cells.push({ g, n: 1, i });
      });
      head += '<tr class="grp">' + cells.map((c) => `<th colspan="${c.n}" class="${c.g ? 'grp-start' : ''}">${esc(c.g)}</th>`).join('') + '</tr>';
    }
    const gStart = (c, i) => hasGroup && c.group && (i === 0 || cols[i - 1].group !== c.group);
    head += '<tr>' + cols.map((c, i) => `<th scope="col" class="${c.num ? 'num' : ''} ${gStart(c, i) ? 'grp-start' : ''}">${esc(c.label)}</th>`).join('') + '</tr>';
    const body = rows.map((r) => {
      const cls = (opt.rowClass ? opt.rowClass(r) : kindOf(r.provider)) || '';
      return `<tr class="${cls}">` + cols.map((c, i) => {
        const raw = c.v ? c.v(r) : r[c.key];
        const html = c.f ? c.f(raw, r) : raw == null ? NA : esc(raw);
        return `<td class="${c.num ? 'num' : ''} ${c.cls || ''} ${gStart(c, i) ? 'grp-start' : ''}">${html}</td>`;
      }).join('') + '</tr>';
    }).join('');
    tables[id] = {
      title: opt.title || title,
      aoa: () => [cols.map((c) => (c.group ? c.group + ' ' : '') + c.label), ...rows.map((r) => cols.map((c) => {
        const v = c.x ? c.x(r) : c.v ? c.v(r) : r[c.key];
        return v == null ? '' : typeof v === 'number' ? Math.round(v * 10000) / 10000 : String(v);
      }))],
    };
    return `<div class="tbl-wrap"><table class="t"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols.length}" class="na">표시할 데이터가 없습니다.</td></tr>`}</tbody></table></div>`;
  }
  function chartBox(id, height) {
    return `<div class="chart-box" style="height:${height || 280}px"><canvas id="cv-${id}" role="img" aria-label=""></canvas></div>`;
  }
  function chart(id, title, config) { pendingCharts.push({ id, title, config }); }

  const refLines = {
    id: 'refLines',
    afterDatasetsDraw(c, args, opts) {
      const lines = (opts && opts.lines) || [];
      const { ctx, chartArea: a } = c;
      for (const l of lines) {
        const sc = c.scales[l.axis || 'y'];
        if (!sc || !isNum(l.value)) continue;
        const px = sc.getPixelForValue(l.value);
        ctx.save();
        ctx.strokeStyle = l.color; ctx.fillStyle = l.color; ctx.lineWidth = 1.5; ctx.setLineDash(l.dash || [5, 4]);
        ctx.beginPath();
        if ((l.axis || 'y') === 'y') { ctx.moveTo(a.left, px); ctx.lineTo(a.right, px); } else { ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 11px ${tok('--font')}`;
        const w = ctx.measureText(l.label).width;
        let tx, ty;
        if ((l.axis || 'y') === 'y') { tx = a.right - 6 - w; ty = px - 6; } else { tx = Math.min(px + 5, a.right - w - 4); ty = a.bottom - 6; }
        ctx.fillStyle = alpha(tok('--surface'), 0.9);
        ctx.fillRect(tx - 3, ty - 11, w + 6, 15);
        ctx.fillStyle = l.color; ctx.textAlign = 'left';
        ctx.fillText(l.label, tx, ty);
        ctx.restore();
      }
    },
  };
  const canvasBg = {
    id: 'canvasBg',
    beforeDraw(c) { const { ctx } = c; ctx.save(); ctx.fillStyle = tok('--surface'); ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); },
  };
  if (window.Chart) Chart.register(refLines, canvasBg);

  function mountCharts() {
    if (!window.Chart) {
      pendingCharts.forEach((p) => { const cv = document.getElementById('cv-' + p.id); if (cv) cv.parentElement.innerHTML = '<div class="msg err">차트 라이브러리를 불러오지 못했습니다.</div>'; });
      return;
    }
    Chart.defaults.font.family = tok('--font');
    Chart.defaults.font.size = 12;
    Chart.defaults.color = tok('--ink-2');
    Chart.defaults.borderColor = tok('--line');
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.boxHeight = 12;
    Chart.defaults.plugins.tooltip.backgroundColor = tok('--ink');
    Chart.defaults.plugins.tooltip.titleColor = tok('--surface');
    Chart.defaults.plugins.tooltip.bodyColor = tok('--surface');
    // animation 객체를 통째로 바꾸면 색 보간 설정이 끊겨 버블에 커서를 댈 때 오류가 난다. 길이만 바꾼다
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) Chart.defaults.animation = false;
    else Chart.defaults.animation.duration = 250;
    for (const p of pendingCharts) {
      const cv = document.getElementById('cv-' + p.id);
      if (!cv) continue;
      cv.setAttribute('aria-label', p.title);
      const cfg = p.config;
      cfg.options = { responsive: true, maintainAspectRatio: false, ...cfg.options };
      const c = new Chart(cv, cfg);
      c.$title = p.title;
      charts.push(c);
    }
    pendingCharts = [];
  }
  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

  // ---------------------------------------------------------------- 내보내기
  let dlPromise = null;
  function downloadsApi() {
    if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
    if (!dlPromise) dlPromise = window.claude.use('downloads').catch(() => null);
    return dlPromise;
  }
  async function saveFile(filename, data) {
    const dl = await downloadsApi();
    if (dl) {
      try { await dl.save({ filename, data }); } catch (e) {
        if (e && e.code === 'declined') return;
        toast('파일을 내려받지 못했습니다. ' + ((e && e.message) || ''));
      }
      return;
    }
    if (window.claude) { toast('이 보기에서는 파일 내려받기를 쓸 수 없습니다. claude.ai에서 페이지를 열어 주세요.'); return; }
    // claude.ai 밖(로컬 파일 등)에서 열었을 때
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function xlsxBytes(sheets) {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.aoa);
      ws['!cols'] = s.aoa[0].map((_, i) => ({ wch: Math.min(28, Math.max(8, ...s.aoa.slice(0, 60).map((r) => String(r[i] == null ? '' : r[i]).length * 1.6))) }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }
    return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
  }
  function exportTable(id) {
    const t = tables[id];
    if (!t || !window.XLSX) { toast('엑셀 라이브러리를 불러오지 못했습니다.'); return; }
    const aoa = t.aoa();
    const meta = [[t.title], [P.baseDateLabel(S.f.base) + (S.f.compare ? ` · 비교 ${qlabel(S.f.compare)}` : '')], []];
    if (sampleParts(S.view).length) meta.splice(2, 0, [P.SAMPLE_LABEL + ' 포함: ' + sampleParts(S.view).join(', ')]);
    saveFile(safeFile(`${t.title}_${S.f.base}.xlsx`), xlsxBytes([{ name: '표', aoa: meta.concat(aoa) }]));
  }
  function exportChart(id) {
    const c = charts.find((ch) => ch.canvas.id === 'cv-' + id);
    if (!c) return;
    c.canvas.toBlob((blob) => { if (blob) saveFile(safeFile(`${c.$title}_${S.f.base}.png`), blob); }, 'image/png');
  }

  // ---------------------------------------------------------------- 공통 차트 설정
  const pctTick = (d = 1) => ({ callback: (v) => Number(v).toFixed(d) + '%' });
  const tipPct = (ctx) => `${ctx.dataset.label}: ${isNum(ctx.parsed.y) ? ctx.parsed.y.toFixed(2) + '%' : '값 없음'}`;
  const colorFor = (name, other = '--other') => tok(kindOf(name) === 'ours' ? '--ours' : kindOf(name) === 'peer' ? '--peer' : other);
  const lineDs = (label, data, color, extra = {}) => ({ label, data, borderColor: color, backgroundColor: color, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, tension: 0.2, spanGaps: false, ...extra });
  const filterSummary = () => `${S.f.plan} · ${S.f.type} · ${plabel(S.f.period)} · ${S.f.avg === 'weighted' ? '적립금 가중평균' : '단순평균'}${S.f.minReserve ? ` · 적립금 ${num(S.f.minReserve)}억 이상 순위` : ''}`;

  // ================================================================ 1. 요약
  function viewSummary() {
    const { base: q, compare: cq, plan, type, period: per } = S.f;
    const me = S.prefs.company, os = ourSector();
    let html = '', top5Card = '', secresCard = '';

    // 지표 카드
    const tAll = totals(q, 'ALL'), tAllC = totals(cq, 'ALL');
    const total = sum(tAll), totalC = sum(tAllC);
    const secT = tAll.filter((t) => t.sector === os);
    const myT = tAll.find((t) => t.provider === me);
    const myTC = tAllC.find((t) => t.provider === me);
    const resRank = P.rank(secT, 'reserve');
    const resRankC = P.rank(tAllC.filter((t) => t.sector === os), 'reserve');
    const ri = rankInfo(q, plan, type, per, me, os);
    const riC = cq ? rankInfo(cq, plan, type, per, me, os) : null;
    const riAll = rankInfo(q, plan, type, per, me, null);
    const avgSec = avgOf(ri.rs, per), avgAll = avgOf(riAll.rs, per);
    const top = ri.rs.filter((r) => ri.ranks.get(r.provider) === 1)[0];
    const fy = feeYear(q), fyC = feeYear(cq);
    const resMap = new Map(totals(q, plan).map((t) => [t.provider, t.reserve]));
    const fees = feesOf(fy, plan).filter((r) => r.sector === os);
    const feeW = (r) => resMap.get(r.provider) || 0;
    const feeRank = P.rank(fees, 'totalCost', { order: 'asc', minReserve: S.f.minReserve, reserveOf: feeW });
    const myFee = fees.find((r) => r.provider === me);
    const feeAvg = avgOf(fees, 'totalCost', feeW);
    const sampleRet = anySampleQ([q, cq].filter(Boolean), 'returns');
    const kpi = (cls, lab, val, rows, sample) => `<div class="kpi ${cls}"><div class="lab">${lab} ${chip(sample)}</div><div class="val">${val}</div><div class="rows">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div></div>`;
    const myVal = ri.value;
    html += `<div class="kpis span-12" style="grid-column: span 12">
      ${kpi('', '총적립금 (전체 사업자·전 제도)', jo(total), [['비교 시점 대비', cq ? signed(totalC ? (total / totalC - 1) * 100 : null, 1, '%') : NA], ['사업자 수', tAll.length + '곳']], sampleRet)}
      ${kpi('ours', `<span class="dot ours"></span>당사 적립금`, myT ? jo(myT.reserve) : NA, [[`${os} 업권 내 순위`, myT ? rankHtml(resRank.ranks.get(me), resRank.count) + moveHtml(resRank.ranks.get(me), resRankC.ranks.get(me)) : NA], [`${os} 업권 점유율`, myT ? pct(myT.reserve / sum(secT) * 100) : NA], ['전체 시장 점유율', myT ? pct(myT.reserve / total * 100) : NA], ['비교 시점 대비', myT && myTC ? signed((myT.reserve / myTC.reserve - 1) * 100, 1, '%') : NA]], sampleRet)}
      ${kpi('ours', `<span class="dot ours"></span>당사 수익률 · ${esc(plan)} ${esc(TYPE_SHORT[type])} ${plabel(per)}`, isNum(myVal) ? myVal.toFixed(2) + '<small>%</small>' : '<span class="na" style="font-size:18px">해당 없음</span>', [[`${os} 업권 내 순위`, ri.rank ? rankHtml(ri.rank, ri.count) + moveHtml(ri.rank, riC && riC.rank) : NA], ['전체 순위(보조)', riAll.rank ? rankHtml(riAll.rank, riAll.count) : NA]], sampleRet)}
      ${kpi('', '평균 대비 (당사 − 업권 평균)', isNum(myVal) && isNum(avgSec) ? gapHtml(gap(myVal, avgSec)) : NA, [[`${os} 업권 평균`, pct(avgSec)], ['전체 평균', pct(avgAll) + (isNum(myVal) ? ` <span class="mv">${gapHtml(gap(myVal, avgAll))}</span>` : '')], [`1위 대비${top ? ' (' + esc(top.provider) + ')' : ''}`, top && isNum(myVal) ? gapHtml(gap(myVal, top[per])) : NA]], sampleRet)}
      ${kpi('ours', `<span class="dot ours"></span>당사 ${FN} · ${esc(plan)} ${fy || ''}년`, myFee && isNum(myFee.totalCost) ? myFee.totalCost.toFixed(2) + '<small>%</small>' : '<span class="na" style="font-size:18px">해당 없음</span>', [[`업권 내 순위(낮을수록 1위)`, myFee ? rankHtml(feeRank.ranks.get(me), feeRank.count) : NA], [`${os} 업권 평균`, pct(feeAvg)]], isSampleFee(fy))}
    </div>`;

    // 당사 순위표
    {
      const cols = P.PERIODS;
      let rowsHtml = '';
      const aoa = [['제도', '유형', ...cols.flatMap((p) => [plabel(p) + ' 순위', plabel(p) + ' 변동', plabel(p) + ' 수익률']), '제도 적립금 순위']];
      for (const pl of P.PLANS) {
        const rr = reserveRank(q, pl, me, os);
        const rrC = cq ? reserveRank(cq, pl, me, os) : { rank: null };
        P.VIEW_TYPES.forEach((ty, ti) => {
          const cells = cols.map((p) => {
            const a = rankInfo(q, pl, ty, p, me, os);
            const b = cq ? rankInfo(cq, pl, ty, p, me, os) : { rank: null };
            const sel = pl === plan && ty === type && p === per;
            return { a, b, p, sel };
          });
          aoa.push([pl, ty, ...cells.flatMap((c) => [c.a.rank ? `${c.a.rank}/${c.a.count}` : '', moveText(c.a.rank, c.b.rank), isNum(c.a.value) ? c.a.value : '']), rr.rank ? `${rr.rank}/${rr.count}` : '']);
          rowsHtml += `<tr class="${ti === 0 ? 'sep' : ''}">${ti === 0 ? `<th scope="rowgroup" rowspan="${P.VIEW_TYPES.length}">${pl}</th>` : ''}<td>${esc(TYPE_SHORT[ty])}</td>` +
            cells.map((c) => `<td class="num click ${c.sel ? 'sel' : ''}" data-act="pick" data-plan="${pl}" data-type="${esc(ty)}" data-period="${c.p}" title="${pl} ${esc(ty)} ${plabel(c.p)} 조건으로 보기">${c.a.rank ? rankHtml(c.a.rank, c.a.count) + moveHtml(c.a.rank, c.b.rank) : NA}<br><span class="muted">${isNum(c.a.value) ? c.a.value.toFixed(2) + '%' : '값 없음'}</span></td>`).join('') +
            (ti === 0 ? `<td rowspan="${P.VIEW_TYPES.length}" class="num grp-start">${rr.rank ? rankHtml(rr.rank, rr.count) + moveHtml(rr.rank, rrC.rank) : NA}<br><span class="muted">${rr.rank ? jo(rr.ts.find((t) => t.provider === me).reserve) : ''}</span></td>` : '') + '</tr>';
        });
      }
      tables.myrank = { title: '당사 순위표', aoa: () => aoa };
      const body = `<div class="tbl-wrap"><table class="t"><thead><tr><th scope="col">제도</th><th scope="col">유형</th>${cols.map((p) => `<th scope="col" class="num">${plabel(p)}</th>`).join('')}<th scope="col" class="num grp-start">적립금 순위</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
      html += card({ id: 'myrank', span: 7, title: `당사 순위표 (${os} 업권 내)`, sub: `칸을 누르면 그 제도·유형·기간으로 필터가 바뀝니다. 순위 옆 ▲▼는 ${qlabel(cq)} 대비 변동입니다.`, table: true, sample: sampleRet, body });
    }

    // 증권사 수익률 TOP5 (카드 안에서 제도를 따로 고를 수 있음. 고르지 않으면 상단 제도 필터를 따름)
    {
      const pl5 = S.f.top5Plan || plan;
      const ri = rankInfo(q, pl5, type, per, me, os);
      const avgSec = avgOf(ri.rs, per);
      const ranked = ri.rs.filter((r) => ri.ranks.has(r.provider)).sort((a, b) => ri.ranks.get(a.provider) - ri.ranks.get(b.provider));
      const list = ranked.slice(0, 5);
      const mine = ranked.find((r) => r.provider === me);
      if (mine && !list.includes(mine)) list.push(mine);
      const labels = list.map((r) => `${ri.ranks.get(r.provider)}위 ${r.provider}`);
      chart('top5', `${os} 수익률 TOP5`, {
        type: 'bar',
        data: { labels, datasets: [{ label: `${plabel(per)} 수익률`, data: list.map((r) => r[per]), backgroundColor: list.map((r) => colorFor(r.provider, SECTOR_TOKEN[os])), borderRadius: 3, barThickness: 22 }] },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${plabel(per)} 수익률 ${c.parsed.x.toFixed(2)}% · 업권 평균 대비 ${gapText(gap(c.parsed.x, avgSec))}` } }, refLines: { lines: [{ axis: 'x', value: avgSec, label: `업권 평균 ${isNum(avgSec) ? avgSec.toFixed(2) : ''}%`, color: tok('--ink-2') }] } },
          scales: { x: { ticks: pctTick(1), grace: '8%' }, y: { grid: { display: false } } },
        },
      });
      tables.top5 = { title: `${os} 수익률 TOP5`, aoa: () => [['순위', '사업자', '수익률(%)', '업권 평균 대비(%p)'], ...list.map((r) => [ri.ranks.get(r.provider), r.provider, r[per], gap(r[per], avgSec)])] };
      tables.top5.title = `${os} 수익률 TOP5_${pl5}`;
      top5Card = card({ id: 'top5', span: 12, title: `${os} 수익률 TOP5`, sub: `${pl5} · ${type} · ${plabel(per)} · ${S.f.avg === 'weighted' ? '적립금 가중평균' : '단순평균'}${S.f.minReserve ? ` · 적립금 ${num(S.f.minReserve)}억 이상 순위` : ''}${!list.length ? ` · 당사·${os} ${pl5} 값 없음` : mine && ri.ranks.get(me) > 5 ? ' · 당사는 5위 밖이라 마지막에 덧붙임' : !mine ? ` · 당사 ${pl5} 값 없음` : ''}`, chart: true, sample: isSampleQ(q),
        actions: seg('top5Plan', P.PLANS.map((p) => [p, p]), pl5), body: chartBox('top5', 230), foot: `<span class="dot ours"></span> 당사 &nbsp; <span class="dot peer"></span> 경쟁사 &nbsp; 점선 = ${os} 업권 평균` });
    }


    // 업권별 적립금 순위
    {
      const rows = P.SECTORS.map((s) => {
        const t = tAll.filter((x) => x.sector === s), tc = tAllC.filter((x) => x.sector === s);
        const byPlan = Object.fromEntries(P.PLANS.map((pl) => [pl, sum(totals(q, pl).filter((x) => x.sector === s))]));
        const tot = sum(t), totC = sum(tc);
        return { sector: s, ...byPlan, total: tot, share: (tot / total) * 100, diff: cq ? tot - totC : null, rate: cq && totC ? (tot / totC - 1) * 100 : null, n: t.length };
      }).sort((a, b) => b.total - a.total);
      rows.forEach((r, i) => { r.rank = i + 1; });
      const allRow = { sector: '전체', rank: null, total, share: 100, diff: cq ? total - totalC : null, rate: cq && totalC ? (total / totalC - 1) * 100 : null, n: tAll.length, _total: true };
      P.PLANS.forEach((pl) => { allRow[pl] = rows.reduce((a, r) => a + r[pl], 0); });
      const cols = [
        { label: '순위', v: (r) => r.rank, num: true },
        { label: '업권', v: (r) => r.sector, f: (v) => (v === '전체' ? '전체' : `<span class="sec-tag"><span class="dot" style="background:var(${SECTOR_TOKEN[v]})"></span>${v}</span>`) },
        ...P.PLANS.map((pl) => ({ label: pl, v: (r) => r[pl], f: jo, num: true })),
        { label: '합계', v: (r) => r.total, f: jo, num: true },
        { label: '점유율', v: (r) => r.share, f: (v) => pct(v, 1), num: true },
        { label: '증감액', v: (r) => r.diff, f: (v) => (isNum(v) ? (v > 0 ? '<span class="up">+' : v < 0 ? '<span class="down">−' : '<span>') + jo(Math.abs(v)) + '</span>' : NA), num: true },
        { label: '증감률', v: (r) => r.rate, f: (v) => signed(v, 1, '%'), num: true },
      ];
      secresCard = card({ id: 'secres', span: 12, title: '업권별 적립금 순위', sub: `전 제도 합계(엑셀은 억원) · 증감은 ${qlabel(cq)} 대비`, table: true, sample: sampleRet, body: table('secres', '업권별 적립금 순위', cols, [...rows, allRow], { rowClass: (r) => (r._total ? 'total' : r.sector === os ? 'ours' : '') }) });
    }

    html += `<div class="stack span-5">${top5Card}${secresCard}</div>`;
    html += positioningCard(q, plan, type, per, 'pos', 12);

    // 제도별 적립금 TOP10
    {
      const tp = S.f.topPlan;
      const ts = totals(q, tp), tsC = totals(cq, tp);
      const all = sum(ts);
      const { ranks, count } = P.rank(ts, 'reserve');
      const rkC = P.rank(tsC, 'reserve').ranks;
      const sorted = ts.slice().sort((a, b) => ranks.get(a.provider) - ranks.get(b.provider));
      const list = sorted.slice(0, 10);
      const mine = sorted.find((t) => t.provider === me);
      if (mine && !list.includes(mine)) list.push(mine);
      const max = Math.max(...list.map((t) => t.reserve), 1);
      const cols = [
        { label: '순위', v: (r) => ranks.get(r.provider), f: (v, r) => `${v}${moveHtml(v, rkC.get(r.provider))}`, x: (r) => ranks.get(r.provider), num: true },
        { label: '사업자', v: (r) => r.provider, f: (v) => nameHtml(v) },
        { label: '업권', v: (r) => r.sector },
        { label: '적립금(억원)', v: (r) => r.reserve, f: (v, r) => `<span style="display:inline-flex;align-items:center;gap:8px;justify-content:flex-end;width:100%"><span style="display:inline-block;height:8px;border-radius:2px;width:${Math.max(2, (v / max) * 90)}px;background:${kindOf(r.provider) ? `var(--${kindOf(r.provider)})` : `var(${SECTOR_TOKEN[r.sector]})`};opacity:.75"></span>${num(v)}</span>`, num: true },
        { label: '점유율(전체)', v: (r) => (r.reserve / all) * 100, f: (v) => pct(v, 1), num: true },
        { label: '실적배당 비중', v: (r) => r.performanceShare, f: (v) => pct(v, 1), num: true },
      ];
      html += card({
        id: 'top10', span: 7, title: '제도별 적립금 TOP10 사업자', sub: `전체 ${count}개 사업자 중 · 당사가 10위 밖이면 마지막에 덧붙임`, table: true, sample: sampleRet,
        actions: seg('topPlan', [['ALL', '전 제도'], ...P.PLANS.map((p) => [p, p])], tp),
        body: table('top10', `적립금 TOP10_${tp === 'ALL' ? '전제도' : tp}`, cols, list, { rowClass: (r) => kindOf(r.provider) + (r === mine && sorted.indexOf(mine) >= 10 ? ' sep' : '') }),
      });
    }

    // 당사 순위 추이
    {
      const qs = trendQuarters();
      const tper = S.f.trendPer || per; // 위 기간 필터와 따로 고를 수 있다
      const g = qs.map((qq) => rankInfo(qq, plan, '원리금보장', tper, me, os));
      const pf = qs.map((qq) => rankInfo(qq, plan, '실적배당', tper, me, os));
      const dep = qs.map((qq) => rankInfo(qq, plan, P.DEPOSIT_TYPE, tper, me, os));
      const mkt = qs.map((qq) => rankInfo(qq, plan, P.MARKET_TYPE, tper, me, os));
      const rs = qs.map((qq) => reserveRank(qq, plan, me, os));
      const maxN = Math.max(2, ...g.map((x) => x.count), ...pf.map((x) => x.count), ...rs.map((x) => x.count));
      const tipRank = (arr) => (c) => `${c.dataset.label}: ${c.parsed.y}위 / ${arr[c.dataIndex].count}`;
      const sets = [[`원리금보장 ${plabel(tper)}`, g, tok('--ours'), {}], [`예금성 ${plabel(tper)}`, dep, tok('--ours'), { borderDash: [4, 3], pointStyle: 'rectRot' }], [`시장성 ${plabel(tper)}`, mkt, tok('--ours'), { borderDash: [1, 3], pointStyle: 'triangle', hidden: true }], [`실적배당 ${plabel(tper)}`, pf, tok('--peer'), {}], ['적립금', rs, tok('--ink-3'), { pointStyle: 'rect' }]];
      chart('trend', '당사 순위 추이', {
        type: 'line',
        data: { labels: qs.map((x) => x.replace('Q', '.') + 'Q'), datasets: sets.map(([l, arr, col, ex]) => lineDs(l, arr.map((x) => x.rank), col, ex)) },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { tooltip: { callbacks: { title: (it) => qlabel(qs[it[0].dataIndex]) + (isSampleQ(qs[it[0].dataIndex]) ? ' (예시)' : ''), label: (c) => { const arr = sets[c.datasetIndex][1]; return `${c.dataset.label}: ${c.parsed.y == null ? '값 없음' : c.parsed.y + '위 / ' + arr[c.dataIndex].count}`; } } } },
          scales: { y: { reverse: true, min: 1, suggestedMax: maxN, ticks: { precision: 0, callback: (v) => v + '위' } }, x: { grid: { display: false } } },
        },
      });
      tables.trend = { title: '당사 순위 추이', aoa: () => [['분기', '자료', ...sets.map((s) => s[0] + ' 순위')], ...qs.map((qq, i) => [qlabel(qq), isSampleQ(qq) ? '예시' : '공시', ...sets.map((s) => (s[1][i].rank ? `${s[1][i].rank}/${s[1][i].count}` : ''))])] };
      html += card({ id: 'trend', span: 5, title: `당사 순위 추이 (최근 ${qs.length}개 분기)`, sub: `${plan} · ${os} 업권 내 · 위로 갈수록 높은 순위`, chart: true, actions: seg('trendPer', P.PERIODS.map((p) => [p, plabel(p)]), tper), sample: anySampleQ(qs, 'returns'), body: chartBox('trend', 400) });
    }

    // 경쟁사 그룹 비교
    html += card({ id: 'peers', span: 12, title: '경쟁사 그룹 비교', sub: `${plan} · ${plabel(per)} · 순위는 각 사업자 업권 내 · ▲▼는 ${qlabel(cq)} 대비`, table: true, sample: sampleRet || isSampleFee(fy), body: peerTable(q, cq, plan, per, fy, fyC) });

    return `<div class="grid">${html}</div>`;
  }

  function peerTable(q, cq, plan, per, fy, fyC) {
    const names = [S.prefs.company, ...S.prefs.peers];
    const ts = totals(q, plan), tsC = totals(cq, plan);
    const resMap = new Map(ts.map((t) => [t.provider, t.reserve]));
    const rows = names.map((name) => {
      const sec = sectorOf(name);
      const t = ts.find((x) => x.provider === name);
      const secSum = sum(ts.filter((x) => x.sector === sec));
      const row = { provider: name, sector: sec, reserve: t ? t.reserve : null, share: t && secSum ? (t.reserve / secSum) * 100 : null, perfShare: t ? t.performanceShare : null };
      const rr = P.rank(ts.filter((x) => x.sector === sec), 'reserve');
      const rrC = P.rank(tsC.filter((x) => x.sector === sec), 'reserve');
      row.resRank = rr.ranks.get(name); row.resCount = rr.count; row.resRankC = rrC.ranks.get(name);
      for (const ty of P.VIEW_TYPES) {
        const a = rankInfo(q, plan, ty, per, name, sec);
        const b = cq ? rankInfo(cq, plan, ty, per, name, sec) : { rank: null };
        row[ty] = { v: a.value, r: a.rank, n: a.count, c: b.rank, avg: avgOf(a.rs, per) };
      }
      const fees = feesOf(fy, plan).filter((r) => r.sector === sec);
      const fr = P.rank(fees, 'totalCost', { order: 'asc', minReserve: S.f.minReserve, reserveOf: (r) => resMap.get(r.provider) || 0 });
      const f = fees.find((r) => r.provider === name);
      row.fee = f ? f.totalCost : null; row.feeRank = fr.ranks.get(name); row.feeN = fr.count;
      return row;
    });
    const tcols = (ty, g) => [
      { group: g, label: '수익률', v: (r) => r[ty].v, f: (v) => pct(v), num: true },
      { group: g, label: '순위', v: (r) => r[ty].r, f: (v, r) => (v ? rankHtml(v, r[ty].n) + moveHtml(v, r[ty].c) : NA), x: (r) => (r[ty].r ? `${r[ty].r}/${r[ty].n} ${moveText(r[ty].r, r[ty].c)}`.trim() : ''), num: true },
      { group: g, label: '업권 평균 대비', v: (r) => gap(r[ty].v, r[ty].avg), f: gapHtml, num: true },
    ];
    const cols = [
      { label: '사업자', v: (r) => r.provider, f: (v) => nameHtml(v) },
      { label: '업권', v: (r) => r.sector },
      { group: '적립금', label: '금액(억원)', v: (r) => r.reserve, f: num, num: true },
      { group: '적립금', label: '업권 순위', v: (r) => r.resRank, f: (v, r) => (v ? rankHtml(v, r.resCount) + moveHtml(v, r.resRankC) : NA), x: (r) => (r.resRank ? `${r.resRank}/${r.resCount}` : ''), num: true },
      { group: '적립금', label: '업권 점유율', v: (r) => r.share, f: (v) => pct(v, 1), num: true },
      { group: '적립금', label: '실적배당 비중', v: (r) => r.perfShare, f: (v) => pct(v, 1), num: true },
      ...tcols(P.DEPOSIT_TYPE, '예금성 원리금보장'), ...tcols(P.MARKET_TYPE, '시장성 원리금보장'), ...tcols('실적배당', '실적배당'),
      { group: `${FN} ${fy || ''}년`, label: '비율', v: (r) => r.fee, f: (v) => pct(v), num: true },
      { group: `${FN} ${fy || ''}년`, label: '순위', v: (r) => r.feeRank, f: (v, r) => (v ? rankHtml(v, r.feeN) : NA), x: (r) => (r.feeRank ? `${r.feeRank}/${r.feeN}` : ''), num: true },
    ];
    return table('peers', '경쟁사 그룹 비교', cols, rows);
  }

  function positioningCard(q, plan, type, per, id, span) {
    const scope = S.f.mapScope;
    const os = ourSector();
    const ts = totals(q, plan);
    const recs = rets(q, plan, type);
    const pts = ts.map((t) => {
      const r = recs.find((x) => x.provider === t.provider);
      return r && isNum(r[per]) && t.reserve > 0 ? { x: t.reserve, y: r[per], share: t.performanceShare || 0, name: t.provider, sector: t.sector } : null;
    }).filter(Boolean).filter((p) => scope === 'all' || p.sector === os);
    const rad = (s) => 4 + Math.sqrt(Math.max(0, s)) * 1.7;
    const mk = (label, arr, col, border) => ({ label, data: arr.map((p) => ({ ...p, r: rad(p.share) })), backgroundColor: alpha(col, 0.55), borderColor: border || col, borderWidth: border ? 2 : 1 });
    const ours = pts.filter((p) => kindOf(p.name) === 'ours'), peers = pts.filter((p) => kindOf(p.name) === 'peer'), rest = pts.filter((p) => !kindOf(p.name));
    const datasets = [mk('당사', ours, tok('--ours'), tok('--ink')), mk('경쟁사', peers, tok('--peer'))];
    if (scope === 'all') P.SECTORS.forEach((s) => datasets.push(mk(s, rest.filter((p) => p.sector === s), tok(SECTOR_TOKEN[s]))));
    else datasets.push(mk('기타 ' + os, rest, tok('--other')));
    const avgY = avgOf(recs.filter((r) => scope === 'all' || r.sector === os), per);
    chart(id, '포지셔닝 맵', {
      type: 'bubble',
      data: { datasets },
      options: {
        plugins: {
          tooltip: { callbacks: { label: (c) => { const p = c.raw; return [`${p.name} (${p.sector})`, `적립금 ${Math.round(p.x).toLocaleString('ko-KR')}억원`, `${plabel(per)} 수익률 ${p.y.toFixed(2)}%`, `실적배당 비중 ${p.share.toFixed(1)}%`]; } } },
          refLines: { lines: [{ axis: 'y', value: avgY, label: `${scope === 'all' ? '전체' : os + ' 업권'} 평균 ${isNum(avgY) ? avgY.toFixed(2) : ''}%`, color: tok('--ink-3') }] },
        },
        scales: {
          x: { type: 'logarithmic', title: { display: true, text: `${plan} 적립금(억원, 로그)` }, ticks: { callback: (v) => { const l = Math.log10(v); return Math.abs(l - Math.round(l)) < 1e-6 ? Number(v).toLocaleString('ko-KR') : ''; } } },
          y: { title: { display: true, text: `${type} ${plabel(per)} 수익률` }, ticks: pctTick(1) },
        },
      },
    });
    tables[id] = { title: '포지셔닝 맵', aoa: () => [['사업자', '업권', '적립금(억원)', '수익률(%)', '실적배당 비중(%)'], ...pts.map((p) => [p.name, p.sector, p.x, p.y, Math.round(p.share * 10) / 10])] };
    return card({
      id, span, title: '포지셔닝 맵', sub: `가로 ${plan} 적립금(로그) · 세로 ${type} ${plabel(per)} 수익률 · 버블 크기 = 실적배당 비중`, chart: true, sample: isSampleQ(q),
      actions: seg('mapScope', [['sector', `${os}만`], ['all', '전체 업권']], scope),
      body: chartBox(id, 360),
    });
  }

  // ================================================================ 2. 업권별
  function viewSector() {
    const { base: q, compare: cq, plan, type, period: per } = S.f;
    const sec = curSector();
    let html = '';
    const recs = rets(q, plan, type);
    const avgAll = avgOf(recs, per);
    const avgs = P.SECTORS.map((s) => avgOf(recs.filter((r) => r.sector === s), per));
    chart('secavg', '업권 평균 수익률', {
      type: 'bar',
      data: { labels: P.SECTORS, datasets: [{ label: `${plabel(per)} 업권 평균`, data: avgs, backgroundColor: P.SECTORS.map((s) => tok(SECTOR_TOKEN[s])), borderRadius: 4, maxBarThickness: 64 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.label} 평균 ${c.parsed.y.toFixed(2)}% (전체 대비 ${gapText(gap(c.parsed.y, avgAll))})` } }, refLines: { lines: [{ value: avgAll, label: `전체 평균 ${isNum(avgAll) ? avgAll.toFixed(2) : ''}%`, color: tok('--ink') }] } }, scales: { y: { ticks: pctTick(1), grace: '10%' }, x: { grid: { display: false } } } },
    });
    tables.secavg = { title: '업권 평균 수익률', aoa: () => [['업권', '평균 수익률(%)', '전체 평균 대비(%p)'], ...P.SECTORS.map((s, i) => [s, avgs[i], gap(avgs[i], avgAll)]), ['전체', avgAll, '']] };
    html += card({ id: 'secavg', span: 5, title: '업권 평균 수익률', sub: filterSummary(), chart: true, sample: isSampleQ(q), body: chartBox('secavg', 280), foot: '실선 = 전체 평균' });

    const qs = trendQuarters();
    const series = P.SECTORS.map((s) => qs.map((qq) => avgOf(rets(qq, plan, type).filter((r) => r.sector === s), per)));
    const allS = qs.map((qq) => avgOf(rets(qq, plan, type), per));
    chart('sectrend', '업권 평균 추이', {
      type: 'line',
      data: { labels: qs.map((x) => x.replace('Q', '.') + 'Q'), datasets: [...P.SECTORS.map((s, i) => lineDs(s, series[i], tok(SECTOR_TOKEN[s]), { borderWidth: s === sec ? 3 : 2 })), lineDs('전체', allS, tok('--ink-3'), { borderDash: [5, 4] })] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: (it) => qlabel(qs[it[0].dataIndex]) + (isSampleQ(qs[it[0].dataIndex]) ? ' (예시)' : ''), label: tipPct } } }, scales: { y: { ticks: pctTick(1) }, x: { grid: { display: false } } } },
    });
    tables.sectrend = { title: '업권 평균 추이', aoa: () => [['분기', '자료', ...P.SECTORS, '전체'], ...qs.map((qq, i) => [qlabel(qq), isSampleQ(qq) ? '예시' : '공시', ...series.map((s) => s[i]), allS[i]])] };
    html += card({ id: 'sectrend', span: 7, title: '업권 평균 추이', sub: `${plan} · ${type} · ${plabel(per)} · 최근 ${qs.length}개 분기`, chart: true, sample: anySampleQ(qs, 'returns'), body: chartBox('sectrend', 280) });

    // 사업자 순위표
    {
      const gType = type === '실적배당' ? '원리금보장' : type;
      const types = [gType, '실적배당'];
      const ts = totals(q, plan).filter((t) => t.sector === sec);
      const info = Object.fromEntries(types.map((ty) => {
        const rs = rets(q, plan, ty).filter((r) => r.sector === sec);
        const rk = rankOf(rs, per);
        const rkC = cq ? rankOf(rets(cq, plan, ty).filter((r) => r.sector === sec), per).ranks : new Map();
        return [ty, { rs, rk, rkC, avg: avgOf(rs, per) }];
      }));
      const rows = ts.map((t) => {
        const row = { provider: t.provider, reserve: t.reserve, perfShare: t.performanceShare };
        for (const ty of types) {
          const r = info[ty].rs.find((x) => x.provider === t.provider);
          row[ty] = { v: r ? r[per] : null, r: info[ty].rk.ranks.get(t.provider) ?? null, c: info[ty].rkC.get(t.provider) ?? null };
        }
        return row;
      });
      const sortTy = types.includes(type) ? type : gType;
      rows.sort((a, b) => (a[sortTy].r ?? 999) - (b[sortTy].r ?? 999) || b.reserve - a.reserve);
      const tc = (ty) => [
        { group: TYPE_SHORT[ty], label: '수익률', v: (r) => r[ty].v, f: (v) => pct(v), num: true },
        { group: TYPE_SHORT[ty], label: '순위', v: (r) => r[ty].r, f: (v) => (v ? `${v}위` : NA), num: true },
        { group: TYPE_SHORT[ty], label: '변동', v: (r) => moveText(r[ty].r, r[ty].c), f: (v, r) => moveHtml(r[ty].r, r[ty].c) || NA, cls: 'c' },
        { group: TYPE_SHORT[ty], label: '평균 대비', v: (r) => gap(r[ty].v, info[ty].avg), f: gapHtml, num: true },
      ];
      const cols = [{ label: '사업자', v: (r) => r.provider, f: (v) => nameHtml(v) }, ...types.flatMap(tc), { label: '실적배당 비중', v: (r) => r.perfShare, f: (v) => pct(v, 1), num: true }, { label: '적립금(억원)', v: (r) => r.reserve, f: num, num: true }];
      html += card({ id: 'secrank', span: 12, title: `${sec} 사업자 순위표`, sub: `${plan} · ${plabel(per)} · ${info[gType].rk.count + '곳'} 순위 산정${S.f.minReserve ? ` (적립금 ${num(S.f.minReserve)}억 이상)` : ''} · 평균 = ${sec} ${S.f.avg === 'weighted' ? '가중' : '단순'}평균 · 변동은 ${qlabel(cq)} 대비`, table: true, sample: isSampleQ(q) || isSampleQ(cq), body: table('secrank', `${sec} 사업자 순위표`, cols, rows) });
    }

    // 적립금 점유율·증감
    html += shareCard(q, cq, sec);
    return `<div class="grid">${html}</div>`;
  }

  function shareCard(q, cq, sec) {
    const sp = S.f.sharePlan;
    const ts = totals(q, sp).filter((t) => t.sector === sec), tsC = totals(cq, sp).filter((t) => t.sector === sec);
    const all = sum(ts), allC = sum(tsC);
    const rk = P.rank(ts, 'reserve').ranks, rkC = P.rank(tsC, 'reserve').ranks;
    const rows = ts.map((t) => {
      const c = tsC.find((x) => x.provider === t.provider);
      const share = (t.reserve / all) * 100, shareC = c && allC ? (c.reserve / allC) * 100 : null;
      return { provider: t.provider, rank: rk.get(t.provider), rankC: rkC.get(t.provider), reserve: t.reserve, reserveC: c ? c.reserve : null, diff: c ? t.reserve - c.reserve : null, rate: c && c.reserve ? (t.reserve / c.reserve - 1) * 100 : null, share, shareD: shareC == null ? null : share - shareC };
    }).sort((a, b) => a.rank - b.rank);
    const cols = [
      { label: '순위', v: (r) => r.rank, f: (v, r) => `${v}${moveHtml(v, r.rankC)}`, x: (r) => r.rank, num: true },
      { label: '사업자', v: (r) => r.provider, f: (v) => nameHtml(v) },
      { label: `${qlabel(q)}(억원)`, v: (r) => r.reserve, f: num, num: true },
      { label: `${qlabel(cq)}(억원)`, v: (r) => r.reserveC, f: num, num: true },
      { label: '증감액(억원)', v: (r) => r.diff, f: (v) => (isNum(v) ? signed(v, 0, '') : NA), num: true },
      { label: '증감률', v: (r) => r.rate, f: (v) => signed(v, 1, '%'), num: true },
      { label: '점유율', v: (r) => r.share, f: (v) => pct(v, 2), num: true },
      { label: '점유율 변화', v: (r) => r.shareD, f: (v) => signed(v, 2, '%p'), num: true },
    ];
    return card({
      id: 'share', span: 12, title: `${sec} 적립금 점유율·증감`, sub: `${sp === 'ALL' ? '전 제도 합계' : sp} · ${sec} 업권 내 점유율 · ${qlabel(cq)} 대비`, table: true, sample: isSampleQ(q) || isSampleQ(cq),
      actions: seg('sharePlan', [['ALL', '전 제도'], ...P.PLANS.map((p) => [p, p])], sp),
      body: table('share', `${sec} 적립금 점유율·증감`, cols, rows),
    });
  }

  // ================================================================ 3. 제도별
  function viewPlan() {
    const { base: q, compare: cq, type, period: per } = S.f;
    const me = S.prefs.company, os = ourSector(), sec = curSector();
    let html = '';
    const mine = P.PLANS.map((pl) => rankInfo(q, pl, type, per, me, os));
    const secAvg = P.PLANS.map((pl) => avgOf(rets(q, pl, type).filter((r) => r.sector === sec), per));
    const allAvg = P.PLANS.map((pl) => avgOf(rets(q, pl, type), per));
    chart('plancmp', '제도별 수익률 비교', {
      type: 'bar',
      data: { labels: P.PLANS, datasets: [{ label: '당사', data: mine.map((m) => m.value), backgroundColor: tok('--ours'), borderRadius: 3 }, { label: `${sec} 업권 평균`, data: secAvg, backgroundColor: tok(SECTOR_TOKEN[sec]), borderRadius: 3 }, { label: '전체 평균', data: allAvg, backgroundColor: tok('--other'), borderRadius: 3 }] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${isNum(c.parsed.y) ? c.parsed.y.toFixed(2) + '%' : '값 없음'}${c.datasetIndex === 0 && mine[c.dataIndex].rank ? ` (${os} ${mine[c.dataIndex].rank}위/${mine[c.dataIndex].count})` : ''}` } } }, scales: { y: { ticks: pctTick(1), grace: '10%' }, x: { grid: { display: false } } } },
    });
    tables.plancmp = { title: '제도별 수익률 비교', aoa: () => [['제도', '당사(%)', '당사 순위', `${sec} 업권 평균(%)`, '전체 평균(%)', '업권 평균 대비(%p)', '전체 평균 대비(%p)'], ...P.PLANS.map((pl, i) => [pl, mine[i].value, mine[i].rank ? `${mine[i].rank}/${mine[i].count}` : '', secAvg[i], allAvg[i], gap(mine[i].value, secAvg[i]), gap(mine[i].value, allAvg[i])])] };
    const noDb = P.PLANS.filter((pl, i) => !isNum(mine[i].value));
    html += card({ id: 'plancmp', span: 6, title: '제도별 당사·업권 평균·전체 평균', sub: `${type} · ${plabel(per)} · ${S.f.avg === 'weighted' ? '적립금 가중평균' : '단순평균'}${noDb.length ? ` · 당사 ${noDb.join('·')} 값 없음` : ''}`, chart: true, sample: isSampleQ(q), body: chartBox('plancmp', 280) });

    // 100% 막대
    {
      const ts = P.PLANS.map((pl) => totals(q, pl));
      const groups = [['당사', (t) => t.provider === me], ...P.SECTORS.map((s) => [s, (t) => t.sector === s]), ['전체', () => true]];
      const amounts = groups.map(([, fn]) => P.PLANS.map((pl, i) => sum(ts[i].filter(fn))));
      const shares = amounts.map((a) => { const t = a.reduce((x, y) => x + y, 0); return a.map((v) => (t ? (v / t) * 100 : null)); });
      chart('planmix', '제도별 적립금 구성', {
        type: 'bar',
        data: { labels: groups.map((g) => g[0]), datasets: P.PLANS.map((pl, i) => ({ label: pl, data: shares.map((s) => s[i]), backgroundColor: tok(PLAN_TOKEN[pl]), borderColor: tok('--surface'), borderWidth: 1 })) },
        options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${isNum(c.parsed.x) ? c.parsed.x.toFixed(1) : 0}% (${Math.round(amounts[c.dataIndex][c.datasetIndex]).toLocaleString('ko-KR')}억원)` } } }, scales: { x: { stacked: true, max: 100, ticks: { callback: (v) => v + '%' } }, y: { stacked: true, grid: { display: false } } } },
      });
      tables.planmix = { title: '제도별 적립금 구성', aoa: () => [['구분', ...P.PLANS.map((p) => p + '(억원)'), ...P.PLANS.map((p) => p + ' 비중(%)')], ...groups.map((g, i) => [g[0], ...amounts[i], ...shares[i].map((v) => (v == null ? '' : Math.round(v * 10) / 10))])] };
      html += card({ id: 'planmix', span: 6, title: '제도별 적립금 구성', sub: `${qlabel(q)} · 원리금보장+실적배당 적립금 기준`, chart: true, sample: isSampleQ(q), body: chartBox('planmix', 280) });
    }

    // 실적배당 비중 추이
    {
      const tp = S.f.trendPlan;
      const qs = trendQuarters();
      const ratio = (qq, fn) => { const ts = totals(qq, tp).filter(fn); const r = sum(ts); return r ? (sum(ts, (t) => t.performance) / r) * 100 : null; };
      const lines = [['당사', (t) => t.provider === me, tok('--ours'), {}], [`${os} 업권`, (t) => t.sector === os, tok(SECTOR_TOKEN[os]), {}], ['전체', () => true, tok('--ink-3'), { borderDash: [5, 4] }]];
      S.prefs.peers.forEach((p) => lines.push([p, (t) => t.provider === p, tok('--peer'), { borderWidth: 1, pointRadius: 2, hidden: true }]));
      const data = lines.map(([, fn]) => qs.map((qq) => ratio(qq, fn)));
      chart('perftrend', '실적배당 비중 추이', {
        type: 'line',
        data: { labels: qs.map((x) => x.replace('Q', '.') + 'Q'), datasets: lines.map(([l, , col, ex], i) => lineDs(l, data[i], col, ex)) },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: (it) => qlabel(qs[it[0].dataIndex]) + (isSampleQ(qs[it[0].dataIndex]) ? ' (예시)' : ''), label: (c) => `${c.dataset.label}: ${isNum(c.parsed.y) ? c.parsed.y.toFixed(1) + '%' : '값 없음'}` } } }, scales: { y: { ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } } },
      });
      tables.perftrend = { title: '실적배당 비중 추이', aoa: () => [['분기', '자료', ...lines.map((l) => l[0])], ...qs.map((qq, i) => [qlabel(qq), isSampleQ(qq) ? '예시' : '공시', ...data.map((d) => d[i])])] };
      html += card({ id: 'perftrend', span: 12, title: '실적배당 비중 추이', sub: '적립금 중 실적배당형 비중 · 범례를 누르면 경쟁사 선을 켜고 끌 수 있습니다', chart: true, sample: anySampleQ(qs, 'returns'), actions: seg('trendPlan', [['ALL', '전 제도'], ...P.PLANS.map((p) => [p, p])], tp), body: chartBox('perftrend', 280) });
    }

    // 사업자별 제도 비교표
    {
      const names = [...new Set(P.PLANS.flatMap((pl) => totals(q, pl).filter((t) => t.sector === sec).map((t) => t.provider)))];
      const per3 = Object.fromEntries(P.PLANS.map((pl) => {
        const rs = rets(q, pl, type).filter((r) => r.sector === sec);
        return [pl, { rs, rk: rankOf(rs, per), rkC: cq ? rankOf(rets(cq, pl, type).filter((r) => r.sector === sec), per).ranks : new Map(), ts: new Map(totals(q, pl).map((t) => [t.provider, t])) }];
      }));
      const rows = names.map((n) => {
        const row = { provider: n, total: 0 };
        for (const pl of P.PLANS) {
          const r = per3[pl].rs.find((x) => x.provider === n);
          const t = per3[pl].ts.get(n);
          row[pl] = { res: t ? t.reserve : null, v: r ? r[per] : null, r: per3[pl].rk.ranks.get(n) ?? null, c: per3[pl].rkC.get(n) ?? null };
          row.total += t ? t.reserve : 0;
        }
        return row;
      }).sort((a, b) => b.total - a.total);
      const cols = [{ label: '사업자', v: (r) => r.provider, f: (v) => nameHtml(v) }, ...P.PLANS.flatMap((pl) => [
        { group: pl, label: '적립금(억원)', v: (r) => r[pl].res, f: num, num: true },
        { group: pl, label: '수익률', v: (r) => r[pl].v, f: (v) => pct(v), num: true },
        { group: pl, label: '순위', v: (r) => r[pl].r, f: (v, r) => (v ? `${v}위${moveHtml(v, r[pl].c)}` : NA), x: (r) => (r[pl].r ? `${r[pl].r} ${moveText(r[pl].r, r[pl].c)}`.trim() : ''), num: true },
      ]), { label: '합계(억원)', v: (r) => r.total, f: num, num: true }];
      html += card({ id: 'planprov', span: 12, title: `${sec} 사업자별 제도 비교`, sub: `${type} · ${plabel(per)} · 순위는 ${sec} 업권 내 · 적립금 합계 순`, table: true, sample: isSampleQ(q) || isSampleQ(cq), body: table('planprov', `${sec} 사업자별 제도 비교`, cols, rows) });
    }
    return `<div class="grid">${html}</div>`;
  }

  // ================================================================ 4. 기간별
  function viewPeriod() {
    const { base: q, compare: cq, plan, type } = S.f;
    const me = S.prefs.company, os = ourSector(), sec = curSector();
    let html = '';
    const recs = rets(q, plan, type);
    const secRecs = recs.filter((r) => r.sector === sec);
    const val = (name) => P.PERIODS.map((p) => { const r = recs.find((x) => x.provider === name); return r ? r[p] : null; });
    const secAvg = P.PERIODS.map((p) => avgOf(secRecs, p));
    const allAvg = P.PERIODS.map((p) => avgOf(recs, p));
    const peerCols = [tok('--peer')];
    const ds = [
      lineDs('당사', val(me), tok('--ours'), { borderWidth: 3, pointRadius: 4 }),
      lineDs(`${sec} 업권 평균`, secAvg, tok(SECTOR_TOKEN[sec]), { borderDash: [6, 4] }),
      lineDs('전체 평균', allAvg, tok('--ink-3'), { borderDash: [2, 3] }),
      ...S.prefs.peers.map((p, i) => lineDs(p, val(p), alpha(peerCols[0], 0.35 + 0.1 * (i % 6)), { borderWidth: 1.5, pointRadius: 2, pointStyle: ['circle', 'rect', 'triangle', 'rectRot', 'star', 'cross'][i % 6] })),
    ];
    chart('curve', '기간별 수익률 곡선', {
      type: 'line',
      data: { labels: P.PERIODS.map(plabel), datasets: ds.map((d) => ({ ...d, tension: 0 })) },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: tipPct } } }, scales: { y: { ticks: pctTick(1) }, x: { grid: { display: false } } } },
    });
    tables.curve = { title: '기간별 수익률 곡선', aoa: () => [['구분', ...P.PERIODS.map(plabel)], ...ds.map((d) => [d.label, ...d.data])] };
    html += card({ id: 'curve', span: 12, title: '기간별 수익률 곡선', sub: `${plan} · ${type} · 3년 이상 연환산`, chart: true, sample: isSampleQ(q), body: chartBox('curve', 320) });

    // 당사 기간별 순위
    {
      const rows = P.PERIODS.map((p, i) => {
        const a = rankInfo(q, plan, type, p, me, os);
        const b = cq ? rankInfo(cq, plan, type, p, me, os) : { rank: null };
        const avg = avgOf(a.rs, p);
        const top = a.rs.find((r) => a.ranks.get(r.provider) === 1);
        return { p, v: a.value, r: a.rank, n: a.count, c: b.rank, avg, all: avgOf(recs, p), top: top ? top.provider : null, topV: top ? top[p] : null };
      });
      const cols = [
        { label: '기간', v: (r) => plabel(r.p) },
        { label: '당사 수익률', v: (r) => r.v, f: (v) => pct(v), num: true },
        { label: `${os} 순위`, v: (r) => r.r, f: (v, r) => (v ? rankHtml(v, r.n) : NA), x: (r) => (r.r ? `${r.r}/${r.n}` : ''), num: true },
        { label: '변동', v: (r) => moveText(r.r, r.c), f: (v, r) => moveHtml(r.r, r.c) || NA, cls: 'c' },
        { label: '업권 평균', v: (r) => r.avg, f: (v) => pct(v), num: true },
        { label: '업권 평균 대비', v: (r) => gap(r.v, r.avg), f: gapHtml, num: true },
        { label: '전체 평균 대비', v: (r) => gap(r.v, r.all), f: gapHtml, num: true },
        { label: '1위', v: (r) => r.top, f: (v, r) => (v ? `${esc(v)} <span class="muted">${pct(r.topV)}</span>` : NA) },
        { label: '1위 대비', v: (r) => gap(r.v, r.topV), f: gapHtml, num: true },
      ];
      html += card({ id: 'myperiod', span: 12, title: '당사 기간별 순위', sub: `${plan} · ${type} · ${os} 업권 내 · 변동은 ${qlabel(cq)} 대비`, table: true, sample: isSampleQ(q) || isSampleQ(cq), body: table('myperiod', '당사 기간별 순위', cols, rows, { rowClass: () => '' }) });
    }

    // 사업자 × 기간
    {
      const rks = Object.fromEntries(P.PERIODS.map((p) => [p, rankOf(secRecs, p).ranks]));
      const rows = secRecs.map((r) => ({ provider: r.provider, reserve: r.reserve, ...Object.fromEntries(P.PERIODS.map((p) => [p, { v: r[p], r: rks[p].get(r.provider) ?? null }])) }))
        .sort((a, b) => (a.r1.r ?? 999) - (b.r1.r ?? 999));
      const cols = [{ label: '사업자', v: (r) => r.provider, f: (v) => nameHtml(v) }, { label: '적립금(억원)', v: (r) => r.reserve, f: num, num: true }, ...P.PERIODS.flatMap((p) => [
        { group: plabel(p), label: '수익률', v: (r) => r[p].v, f: (v) => pct(v), num: true },
        { group: plabel(p), label: '순위', v: (r) => r[p].r, f: (v) => (v ? v + '위' : NA), num: true },
      ])];
      html += card({ id: 'provperiod', span: 12, title: `${sec} 사업자 × 기간 비교`, sub: `${plan} · ${type} · 1년 순위 순`, table: true, sample: isSampleQ(q), body: table('provperiod', `${sec} 사업자 기간 비교`, cols, rows) });
    }
    return `<div class="grid">${html}</div>`;
  }

  // ================================================================ 5. 디폴트옵션
  function viewDefault() {
    const { doPlan: plan, risk, doPeriod: per } = S.f;
    const { q, cq, fallback } = doQuarters();
    const me = S.prefs.company, os = ourSector(), sec = curSector();
    let html = '';
    if (fallback) html += `<div class="msg" style="grid-column:1/-1">${esc(qlabel(S.f.base))} 디폴트옵션 공시가 아직 없어 ${esc(qlabel(q))} 기준으로 보여 줍니다(비교 시점 ${esc(qlabel(cq))}).</div>`;
    const all = doOf(q, plan);
    if (!all.length) return `<div class="grid">${card({ id: 'donone', title: '디폴트옵션', body: `<div class="msg">${qlabel(q)} 디폴트옵션 데이터가 없습니다. 데이터 관리 화면에서 업로드 양식의 디폴트옵션 시트를 올려 주세요.</div>` })}</div>`;
    const sampleDo = isSampleQ(q, 'defaultOptions');
    const series = [...P.SECTORS.map((s) => [s, (r) => r.sector === s, tok(SECTOR_TOKEN[s])]), ['당사', (r) => r.provider === me, tok('--ours')]];
    const data = series.map(([, fn]) => P.RISKS.map((rk) => avgOf(all.filter((r) => r.risk === rk && fn(r)), per)));
    const allAvg = P.RISKS.map((rk) => avgOf(all.filter((r) => r.risk === rk), per));
    chart('doavg', '위험등급별 업권 평균 수익률', {
      type: 'bar',
      data: { labels: P.RISKS, datasets: [...series.map(([l, , col], i) => ({ label: l === '당사' ? '당사' : `${l} 평균`, data: data[i], backgroundColor: col, borderRadius: 3 })), { label: '전체 평균', data: allAvg, backgroundColor: tok('--other'), borderRadius: 3 }] },
      options: { plugins: { tooltip: { callbacks: { label: tipPct } } }, scales: { y: { ticks: pctTick(1), grace: '10%' }, x: { grid: { display: false } } } },
    });
    tables.doavg = { title: '위험등급별 업권 평균 수익률', aoa: () => [['위험등급', ...series.map((s) => s[0]), '전체 평균'], ...P.RISKS.map((rk, j) => [rk, ...data.map((d) => d[j]), allAvg[j]])] };
    html += card({ id: 'doavg', span: 7, title: '위험등급별 업권 평균 수익률', sub: `${plan} · ${plabel(per)}${per === 'r1' ? '' : '(누적, 연환산 아님)'} · ${S.f.avg === 'weighted' ? '적립금 가중평균' : '단순평균'} · 회색 = 전체 평균`, chart: true, sample: sampleDo, body: chartBox('doavg', 300) });

    {
      const groups = [['당사', (r) => r.provider === me], ...P.SECTORS.map((s) => [s, (r) => r.sector === s]), ['전체', () => true]];
      const amounts = groups.map(([, fn]) => P.RISKS.map((rk) => sum(all.filter((r) => r.risk === rk && fn(r)))));
      const shares = amounts.map((a) => { const t = a.reduce((x, y) => x + y, 0); return a.map((v) => (t ? (v / t) * 100 : null)); });
      chart('domix', '위험등급별 적립금 구성', {
        type: 'bar',
        data: { labels: groups.map((g) => g[0]), datasets: P.RISKS.map((rk, i) => ({ label: rk, data: shares.map((s) => s[i]), backgroundColor: tok(RISK_TOKEN[rk]), borderColor: tok('--surface'), borderWidth: 1 })) },
        options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${isNum(c.parsed.x) ? c.parsed.x.toFixed(1) : 0}% (${Math.round(amounts[c.dataIndex][c.datasetIndex]).toLocaleString('ko-KR')}억원)` } } }, scales: { x: { stacked: true, max: 100, ticks: { callback: (v) => v + '%' } }, y: { stacked: true, grid: { display: false } } } },
      });
      tables.domix = { title: '위험등급별 적립금 구성', aoa: () => [['구분', ...P.RISKS.map((r) => r + '(억원)'), ...P.RISKS.map((r) => r + ' 비중(%)')], ...groups.map((g, i) => [g[0], ...amounts[i], ...shares[i].map((v) => (v == null ? '' : Math.round(v * 10) / 10))])] };
      html += card({ id: 'domix', span: 5, title: '위험등급별 적립금 구성', sub: `${plan} · ${qlabel(q)}`, chart: true, sample: sampleDo, body: chartBox('domix', 300) });
    }

    {
      const rs = all.filter((r) => r.risk === risk && r.sector === sec);
      const rk = rankOf(rs, per);
      const rkC = cq ? rankOf(doOf(cq, plan, risk).filter((r) => r.sector === sec), per).ranks : new Map();
      const avg = avgOf(rs, per);
      const rows = rs.map((r) => ({ ...r, rank: rk.ranks.get(r.provider) ?? null, rankC: rkC.get(r.provider) ?? null })).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      const cols = [
        { label: '순위', v: (r) => r.rank, f: (v, r) => (v ? `${v}${moveHtml(v, r.rankC)}` : NA), x: (r) => r.rank, num: true },
        { label: '사업자', v: (r) => r.provider, f: (v) => nameHtml(v) },
        { label: '적립금(억원)', v: (r) => r.reserve, f: num, num: true },
        ...P.DO_PERIODS.map((p) => ({ label: plabel(p) + (p === per ? ' ●' : ''), v: (r) => r[p], f: (v) => pct(v), num: true })),
        { label: '평균 대비', v: (r) => gap(r[per], avg), f: gapHtml, num: true },
      ];
      html += card({ id: 'dorank', span: 12, title: `${sec} 디폴트옵션 순위표 · ${risk}`, sub: `${plan} · ${plabel(per)} 수익률 기준 순위(●) · ${sec} 평균 ${pct(avg)} · 변동은 ${qlabel(cq)} 대비`, table: true, sample: sampleDo || isSampleQ(cq, 'defaultOptions'), body: table('dorank', `${sec} 디폴트옵션 ${risk}`, cols, rows) });
    }
    return `<div class="grid">${html}</div>`;
  }

  // ================================================================ 6. 수수료
  // 수수료 화면은 연도로 고른다. 비교 연도 기본값 = 그 전 저장 연도. 'none' = 비교 안 함
  const feeYearsStored = () => [...S.ix.fee.keys()].map(Number).filter((y) => feesOf(y).length).sort((a, b) => a - b);
  function feeSel() {
    const ys = feeYearsStored();
    const want = Number(S.f.feeYear);
    const fy = ys.includes(want) ? want : feeYear(S.f.base);
    const prev = ys.filter((y) => y < fy);
    const fyC = S.f.feeCompare === 'none' ? null : ys.includes(Number(S.f.feeCompare)) && Number(S.f.feeCompare) < fy ? Number(S.f.feeCompare) : (prev[prev.length - 1] ?? null);
    // 적립금 가중치·수익률은 그 연도 마지막 분기(없으면 그 이전 가장 최근 분기) 값
    const qOf = (y) => (y == null ? null : S.ix.quarters.filter((x) => P.splitQuarter(x).year <= y).pop() || null);
    return { fy, fyC, q: qOf(fy), cq: qOf(fyC) };
  }
  function viewFee() {
    const { plan } = S.f;
    // 유형·기간·평균 방식 필터는 이 화면에 없다: 원리금보장(합산) 1년 수익률, 적립금 가중평균으로 고정
    const type = '원리금보장', per = 'r1';
    const avgOf = (rs, field, weightOf) => P.average(rs, field, 'weighted', weightOf);
    const { fy, fyC, q, cq } = feeSel();
    const me = S.prefs.company, os = ourSector(), sec = curSector();
    let html = '';
    if (fy == null) return `<div class="grid">${card({ id: 'feenone', title: '수수료', body: '<div class="msg">수수료 데이터가 없습니다. 데이터 관리 화면에서 수수료 시트를 올려 주세요.</div>' })}</div>`;
    const sampleFee = isSampleFee(fy);
    const wMaps = Object.fromEntries(P.PLANS.map((pl) => [pl, new Map(totals(q, pl).map((t) => [t.provider, t.reserve]))]));
    const series = [...P.SECTORS.map((s) => [`${s} 평균`, (r) => r.sector === s, tok(SECTOR_TOKEN[s])]), ['당사', (r) => r.provider === me, tok('--ours')]];
    const data = series.map(([, fn]) => P.PLANS.map((pl) => avgOf(feesOf(fy, pl).filter(fn), 'totalCost', (r) => wMaps[pl].get(r.provider) || 0)));
    chart('feeavg', `${FN} 업권 평균`, {
      type: 'bar',
      data: { labels: P.PLANS, datasets: series.map(([l, , col], i) => ({ label: l, data: data[i], backgroundColor: col, borderRadius: 3 })) },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${isNum(c.parsed.y) ? c.parsed.y.toFixed(3) + '%' : '값 없음'}` } } }, scales: { y: { ticks: pctTick(2), beginAtZero: true }, x: { grid: { display: false } } } },
    });
    tables.feeavg = { title: `${FN} 업권 평균`, aoa: () => [['제도', ...series.map((s) => s[0] + '(%)')], ...P.PLANS.map((pl, j) => [pl, ...data.map((d) => d[j])])] };
    html += card({ id: 'feeavg', span: 5, title: `${FN} 업권 평균 (${fy}년)`, sub: `${qlabel(q)} 제도별 적립금 가중평균 · 낮을수록 좋음`, chart: true, sample: sampleFee, body: chartBox('feeavg', 300) });

    // 산점도
    {
      const scope = S.f.mapScope;
      const fees = feesOf(fy, plan);
      const recs = rets(q, plan, type);
      const pts = fees.map((f) => { const r = recs.find((x) => x.provider === f.provider); return r && isNum(r[per]) && isNum(f.totalCost) ? { x: f.totalCost, y: r[per], name: f.provider, sector: f.sector } : null; })
        .filter(Boolean).filter((p) => scope === 'all' || p.sector === os);
      const mk = (label, arr, col, extra = {}) => ({ label, data: arr, backgroundColor: col, borderColor: col, pointRadius: 6, pointHoverRadius: 8, ...extra });
      const ds = [mk('당사', pts.filter((p) => kindOf(p.name) === 'ours'), tok('--ours'), { pointRadius: 8, borderColor: tok('--ink'), borderWidth: 2 }), mk('경쟁사', pts.filter((p) => kindOf(p.name) === 'peer'), tok('--peer'))];
      const rest = pts.filter((p) => !kindOf(p.name));
      if (scope === 'all') P.SECTORS.forEach((s) => ds.push(mk(s, rest.filter((p) => p.sector === s), alpha(tok(SECTOR_TOKEN[s]), 0.7))));
      else ds.push(mk('기타 ' + os, rest, tok('--other')));
      chart('feescatter', '수수료 × 수익률', {
        type: 'scatter',
        data: { datasets: ds },
        options: { plugins: { tooltip: { callbacks: { label: (c) => [`${c.raw.name} (${c.raw.sector})`, `${FN} ${c.raw.x.toFixed(2)}%`, `${plabel(per)} 수익률 ${c.raw.y.toFixed(2)}%`] } } }, scales: { x: { title: { display: true, text: `${plan} ${FN} (${fy}년)` }, ticks: pctTick(2) }, y: { title: { display: true, text: `${type} ${plabel(per)} 수익률` }, ticks: pctTick(1) } } },
      });
      tables.feescatter = { title: '수수료 × 수익률', aoa: () => [['사업자', '업권', `${FN}(%)`, '수익률(%)'], ...pts.map((p) => [p.name, p.sector, p.x, p.y])] };
      html += card({ id: 'feescatter', span: 7, title: '수수료 × 수익률', sub: `${plan} · 가로 ${fy}년 ${FN} · 세로 ${qlabel(q)} ${type}(합산) ${plabel(per)} 수익률 · 왼쪽 위일수록 유리`, chart: true, sample: sampleFee || isSampleQ(q), actions: seg('mapScope', [['sector', `${os}만`], ['all', '전체 업권']], scope), body: chartBox('feescatter', 300) });
    }

    // 수수료 순위표
    {
      const fees = feesOf(fy, plan).filter((r) => r.sector === sec);
      const w = (r) => wMaps[plan].get(r.provider) || 0;
      const rk = P.rank(fees, 'totalCost', { order: 'asc', minReserve: S.f.minReserve, reserveOf: w });
      const wC = new Map(totals(cq, plan).map((t) => [t.provider, t.reserve]));
      const rkC = fyC != null ? P.rank(feesOf(fyC, plan).filter((r) => r.sector === sec), 'totalCost', { order: 'asc', minReserve: S.f.minReserve, reserveOf: (r) => wC.get(r.provider) || 0 }).ranks : null;
      const avg = avgOf(fees, 'totalCost', w);
      const recs = rets(q, plan, type);
      const rows = fees.map((f) => { const r = recs.find((x) => x.provider === f.provider); return { ...f, reserve: w(f), rank: rk.ranks.get(f.provider) ?? null, rankC: rkC ? rkC.get(f.provider) ?? null : null, ret: r ? r[per] : null }; })
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      const cols = [
        { label: '순위', v: (r) => r.rank, f: (v, r) => (v ? `${v}${rkC ? moveHtml(v, r.rankC) : ''}` : NA), x: (r) => r.rank, num: true },
        { label: '사업자', v: (r) => r.provider, f: (v) => nameHtml(v) },
        { label: FN, v: (r) => r.totalCost, f: (v) => pct(v), num: true },
        { label: '운용관리수수료', v: (r) => r.opFee, f: (v) => pct(v), num: true },
        { label: '자산관리수수료', v: (r) => r.custodyFee, f: (v) => pct(v), num: true },
        ...(FN === '총비용부담률' ? [{ label: '펀드총비용', v: (r) => r.fundCost, f: (v) => pct(v), num: true }] : []), // 포털 공시에는 펀드총비용이 없다
        { label: '평균 대비', v: (r) => gap(r.totalCost, avg), f: gapHtml, num: true },
        { label: `${qlabel(q)} ${TYPE_SHORT[type]} ${plabel(per)} 수익률`, v: (r) => r.ret, f: (v) => pct(v), num: true },
        { label: `${plan} 적립금(억원)`, v: (r) => r.reserve || null, f: num, num: true },
      ];
      html += card({ id: 'feerank', span: 12, title: `${sec} 수수료 순위표 (${fy}년)`, sub: `${plan} · ${FN}이 낮을수록 1위 · ${sec} 평균 ${pct(avg)}${rkC ? ` · 변동은 ${fyC}년 대비` : ''}`, table: true, sample: sampleFee, body: table('feerank', `${sec} 수수료 순위표 ${fy}`, cols, rows) });
    }
    return `<div class="grid">${html}</div>`;
  }

  // ================================================================ 7. 데이터 관리
  // 데이터 관리에서 올리는 포털 원본 3종 [종류, 이름, 포털 화면 이름]
  const FEE_LABEL = { totalCost: '합계', opFee: '운용관리', custodyFee: '자산관리', fundCost: '펀드총비용' };
  const UP_KINDS = [
    ['returns', '수익률', '"퇴직연금 적립금 운용 금액, 운용수익률" 분기 엑셀'],
    ['defaultOptions', '디폴트옵션', '"사전운용방법(디폴트옵션) 비교공시" 분기 엑셀'],
    ['fees', '수수료', '"퇴직연금사업자 수수료 항목별 비용부담률" 연도 엑셀'],
  ];
  function feeYearOptions() {
    const ys = new Set(Object.keys(S.db.feeYears).map(Number));
    S.ix.quarters.forEach((q) => ys.add(P.splitQuarter(q).year));
    const max = Math.max(...ys, new Date().getFullYear()), min = Math.min(...ys);
    const out = [];
    for (let y = max; y >= min - 2; y--) out.push(y);
    return out;
  }
  function quarterOptions() {
    const qs = S.ix.quarters;
    const first = qs[0] || '2024Q4', last = qs[qs.length - 1] || '2026Q3';
    const out = [];
    for (let q = P.shiftQuarter(first, -8); q <= P.shiftQuarter(last, 4); q = P.shiftQuarter(q, 1)) out.push(q);
    return out;
  }
  function srcChip(src) {
    if (!src) return '<span class="na">없음</span>';
    return `<span class="chip ${src === '공시' ? 'real' : src === '예시' ? 'sample' : 'mixed'}">${esc(src)}</span>`;
  }
  function viewData() {
    const u = S.upload;
    const editable = !S.connected || S.canEdit;
    let html = '';
    // 업로드: 통합연금포털 원본 파일을 종류별로 그대로 올린다
    {
      const kind = S.upKind;
      const K = UP_KINDS.find((k) => k[0] === kind);
      const isFee = kind === 'fees';
      let pv = '';
      if (u && u.error) pv = `<div class="msg err">${esc(u.error)}</div>`;
      if (u && u.parsed) pv = previewHtml(u, editable);
      // 기준 분기(수수료는 연도): 올리기 전에 고르거나 '자동'으로 두면 파일에 적힌 값을 쓴다
      const cur = u && u.parsed ? u.quarter : S.upTarget || 'auto';
      const unit = isFee ? '연도' : '분기';
      const opts = [`<option value="auto" ${cur === 'auto' ? 'selected' : ''}>자동 (파일에 적힌 ${unit})</option>`, ...(isFee
        ? feeYearOptions().map((y) => `<option value="${y}Q4" ${cur !== 'auto' && P.splitQuarter(cur).year === y ? 'selected' : ''}>${y}년${S.db.feeYears[y] ? ' · 저장됨' : ''}</option>`)
        : quarterOptions().reverse().map((q) => `<option value="${q}" ${cur === q ? 'selected' : ''}>${qlabel(q)}${S.ix.quarters.includes(q) ? ' · 저장됨' : ''}</option>`))].join('');
      const note = !(u && u.parsed) ? `파일을 올리기 전에 골라도 되고, 자동으로 두면 파일에서 읽습니다.`
        : u.chosen ? `직접 고른 ${unit}로 저장합니다.${u.detectedQ && u.detectedQ !== u.quarter ? ` 파일에는 ${isFee ? P.splitQuarter(u.detectedQ).year + '년으로' : qlabel(u.detectedQ) + '로'} 적혀 있어요.` : ''}`
        : u.detected ? `파일에 적힌 ${unit}를 읽었습니다. 다르면 바꿔 주세요.` : `파일에서 ${unit}를 찾지 못했습니다. 맞는 값을 골라 주세요.`;
      const target = `<div class="form-row"><label class="fl"><span>기준 ${unit}</span><select id="up-quarter">${opts}</select></label><span class="muted">${esc(note)}</span></div>`;
      html += card({
        id: 'upload', span: 12, title: '통합연금포털 원본 올리기',
        sub: '종류를 고르고 포털에서 내려받은 엑셀을 그대로 올리면 됩니다. 미리보기를 확인한 뒤 저장하세요.',
        actions: seg('upKind', UP_KINDS.map(([v, l]) => [v, l]), kind),
        body: `<div class="muted" style="margin-bottom:8px">${esc(K[1])} 원본: ${esc(K[2])}</div>
          ${target}
          <label class="drop" id="drop"><input type="file" id="up-file" accept=".xlsx,.xls,.csv">
            ${u && u.fileName ? `<b>${esc(u.fileName)}</b> · 다른 파일을 고르려면 누르거나 끌어다 놓으세요` : `${esc(K[1])} 원본 엑셀을 끌어다 놓거나 눌러서 고르세요 (.xlsx, .xls)`}</label>
          ${pv}
          ${!S.connected ? '<div class="msg warn">공유 저장소가 아직 연결되지 않아, 저장하면 이 화면에서만 적용됩니다(새로고침하면 사라짐).</div>' : Store.offline ? '<div class="msg warn">공유 저장소에 연결하지 못해 처음 게시한 데이터를 보여 줍니다. 다른 사람이 저장한 분기는 보이지 않을 수 있습니다(claude.ai에 로그인한 상태로 열어 주세요).</div>' : !S.canEdit ? `<div class="msg">${esc(Store.readOnlyNote || '보기 전용입니다. 편집 권한이 있는 사람만 업로드·삭제할 수 있습니다.')}</div>` : ''}`,
      });
    }

    // 저장된 분기
    {
      const qs = S.ix.quarters.slice().reverse();
      const allQ = [...new Set([...qs, ...Object.keys(S.db.quarters)])].sort().reverse();
      const rows = allQ.map((q) => {
        const m = S.db.quarters[q] || { datasets: {} };
        const r = m.datasets.returns, d = m.datasets.defaultOptions;
        const latest = [r, d].filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
        return { q, r, d, latest, n: retsQ(q).length };
      });
      const delBtn = (key) => (editable ? (S.confirmDel === key ? `<button class="btn danger" type="button" data-act="del" data-key="${key}">삭제 확인</button> <button class="btn" type="button" data-act="delcancel">취소</button>` : `<button class="btn" type="button" data-act="delask" data-key="${key}">삭제</button>`) : '');
      const body = `<div class="tbl-wrap"><table class="t"><thead><tr><th>분기</th><th>수익률·적립금</th><th class="num">행</th><th>저장된 기간</th><th>디폴트옵션</th><th>마지막 저장</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr><td>${qlabel(x.q)}</td><td>${srcChip(x.r && x.r.source)}</td><td class="num">${x.n}</td><td>${x.r && x.r.fields ? esc(x.r.fields.filter((f) => f !== 'reserve').map(plabel).join('·')) : NA}</td><td>${srcChip(x.d && x.d.source)}</td><td class="muted">${x.latest && x.latest.by ? esc(x.latest.by) + ' · ' : ''}${x.latest && x.latest.fileName ? esc(x.latest.fileName) : x.latest && x.latest.source === '예시' ? '초기 예시 데이터' : ''}</td><td>${delBtn('q:' + x.q)}</td></tr>`).join('')}</tbody></table></div>`;
      const fys = Object.keys(S.db.feeYears).sort().reverse();
      const fbody = `<div class="tbl-wrap"><table class="t"><thead><tr><th>연도</th><th>수수료</th><th class="num">행</th><th>마지막 저장</th><th></th></tr></thead><tbody>${fys.map((y) => { const m = S.db.feeYears[y]; return `<tr><td>${y}년</td><td>${srcChip(m.source)}</td><td class="num">${feesOf(y).length}</td><td class="muted">${m.by ? esc(m.by) + ' · ' : ''}${m.fileName ? esc(m.fileName) : m.source === '예시' ? '초기 예시 데이터' : ''}</td><td>${delBtn('y:' + y)}</td></tr>`; }).join('')}</tbody></table></div>`;
      html += card({ id: 'stored', span: 12, title: '저장된 분기', actions: `<button class="btn" type="button" data-act="fulldata">${esc(qlabel(S.f.base))} 전체 데이터 내려받기</button>`, sub: `예시 = ${esc(P.SAMPLE_LABEL)} · 공시 = 포털에서 받은 실제 값 · 혼합 = 일부만 실제 값${S.local ? ' · <b>이 화면에서만 적용한 변경이 있습니다(새로고침하면 사라짐)</b>' : ''}`, body: body + `<h3 style="font-size:14px;margin:10px 0 0">수수료 (연도 단위)</h3>` + fbody + (editable ? '<div class="muted">분기 삭제는 그 분기의 수익률·적립금과 디폴트옵션을 함께 지웁니다.</div>' : '') });
    }
    return `<div class="grid">${html}</div>`;
  }

  function previewHtml(u, editable) {
    const pv = u.parsed.preview;
    const kinds = Object.keys(pv.counts).filter((k) => pv.counts[k]);
    const stats = [
      ['인식된 행', kinds.map((k) => `${P.KIND_LABEL[k]} ${pv.counts[k]}`).join(' · ') || '0'],
      u.kind === 'fees' ? ['항목', (pv.fieldsPresent.fees || []).map((f) => FEE_LABEL[f] || f).join('·') || '없음'] : ['포함된 기간', pv.periods.length ? pv.periods.join('·') : (pv.fieldsPresent.defaultOptions || []).filter((f) => f !== 'reserve').map(plabel).join('·') || '없음'],
      ['제도', pv.plans.join('·') || '없음'],
      ['사업자', pv.providerCount + '곳'],
      [u.kind === 'fees' ? '기준 연도' : '기준 분기', u.kind === 'fees' ? `${P.splitQuarter(u.quarter).year}년` : qlabel(u.quarter)],
    ];
    let h = `<div class="stat-row">${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>`;
    h += `<div class="stat-row">${P.SECTORS.map((s) => `<div class="stat"><div class="k"><span class="dot" style="background:var(${SECTOR_TOKEN[s]})"></span> ${s}</div><div class="v">${pv.sectorProviderCounts[s] || 0}곳</div></div>`).join('')}</div>`;
    for (const w of pv.warnings) h += /추정/.test(w) ? `<details class="more"><summary>${esc(w)}</summary><div class="muted" style="margin-top:4px">${esc(pv.inferredSectorProviders.join(', '))}</div></details>` : `<div class="msg warn">${esc(w)}</div>`;
    const sheetNotes = pv.sheets.map((s) => `<li><b>${esc(s.sheet || s.name)}</b> → ${s.kind ? P.KIND_LABEL[s.kind] : '인식 못 함'}${s.columns && s.columns.length ? ` · 인식한 열 ${s.columns.length}개` : ''}${s.ignoredColumns && s.ignoredColumns.length ? ` · 무시한 열 ${s.ignoredColumns.length}개` : ''}${s.unit ? ` · 단위 ${esc(s.unit)}` : ''}${s.decimalConverted && s.decimalConverted.length ? ` · 소수→% 변환 ${s.decimalConverted.length}개 열` : ''}${s.notes && s.notes.length ? ` · ${esc(s.notes.join(' / '))}` : ''}</li>`).join('');
    h += `<details class="more"><summary>시트별 인식 결과 (${pv.sheets.length}개 시트)</summary><ul class="steps" style="margin-top:6px">${sheetNotes}</ul></details>`;
    const list = (arr, f) => `<div class="tbl-wrap" style="max-height:220px;overflow:auto"><table class="t"><thead><tr><th>시트</th><th class="num">행</th><th>사업자</th><th>사유</th></tr></thead><tbody>${arr.map((x) => `<tr><td>${esc(x.sheet)}</td><td class="num">${esc(x.row)}</td><td>${esc(x.name || '')}</td><td>${esc(f(x))}</td></tr>`).join('')}</tbody></table></div>`;
    h += `<details class="more" ${pv.problems.length ? 'open' : ''}><summary>문제가 있는 행 ${pv.problems.length}개</summary>${pv.problems.length ? list(pv.problems, (x) => x.issue) : '<div class="muted">없음</div>'}</details>`;
    h += `<details class="more"><summary>자동으로 제외된 행 ${pv.excluded.length}개 (근로복지공단, 합계·평균 등)</summary>${pv.excluded.length ? list(pv.excluded, (x) => x.reason) : '<div class="muted">없음</div>'}</details>`;
    const sm = u.dry;
    if (sm) {
      const parts = ['returns', 'fees', 'defaultOptions'].filter((k) => sm.added[k] || sm.updated[k] || sm.removedSample[k]).map((k) => `${P.KIND_LABEL[k]}: 새로 ${sm.added[k]} · 바뀜 ${sm.updated[k]}${sm.removedSample[k] ? ` · 예시 ${sm.removedSample[k]}행 삭제` : ''}`);
      h += `<div class="msg">저장하면 ${esc(u.kind === 'fees' ? `${P.splitQuarter(u.quarter).year}년 수수료` : `${qlabel(u.quarter)} ${UP_KINDS.find((k) => k[0] === u.kind)[1]}`)}에 반영됩니다. ${esc(parts.join(' / ') || '바뀌는 내용이 없습니다.')}</div>`;
    }
    if (u.saved) h += `<div class="msg ok">${esc(u.saved)}</div>`;
    if (u.saveError) h += `<div class="msg err">${esc(u.saveError)}</div>`;
    const total = kinds.reduce((a, k) => a + pv.counts[k], 0);
    h += `<div class="form-row"><button class="btn primary" type="button" data-act="save" ${!editable || !total || u.saved ? 'disabled' : ''}>${S.connected ? '저장' : '이 화면에서만 적용해 보기'}</button>${!editable ? '<span class="muted">편집 권한이 있는 사람만 저장할 수 있습니다.</span>' : ''}<button class="btn" type="button" data-act="clearupload">지우기</button></div>`;
    return h;
  }

  // 병합 셀은 왼쪽 위 칸에만 값을 둔다. 포털 원본은 병합된 칸마다 같은 글자를 채워 두는데,
  // 그대로 두면 다단 헤더가 "원리금구분원리금구분…"처럼 이어져 열을 알아보지 못한다.
  function sheetRows(ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
    const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
    const r0 = ref ? ref.s.r : 0, c0 = ref ? ref.s.c : 0;
    for (const m of ws['!merges'] || []) {
      for (let r = m.s.r; r <= m.e.r; r++) {
        const row = rows[r - r0];
        if (!row) continue;
        for (let c = m.s.c; c <= m.e.c; c++) if ((r !== m.s.r || c !== m.s.c) && c - c0 < row.length) row[c - c0] = '';
      }
    }
    return rows;
  }
  async function readFile(file) {
    S.upload = { fileName: file.name, kind: S.upKind, quarter: null };
    if (!window.XLSX) { S.upload.error = '엑셀 라이브러리를 불러오지 못했습니다. 페이지를 새로고침해 주세요.'; render(); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      S.upload.sheets = wb.SheetNames.map((name) => ({ name, rows: sheetRows(wb.Sheets[name]) }));
      // 기준 분기(수수료는 연도)는 파일에서 읽는다. 없으면 고르게 한다
      setUploadTarget(S.upTarget || 'auto');
    } catch (e) {
      S.upload.error = '파일을 읽지 못했습니다: ' + (e.message || e);
    }
    render();
  }
  // 기준 분기 정하기: 'auto'면 파일에서 읽고(못 읽으면 기본값), 아니면 고른 값
  function setUploadTarget(v) {
    const u = S.upload;
    if (u.kind === 'fees') {
      const text = u.sheets.flatMap((sh) => sh.rows.slice(0, 15)).map((r) => (r || []).join(' ')).join(' ');
      const m = /년도\s*[:：]?\s*(\d{4})/.exec(text) || /(\d{4})\s*년/.exec(text);
      u.detectedQ = m ? `${m[1]}Q4` : null;
    } else {
      u.detectedQ = P.detectQuarter(u.sheets[0] ? u.sheets[0].rows : []) || null;
    }
    u.detected = !!u.detectedQ;
    u.chosen = v !== 'auto';
    u.quarter = u.chosen ? v : u.detectedQ || (u.kind === 'fees' ? `${P.splitQuarter(S.f.base).year}Q4` : P.shiftQuarter(S.ix.quarters[S.ix.quarters.length - 1] || S.f.base, 1));
    parseUpload();
  }
  function parseUpload() {
    const u = S.upload;
    if (!u || !u.sheets) return;
    const parsed = P.parseWorkbook(u.sheets, { quarter: u.quarter });
    const K = UP_KINDS.find((k) => k[0] === u.kind);
    if (!parsed[u.kind].length) {
      const other = UP_KINDS.find((k) => parsed[k[0]].length);
      u.parsed = null;
      u.error = `${K[1]} 원본으로 읽히지 않았습니다.${other ? ` 이 파일은 ${other[1]} 원본으로 보여요. 위에서 ${other[1]} 버튼을 누르고 다시 올려 주세요.` : ' 통합연금포털에서 내려받은 파일이 맞는지 확인해 주세요.'}`;
      return;
    }
    u.error = null;
    // 고른 종류만 저장한다
    u.parsed = { ...parsed, ...Object.fromEntries(UP_KINDS.filter((k) => k[0] !== u.kind).map((k) => [k[0], []])) };
    u.dry = P.applyUpload(S.db, u.parsed, { quarter: u.quarter }).summary;
    u.saved = null; u.saveError = null;
  }
  async function saveUpload() {
    const u = S.upload;
    if (!u || !u.parsed) return;
    let by = null;
    try { by = await Store.who(); } catch (e) { /* 이름 없이 저장 */ }
    const { db: next, summary } = P.applyUpload(S.db, u.parsed, { quarter: u.quarter, source: '공시', by, fileName: u.fileName });
    await commit(next, { action: 'upload', quarter: u.quarter, fileName: u.fileName, summary }, (ok, local) => {
      const where = u.kind === 'fees' ? `${P.splitQuarter(u.quarter).year}년 수수료` : qlabel(u.quarter);
      if (ok) u.saved = local ? `${where}에 이 화면에서만 적용했습니다. 다른 화면에서 확인할 수 있고, 새로고침하면 사라집니다.` : `${where}에 저장했습니다. 대시보드를 여는 모든 사람에게 보입니다.`;
    });
  }
  async function commit(next, info, done) {
    if (!S.connected) { S.local = true; setDb(next); done(true, true); render(); toast('이 화면에서만 적용했습니다.'); return; }
    try {
      const saved = await Store.save(next, info);
      setDb(saved || next); done(true, false); toast('저장했습니다.');
    } catch (e) {
      if (S.upload) S.upload.saveError = e && e.code === 'not_granted' ? '편집 권한이 없어 저장하지 못했습니다.' : '저장하지 못했습니다: ' + ((e && e.message) || e);
      done(false);
    }
    render();
  }
  async function deleteKey(key) {
    S.confirmDel = null;
    const [kind, id] = key.split(':');
    const next = kind === 'q' ? P.deleteQuarter(S.db, id) : P.deleteFeeYear(S.db, id);
    await commit(next, kind === 'q' ? { action: 'delete', quarter: id, kinds: ['returns', 'defaultOptions'] } : { action: 'delete', year: Number(id), kinds: ['fees'] }, () => {});
  }


  function downloadFull() {
    const q = S.f.base, fy = feeYear(q);
    const r = retsQ(q).slice().sort((a, b) => P.SECTORS.indexOf(a.sector) - P.SECTORS.indexOf(b.sector) || a.provider.localeCompare(b.provider, 'ko') || P.PLANS.indexOf(a.plan) - P.PLANS.indexOf(b.plan));
    const sheets = [
      { name: '수익률', aoa: [['분기', '자료구분', '사업자명', '업권', '제도', '상품유형', '적립금(억원)', ...P.PERIODS.map(plabel)], ...r.map((x) => [qlabel(q), x.source, x.provider, x.sector, x.plan, x.type, x.reserve, ...P.PERIODS.map((p) => x[p])])] },
      { name: '수수료', aoa: [['연도', '자료구분', '사업자명', '업권', '제도', '총비용부담률', '운용관리수수료', '자산관리수수료', '펀드총비용'], ...feesOf(fy).map((x) => [x.year, x.source, x.provider, x.sector, x.plan, x.totalCost, x.opFee, x.custodyFee, x.fundCost])] },
      { name: '디폴트옵션', aoa: [['분기', '자료구분', '사업자명', '업권', '제도', '위험등급', '적립금(억원)', ...P.DO_PERIODS.map(plabel)], ...doOf(q).map((x) => [qlabel(q), x.source, x.provider, x.sector, x.plan, x.risk, x.reserve, ...P.DO_PERIODS.map((p) => x[p])])] },
    ];
    sheets.forEach((s) => s.aoa.forEach((row) => row.forEach((v, i) => { if (v == null) row[i] = ''; })));
    saveFile(`퇴직연금_전체데이터_${q}.xlsx`, xlsxBytes(sheets));
  }

  // ---------------------------------------------------------------- 머리말·필터·띠
  function renderHeader() {
    const fs = S.view === 'fee' && S.f.base ? feeSel() : null;
    $('#basedate').innerHTML = !S.f.base ? '저장된 데이터가 없습니다'
      : fs ? `<b>${fs.fy}년 수수료 공시 기준</b>${fs.fyC != null ? ` · 비교 연도 ${fs.fyC}년` : ''}`
      : `<b>${esc(P.baseDateLabel(S.f.base))}</b>${S.f.compare && S.view !== 'data' ? ` · 비교 시점 ${esc(qlabel(S.f.compare))}` : ''}`;
    const sel = $('#company');
    const byS = {};
    for (const [n, s] of S.ix.providers) (byS[s] = byS[s] || []).push(n);
    sel.innerHTML = P.SECTORS.filter((s) => byS[s]).map((s) => `<optgroup label="${s}">${byS[s].sort((a, b) => a.localeCompare(b, 'ko')).map((n) => `<option ${n === S.prefs.company ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('');
    $('#peers-label').textContent = `경쟁사 ${S.prefs.peers.length}곳`;
    $('#tabs').innerHTML = VIEWS.map((v) => `<button class="tab" role="tab" type="button" data-act="view" data-v="${v.id}" aria-selected="${v.id === S.view}">${v.label}</button>`).join('');
  }
  function renderFilters() {
    const v = VIEWS.find((x) => x.id === S.view);
    const f = S.f;
    const qs = S.ix.quarters;
    const fl = (label, inner) => `<div class="fl"><span>${label}</span>${inner}</div>`;
    const sel = (key, opts, cur) => `<select id="f-${key}" data-k="${key}">${opts.map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const qLabel = (q) => qlabel(q) + (isSampleQ(q) ? ' (예시)' : '');
    const map = {
      base: () => fl('기준 시점', sel('base', qs.slice().reverse().map((q) => [q, qLabel(q)]), f.base)),
      feeYear: () => { const fs = feeSel(); return fl('기준 연도', sel('feeYear', feeYearsStored().slice().reverse().map((y) => [y, y + '년']), fs.fy)); },
      feeCompare: () => { const fs = feeSel(); return fl('비교 연도', sel('feeCompare', [['none', '비교 안 함'], ...feeYearsStored().filter((y) => y < fs.fy).reverse().map((y) => [y, y + '년'])], fs.fyC == null ? 'none' : fs.fyC)); },
      compare: () => fl('비교 시점', sel('compare', [['', '비교 안 함'], ...qs.filter((q) => q < f.base).reverse().map((q) => [q, qLabel(q)])], f.compare || '')),
      plan: () => fl('제도', seg('plan', P.PLANS.map((p) => [p, p]), f.plan)),
      type: () => fl('유형', seg('type', P.VIEW_TYPES.map((t) => [t, t === '원리금보장' ? '원리금보장(합산)' : TYPE_SHORT[t] || t]), f.type)),
      period: () => fl('기간', seg('period', P.PERIODS.map((p) => [p, plabel(p)]), f.period)),
      avg: () => fl('업권 평균', seg('avg', [['weighted', '적립금 가중'], ['simple', '단순']], f.avg)),
      minReserve: () => fl('순위 대상', sel('minReserve', MIN_RESERVE.map((m) => [m, m ? `적립금 ${m >= 10000 ? m / 10000 + '조' : m.toLocaleString('ko-KR') + '억'} 이상` : '전체 포함']), f.minReserve)),
      sector: () => fl('업권', seg('sector', P.SECTORS.map((s) => [s, s === ourSector() ? s + '(당사)' : s]), curSector())),
      doPlan: () => fl('제도', seg('doPlan', [['DC', 'DC'], ['IRP', 'IRP']], f.doPlan)),
      risk: () => fl('위험등급', seg('risk', P.RISKS.map((r) => [r, r]), f.risk)),
      doPeriod: () => fl('기간', seg('doPeriod', P.DO_PERIODS.map((p) => [p, plabel(p)]), f.doPeriod)),
    };
    $('#filters').innerHTML = v.filters.map((k) => map[k]()).join('');
    $('#filters').hidden = !v.filters.length;
  }
  function renderBand() {
    const parts = S.view === 'data' ? [] : sampleParts(S.view);
    let h = '';
    if (parts.length) h += `<div class="sample-band" role="note"><strong>${esc(P.SAMPLE_LABEL)}</strong><span>이 화면에 예시 데이터가 들어 있습니다: ${esc(parts.join(', '))}. '예시' 표시가 붙은 표와 차트는 실제 공시값이 아닙니다.</span></div>`;
    if (S.local && S.view !== 'data') h += '<div class="sample-band" role="note"><strong>임시 적용</strong><span>이 화면에서만 적용한 업로드·삭제가 반영돼 있습니다. 새로고침하면 저장된 데이터로 돌아갑니다.</span></div>';
    $('#band').innerHTML = h;
  }
  const RENDER = { summary: viewSummary, sector: viewSector, plan: viewPlan, period: viewPeriod, default: viewDefault, fee: viewFee, data: viewData };
  function render() {
    destroyCharts();
    pendingCharts = []; tables = {};
    if (!S.f.base && S.view !== 'data') S.view = 'data';
    renderHeader(); renderFilters(); renderBand();
    let html;
    try { FN = S.f.base ? feeName(feeYear(S.f.base)) : FN; html = RENDER[S.view](); } catch (e) { console.error(e); html = `<div class="msg err">화면을 그리지 못했습니다: ${esc(e.message)}</div>`; }
    $('#main').innerHTML = html;
    mountCharts();
  }

  // ---------------------------------------------------------------- 경쟁사 선택
  function openPeers() {
    const byS = {};
    for (const [n, s] of S.ix.providers) if (n !== S.prefs.company) (byS[s] = byS[s] || []).push(n);
    const sel = new Set(S.prefs.peers);
    const draw = () => {
      $('#layer').innerHTML = `<div class="dialog-back" data-act="peersclose"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="peers-h">
        <h3 id="peers-h">경쟁사 그룹 (${sel.size}/${MAX_PEERS})</h3>
        <div class="muted">최대 ${MAX_PEERS}곳까지 고를 수 있습니다. 선택은 이 사용자에게만 저장됩니다.</div>
        ${P.SECTORS.filter((s) => byS[s]).map((s) => `<div class="pick-sec">${s}</div><div class="pick-grid">${byS[s].sort((a, b) => a.localeCompare(b, 'ko')).map((n) => `<label><input type="checkbox" data-peer="${esc(n)}" ${sel.has(n) ? 'checked' : ''} ${!sel.has(n) && sel.size >= MAX_PEERS ? 'disabled' : ''}>${esc(n)}</label>`).join('')}</div>`).join('')}
        <div class="form-row" style="justify-content:flex-end"><button class="btn" type="button" data-act="peersdefault">기본값</button><button class="btn primary" type="button" data-act="peersdone">적용</button></div>
      </div></div>`;
    };
    draw();
    const layer = $('#layer');
    layer.onchange = (e) => {
      const n = e.target.getAttribute('data-peer');
      if (!n) return;
      if (e.target.checked) sel.add(n); else sel.delete(n);
      draw();
    };
    layer.onclick = (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.getAttribute('data-act');
      if (a === 'peersclose' && e.target !== act) return;
      if (a === 'peersdefault') { sel.clear(); DEFAULT_PEERS.filter((p) => p !== S.prefs.company && S.ix.providers.has(p)).forEach((p) => sel.add(p)); draw(); return; }
      if (a === 'peersdone') { S.prefs.peers = [...sel]; savePrefs(); }
      layer.innerHTML = ''; layer.onclick = layer.onchange = null;
      render();
    };
  }
  function savePrefs() { Store.prefs.save({ company: S.prefs.company, peers: S.prefs.peers }).catch(() => {}); }

  // ---------------------------------------------------------------- 이벤트
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.closest('#layer')) return;
    const a = el.getAttribute('data-act');
    const d = el.dataset;
    if (a === 'view') { S.view = d.v; try { history.replaceState(null, '', '#' + d.v); } catch (err) { /* 무시 */ } render(); window.scrollTo(0, 0); }
    else if (a === 'set') {
      const k = d.k;
      S.f[k] = k === 'minReserve' ? Number(d.v) : d.v;
      if (k === 'plan') S.f.top5Plan = null;
      if (k === 'period') S.f.trendPer = null;
      if (k === 'upKind') { S.upKind = d.v; S.upload = null; S.upTarget = null; render(); return; }
      if (k === 'type' && S.view === 'default') return;
      render();
    } else if (a === 'pick') { S.f.plan = d.plan; S.f.type = d.type; S.f.period = d.period; render(); }
    else if (a === 'png') exportChart(d.id);
    else if (a === 'xlsx') exportTable(d.id);
    else if (a === 'fulldata') downloadFull();
    else if (a === 'save') saveUpload();
    else if (a === 'clearupload') { S.upload = null; render(); }
    else if (a === 'delask') { S.confirmDel = d.key; render(); }
    else if (a === 'delcancel') { S.confirmDel = null; render(); }
    else if (a === 'del') deleteKey(d.key);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'company') {
      S.prefs.company = t.value;
      S.prefs.peers = S.prefs.peers.filter((p) => p !== t.value);
      S.f.sector = null;
      savePrefs(); render();
    } else if (t.matches('#filters select')) {
      const k = t.getAttribute('data-k');
      S.f[k] = k === 'minReserve' ? Number(t.value) : t.value || null;
      if (k === 'feeYear') S.f.feeCompare = null;
      if (k === 'base') {
        if (S.f.compare && S.f.compare >= S.f.base) S.f.compare = null;
        if (!S.f.compare) { const prev = S.ix.quarters.filter((q) => q < S.f.base); S.f.compare = prev[prev.length - 1] || null; }
      }
      render();
    } else if (t.id === 'up-file' && t.files && t.files[0]) readFile(t.files[0]);
    else if (t.id === 'up-quarter') { S.upTarget = t.value === 'auto' ? null : t.value; if (S.upload && S.upload.sheets) setUploadTarget(t.value); render(); }
  });
  document.addEventListener('dragover', (e) => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', (e) => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', (e) => {
    const d = e.target.closest && e.target.closest('#drop');
    if (!d) return;
    e.preventDefault();
    if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
  $('#peers-btn').addEventListener('click', openPeers);

  // 테마가 바뀌면 차트 색을 다시 칠한다
  let themeTimer = null;
  const rethemed = () => { clearTimeout(themeTimer); themeTimer = setTimeout(() => { if (S.db) render(); }, 60); };
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rethemed); } catch (e) { /* 오래된 브라우저 */ }
  new MutationObserver(rethemed).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------------------------------------------------------- 시작
  async function start() {
    const h = (location.hash || '').slice(1);
    if (VIEWS.some((v) => v.id === h)) S.view = h;
    try {
      const [db, prefs] = await Promise.all([Store.load(), Store.prefs.load().catch(() => null)]);
      if (prefs && prefs.company) S.prefs.company = prefs.company;
      if (prefs && Array.isArray(prefs.peers)) S.prefs.peers = prefs.peers.slice(0, MAX_PEERS);
      setDb(db || P.emptyDb());
      S.prefs.peers = S.prefs.peers.filter((p) => p !== S.prefs.company && S.ix.providers.has(p));
    } catch (e) {
      $('#main').innerHTML = `<div class="msg err">데이터를 불러오지 못했습니다: ${esc(e.message || e)}</div>`;
      return;
    }
    render();
    Store.canEdit().then((v) => { if (v !== S.canEdit) { S.canEdit = v; if (S.view === 'data') render(); } }).catch(() => {});
    Store.subscribe((db) => { if (db && !S.local) { setDb(db); render(); } });
  }
  window.PensionDashboard = { state: S, render, setDb };
  start();
})();
