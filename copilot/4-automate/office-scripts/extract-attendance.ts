/**
 * extract-attendance.ts — 근태 엑셀(YYMM 월별 시트) → 일별 TO·재직인원·상담사_투입인원
 * 대상 센터: kbjeongbi · lge · lge_seongsu
 * 규칙: 1-knowledge/K3_센터별_추출규칙.md 5장 (원본: app.js attxExtractWorkbook / generateAttRangeRows)
 *
 * 매개변수
 *   centerCode   kbjeongbi | lge | lge_seongsu
 *   toValue      그 달 TO(월별TO 목록에서 흐름이 찾아 넘긴다. 0 이면 센터 기본 TO)
 *   holidaysCsv  공휴일 "2026-01-01,2026-02-16,…" (공휴일 목록에서 흐름이 만들어 넘긴다)
 *   startDate / endDate  저장 기간 YYYY-MM-DD (비우면 파일 전체)
 *   excludeCsv   저장에서 뺄 날짜 "2026-07-03,…" (선택)
 * 반환: { ok, message, dates, items[] } — 근태만 만든다
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

interface DayCount {
  counselor: number;
  manager: number;
  total: number;
}

const DEFAULT_TO: { [center: string]: number } = { 'kbjeongbi': 15, 'lge': 19, 'lge_seongsu': 35 };
const WORK_MARKS = ['○', 'ㅇ', 'O', 'o', '◯', '●'];
const KNOWN_HEADERS = ['성명', '이름', '업무', '팀', '퇴사일', '입사일', '전보일', '근무시간', '사번', 'No'];
const MANAGER_WORDS = ['관리자', '팀장', '센터장', '총괄', 'QA', '강사', 'SV', '매니저', '파트장'];

function main(workbook: ExcelScript.Workbook, centerCode: string, toValue: number, holidaysCsv: string, startDate?: string, endDate?: string, excludeCsv?: string): ExtractResult {
  const sheets = workbook.getWorksheets()
    .filter(ws => /^\d{4}$/.test(ws.getName().trim()))
    .map(ws => ({ name: ws.getName().trim(), grid: readGrid(ws) }));
  return extractAttendance(sheets, centerCode, toValue, holidaysCsv || '', startDate || '', endDate || '', excludeCsv || '');
}

// ── 순수 로직 ─────────────────────────────────────────────────

function extractAttendance(sheets: { name: string; grid: Cell[][] }[], centerCode: string, toValue: number, holidaysCsv: string,
  startDate: string, endDate: string, excludeCsv: string): ExtractResult {
  if (DEFAULT_TO[centerCode] === undefined) return fail('근태 자동추출 대상 센터가 아닙니다: ' + centerCode);
  if (!sheets.length) return fail('2607, 2606 같은 4자리 월별 시트를 찾지 못했습니다.');
  const to = toValue && toValue > 0 ? toValue : DEFAULT_TO[centerCode];
  const holidays = splitCsv(holidaysCsv);
  const excluded = splitCsv(excludeCsv);

  const byDate: { [iso: string]: DayCount } = {};
  const errors: string[] = [];
  sheets.slice().sort((a, b) => (a.name < b.name ? -1 : 1)).forEach(sh => {
    try {
      const res = analyzeSheet(sh.name, sh.grid);
      Object.keys(res).forEach(d => { byDate[d] = res[d]; });
    } catch (e) {
      errors.push(sh.name + ': ' + (e as Error).message);
    }
  });
  const allDates = Object.keys(byDate).sort();
  if (!allDates.length) return fail('분석 가능한 월별 시트가 없습니다. ' + errors.join(' / '));

  const items: MetricItem[] = [];
  const saved: string[] = [];
  let skippedZero = 0, skippedHoliday = 0, skippedExcluded = 0;
  allDates.forEach(d => {
    if (startDate && d < startDate) return;
    if (endDate && d > endDate) return;
    if (isWeekendOrHoliday(d, holidays)) { skippedHoliday++; return; }
    if (excluded.indexOf(d) >= 0) { skippedExcluded++; return; }
    const c = byDate[d];
    if (c.counselor === 0) { skippedZero++; return; }
    items.push(att(centerCode, d, 'TO', to));
    items.push(att(centerCode, d, '재직인원', c.total));
    items.push(att(centerCode, d, '상담사_투입인원', c.counselor));
    saved.push(d);
  });

  if (!saved.length) return fail('저장할 영업일이 없습니다(기간·공휴일·투입인원 0명 여부를 확인해 주세요).');
  const notes: string[] = [];
  if (skippedHoliday) notes.push('주말·공휴일 ' + skippedHoliday + '일 제외');
  if (skippedZero) notes.push('투입인원 0명 ' + skippedZero + '일 제외');
  if (skippedExcluded) notes.push('지정 제외 ' + skippedExcluded + '일');
  if (errors.length) notes.push('인식 실패 시트: ' + errors.join(' / '));
  return {
    ok: true,
    message: sheets.length + '개 월별시트 · ' + saved.length + '일 저장 (' + saved[0] + ' ~ ' + saved[saved.length - 1] + ')' + (notes.length ? ' · ' + notes.join(' · ') : ''),
    dates: saved,
    items: items,
  };
}

function analyzeSheet(name: string, aoa: Cell[][]): { [iso: string]: DayCount } {
  // 머리글 행: 알려진 머리글 ×5 + 날짜 칸 수 점수가 가장 높은 행(10점 미만이면 실패)
  let best = -1, bestScore = -1;
  for (let r = 0; r < Math.min(12, aoa.length); r++) {
    let known = 0, dates = 0;
    (aoa[r] || []).forEach(v => {
      if (KNOWN_HEADERS.indexOf(text(v).replace(/\s/g, '')) >= 0) known++;
      if (parseDate(v)) dates++;
    });
    const score = known * 5 + dates;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (best < 0 || bestScore < 10) throw new Error('머리글 행을 찾지 못했습니다(성명/업무/퇴사일/날짜 열 확인)');
  const headers = aoa[best] || [];
  const nameCol = findColumn(headers, ['성명', '이름']);
  const workCol = findColumn(headers, ['업무']);
  const teamCol = findColumn(headers, ['팀']);
  const roleCol = workCol >= 0 ? workCol : teamCol;
  const joinCol = findColumn(headers, ['입사일']);
  const retireCol = findColumn(headers, ['퇴사일']);
  if (nameCol < 0) throw new Error('성명/이름 열 없음');
  if (roleCol < 0) throw new Error('업무 또는 팀 열 없음');

  const dateCols: { col: number; iso: string }[] = [];
  headers.forEach((v, c) => { const iso = parseDate(v); if (iso) dateCols.push({ col: c, iso: iso }); });
  if (!dateCols.length) throw new Error('날짜 열 없음');

  const out: { [iso: string]: DayCount } = {};
  dateCols.forEach(dc => { out[dc.iso] = { counselor: 0, manager: 0, total: 0 }; });
  for (let r = best + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const person = text(row[nameCol]);
    if (!person || person === '성명' || person === '이름') continue;
    const isCounselor = classifyRole(row[roleCol], workCol >= 0) === '상담사';
    const join = joinCol >= 0 ? parseDate(row[joinCol]) : '';
    const retire = retireCol >= 0 ? parseDate(row[retireCol]) : '';
    dateCols.forEach(dc => {
      if (WORK_MARKS.indexOf(text(row[dc.col])) < 0) return;
      if (join && dc.iso < join) return;
      if (retire && dc.iso > retire) return;
      const rec = out[dc.iso];
      if (isCounselor) rec.counselor++; else rec.manager++;
      rec.total++;
    });
  }
  return out;
}

function classifyRole(raw: Cell, hasWorkColumn: boolean): string {
  const role = text(raw);
  if (hasWorkColumn) return role.indexOf('상담사') >= 0 ? '상담사' : '관리자';
  return MANAGER_WORDS.some(k => role.indexOf(k) >= 0) ? '관리자' : '상담사';
}
function findColumn(headers: Cell[], candidates: string[]): number {
  const nc = candidates.map(x => x.replace(/\s/g, ''));
  for (let i = 0; i < headers.length; i++) if (nc.indexOf(text(headers[i]).replace(/\s/g, '')) >= 0) return i;
  for (let i = 0; i < headers.length; i++) { const t = text(headers[i]).replace(/\s/g, ''); if (t && nc.some(c => t.indexOf(c) >= 0)) return i; }
  return -1;
}
function parseDate(v: Cell): string {
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    const iso = serialToIso(v);
    const y = Number(iso.slice(0, 4));
    return (y >= 2000 && y <= 2099) ? iso : '';
  }
  const t = text(v);
  if (!t) return '';
  let m = t.match(/(20\d{2})[-.\/년\s]+(\d{1,2})[-.\/월\s]+(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[3]));
  m = t.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return '';
}
function isWeekendOrHoliday(iso: string, holidays: string[]): boolean {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6 || holidays.indexOf(iso) >= 0;
}
function splitCsv(s: string): string[] { return s.split(',').map(x => x.trim()).filter(x => x !== ''); }
function text(v: Cell): string { return v === undefined || v === null ? '' : String(v).replace(/ /g, ' ').trim(); }
function att(center: string, date: string, key: string, value: number): MetricItem {
  return { CenterCode: center, ReportDate: date, MetricGroup: '근태', MetricKey: key, Value: value, RawValue: String(value) };
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
function serialToIso(serial: number): string {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
}
function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }
function fail(message: string): ExtractResult { return { ok: false, message: message, dates: [], items: [] }; }
