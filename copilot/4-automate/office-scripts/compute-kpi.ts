/**
 * compute-kpi.ts — 일별실적 행 → 기간별 핵심지표(일평균·합계·비율·TO 대비·목표 판정·전월比·전년동월比)
 * 규칙: 1-knowledge/K4_KPI_계산식.md (원본: app.js avgMetricValue / getAvgForDef / computeCenterHeadline)
 *
 * 에이전트(LLM)가 숫자를 직접 계산하지 않도록, 모든 계산은 이 스크립트가 한다.
 * 엑셀 통합문서는 쓰지 않는다 — 실행용 빈 통합문서(kpi-runner.xlsx)를 지정한다.
 *
 * 매개변수
 *   centerCode   센터코드
 *   startDate / endDate  조회 기간 YYYY-MM-DD
 *   rowsJson     일별실적 행 JSON 배열 [{ "d":"2026-07-01", "k":"제휴상담_인입호", "v":3200 }, …]
 *                → 흐름이 (전년 같은 기간 시작 ~ endDate) 범위를 가져와 넘긴다(전월比·전년동월比·연초누적 계산용)
 *   holidaysCsv  공휴일 "2026-01-01,…"
 *   targetsJson  KPI목표 행 JSON [{ "k":"제휴상담_SL", "label":"제휴SL", "ym":"기본"|"2026-07", "t":80, "o":1 }, …] (없으면 "[]")
 *   toTotal      그 달 TO 합계(월별TO 관리자+상담사, 없으면 센터 전체정원, 모르면 0)
 * 반환: KpiResult (아래 interface)
 */

interface InRow { d: string; k: string; v: number | null; }
interface TargetRow { k: string; label: string; ym: string; t: number | null; o: number; }

interface MetricDef { label: string; type: string; key: string; att: boolean; }

interface MetricOut {
  label: string;
  key: string;
  type: string;
  value: number | null;
  display: string;
  sum: number | null;
  cumulative: number | null;
  prevMonth: number | null;
  prevYear: number | null;
  momText: string;
  yoyText: string;
  target: number | null;
  targetDisplay: string;
  judged: string;
}

interface KpiResult {
  ok: boolean;
  message: string;
  center: string;
  start: string;
  end: string;
  workdays: number;
  dataDays: number;
  missingWorkdays: string[];
  staffText: string;
  warnings: string[];
  metrics: MetricOut[];
}

type DayMap = { [key: string]: number };

const KPI_DEFS: { [center: string]: MetricDef[] } = {
  'kbsonhae': [
    { label: '재직인원', type: 'staff', key: '총원', att: true },
    { label: '제휴인원', type: 'people', key: '제휴CS_소계', att: true },
    { label: '제휴인입호', type: 'count', key: '제휴상담_인입호', att: false },
    { label: '제휴SL', type: 'rate', key: '제휴상담_SL', att: false },
    { label: '손사인원', type: 'people', key: '장기사고_소계', att: true },
    { label: '손사인입호', type: 'count', key: '장기손사_인입호', att: false },
    { label: '손사SL', type: 'rate', key: '장기손사_SL', att: false },
  ],
  'pyeongtaek': [
    { label: '재직인원', type: 'people', key: '재직인원', att: true },
    { label: '상담사투입인원', type: 'staff', key: '투입인원', att: true },
    { label: '요청호', type: 'count', key: '요청호', att: false },
    { label: '응답호', type: 'count', key: '응답호', att: false },
    { label: '응대율', type: 'rate', key: '응대율', att: false },
    { label: '포기호', type: 'count', key: '포기호', att: false },
    { label: 'CPD', type: 'number', key: 'CPD', att: false },
  ],
  'kbjeongbi': [
    { label: '재직인원', type: 'staff', key: '재직인원', att: true },
    { label: '투입인원', type: 'people', key: '상담사_투입인원', att: true },
    { label: '총 접수건', type: 'count', key: '통합_접수', att: false },
    { label: '고지 접수건', type: 'count', key: '접수_고지의무', att: false },
    { label: '통지 접수건', type: 'count', key: '접수_통지의무', att: false },
    { label: '목적물 접수건', type: 'count', key: '접수_목적물소멸', att: false },
    { label: '통합 처리율', type: 'rate', key: '통합_처리율', att: false },
    { label: '고지의무 준수율', type: 'rate', key: '고지의무_준수율', att: false },
    { label: '통지의무 준수율', type: 'rate', key: '통지의무_준수율', att: false },
  ],
  'lge': [
    { label: '전체재직인원(TO대비)', type: 'staff', key: '재직인원', att: true },
    { label: 'T-NPS', type: 'number', key: 'TNPS', att: false },
    { label: '생산성(IN+OUT)', type: 'number', key: '생산성_INOUT', att: false },
    { label: '생산성(IN)', type: 'number', key: '생산성_IN', att: false },
    { label: '생산성(OUT)', type: 'number', key: '생산성_OUT_only', att: false },
    { label: '통화시간(IN+OUT)', type: 'duration', key: '통화시간_INOUT', att: false },
  ],
  'lge_total': [
    { label: '재직인원', type: 'staff', key: '총재직인원_합계', att: true },
    { label: '투입인원', type: 'people', key: '상담사투입인원_합계', att: true },
    { label: 'T-NPS', type: 'number', key: 'TNPS', att: false },
    { label: '생산성(IN+OUT)', type: 'number', key: '생산성_INOUT', att: false },
    { label: '생산성(IN)', type: 'number', key: '생산성_IN', att: false },
    { label: '생산성(OUT)', type: 'number', key: '생산성_OUT_only', att: false },
    { label: '통화시간', type: 'duration', key: '통화시간_INOUT_초', att: false },
  ],
};
KPI_DEFS['lge_seongsu'] = KPI_DEFS['lge'];

