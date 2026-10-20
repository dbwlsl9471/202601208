/*
 * 퇴직연금 수익률 대시보드 데이터 계층
 *
 * - 엑셀 시트(2차원 배열)를 읽어 정규화된 레코드와 미리보기 보고서를 만든다.
 *   업로드 양식(3시트)과 통합연금포털 원본 양식을 같은 규칙으로 인식한다.
 * - 저장소(DB 문서)에 분기 단위로 병합한다: 올린 열만 교체, 예시 → 공시 교체.
 * - 업권 평균, 순위(동률 같은 순위) 같은 공통 계산을 제공한다.
 *
 * 브라우저: <script src="pension-data.js"> → window.PensionData
 *   시트는 SheetJS로 XLSX.utils.sheet_to_json(ws, {header: 1, raw: false, defval: ''}) 로 넘긴다.
 * Node:     const PensionData = require('./pension-data.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PensionData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const SECTORS = ['은행', '증권', '생보', '손보'];
  const PLANS = ['DB', 'DC', 'IRP'];
  const TYPES = ['원리금보장', '실적배당'];
  // 예금성·시장성 원리금보장을 따로 본 값. 원리금보장(예금성+시장성)의 조각이므로 적립금 합계·실적배당 비중에는 넣지 않는다.
  const DEPOSIT_TYPE = '예금성 원리금보장';
  const MARKET_TYPE = '시장성 원리금보장';
  const COMPONENT_TYPES = [DEPOSIT_TYPE, MARKET_TYPE];
  const VIEW_TYPES = ['원리금보장', DEPOSIT_TYPE, MARKET_TYPE, '실적배당'];
  const PERIODS = ['r1', 'r3', 'r5', 'r7', 'r10'];
  // m1·m3·m6 = 디폴트옵션 단기 수익률(1·3·6개월). 디폴트옵션은 r1·r3도 포털 공시대로 기간 누적(연환산 아님). 수익률 시트의 r3 이상은 연환산
  const PERIOD_LABEL = { m1: '1개월', m3: '3개월', m6: '6개월', r1: '1년', r3: '3년', r5: '5년', r7: '7년', r10: '10년' };
  const RISKS = ['초저위험', '저위험', '중위험', '고위험'];
  const DO_PERIODS = ['m1', 'm3', 'm6', 'r1', 'r3'];
  const SAMPLE_LABEL = '예시 데이터(실제 공시값 아님)';

  // ---------------------------------------------------------------- 사업자 이름
  // 같은 회사의 옛 이름·표기 차이를 하나의 이름으로 묶는다. 값 = [표준 이름, 업권]
  const PROVIDERS = {
    'KB증권': '증권', 'NH투자증권': '증권', '대신증권': '증권', '미래에셋증권': '증권', '삼성증권': '증권',
    '신영증권': '증권', '신한투자증권': '증권', '아이엠증권': '증권', '우리투자증권': '증권', '유안타증권': '증권',
    '키움증권': '증권', '하나증권': '증권', '한국투자증권': '증권', '한화투자증권': '증권', '현대차증권': '증권',
    '교보증권': '증권', 'DB증권': '증권', 'IBK투자증권': '증권',
    'DB생명보험': '생보', '교보생명보험': '생보', '동양생명보험': '생보', '미래에셋생명보험': '생보',
    '삼성생명보험': '생보', '신한라이프생명보험': '생보', '아이비케이연금보험': '생보', '푸본현대생명보험': '생보',
    '한화생명보험': '생보', '흥국생명보험': '생보', 'KDB생명보험': '생보', '농협생명보험': '생보',
    'DB손해보험': '손보', '롯데손해보험': '손보', '삼성화재해상보험': '손보', 'KB손해보험': '손보',
    '한화손해보험': '손보', '현대해상화재보험': '손보', '흥국화재해상보험': '손보', '메리츠화재해상보험': '손보',
    'BNK경남은행': '은행', 'BNK부산은행': '은행', 'IBK기업은행': '은행', 'KB국민은행': '은행', 'NH농협은행': '은행',
    'iM뱅크': '은행', '광주은행': '은행', '신한은행': '은행', '우리은행': '은행', '제주은행': '은행',
    '하나은행': '은행', '한국산업은행': '은행', '전북은행': '은행', 'SC제일은행': '은행', '수협은행': '은행',
  };
  const ALIASES = {
    'iM뱅크(구 대구은행)': 'iM뱅크', 'iM뱅크(구대구은행)': 'iM뱅크', 'DGB대구은행': 'iM뱅크', '대구은행': 'iM뱅크',
    '하이투자증권': '아이엠증권', 'iM증권': '아이엠증권', '신한금융투자': '신한투자증권', '하나금융투자': '하나증권', 'DB금융투자': 'DB증권', '한국포스증권': '우리투자증권',
    'IBK연금보험': '아이비케이연금보험', '신한라이프': '신한라이프생명보험', '삼성화재': '삼성화재해상보험',
    'KDB산업은행': '한국산업은행', '산업은행': '한국산업은행', '국민은행': 'KB국민은행', '기업은행': 'IBK기업은행',
    '농협은행': 'NH농협은행', '부산은행': 'BNK부산은행', '경남은행': 'BNK경남은행', '현대해상': '현대해상화재보험',
  };

  function cleanName(raw) {
    return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  }

  function canonicalProvider(raw) {
    let name = cleanName(raw);
    if (ALIASES[name]) return ALIASES[name];
    // "우리투자증권(구.포스증권)"처럼 옛 이름을 괄호로 붙인 표기는 괄호를 떼고 찾는다
    const bare = name.replace(/\s*\(\s*구[.\s]?[^)]*\)\s*$/, '');
    if (bare !== name && bare) { if (ALIASES[bare]) return ALIASES[bare]; name = bare; }
    const compact = name.replace(/\s/g, '');
    for (const k of Object.keys(ALIASES)) if (k.replace(/\s/g, '') === compact) return ALIASES[k];
    for (const k of Object.keys(PROVIDERS)) if (k.replace(/\s/g, '') === compact) return k;
    return name;
  }

  // 업권 칸이 없을 때 사업자 이름으로 업권을 추정한다. 모르면 null.
  function inferSector(name) {
    const n = canonicalProvider(name);
    if (PROVIDERS[n]) return PROVIDERS[n];
    if (/근로복지공단/.test(n)) return null;
    if (/손해보험|화재|해상/.test(n)) return '손보';
    if (/생명|라이프|연금보험/.test(n)) return '생보';
    if (/증권|금융투자|투자증권/.test(n)) return '증권';
    if (/은행|뱅크/.test(n)) return '은행';
    return null;
  }

  function normalizeSector(v) {
    const s = cleanName(v).replace(/\s/g, '');
    if (!s) return null;
    if (/^은행/.test(s)) return '은행';
    if (/증권|금융투자/.test(s)) return '증권';
    if (/생보|생명/.test(s)) return '생보';
    if (/손보|손해/.test(s)) return '손보';
    return undefined; // 값은 있는데 알 수 없음
  }

  function normalizePlan(v) {
    const s = cleanName(v).toUpperCase().replace(/\s/g, '');
    if (!s) return null;
    if (/IRP|개인형|개인퇴직/.test(s)) return 'IRP';
    if (/DB|확정급여/.test(s)) return 'DB';
    if (/DC|확정기여/.test(s)) return 'DC';
    return undefined;
  }

  // 원리금구분/상품유형 값 → { type } | { exclude: 사유 } | undefined(알 수 없음)
  function classifyTypeValue(v) {
    const s = cleanName(v).replace(/\s/g, '');
    if (!s) return null;
    if (/합계|소계|총계|전체/.test(s)) return { exclude: '합계 행' };
    if (/자사계열사|계열사/.test(s)) return { exclude: '자사계열사 행' };
    if (/기타사업자/.test(s)) return { exclude: '기타 사업자 행' };
    if (/비보장|실적배당/.test(s)) return { type: '실적배당' };
    if (/원리금보장|보장형|^보장$/.test(s)) return { type: '원리금보장', part: s };
    return undefined;
  }

  function normalizeRisk(v) {
    const s = cleanName(v).replace(/\s/g, '');
    if (!s) return null;
    if (/초저/.test(s)) return '초저위험';
    if (/^저/.test(s)) return '저위험';
    if (/^중/.test(s)) return '중위험';
    if (/^고/.test(s)) return '고위험';
    return undefined;
  }

  // ---------------------------------------------------------------- 숫자·분기
  function parseNumber(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v).trim();
    if (s === '' || s === '-' || s === '–' || s === 'N/A' || s === '해당없음') return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[,%\s]/g, '').replace(/^△/, '-').replace(/^▲/, '').replace(/^▼/, '-');
    if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return NaN;
    const n = Number(s);
    return neg ? -n : n;
  }

  const QUARTER_END = { 1: '03.31', 2: '06.30', 3: '09.30', 4: '12.31' };
  function quarterId(year, q) { return `${year}Q${q}`; }
  function splitQuarter(id) {
    const m = /^(\d{4})Q([1-4])$/.exec(id || '');
    return m ? { year: +m[1], q: +m[2] } : null;
  }
  function quarterLabel(id) {
    const p = splitQuarter(id);
    return p ? `${p.year}년 ${p.q}분기` : String(id);
  }
  // 모든 화면 상단에 쓰는 기준일 문구: "2026년 3분기 공시 기준(2026.09.30)"
  function baseDateLabel(id) {
    const p = splitQuarter(id);
    return p ? `${p.year}년 ${p.q}분기 공시 기준(${p.year}.${QUARTER_END[p.q]})` : '';
  }
  function baseDate(id) {
    const p = splitQuarter(id);
    return p ? `${p.year}-${QUARTER_END[p.q].replace('.', '-')}` : null;
  }
  function shiftQuarter(id, n) {
    const p = splitQuarter(id);
    let idx = p.year * 4 + (p.q - 1) + n;
    return quarterId(Math.floor(idx / 4), (idx % 4) + 1);
  }
  function compareQuarter(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // 엑셀 앞부분/헤더에서 분기 추정: "년도: 2026 분기: 3" 또는 "'26.3분기", "2026년 3분기", "2026Q3"
  function detectQuarter(rows) {
    const text = rows.slice(0, 15).map((r) => (r || []).map(cleanName).join(' ')).join(' ');
    let m = /년도\s*[:：]?\s*(\d{4}).{0,10}?분기\s*[:：]?\s*([1-4])/.exec(text);
    if (m) return quarterId(+m[1], +m[2]);
    m = /(\d{4})\s*년\s*([1-4])\s*분기/.exec(text);
    if (m) return quarterId(+m[1], +m[2]);
    m = /(\d{4})\s*Q([1-4])/i.exec(text);
    if (m) return quarterId(+m[1], +m[2]);
    m = /'(\d{2})(?:\.|\s*년)\s*([1-4])\s*분기/.exec(text); // '26.2분기, '26년 2분기(디폴트옵션 공시)
    if (m) return quarterId(2000 + +m[1], +m[2]);
    return null;
  }

  // ---------------------------------------------------------------- 단위
  const UNIT_FACTOR = { '억원': 1, '백만원': 0.01, '천원': 0.00001, '원': 0.00000001 };
  function findUnit(text) {
    const m = /단위\s*[:：]?\s*(억\s*원|백만\s*원|천\s*원|원)/.exec(text);
    if (m) return m[1].replace(/\s/g, '');
    const m2 = /\((억원|백만원|천원|원)\)/.exec(text.replace(/\s/g, ''));
    return m2 ? m2[1] : null;
  }

  // ---------------------------------------------------------------- 헤더 인식
  const NAME_RE = /사업자|회사명|금융회사|금융기관|퇴직연금사업자/;

  function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const row = rows[i] || [];
      if (row.some((c) => NAME_RE.test(cleanName(c)) && cleanName(c).length <= 12)) return i;
    }
    return -1;
  }

  function rowHasNumber(row, skipCols) {
    return (row || []).some((c, j) => {
      if (skipCols.has(j)) return false;
      const n = parseNumber(c);
      return n !== null && !Number.isNaN(n);
    });
  }

  // 여러 줄 헤더를 열마다 하나의 경로(['확정급여형(DB)', "'26.3분기", '수익률'])로 만든다.
  // 병합 셀은 왼쪽 값이 오른쪽으로 이어진다고 보고, 위 단계 값이 바뀌면 끊는다.
  function buildColumnPaths(headerRows, width) {
    const paths = Array.from({ length: width }, () => []);
    let parentKey = Array(width).fill('');
    headerRows.forEach((row, level) => {
      const isLeaf = level === headerRows.length - 1 && headerRows.length > 1;
      let carry = '';
      const nextKey = [];
      for (let j = 0; j < width; j++) {
        const v = cleanName((row || [])[j]);
        if (j > 0 && parentKey[j] !== parentKey[j - 1]) carry = '';
        if (v) carry = v;
        const val = v || (isLeaf ? '' : carry);
        if (val) paths[j].push(val);
        nextKey.push(parentKey[j] + '|' + val);
      }
      parentKey = nextKey;
    });
    return paths;
  }

  // 열 경로 하나의 의미를 정한다.
  function classifyColumn(path) {
    const text = path.join(' ');
    const t = text.replace(/\s/g, '');
    const c = { text };
    if (!t) return c;
    // 키 열
    if (NAME_RE.test(t) && path.length && NAME_RE.test(path[path.length - 1].replace(/\s/g, ''))) return { ...c, key: 'name' };
    if (/^업권$|업권구분|^업종$/.test(t)) return { ...c, key: 'sector' };
    if (/^제도$|제도구분|^제도유형$|^퇴직연금제도$/.test(t)) return { ...c, key: 'plan' };
    if (/위험등급|^위험도$/.test(t)) return { ...c, key: 'risk' };
    if (/^상품명$/.test(t)) return { ...c, key: 'product' };
    if (/^원리금구분$|^상품유형$|^유형$|^상품구분$|^운용유형$/.test(t)) return { ...c, key: 'type' };
    if (/^(기준)?분기$/.test(t)) return { ...c, key: 'quarter' };
    if (/^(기준)?연도$/.test(t)) return { ...c, key: 'year' };

    const plan = normalizePlan(path.find((p) => normalizePlan(p)) || '') || null;
    let type = null;
    if (/비보장|실적배당/.test(t)) type = '실적배당';
    else if (/원리금보장|보장형/.test(t)) type = '원리금보장';
    let risk = null;
    for (const p of path) { const r = /위험/.test(p) ? normalizeRisk(p) : null; if (r) risk = r; }
    const unit = findUnit(text);

    // 수수료
    // 포털 수수료 공시는 대면·비대면 채널 열이 따로 있다. 대면 채널 값만 읽는다(비대면은 IRP 일부 사업자만 공시)
    if (/비대면/.test(t)) return { ...c, nonFace: true };
    if (/펀드총비용|펀드비용/.test(t)) return { ...c, metric: 'fundCost', plan, unit };
    // 포털의 "수수료 비용부담률 합계(A+B)" = 운용관리 + 자산관리 (펀드총비용 없음)
    if (/비용부담률합계|합계\(A\+B\)/.test(t)) return { ...c, metric: 'totalCost', plan, unit };
    if (/총비용부담률/.test(t)) return { ...c, metric: 'totalCost', plan, unit };
    // 운용관리·자산관리를 한 열에 합친 옛 양식은 나눌 수 없어 읽지 않는다(미리보기 '무시한 열'에 표시)
    if (/운용관리/.test(t) && /자산관리/.test(t)) return { ...c, combinedFee: true };
    if (/운용관리/.test(t)) return { ...c, metric: 'opFee', plan, unit };
    if (/자산관리/.test(t)) return { ...c, metric: 'custodyFee', plan, unit };
    // 적립금
    if (/적립금|운용금액|잔액|금액/.test(t) && !/비중|증감|점유/.test(t)) return { ...c, metric: 'reserve', plan, type, risk, unit };
    // 수익률: 마지막 경로 조각에 "N년"이 있으면 그 기간, "수익률"만 있으면 1년
    const last = path[path.length - 1] || '';
    // 디폴트옵션 공시는 1M·3M·6M·1Y·3Y
    const em = /^(1|3|6)\s*M$/i.exec(last.trim());
    if (em) return { ...c, metric: 'm' + em[1], plan, type, risk, unit };
    const ey = /^(1|3|5|7|10)\s*Y$/i.exec(last.trim());
    if (ey) return { ...c, metric: 'r' + ey[1], plan, type, risk, unit };
    const mm = /(^|[^\d])(1|3|6)\s*(개월|달)/.exec(last) || (/^1달/.test(last) ? [null, '', '1'] : null);
    if (mm && !/적립금/.test(t)) return { ...c, metric: 'm' + mm[2], plan, type, risk, unit };
    const ym = /(^|[^\d])(1|3|5|7|10)\s*년/.exec(last) || /(^|[^\d'])(1|3|5|7|10)\s*년\s*(수익률)?$/.exec(t);
    if (ym && /수익률|년$|년\(|년수익/.test(t)) return { ...c, metric: 'r' + ym[2], plan, type, risk, unit };
    if (/수익률/.test(t)) return { ...c, metric: 'r1', plan, type, risk, unit, assumedR1: true };
    return c;
  }

  function detectKind(sheetName, cols, title = '') {
    const n = cleanName(sheetName);
    if (/디폴트|사전지정/.test(n)) return 'defaultOptions';
    if (/수수료|비용/.test(n)) return 'fees';
    if (/수익률|적립금/.test(n)) return 'returns';
    if (/디폴트옵션|사전운용방법/.test(title)) return 'defaultOptions'; // 통합연금포털 디폴트옵션 비교공시
    if (cols.some((c) => c.key === 'risk' || c.risk)) return 'defaultOptions';
    if (cols.some((c) => FEE_FIELDS.includes(c.metric))) return 'fees';
    if (cols.some((c) => c.metric)) return 'returns';
    return null;
  }

  const KIND_LABEL = { returns: '수익률', fees: '수수료', defaultOptions: '디폴트옵션' };
  const RETURN_FIELDS = ['reserve', ...PERIODS];
  // 총비용부담률 = 운용관리수수료 + 자산관리수수료 + 펀드총비용 (%)
  const FEE_FIELDS = ['totalCost', 'opFee', 'custodyFee', 'fundCost'];
  const DO_FIELDS = ['reserve', ...DO_PERIODS];
  const KIND_FIELDS = { returns: RETURN_FIELDS, fees: FEE_FIELDS, defaultOptions: DO_FIELDS };

  // ---------------------------------------------------------------- 시트 해석
  function parseSheet(sheetName, rows, ctx) {
    const rep = {
      sheet: sheetName, kind: null, layout: null, headerRows: 0, unit: '억원',
      columns: [], ignoredColumns: [], decimalConverted: [], notes: [],
    };
    const hi = findHeaderRow(rows);
    if (hi < 0) { rep.notes.push('사업자명 열을 찾지 못해 이 시트를 건너뜀'); return { rep, items: [] }; }

    const width = rows.reduce((w, r) => Math.max(w, (r || []).length), 0);
    // 헤더 끝 = 헤더 아래에서 숫자가 처음 나오는 행 바로 위. 사업자명 열 숫자는 무시
    const nameColGuess = (rows[hi] || []).findIndex((c) => NAME_RE.test(cleanName(c)));
    let di = hi + 1;
    while (di < rows.length && !rowHasNumber(rows[di], new Set([nameColGuess]))) di++;
    // 헤더 아래 단위 행 같은 것은 헤더로 포함하되 최대 4줄
    const headerRows = rows.slice(hi, Math.min(di, hi + 4));
    rep.headerRows = headerRows.length;
    const paths = buildColumnPaths(headerRows, width);
    const cols = paths.map(classifyColumn);

    const pre = rows.slice(0, di).map((r) => (r || []).map(cleanName).join(' ')).join(' ');
    rep.unit = findUnit(pre) || '억원';
    const kind = detectKind(sheetName, cols, pre);
    rep.kind = kind;
    if (!kind) { rep.notes.push('수익률·수수료·디폴트옵션 중 어느 양식인지 알 수 없어 건너뜀'); return { rep, items: [] }; }

    const nameCol = cols.findIndex((c) => c.key === 'name');
    const sectorCol = cols.findIndex((c) => c.key === 'sector');
    const planCol = cols.findIndex((c) => c.key === 'plan');
    const typeCol = cols.findIndex((c) => c.key === 'type');
    const riskCol = cols.findIndex((c) => c.key === 'risk');
    const quarterCol = cols.findIndex((c) => c.key === 'quarter');
    const yearCol = cols.findIndex((c) => c.key === 'year');
    // 디폴트옵션 공시처럼 상품별 행이면: 수익률은 상품마다 하나라 제도별 적립금(DC·IRP 열)으로 가중평균한다
    const productCol = cols.findIndex((c) => c.key === 'product');
    const productMode = kind === 'defaultOptions' && productCol >= 0;
    // 포털처럼 시장성 원리금보장 행이 있으면 예금성 행은 원리금보장 합산의 조각이면서 따로 보는 예금성 값이 된다.
    // 시장성 행이 없으면(업로드 양식) 예금성 행은 예금성 값으로만 읽는다.
    const componentMode = typeCol >= 0 && rows.slice(di).some((r) => /시장성/.test(cleanName((r || [])[typeCol])));
    const allowed = KIND_FIELDS[kind];
    const metricCols = [];
    cols.forEach((c, j) => {
      if (c.key) { rep.columns.push({ col: j, header: c.text, as: c.key }); return; }
      const hasData = rows.slice(di).some((r) => cleanName((r || [])[j]) !== '');
      if (c.metric && allowed.includes(c.metric) && hasData) { metricCols.push(j); rep.columns.push({ col: j, header: c.text, as: c.metric, plan: c.plan || undefined, type: c.type || undefined, risk: c.risk || undefined }); }
      else if (c.text && hasData) rep.ignoredColumns.push({ col: j, header: c.text });
    });
    rep.layout = planCol >= 0 ? 'long' : 'wide';
    // 제도 표시가 없는 수익률 열은 제도별 적립금 열이 있는 제도마다 같은 값으로 쓴다(디폴트옵션 상품별 공시)
    const reservePlans = kind === 'defaultOptions' && planCol < 0 ? [...new Set(metricCols.filter((j) => cols[j].metric === 'reserve' && cols[j].plan).map((j) => cols[j].plan))] : [];
    if (productMode) rep.notes.push('상품별 수익률을 사업자·제도·위험등급마다 제도별 적립금으로 가중평균함. 0.00은 공시값 없음으로 봄');
    if (rep.layout === 'wide' && metricCols.some((j) => !cols[j].plan && !(reservePlans.length && cols[j].metric !== 'reserve')) && kind !== 'fees') {
      rep.notes.push('제도 열도, 제도별 헤더도 없는 숫자 열이 있어 해당 열은 건너뜀');
    }
    if (cols.some((c) => c.nonFace)) rep.notes.push('대면·비대면 채널이 나뉜 수수료는 대면 채널 값을 읽음(비대면 열은 건너뜀)');
    if (cols.some((c) => c.combinedFee)) rep.notes.push('운용관리·자산관리수수료가 한 열로 합쳐져 있어 읽지 않음: 운용관리수수료, 자산관리수수료 열로 나눠 올려 주세요');
    if (cols.some((c) => c.assumedR1)) rep.notes.push('기간 표시 없는 "수익률" 열은 1년 수익률로 읽음');

    // 열 단위·소수 판정
    const factor = {};
    const decimal = {};
    const dataRows = rows.slice(di);
    const isShort = (j) => /^m\d/.test(cols[j].metric);
    for (const j of metricCols) {
      const c = cols[j];
      if (c.metric === 'reserve') factor[j] = UNIT_FACTOR[c.unit || rep.unit] || 1;
      else if (isShort(j)) continue; // 단기 수익률은 값이 작아 아래에서 따로 판정
      else {
        const vals = dataRows.map((r) => parseNumber((r || [])[j])).filter((v) => v !== null && !Number.isNaN(v));
        const maxAbs = vals.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
        const limit = kind === 'fees' ? 0.03 : 0.5; // 0.0325 → 3.25%, 수수료 0.0035 → 0.35%
        if (vals.length && maxAbs > 0 && maxAbs < limit) { decimal[j] = true; rep.decimalConverted.push(c.text); }
      }
    }
    // 1·3·6개월 수익률: 같은 시트의 1년 이상 수익률이 소수면 같이 바꾸고, 그런 열이 없으면 최댓값 0.05 미만일 때만 소수로 본다
    const longRateCols = metricCols.filter((j) => /^r\d/.test(cols[j].metric));
    const sheetDecimal = longRateCols.some((j) => decimal[j]);
    for (const j of metricCols.filter(isShort)) {
      const vals = dataRows.map((r) => parseNumber((r || [])[j])).filter((v) => v !== null && !Number.isNaN(v));
      const maxAbs = vals.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      if (vals.length && maxAbs > 0 && (sheetDecimal || (!longRateCols.length && maxAbs < 0.05))) { decimal[j] = true; rep.decimalConverted.push(cols[j].text); }
    }
    if (rep.unit !== '억원' && metricCols.some((j) => cols[j].metric === 'reserve')) rep.notes.push(`적립금 단위 ${rep.unit} → 억원으로 변환`);

    // 행 해석
    const items = [];
    let lastName = '';
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] || [];
      const rowNo = di + i + 1; // 엑셀 행 번호(1부터)
      let rawName = nameCol >= 0 ? cleanName(row[nameCol]) : '';
      const typeVal = typeCol >= 0 ? row[typeCol] : '';
      if (!rawName && typeCol >= 0 && cleanName(typeVal) && lastName) rawName = lastName; // 세로 병합된 사업자명
      const hasAnyNumber = metricCols.some((j) => { const v = parseNumber(row[j]); return v !== null; });
      if (!rawName) {
        if (hasAnyNumber) ctx.problems.push({ sheet: sheetName, row: rowNo, name: '', issue: '사업자명이 비어 있음' });
        continue;
      }
      lastName = rawName;
      if (/^[※*주]|^\(?주\)|출처|비고/.test(rawName)) continue; // 주석 행
      if (/근로복지공단/.test(rawName)) { ctx.excluded.push({ sheet: sheetName, row: rowNo, name: rawName, reason: '근로복지공단' }); continue; }
      if (/합계|소계|총계|평균|^전체/.test(rawName.replace(/\s/g, ''))) { ctx.excluded.push({ sheet: sheetName, row: rowNo, name: rawName, reason: '합계·평균 행' }); continue; }

      const provider = canonicalProvider(rawName);
      let sector;
      if (sectorCol >= 0 && cleanName(row[sectorCol])) {
        sector = normalizeSector(row[sectorCol]);
        if (sector === undefined) { ctx.problems.push({ sheet: sheetName, row: rowNo, name: rawName, issue: `업권 값을 알 수 없음: ${cleanName(row[sectorCol])}` }); continue; }
      } else {
        sector = inferSector(provider);
        if (!sector) { ctx.problems.push({ sheet: sheetName, row: rowNo, name: rawName, issue: '업권 칸이 없고 이름으로 업권을 추정하지 못함' }); continue; }
        if (sectorCol < 0) ctx.inferredSector.add(provider);
      }

      let rowType = null;
      let part = null;
      if (typeCol >= 0 && kind === 'returns') {
        const t = classifyTypeValue(typeVal);
        if (t && t.exclude) { ctx.excluded.push({ sheet: sheetName, row: rowNo, name: rawName, reason: t.exclude }); continue; }
        if (t === undefined) { ctx.problems.push({ sheet: sheetName, row: rowNo, name: rawName, issue: `상품유형 값을 알 수 없음: ${cleanName(typeVal)}` }); continue; }
        if (t) { rowType = t.type; part = t.part || null; }
      }
      let rowPlan = null;
      if (planCol >= 0) {
        rowPlan = normalizePlan(row[planCol]);
        if (!rowPlan) { ctx.problems.push({ sheet: sheetName, row: rowNo, name: rawName, issue: `제도 값을 알 수 없음: ${cleanName(row[planCol])}` }); continue; }
      }
      let rowRisk = null;
      if (riskCol >= 0) {
        rowRisk = normalizeRisk(row[riskCol]);
        if (!rowRisk) { ctx.problems.push({ sheet: sheetName, row: rowNo, name: rawName, issue: `위험등급 값을 알 수 없음: ${cleanName(row[riskCol])}` }); continue; }
      }
      if (quarterCol >= 0 && cleanName(row[quarterCol]) && ctx.quarter) {
        const q = detectQuarter([[row[quarterCol]]]) || cleanName(row[quarterCol]);
        if (q !== ctx.quarter) { ctx.excluded.push({ sheet: sheetName, row: rowNo, name: rawName, reason: '선택한 분기가 아닌 행' }); continue; }
      }

      if (yearCol >= 0 && cleanName(row[yearCol]) && ctx.quarter) {
        if (parseInt(cleanName(row[yearCol]), 10) !== splitQuarter(ctx.quarter).year) { ctx.excluded.push({ sheet: sheetName, row: rowNo, name: rawName, reason: '선택한 분기의 연도가 아닌 행' }); continue; }
      }

      // 열 묶음(제도·유형·위험등급)별로 값을 모은다
      const groups = new Map();
      let bad = false;
      for (const j of metricCols) {
        const c = cols[j];
        const plans = rowPlan || c.plan ? [rowPlan || c.plan] : (c.metric !== 'reserve' ? reservePlans : []);
        const type = rowType || c.type;
        const risk = rowRisk || c.risk;
        if (!plans.length) continue;
        if (kind === 'returns' && !type) { if (!ctx.typeMissingWarned) { ctx.problems.push({ sheet: sheetName, row: rowNo, name: rawName, issue: '상품유형(원리금보장/실적배당)을 알 수 없음' }); ctx.typeMissingWarned = true; } continue; }
        if (kind === 'defaultOptions' && !risk) continue;
        let v = parseNumber(row[j]);
        if (Number.isNaN(v)) { ctx.problems.push({ sheet: sheetName, row: rowNo, name: rawName, issue: `숫자가 아닌 값: ${c.text} = "${cleanName(row[j])}"` }); bad = true; continue; }
        if (v !== null) {
          if (c.metric === 'reserve') v = v * factor[j];
          else if (decimal[j]) v = v * 100;
        }
        if (productMode) {
          if (c.metric === 'reserve' && v === null) v = 0;   // '-' = 그 제도 적립금 없음
          if (c.metric !== 'reserve' && v === 0) v = null;   // 포털은 공시값이 없을 때 0.00을 적는다
        }
        for (const plan of plans) {
          const gk = [plan, type || '', risk || ''].join('|');
          if (!groups.has(gk)) groups.set(gk, { plan, type, risk, fields: {} });
          groups.get(gk).fields[c.metric] = v;
        }
      }
      if (bad && !groups.size) continue;
      for (const g of groups.values()) {
        if (kind === 'defaultOptions' && g.plan === 'DB') { ctx.problems.push({ sheet: sheetName, row: rowNo, name: rawName, issue: '디폴트옵션에 DB 제도는 없음' }); continue; }
        const base = { kind, row: rowNo, sheet: sheetName, provider, rawName, sector, plan: g.plan, type: g.type || undefined, risk: g.risk || undefined, part: productMode ? cleanName(row[productCol]) || `행${rowNo}` : part, fields: g.fields };
        if (kind === 'returns' && part && /예금성|시장성/.test(part)) {
          if (componentMode) items.push(base);
          items.push({ ...base, type: /예금성/.test(part) ? DEPOSIT_TYPE : MARKET_TYPE, part: null, fields: { ...g.fields } });
        } else items.push(base);
      }
    }
    // 같은 사업자·제도에 합산된 원리금보장 행이 따로 있으면(업로드 양식에 네 유형을 다 채운 경우) 그 행을 쓰고 조각은 더하지 않는다
    if (kind === 'returns') {
      const plain = new Set(items.filter((it) => it.type === '원리금보장' && !(it.part && /예금성|시장성/.test(it.part))).map((it) => it.provider + '|' + it.plan));
      return { rep, items: items.filter((it) => !(it.type === '원리금보장' && it.part && /예금성|시장성/.test(it.part) && plain.has(it.provider + '|' + it.plan))) };
    }
    return { rep, items };
  }

  // 같은 키(사업자·제도·유형/위험등급) 조각을 적립금 가중으로 합친다.
  // 예금성 원리금보장 + 시장성 원리금보장 → 원리금보장.
  function combineParts(items, kind) {
    const fields = KIND_FIELDS[kind];
    const rateFields = fields.filter((f) => f !== 'reserve');
    const byKey = new Map();
    for (const it of items) {
      const key = recordKey(kind, it);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(it);
    }
    const out = [];
    const dupes = [];
    for (const [key, parts] of byKey) {
      const base = parts[0];
      const rec = { provider: base.provider, sector: base.sector, plan: base.plan };
      if (kind === 'returns') rec.type = base.type;
      if (kind === 'defaultOptions') rec.risk = base.risk;
      if (parts.length > 1) {
        const labels = parts.map((p) => p.part || '');
        if (new Set(labels).size !== labels.length) dupes.push({ name: base.rawName, key, rows: parts.map((p) => p.row) });
      }
      const has = (f) => parts.some((p) => f in p.fields);
      if (fields.includes('reserve') && has('reserve')) {
        const vals = parts.map((p) => p.fields.reserve).filter((v) => v != null);
        rec.reserve = vals.length ? round(vals.reduce((a, b) => a + b, 0), 2) : null;
      }
      for (const f of rateFields) {
        if (!has(f)) continue;
        const withVal = parts.filter((p) => p.fields[f] != null);
        if (!withVal.length) { rec[f] = null; continue; }
        if (withVal.length === 1 && parts.length === 1) { rec[f] = round(withVal[0].fields[f], 4); continue; }
        // 가중치: 같은 행의 적립금. 적립금이 0인 조각의 수익률은 의미가 없어 뺀다.
        const weighted = withVal.filter((p) => p.fields.reserve != null);
        if (weighted.length === withVal.length) {
          const w = weighted.filter((p) => p.fields.reserve > 0);
          const sw = w.reduce((a, p) => a + p.fields.reserve, 0);
          rec[f] = sw > 0 ? round(w.reduce((a, p) => a + p.fields.reserve * p.fields[f], 0) / sw, 4) : null;
        } else {
          rec[f] = round(withVal.reduce((a, p) => a + p.fields[f], 0) / withVal.length, 4); // 적립금 없이 올린 경우 단순평균
        }
      }
      // 적립금이 0이면 수익률도 없는 것으로 본다(포털은 0원에도 0.00을 표기)
      if (rec.reserve === 0) for (const f of rateFields) if (f in rec) rec[f] = null;
      const noRate = rateFields.every((f) => !(f in rec) || rec[f] == null);
      if (noRate && !rec.reserve) continue; // 값이 없거나 적립금 0뿐인 조합은 저장하지 않음
      out.push(rec);
    }
    return { records: out, dupes };
  }

  function round(v, d) { const p = Math.pow(10, d); return Math.round(v * p) / p; }

  function recordKey(kind, r) {
    if (kind === 'returns') return [r.provider, r.plan, r.type].join('|');
    if (kind === 'fees') return [r.provider, r.plan].join('|');
    return [r.provider, r.plan, r.risk].join('|');
  }

  /**
   * 엑셀 통합문서를 해석한다.
   * @param {Array<{name:string, rows:any[][]}>} sheets
   * @param {{quarter?: string}} opts quarter = 화면에서 고른 분기(예: '2026Q3')
   * @returns {{returns, fees, defaultOptions, preview}}
   */
  function parseWorkbook(sheets, opts = {}) {
    const ctx = { quarter: opts.quarter || null, excluded: [], problems: [], inferredSector: new Set() };
    const sheetReports = [];
    const byKind = { returns: [], fees: [], defaultOptions: [] };
    let detected = null;
    for (const s of sheets) {
      const rows = (s.rows || []).map((r) => (r || []).map((c) => (c == null ? '' : c)));
      detected = detected || detectQuarter(rows);
      const { rep, items } = parseSheet(s.name, rows, ctx);
      sheetReports.push(rep);
      if (rep.kind) byKind[rep.kind].push(...items);
    }
    const result = { returns: [], fees: [], defaultOptions: [] };
    const fieldsPresent = {};
    for (const kind of Object.keys(byKind)) {
      const { records, dupes } = combineParts(byKind[kind], kind);
      result[kind] = records;
      for (const d of dupes) ctx.problems.push({ sheet: KIND_LABEL[kind], row: d.rows.join(','), name: d.name, issue: '같은 사업자·제도·유형 행이 여러 개라 적립금 가중으로 합침' });
      const present = new Set();
      byKind[kind].forEach((it) => Object.keys(it.fields).forEach((f) => present.add(f)));
      fieldsPresent[kind] = KIND_FIELDS[kind].filter((f) => present.has(f));
    }
    const providers = new Map();
    for (const kind of Object.keys(result)) for (const r of result[kind]) providers.set(r.provider, r.sector);
    const sectorCounts = {};
    for (const s of SECTORS) sectorCounts[s] = 0;
    for (const s of providers.values()) sectorCounts[s]++;

    const warnings = [];
    if (opts.quarter && detected && detected !== opts.quarter) warnings.push(`파일에 적힌 분기(${quarterLabel(detected)})와 선택한 분기(${quarterLabel(opts.quarter)})가 다릅니다.`);
    if (ctx.inferredSector.size) warnings.push(`업권 칸이 없어 이름으로 업권을 추정한 사업자 ${ctx.inferredSector.size}곳`);

    const preview = {
      selectedQuarter: opts.quarter || null,
      detectedQuarter: detected,
      sheets: sheetReports,
      counts: { returns: result.returns.length, fees: result.fees.length, defaultOptions: result.defaultOptions.length },
      fieldsPresent,
      periods: (fieldsPresent.returns || []).filter((f) => f !== 'reserve').map((f) => PERIOD_LABEL[f]),
      plans: PLANS.filter((p) => Object.values(result).some((rs) => rs.some((r) => r.plan === p))),
      providerCount: providers.size,
      sectorProviderCounts: sectorCounts,
      inferredSectorProviders: [...ctx.inferredSector],
      excluded: ctx.excluded,
      problems: ctx.problems,
      warnings,
    };
    return { ...result, preview };
  }

  // ---------------------------------------------------------------- 저장소(DB 문서)
  function emptyDb() {
    return { schemaVersion: SCHEMA_VERSION, updatedAt: null, quarters: {}, feeYears: {}, returns: [], fees: [], defaultOptions: [] };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /**
   * 해석 결과를 저장소에 병합한다. db는 바꾸지 않고 새 문서를 돌려준다.
   * - 올린 파일에 있는 열(값이 비어 있지 않은 칸)만 바꾸고 나머지 열·행은 유지한다.
   * - source가 '공시'이면 같은 분기(수수료는 같은 연도)의 같은 종류 예시 데이터를 먼저 지운다.
   * @param {object} db
   * @param {{returns, fees, defaultOptions}} parsed
   * @param {{quarter:string, source?:'공시'|'예시', by?:string, at?:string, fileName?:string}} opts
   */
  function applyUpload(db, parsed, opts) {
    const next = clone(db || emptyDb());
    const quarter = opts.quarter;
    const qp = splitQuarter(quarter);
    if (!qp) throw new Error('분기 형식이 잘못됨: ' + quarter);
    const source = opts.source || '공시';
    const at = opts.at || new Date().toISOString();
    const summary = { quarter, source, removedSample: {}, added: {}, updated: {} };

    const scopes = {
      returns: (r) => r.quarter === quarter,
      defaultOptions: (r) => r.quarter === quarter,
      fees: (r) => r.year === qp.year,
    };
    for (const kind of ['returns', 'fees', 'defaultOptions']) {
      const incoming = parsed[kind] || [];
      summary.added[kind] = 0; summary.updated[kind] = 0; summary.removedSample[kind] = 0;
      if (!incoming.length) continue;
      if (source === '공시') {
        const before = next[kind].length;
        next[kind] = next[kind].filter((r) => !(scopes[kind](r) && r.source === '예시'));
        summary.removedSample[kind] = before - next[kind].length;
      }
      const index = new Map();
      next[kind].forEach((r, i) => { if (scopes[kind](r)) index.set(recordKey(kind, r), i); });
      for (const inc of incoming) {
        const key = recordKey(kind, inc);
        const scope = kind === 'fees' ? { year: qp.year } : { quarter };
        if (index.has(key)) {
          const cur = next[kind][index.get(key)];
          for (const f of KIND_FIELDS[kind]) if (inc[f] != null) cur[f] = inc[f];
          if (inc.reserve === 0) for (const f of KIND_FIELDS[kind]) if (f !== 'reserve') cur[f] = null;
          cur.sector = inc.sector;
          cur.source = source;
          summary.updated[kind]++;
        } else {
          const rec = { ...scope, ...inc, source };
          for (const f of KIND_FIELDS[kind]) if (!(f in rec)) rec[f] = null;
          next[kind].push(rec);
          index.set(key, next[kind].length - 1);
          summary.added[kind]++;
        }
      }
    }
    const meta = next.quarters[quarter] || { id: quarter, label: quarterLabel(quarter), baseDate: baseDate(quarter), datasets: {} };
    for (const kind of ['returns', 'defaultOptions']) {
      if ((parsed[kind] || []).length) {
        meta.datasets[kind] = { source, updatedAt: at, by: opts.by || null, fileName: opts.fileName || null, fields: (parsed.preview && parsed.preview.fieldsPresent[kind]) || null };
      }
    }
    // 수수료만 올린 경우에는 분기 메타를 새로 만들지 않는다(빈 분기가 분기 목록에 생기지 않게)
    if (next.quarters[quarter] || (parsed.returns || []).length || (parsed.defaultOptions || []).length) next.quarters[quarter] = meta;
    if ((parsed.fees || []).length) {
      next.feeYears[qp.year] = { year: qp.year, source, updatedAt: at, by: opts.by || null, fileName: opts.fileName || null };
    }
    refreshSources(next);
    next.updatedAt = at;
    return { db: next, summary };
  }

  // 레코드의 source를 보고 분기·연도 메타의 예시/공시 표시를 다시 계산한다(일부만 공시면 '혼합').
  function refreshSources(db) {
    const pick = (rs) => { const s = new Set(rs.map((r) => r.source)); return s.size === 0 ? null : s.size === 1 ? [...s][0] : '혼합'; };
    for (const q of Object.keys(db.quarters)) {
      const m = db.quarters[q];
      for (const kind of ['returns', 'defaultOptions']) {
        const src = pick(db[kind].filter((r) => r.quarter === q));
        if (src) m.datasets[kind] = { ...(m.datasets[kind] || {}), source: src };
        else delete m.datasets[kind];
      }
      if (!Object.keys(m.datasets).length) delete db.quarters[q];
    }
    for (const y of Object.keys(db.feeYears)) {
      const src = pick(db.fees.filter((r) => String(r.year) === String(y)));
      if (src) db.feeYears[y].source = src; else delete db.feeYears[y];
    }
  }

  /** 분기 데이터 삭제. kinds 생략 시 그 분기의 수익률·디폴트옵션 모두. 수수료는 deleteFeeYear로 */
  function deleteQuarter(db, quarter, kinds = ['returns', 'defaultOptions']) {
    const next = clone(db);
    for (const k of kinds) next[k] = next[k].filter((r) => r.quarter !== quarter);
    refreshSources(next);
    next.updatedAt = new Date().toISOString();
    return next;
  }
  function deleteFeeYear(db, year) {
    const next = clone(db);
    next.fees = next.fees.filter((r) => String(r.year) !== String(year));
    refreshSources(next);
    next.updatedAt = new Date().toISOString();
    return next;
  }

  function listQuarters(db) { return Object.keys(db.quarters).sort(compareQuarter); }
  function isSample(db, quarter, kind = 'returns') {
    const d = db.quarters[quarter] && db.quarters[quarter].datasets[kind];
    return !!d && d.source !== '공시';
  }
  // 수수료는 기준 분기가 속한 연도 값을 쓴다. 그 연도가 없으면 가장 가까운 이전 연도.
  function feeYearFor(db, quarter) {
    const y = splitQuarter(quarter).year;
    const years = Object.keys(db.feeYears).map(Number).filter((v) => v <= y).sort((a, b) => b - a);
    return years.length ? years[0] : null;
  }

  // ---------------------------------------------------------------- 공통 계산
  /**
   * 평균. method: 'weighted'(적립금 가중) | 'simple'(단순). 값이 없거나 적립금이 0인 사업자는 뺀다.
   * weightOf: 가중치. 기본은 레코드의 reserve. 수수료처럼 레코드에 적립금이 없으면 함수로 넘긴다.
   */
  function average(records, field, method = 'weighted', weightOf = (r) => r.reserve) {
    const rs = records.filter((r) => r[field] != null && !(weightOf(r) === 0));
    if (!rs.length) return null;
    if (method === 'simple') return rs.reduce((a, r) => a + r[field], 0) / rs.length;
    const w = rs.filter((r) => weightOf(r) > 0);
    const sw = w.reduce((a, r) => a + weightOf(r), 0);
    return sw > 0 ? w.reduce((a, r) => a + weightOf(r) * r[field], 0) / sw : null;
  }

  /**
   * 순위(동률은 같은 순위, 다음 순위는 건너뜀: 1,2,2,4). 소수 넷째 자리에서 같으면 동률.
   * @param {Array} records 순위 대상 레코드
   * @param {string} field 값 필드
   * @param {{order?:'desc'|'asc', minReserve?:number, reserveOf?:Function}} opt
   *   수익률·적립금은 desc, 수수료는 asc(낮을수록 1위). minReserve(억원) 미만은 순위에서 뺀다(기본 0 = 전체 포함).
   * @returns {{ranks: Map<string, number>, count: number}}
   */
  function rank(records, field, opt = {}) {
    const order = opt.order || 'desc';
    const min = opt.minReserve || 0;
    const reserveOf = opt.reserveOf || ((r) => r.reserve);
    const rs = records.filter((r) => r[field] != null && !(field !== 'reserve' && reserveOf(r) === 0) && !(min > 0 && !(reserveOf(r) >= min)));
    const val = (r) => round(r[field], 4);
    rs.sort((a, b) => (order === 'desc' ? val(b) - val(a) : val(a) - val(b)));
    const ranks = new Map();
    let prev = null; let prevRank = 0;
    rs.forEach((r, i) => {
      const v = val(r);
      const rk = prev !== null && v === prev ? prevRank : i + 1;
      ranks.set(r.provider, rk);
      prev = v; prevRank = rk;
    });
    return { ranks, count: rs.length };
  }

  /** bp 차이: (a - b)% → bp */
  function bp(a, b) { return a == null || b == null ? null : Math.round((a - b) * 100); }

  /** 사업자·제도별 원리금보장+실적배당 적립금 합계와 실적배당 비중(%) */
  function providerTotals(returns, quarter, plan) {
    const m = new Map();
    for (const r of returns) {
      if (r.quarter !== quarter || (plan && plan !== 'ALL' && r.plan !== plan) || COMPONENT_TYPES.includes(r.type)) continue;
      const t = m.get(r.provider) || { provider: r.provider, sector: r.sector, reserve: 0, guaranteed: 0, performance: 0 };
      const v = r.reserve || 0;
      t.reserve += v;
      if (r.type === '실적배당') t.performance += v; else t.guaranteed += v;
      m.set(r.provider, t);
    }
    for (const t of m.values()) t.performanceShare = t.reserve > 0 ? (t.performance / t.reserve) * 100 : null;
    return [...m.values()];
  }

  return {
    SCHEMA_VERSION, SECTORS, PLANS, TYPES, DEPOSIT_TYPE, MARKET_TYPE, COMPONENT_TYPES, VIEW_TYPES, PERIODS, PERIOD_LABEL, RISKS, DO_PERIODS, SAMPLE_LABEL, KIND_LABEL,
    RETURN_FIELDS, FEE_FIELDS, DO_FIELDS, PROVIDERS, ALIASES,
    cleanName, canonicalProvider, inferSector, normalizePlan, normalizeSector, normalizeRisk, parseNumber,
    quarterId, splitQuarter, quarterLabel, baseDateLabel, baseDate, shiftQuarter, compareQuarter, detectQuarter,
    parseWorkbook, emptyDb, applyUpload, deleteQuarter, deleteFeeYear, listQuarters, isSample, feeYearFor,
    average, rank, bp, providerTotals, recordKey,
  };
});
