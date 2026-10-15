/**
 * extract-kb-sonhae.ts — KB손보부천 일별 실적 엑셀 → 일별실적 항목 목록
 * 규칙: 1-knowledge/K3_센터별_추출규칙.md 1장 (원본: app.js xlsxExtractDaily / XLSX_FIELDS_KBSONHAE)
 *
 * Power Automate "스크립트 실행" 매개변수
 *   year       파일 연도(날짜가 "7/14"처럼 연도 없이 적힌 경우에 쓴다)
 *   startDate  추출 시작일 YYYY-MM-DD (비우면 파일 전체)
 *   endDate    추출 종료일 YYYY-MM-DD (비우면 파일 전체)
 *   groupFilter  "전체" | "근태" | "실적" — 한쪽만 저장할 때
 * 반환: { ok, message, dates, items[] } — items 한 개가 일별실적 목록 한 행
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

interface FieldDef {
  key: string;
  group: string;
  type: string;
  tokens: string[];
  nth: number;
}

const CENTER = 'kbsonhae';

// [지표키, 구분, 형식, 머리글 경로 낱말, 같은 조건 열 중 순번]
const FIELDS: FieldDef[] = [
  { key: '총원', group: '근태', type: 'num1', tokens: ['총원'], nth: 0 },
  { key: '제휴CS_소계', group: '근태', type: 'num1', tokens: ['재적인원', '제휴CS', '소계'], nth: 0 },
  { key: '장기사고_소계', group: '근태', type: 'num1', tokens: ['재적인원', '장기사고', '소계'], nth: 0 },
  { key: '투입인원_제휴상담', group: '근태', type: 'num1', tokens: ['투입인원', '제휴상담'], nth: 0 },
  { key: '투입률_제휴상담', group: '근태', type: 'pct1', tokens: ['투입인원', '제휴상담'], nth: 1 },
  { key: '투입인원_장기사고', group: '근태', type: 'num1', tokens: ['투입인원', '장기사고'], nth: 0 },
  { key: '투입률_장기사고', group: '근태', type: 'pct1', tokens: ['투입인원', '장기사고'], nth: 1 },
  { key: '기타업무_채팅상담', group: '근태', type: 'num1', tokens: ['기타업무', '채팅상담'], nth: 0 },
  { key: '기타업무_지원업무', group: '근태', type: 'num1', tokens: ['기타업무', '지원업무'], nth: 0 },
  { key: '기타업무_실효안내', group: '근태', type: 'num1', tokens: ['기타업무', '실효안내'], nth: 0 },
  { key: '관리자_팀장', group: '근태', type: 'num1', tokens: ['관리자', '팀장'], nth: 0 },
  { key: '관리자_특화', group: '근태', type: 'num1', tokens: ['관리자', '특화'], nth: 0 },
  { key: '관리자_QA', group: '근태', type: 'num1', tokens: ['관리자', 'QA'], nth: 0 },
  { key: '관리자_소계', group: '근태', type: 'num1', tokens: ['관리자', '소계'], nth: 0 },
  { key: '교육생_소계', group: '근태', type: 'num1', tokens: ['교육생', '소계'], nth: 0 },
  { key: '제외_보유계약', group: '근태', type: 'num1', tokens: ['제외', '보유계약'], nth: 0 },
  { key: '제휴상담_인입호', group: '실적', type: 'int', tokens: ['Call현황', '제휴상담', '인입호'], nth: 0 },
  { key: '제휴상담_응답호', group: '실적', type: 'int', tokens: ['Call현황', '제휴상담', '응답호'], nth: 0 },
  { key: '제휴상담_손사지원', group: '실적', type: 'int', tokens: ['Call현황', '제휴상담', '손사지원'], nth: 0 },
  { key: '제휴상담_OutCall', group: '실적', type: 'int', tokens: ['Call현황', '제휴상담', 'OutCall'], nth: 0 },
  { key: '제휴상담_콜백', group: '실적', type: 'int', tokens: ['Call현황', '제휴상담', '콜백'], nth: 0 },
  { key: '제휴상담_응답율', group: '실적', type: 'pct1', tokens: ['Call현황', '제휴상담', '응답율'], nth: 0 },
  { key: '제휴상담_CPD', group: '실적', type: 'num1', tokens: ['Call현황', '제휴상담', 'CPD'], nth: 0 },
  { key: '제휴상담_SL', group: '실적', type: 'num1', tokens: ['Call현황', '제휴상담', 'S.L'], nth: 0 },
  { key: '장기손사_인입호', group: '실적', type: 'int', tokens: ['Call현황', '장기손사', 'Total', '인입호'], nth: 0 },
  { key: '장기손사_응답호', group: '실적', type: 'int', tokens: ['Call현황', '장기손사', 'Total', '응답호'], nth: 0 },
  { key: '장기손사_OutCall', group: '실적', type: 'int', tokens: ['Call현황', '장기손사', 'Total', 'OutCall'], nth: 0 },
  { key: '장기손사_콜백', group: '실적', type: 'int', tokens: ['Call현황', '장기손사', 'Total', '콜백'], nth: 0 },
  { key: '장기손사_응답율', group: '실적', type: 'pct1', tokens: ['Call현황', '장기손사', 'Total', '응답율'], nth: 0 },
  { key: '장기손사_CPD', group: '실적', type: 'num1', tokens: ['Call현황', '장기손사', 'Total', 'CPD'], nth: 0 },
  { key: '장기손사_SL', group: '실적', type: 'num1', tokens: ['Call현황', '장기손사', 'Total', 'S.L'], nth: 0 },
];

function main(workbook: ExcelScript.Workbook, year: number, startDate?: string, endDate?: string, groupFilter?: string): ExtractResult {
  const grids: Cell[][][] = workbook.getWorksheets().map(ws => readGrid(ws));
  return extractKbSonhae(grids, year, startDate || '', endDate || '', groupFilter || '전체');
}

// ── 순수 로직(엑셀 없이 시험 가능) ───────────────────────────────

function extractKbSonhae(grids: Cell[][][], year: number, startDate: string, endDate: string, groupFilter: string): ExtractResult {
  if (startDate && endDate && startDate > endDate) return fail('추출 시작일이 종료일보다 늦습니다.');
  const items: MetricItem[] = [];
  const dateSet: { [d: string]: boolean } = {};

  grids.forEach(grid => {
    const maxRow = grid.length;
    let maxCol = 0;
    grid.forEach(r => { if (r.length > maxCol) maxCol = r.length; });

    // 1) 머리글 행: 위 12행 안에서 "일자" + "Call"(또는 "콜")
    let hdr = -1;
    for (let r = 0; r < Math.min(maxRow, 12) && hdr < 0; r++) {
      const text = (grid[r] || []).map(v => String(v).replace(/[\n\r]/g, '')).join(' ');
      if (text.indexOf('일자') >= 0 && (text.indexOf('Call') >= 0 || text.indexOf('콜') >= 0)) hdr = r;
    }
    if (hdr < 0) return;

    // 2) "출근현황" 요약박스가 시작되는 행 위까지만
    let lastRow = maxRow - 1;
    for (let r = hdr + 1; r < maxRow; r++) {
      if ((grid[r] || []).some(v => clean(v).indexOf('출근현황') >= 0)) { lastRow = r - 1; break; }
    }

    // 3) 열별 머리글 경로(3단)
    const paths: { [c: number]: string } = {};
    for (let c = 0; c < maxCol; c++) {
      const parts: string[] = [];
      for (let r = hdr; r <= hdr + 2; r++) {
        const v = cellAt(grid, r, c);
        if (!isBlank(v)) parts.push(clean(v));
      }
      const joined = parts.join('|');
      if (joined.indexOf('출근') >= 0) continue;
      paths[c] = joined;
    }
    const findCols = (tokens: string[]): number[] =>
      Object.keys(paths).map(k => Number(k)).filter(c => tokens.every(t => paths[c].indexOf(clean(t)) >= 0)).sort((a, b) => a - b);

    // 4) 날짜 열: "일자" 열 중 날짜 일련번호가 가장 많은 열
    const dateCands = findCols(['일자']);
    let dateCol = -1, bestScore = -1;
    dateCands.forEach(c => {
      let score = 0;
      for (let r = hdr + 3; r <= lastRow; r++) if (isDateSerial(cellAt(grid, r, c))) score++;
      if (score > bestScore) { bestScore = score; dateCol = c; }
    });
    if (dateCol < 0) return;

    const colOf: { [key: string]: number } = {};
    FIELDS.forEach(f => { const cols = findCols(f.tokens); colOf[f.key] = cols.length > f.nth ? cols[f.nth] : -1; });

    // 5) 데이터 행
    for (let r = hdr + 3; r <= lastRow; r++) {
      const dv = cellAt(grid, r, dateCol);
      if (['합계', '평균'].indexOf(String(dv).trim()) >= 0) continue;
      const iso = toIsoDate(dv, year);
      if (!iso) continue;
      if (startDate && iso < startDate) continue;
      if (endDate && iso > endDate) continue;
      const csIn = colOf['제휴상담_인입호'] >= 0 ? cellAt(grid, r, colOf['제휴상담_인입호']) : '';
      const ltIn = colOf['장기손사_인입호'] >= 0 ? cellAt(grid, r, colOf['장기손사_인입호']) : '';
      if (isBlankOrZero(csIn) && isBlankOrZero(ltIn)) continue;

      FIELDS.forEach(f => {
        if (groupFilter !== '전체' && f.group !== groupFilter) return;
        const c = colOf[f.key];
        if (c < 0) return;
        const raw = cellAt(grid, r, c);
        if (isBlank(raw)) return;
        const fmt = formatValue(raw, f.type);
        items.push({ CenterCode: CENTER, ReportDate: iso, MetricGroup: f.group, MetricKey: f.key, Value: fmt.value, RawValue: fmt.raw });
      });
      dateSet[iso] = true;
    }
  });

  const dates = Object.keys(dateSet).sort();
  if (!dates.length) return fail('일자별 데이터를 찾지 못했습니다. 머리글(일자·Call현황) 양식이 바뀌었는지 확인해 주세요.');
  return { ok: true, message: dates.length + '일치 추출 (' + dates[0] + ' ~ ' + dates[dates.length - 1] + ')', dates: dates, items: items };
}

function formatValue(v: Cell, type: string): { value: number | null; raw: string } {
  const n = Number(v);
  if (typeof v === 'boolean' || !isFinite(n)) return { value: null, raw: String(v) };
  if (type === 'pct1') { const p = Math.round(n * 1000) / 10; return { value: p, raw: p.toFixed(1) + '%' }; }
  if (type === 'int') { const i = Math.round(n); return { value: i, raw: i.toLocaleString('en-US') }; }
  const d = Math.round(n * 10) / 10;
  return { value: d, raw: String(d) };
}

// ── 공통 도우미(스크립트마다 같은 내용을 둔다 — Office Scripts는 다른 파일을 불러올 수 없다) ──

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
  // 병합 셀 풀기: 왼쪽 위 칸 값을 병합 범위 전체에 채운다(여러 단 머리글 경로를 만들기 위해 필요)
  const merged = used.getMergedAreasOrNullObject();
  if (merged) {
    merged.getAreas().forEach(area => {
      const ar = area.getRowIndex(), ac = area.getColumnIndex();
      const rows = area.getRowCount(), cols = area.getColumnCount();
      const top = cellAt(grid, ar, ac);
      for (let r = ar; r < ar + rows; r++) {
        while (grid.length <= r) grid.push([]);
        for (let c = ac; c < ac + cols; c++) {
          while (grid[r].length <= c) grid[r].push('');
          grid[r][c] = top;
        }
      }
    });
  }
  return grid;
}

function cellAt(grid: Cell[][], r: number, c: number): Cell {
  const row = grid[r];
  if (!row || c >= row.length) return '';
  const v = row[c];
  return v === null || v === undefined ? '' : v;
}
function clean(v: Cell): string { return String(v).replace(/[\n\r\s_]/g, '').trim(); }
function isBlank(v: Cell): boolean { return String(v).trim() === ''; }
function isBlankOrZero(v: Cell): boolean { return isBlank(v) || Number(v) === 0; }
function isDateSerial(v: Cell): boolean { return typeof v === 'number' && v > 40000 && v < 60000; }
function serialToIso(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return d.toISOString().slice(0, 10);
}
function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }
function toIsoDate(v: Cell, year: number): string {
  if (isDateSerial(v)) return serialToIso(v as number);
  const s = String(v).trim();
  let m = s.match(/^(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[3]));
  m = s.match(/(\d{1,2})\s*[\/.-]\s*(\d{1,2})/);
  if (m && year) return year + '-' + pad2(Number(m[1])) + '-' + pad2(Number(m[2]));
  return '';
}
function fail(message: string): ExtractResult { return { ok: false, message: message, dates: [], items: [] }; }