// 기간 전체 Σ분자 ÷ Σ분모 로 계산하는 비율(영업일만 합산)
const RATIO_DEFS: { [center: string]: { [key: string]: { num: string[]; den: string[] } } } = {
  'kbjeongbi': {
    '고지의무_처리율': { num: ['처리_고지의무'], den: ['접수_고지의무'] },
    '통지의무_처리율': { num: ['처리_통지의무'], den: ['접수_통지의무'] },
    '목적물소멸_처리율': { num: ['처리_목적물소멸'], den: ['접수_목적물소멸'] },
    '통합_처리율': { num: ['처리_고지의무', '처리_통지의무', '처리_목적물소멸'], den: ['접수_고지의무', '접수_통지의무', '접수_목적물소멸'] },
    '고지의무_준수율': { num: ['고지의무_변경기한일_처리건'], den: ['고지의무_변경기한일_처리건', '고지의무_변경기한일_미처리건'] },
    '통지의무_준수율': { num: ['통지의무_변경기한일_처리건'], den: ['통지의무_변경기한일_처리건', '통지의무_변경기한일_미처리건'] },
  },
};

// LG전자통합: 조회할 때마다 두 부분을 더하는 합계(둘 다 없으면 값 없음)
const LIVE_SUMS: { [key: string]: string[] } = {
  'TO_합계': ['TO_AS', 'TO_성수기'],
  '총재직인원_합계': ['총재직인원_AS', '총재직인원_성수기'],
  '상담사투입인원_합계': ['상담사투입인원_AS', '상담사투입인원_성수기'],
};
const LGE_TOTAL_MONTHLY_KEYS = ['TNPS', '생산성_INOUT', '생산성_IN', '통화시간_INOUT_초'];
// 낮을수록 좋은 지표(목표 판정 방향)
const LOWER_IS_BETTER = ['포기호', '통화시간_INOUT', '통화시간_INOUT_초'];

function main(workbook: ExcelScript.Workbook, centerCode: string, startDate: string, endDate: string, rowsJson: string,
  holidaysCsv: string, targetsJson: string, toTotal: number): KpiResult {
  const rows = JSON.parse(rowsJson || '[]') as InRow[];
  const targets = JSON.parse(targetsJson || '[]') as TargetRow[];
  return computeKpi(centerCode, startDate, endDate, rows, holidaysCsv || '', targets, toTotal || 0);
}

// ── 순수 로직 ─────────────────────────────────────────────────

