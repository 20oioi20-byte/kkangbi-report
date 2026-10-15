/**
 * extract-lge-summary.ts — LG전자AS / LG전자성수기 summary 시트 → 일별 T-NPS·생산성·통화시간
 * 규칙: 1-knowledge/K3_센터별_추출규칙.md 3장 (원본: app.js lgexExtract)
 *
 * 매개변수
 *   centerCode  "lge"(상시 Total) | "lge_seongsu"(한시 Total)
 *   year        날짜가 "7/14"처럼 연도 없이 적힌 경우 쓸 연도
 *   startDate / endDate  추출 기간 YYYY-MM-DD (비우면 파일 전체)
 * 반환: { ok, message, dates, items[] }
 */

type Cell = string | number | boolean;

interface MetricItem {
  CenterCode: string;
  ReportDate: string;
  MetricGroup: string;
  MetricKey: string;
  Value: number | null;
  RawValue: string;
}

interface ExtractResult {
  ok: boolean;
  message: string;
  dates: string[];
  items: MetricItem[];
}

interface Target {
  key: string;
  aliases: string[];
  kind: string;
}

const TARGETS: Target[] = [
  { key: 'TNPS', aliases: ['T-NPS', 'TNPS'], kind: 'num' },
  { key: '생산성_INOUT', aliases: ['생산성 (IN+OUT)', '생산성(IN+OUT)', '생산성 IN+OUT'], kind: 'num' },
  { key: '생산성_IN', aliases: ['생산성 (IN)', '생산성(IN)', '생산성 IN'], kind: 'num' },
  { key: '통화시간_INOUT', aliases: ['통화시간 (IN+OUT)', '통화시간(IN+OUT)', '통화시간 IN+OUT'], kind: 'time' },
];

const GROUPS: { [center: string]: { target: string; others: string[] } } = {
  'lge': { target: '상시', others: ['한시'] },
  'lge_seongsu': { target: '한시', others: ['상시'] },
};

function main(workbook: ExcelScript.Workbook, centerCode: string, year: number, startDate?: string, endDate?: string): ExtractResult {
  const sheets = workbook.getWorksheets();
  const names = sheets.map(ws => ws.getName());
  const name = pickSheetName(names);
  const ws = workbook.getWorksheet(name);
  if (!ws) return fail('summary 시트를 찾지 못했습니다.');
  return extractLge(readGrid(ws), centerCode, year, startDate || '', endDate || '', name);
}

// ── 순수 로직 ─────────────────────────────────────────────────

function pickSheetName(names: string[]): string {
  const exact = names.filter(n => normalize(n) === 'SUMMARY')[0];
  if (exact) return exact;
  const inc = names.filter(n => normalize(n).indexOf('SUMMARY') >= 0)[0];
  return inc || names[0];
}

function extractLge(aoa: Cell[][], centerCode: string, year: number, startDate: string, endDate: string, sheetName: string): ExtractResult {
  const grp = GROUPS[centerCode];
  if (!grp) return fail('센터코드는 lge 또는 lge_seongsu 이어야 합니다: ' + centerCode);
  if (startDate && endDate && startDate > endDate) return fail('추출 시작일이 종료일보다 늦습니다.');

  // 1) 날짜 머리글 행: 위 45행 중 날짜 칸이 가장 많은 행
  let bestRow = -1;
  let bestCols: { col: number; iso: string }[] = [];
  for (let r = 0; r < Math.min(45, aoa.length); r++) {
    const cols: { col: number; iso: string }[] = [];
    (aoa[r] || []).forEach((v, c) => { const iso = parseDate(v, year); if (iso) cols.push({ col: c, iso: iso }); });
    if (cols.length > bestCols.length) { bestRow = r; bestCols = cols; }
  }
  if (bestRow < 0) return fail('날짜 머리글을 찾지 못했습니다. summary 시트 상단 날짜 형식을 확인해 주세요.');
  const firstDateCol = Math.min(...bestCols.map(x => x.col));
  const leftLimit = Math.max(6, Math.min(firstDateCol, 16));

  // 2) 항목별 대상 행
  const rowOf: { [key: string]: number } = {};
  const missing: string[] = [];
  TARGETS.forEach(t => {
    const r = findTargetRow(aoa, t, leftLimit, grp.target, grp.others);
    rowOf[t.key] = r;
    if (r < 0) missing.push(t.aliases[0]);
  });
  if (missing.length) return fail(grp.target + ' Total 행을 찾지 못한 항목: ' + missing.join(', ') + ' (탐색 범위: 날짜 시작열 앞 ' + leftLimit + '열)');

  // 3) 날짜별 값
  const items: MetricItem[] = [];
  const dates: string[] = [];
  bestCols.slice().sort((a, b) => (a.iso < b.iso ? -1 : 1)).forEach(dc => {
    if (startDate && dc.iso < startDate) return;
    if (endDate && dc.iso > endDate) return;
    const raws = TARGETS.map(t => cellAt(aoa, rowOf[t.key], dc.col));
    if (!raws.some(v => meaningful(v))) return;
    TARGETS.forEach((t, i) => {
      const raw = raws[i];
      if (isBlank(raw) || isErrorOrFormula(raw)) return;
      if (t.kind === 'time') {
        const sec = toSeconds(raw);
        if (sec === null) return;
        items.push(item(centerCode, dc.iso, t.key, sec, formatHms(sec)));
      } else {
        const n = toNumber(raw);
        if (n === null) return;
        const txt = n.toFixed(1); // 원본(app.js lgexFormatNumber)과 같은 반올림을 쓴다
        items.push(item(centerCode, dc.iso, t.key, Number(txt), txt));
      }
    });
    dates.push(dc.iso);
  });

  if (!dates.length) return fail('값이 있는 날짜가 없습니다(기간 설정을 확인해 주세요).');
  return { ok: true, message: sheetName + ' 시트 ' + grp.target + ' Total · ' + dates.length + '일치 (' + dates[0] + ' ~ ' + dates[dates.length - 1] + ')', dates: dates, items: items };
}

function findTargetRow(aoa: Cell[][], target: Target, leftLimit: number, group: string, others: string[]): number {
  const starts: number[] = [];
  for (let r = 0; r < aoa.length; r++) if (rowMatchesTarget(aoa[r] || [], target, leftLimit)) starts.push(r);
  for (const start of starts) {
    let end = aoa.length;
    for (let r = start + 1; r < aoa.length; r++) if (TARGETS.some(t => rowMatchesTarget(aoa[r] || [], t, leftLimit))) { end = r; break; }

    let seen = false, seenRow = -1;
    for (let r = start; r < end; r++) {
      const row = aoa[r] || [];
      const hasGroup = rowHasWord(row, group, leftLimit);
      const hasTotal = rowHasWord(row, 'Total', leftLimit);
      const hasOther = others.some(g => rowHasWord(row, g, leftLimit));
      if (hasGroup && hasTotal) return r;
      if (hasGroup) { seen = true; seenRow = r; }
      if (seen && r > seenRow && hasTotal) return r;
      if (seen && hasOther) break;
    }
    // 그룹 이름이 없으면: 다른 그룹 이전의 마지막 Total 행
    let fallback = -1;
    for (let r = start; r < end; r++) {
      const row = aoa[r] || [];
      if (others.some(g => rowHasWord(row, g, leftLimit))) break;
      if (rowHasWord(row, 'Total', leftLimit)) fallback = r;
    }
    if (fallback >= 0) return fallback;
  }
  return -1;
}

function rowMatchesTarget(row: Cell[], target: Target, limit: number): boolean {
  for (let c = 0; c < Math.min(limit, row.length); c++) {
    const nv = normalize(row[c]);
    if (nv && target.aliases.some(a => normalize(a) === nv)) return true;
  }
  return false;
}
function rowHasWord(row: Cell[], word: string, limit: number): boolean {
  const nw = normalize(word);
  for (let c = 0; c < Math.min(limit, row.length); c++) {
    const cell = normalize(row[c]);
    if (cell === nw) return true;
    if (nw.length >= 2 && cell.indexOf(nw) >= 0) return true;
  }
  return false;
}
function normalize(v: Cell): string {
  return String(v).replace(/ /g, ' ').replace(/（/g, '(').replace(/）/g, ')').replace(/[–—]/g, '-').trim().toUpperCase().replace(/\s+/g, '');
}
function isErrorOrFormula(v: Cell): boolean { return typeof v === 'string' && (/^#/.test(v.trim()) || v.trim().indexOf('=') === 0); }
function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string' || isErrorOrFormula(v)) return null;
  const s = v.replace(/,/g, '').replace(/%/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function meaningful(v: Cell): boolean {
  if (isBlank(v) || isErrorOrFormula(v)) return false;
  const n = toNumber(v);
  if (n === null) return String(v).trim() !== '';
  return n !== 0;
}
// 엑셀 시간값(하루=1)이면 ×86400, 이미 H:MM:SS 글자면 그대로, 그 밖의 숫자는 초로 본다
function toSeconds(v: Cell): number | null {
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  const n = toNumber(v);
  if (n === null) return null;
  return (n > 0 && n < 1.5) ? Math.round(n * 86400) : Math.round(n);
}
function formatHms(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h + ':' + pad2(m) + ':' + pad2(s);
}
function parseDate(v: Cell, year: number): string {
  if (typeof v === 'number') return (v >= 20000 && v <= 60000) ? serialToIso(v) : '';
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return serialToIso(Number(s));
  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/);
  if (m) return m[1] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[3]));
  m = s.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (m && year) return year + '-' + pad2(Number(m[1])) + '-' + pad2(Number(m[2]));
  return '';
}
function item(center: string, date: string, key: string, value: number, raw: string): MetricItem {
  return { CenterCode: center, ReportDate: date, MetricGroup: '실적', MetricKey: key, Value: value, RawValue: raw };
}

// ── 공통 도우미 ───────────────────────────────────────────────

function readGrid(ws: ExcelScript.Worksheet): Cell[][] {
  const used = ws.getUsedRange(true);
  if (!used) return [];
  const r0 = used.getRowIndex(), c0 = used.getColumnIndex();
  const values = used.getValues() as Cell[][];
  const grid: Cell[][] = [];
  for (let r = 0; r < r0; r++) grid.push([]);
  values.forEach(row => {
    const padded: Cell[] = [];
    for (let c = 0; c < c0; c++) padded.push('');
    grid.push(padded.concat(row));
  });
  return grid;
}
function cellAt(grid: Cell[][], r: number, c: number): Cell {
  if (r < 0 || c < 0) return '';
  const row = grid[r];
  if (!row || c >= row.length) return '';
  const v = row[c];
  return v === null || v === undefined ? '' : v;
}
function isBlank(v: Cell): boolean { return String(v).trim() === ''; }
function serialToIso(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  return d.toISOString().slice(0, 10);
}
function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }
function fail(message: string): ExtractResult { return { ok: false, message: message, dates: [], items: [] }; }