function computeKpi(center: string, start: string, end: string, inRows: InRow[], holidaysCsv: string, targets: TargetRow[], toTotal: number): KpiResult {
  const holidays = holidaysCsv.split(',').map(x => x.trim()).filter(x => x !== '');
  const empty: KpiResult = { ok: false, message: '', center: center, start: start, end: end, workdays: 0, dataDays: 0, missingWorkdays: [], staffText: '', warnings: [], metrics: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) { empty.message = '기간 형식이 잘못되었습니다(YYYY-MM-DD, 시작 ≤ 종료).'; return empty; }

  // 날짜별 묶기
  const byDate: { [d: string]: DayMap } = {};
  inRows.forEach(r => {
    if (!r || !r.d || !r.k || r.v === null || r.v === undefined || isNaN(Number(r.v))) return;
    const d = String(r.d).slice(0, 10);
    if (!byDate[d]) byDate[d] = {};
    byDate[d][r.k] = Number(r.v);
  });
  const dates = Object.keys(byDate).sort();
  const inRange = (s: string, e: string) => dates.filter(d => d >= s && d <= e);
  const isOff = (d: string) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6 || holidays.indexOf(d) >= 0; };

  // 지표 하나의 일별 값
  const valueOf = (d: string, key: string): number | null => {
    const day = byDate[d];
    if (!day) return null;
    if (center === 'lge_total' && LIVE_SUMS[key]) {
      const a = day[LIVE_SUMS[key][0]], b = day[LIVE_SUMS[key][1]];
      if (a === undefined && b === undefined) return null;
      return (a || 0) + (b || 0);
    }
    if (center === 'kbjeongbi' && (key === '통합_접수' || key === '통합_처리')) {
      const p = key === '통합_접수' ? '접수_' : '처리_';
      return (day[p + '고지의무'] || 0) + (day[p + '통지의무'] || 0) + (day[p + '목적물소멸'] || 0);
    }
    if (key === '생산성_OUT_only') {
      const t = day['생산성_INOUT'], i = day['생산성_IN'];
      return (t === undefined || i === undefined) ? null : Math.max(0, t - i);
    }
    return day[key] === undefined ? null : day[key];
  };

  const workdayAvg = (ds: string[], key: string): number | null => {
    const nums = ds.filter(d => !isOff(d)).map(d => valueOf(d, key)).filter(v => v !== null) as number[];
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };
  const monthlyAvg = (ds: string[], key: string): number | null => {
    const months: { [ym: string]: boolean } = {};
    ds.forEach(d => { months[d.slice(0, 7)] = true; });
    const vals = Object.keys(months).map(ym => { const day = byDate[ym + '-01']; const v = day ? day[key + '_월평균'] : undefined; return v === undefined ? null : v; })
      .filter(v => v !== null) as number[];
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  // 원본 avgMetricValue 와 같은 분기
  const avgOf = (ds: string[], key: string): number | null => {
    if (center === 'lge_total') {
      if (LGE_TOTAL_MONTHLY_KEYS.indexOf(key) >= 0) return monthlyAvg(ds, key);
      if (key === '생산성_OUT_only') {
        const t = monthlyAvg(ds, '생산성_INOUT'), i = monthlyAvg(ds, '생산성_IN');
        return (t !== null && i !== null) ? Math.max(0, t - i) : null;
      }
    }
    const rd = RATIO_DEFS[center] && RATIO_DEFS[center][key];
    if (rd) {
      let num = 0, den = 0;
      ds.filter(d => !isOff(d)).forEach(d => {
        rd.num.forEach(k => { const v = valueOf(d, k); if (v !== null) num += v; });
        rd.den.forEach(k => { const v = valueOf(d, k); if (v !== null) den += v; });
      });
      return den > 0 ? num / den * 100 : null;
    }
    return workdayAvg(ds, key);
  };
  const sumOf = (ds: string[], key: string): number | null => {
    const vals = ds.map(d => valueOf(d, key)).filter(v => v !== null) as number[];
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  // 기간
  const mainDays = inRange(start, end);
  const pm = shiftRange(start, end, -1), py = shiftRange(start, end, -12);
  const cumStart = end.slice(0, 4) + '-01-01';
  const workdays = enumerate(start, end).filter(d => !isOff(d));
  const missing = workdays.filter(d => !byDate[d]);

  // 목표: 종료일이 속한 달 → 기본
  const ym = end.slice(0, 7);
  const targetFor = (key: string): number | null => {
    const m = targets.filter(t => t.k === key && t.ym === ym)[0] || targets.filter(t => t.k === key && t.ym === '기본')[0];
    return m && m.t !== null && m.t !== undefined ? Number(m.t) : null;
  };

  // 지표 목록: KPI목표에 등록된 지표가 있으면 그 지표(정렬순서), 없으면 센터 기본 세트
  const registered: { [k: string]: TargetRow } = {};
  targets.slice().sort((a, b) => (a.o || 0) - (b.o || 0)).forEach(t => { if (!registered[t.k]) registered[t.k] = t; });
  const base = KPI_DEFS[center] || [];
  const defs: MetricDef[] = Object.keys(registered).length
    ? Object.keys(registered).map(k => base.filter(b => b.key === k)[0] || { label: registered[k].label || k, type: guessType(k), key: k, att: false })
    : base;
  if (!defs.length) { empty.message = '이 센터의 지표 정의가 없습니다: ' + center; return empty; }

  const warnings: string[] = [];
  const metrics: MetricOut[] = defs.map(def => {
    const value = avgOf(mainDays, def.key);
    const cumulative = avgOf(inRange(cumStart, end), def.key);
    const prevMonth = avgOf(inRange(pm.start, pm.end), def.key);
    const prevYear = avgOf(inRange(py.start, py.end), def.key);
    const target = targetFor(def.key);
    const lower = LOWER_IS_BETTER.indexOf(def.key) >= 0;
    let judged = '목표 없음';
    if (target !== null && cumulative !== null) {
      const okv = lower ? cumulative <= target : cumulative >= target;
      judged = okv ? '달성' : '미달';
      if (!okv) warnings.push(def.label + ': 누적 ' + fmt(def.type, cumulative, toTotal) + ' / 목표 ' + fmt(def.type, target, 0));
    }
    return {
      label: def.label,
      key: def.key,
      type: def.type,
      value: round(value),
      display: fmt(def.type, value, toTotal),
      sum: def.type === 'count' ? round(sumOf(mainDays, def.key)) : null,
      cumulative: round(cumulative),
      prevMonth: round(prevMonth),
      prevYear: round(prevYear),
      momText: diffText(def.type, value, prevMonth),
      yoyText: diffText(def.type, value, prevYear),
      target: target,
      targetDisplay: target === null ? '-' : fmt(def.type, target, 0),
      judged: judged,
    };
  });

  const staffDef = defs.filter(d => d.type === 'staff')[0];
  const staffAvg = staffDef ? avgOf(inRange(cumStart, end), staffDef.key) : null;
  const staffText = staffAvg !== null && toTotal ? staffAvg.toFixed(1) + '명 / ' + toTotal + '명 (' + (staffAvg / toTotal * 100).toFixed(0) + '%)' : '';

  return {
    ok: true,
    message: mainDays.length ? '' : '해당 기간에 입력된 데이터가 없습니다.',
    center: center, start: start, end: end,
    workdays: workdays.length,
    dataDays: mainDays.length,
    missingWorkdays: missing,
    staffText: staffText,
    warnings: warnings,
    metrics: metrics,
  };
}

function guessType(key: string): string {
  if (/율$|SL$|_비중$/.test(key)) return 'rate';
  if (/통화시간/.test(key)) return 'duration';
  if (/인원|총원|TO/.test(key)) return 'people';
  if (/호$|건$|접수|처리/.test(key)) return 'count';
  return 'number';
}
function fmt(type: string, v: number | null, toTotal: number): string {
  if (v === null) return '-';
  if (type === 'staff') return v.toFixed(1) + '명' + (toTotal ? ' (TO ' + toTotal + '명 대비 ' + (v / toTotal * 100).toFixed(1) + '%)' : '');
  if (type === 'people') return Math.round(v).toLocaleString('en-US') + '명';
  if (type === 'count') return Math.round(v).toLocaleString('en-US') + '건';
  if (type === 'number') return v.toFixed(1);
  if (type === 'duration') { const s = Math.round(v); return Math.floor(s / 3600) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60); }
  return v.toFixed(1) + '%';
}
function diffText(type: string, cur: number | null, prev: number | null): string {
  if (cur === null || prev === null) return '-';
  if (type === 'rate') { const pp = cur - prev; return (pp >= 0 ? '▲ ' : '▼ ') + Math.abs(pp).toFixed(1) + '%p'; }
  if (prev === 0) return '-';
  const pct = (cur - prev) / prev * 100;
  return (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%';
}
function round(v: number | null): number | null { return v === null ? null : Math.round(v * 100) / 100; }
function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }
function enumerate(start: string, end: string): string[] {
  const out: string[] = [];
  let t = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const e = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
  for (; t <= e; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
// 기간을 n개월 옮긴다. 말일로 끝나는 기간은 옮긴 달의 말일로 맞춘다(7/1~7/31 → 6/1~6/30)
function shiftRange(start: string, end: string, months: number): { start: string; end: string } {
  const shift = (iso: string, keepMonthEnd: boolean): string => {
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1, d = +iso.slice(8, 10);
    const target = new Date(Date.UTC(y, m + months, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    const day = keepMonthEnd ? last : Math.min(d, last);
    return target.getUTCFullYear() + '-' + pad2(target.getUTCMonth() + 1) + '-' + pad2(day);
  };
  const endIsMonthEnd = new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10) + 1)).getUTCDate() === 1;
  return { start: shift(start, false), end: shift(end, endIsMonthEnd) };
}
