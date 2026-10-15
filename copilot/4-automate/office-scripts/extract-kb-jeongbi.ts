/**
 * extract-kb-jeongbi.ts — KB손보정비 접수 RAW 엑셀(건 단위) → 일자별 접수·처리·준수 집계
 * 규칙: 1-knowledge/K3_센터별_추출규칙.md 2장 (원본: app.js extractLongContractAndFill / lcClassify / lcBuildDailyRows)
 *
 * 매개변수
 *   year       날짜가 "7/14"처럼 연도 없이 적힌 경우 쓸 연도
 *   startDate  추출 시작일 YYYY-MM-DD (비우면 파일 전체)
 *   endDate    추출 종료일 YYYY-MM-DD (비우면 파일 전체)
 * 반환: { ok, message, dates, items[] } — 실적만 만든다(근태는 extract-attendance.ts)
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

interface LcRecord {
  obligation: string;
  category: string;
  requestDate: string;
  dueDate: string;
  done: boolean;
}

const CENTER = 'kbjeongbi';
const REQUIRED_HEADERS = ['처리구분', '의무위반사항', '요청일', '완료일', '변경기한일'];
const FLAT_KEYS = ['접수_고지의무', '접수_통지의무', '접수_목적물소멸', '접수_기타', '접수_Total',
  '처리_고지의무', '처리_통지의무', '처리_목적물소멸', '처리_기타', '처리_Total',
  '고지의무_변경기한일_대상건', '고지의무_변경기한일_처리건', '고지의무_변경기한일_미처리건',
  '통지의무_변경기한일_대상건', '통지의무_변경기한일_처리건', '통지의무_변경기한일_미처리건'];

function main(workbook: ExcelScript.Workbook, year: number, startDate?: string, endDate?: string): ExtractResult {
  const sheets = workbook.getWorksheets().map(ws => ({ name: ws.getName(), grid: readGrid(ws) }));
  return extractKbJeongbi(sheets, year, startDate || '', endDate || '');
}

// ── 순수 로직 ─────────────────────────────────────────────────

function extractKbJeongbi(sheets: { name: string; grid: Cell[][] }[], year: number, startDate: string, endDate: string): ExtractResult {
  if (startDate && endDate && startDate > endDate) return fail('추출 시작일이 종료일보다 늦습니다.');
  const records: LcRecord[] = [];
  const usedSheets: string[] = [];

  sheets.forEach(sh => {
    const grid = sh.grid;
    const hdr = findHeaderRow(grid);
    if (hdr < 0) return;
    usedSheets.push(sh.name);
    const header = (grid[hdr] || []).map(v => cleanHeader(v));
    const col = (label: string): number => header.indexOf(cleanHeader(label));
    const cObl = col('의무위반사항'), cProc = col('처리구분'), cReq = col('요청일'), cDone = col('완료일'), cDue = col('변경기한일');

    for (let r = hdr + 1; r < grid.length; r++) {
      const obligation = String(cellAt(grid, r, cObl)).trim();
      const process = String(cellAt(grid, r, cProc)).trim();
      // 여러 조회결과를 이어붙인 파일은 중간에 머리글 행이 다시 끼어 있다 — 건너뛴다
      if (cleanHeader(obligation) === '의무위반사항' || cleanHeader(process) === '처리구분') continue;
      const requestDate = toDateKey(cellAt(grid, r, cReq), year);
      const dueDate = toDateKey(cellAt(grid, r, cDue), year);
      if (!requestDate && !dueDate && !obligation && !process) continue; // 빈 행
      records.push({
        obligation: obligation,
        category: classify(obligation, process),
        requestDate: requestDate,
        dueDate: dueDate,
        done: !isBlank(cellAt(grid, r, cDone)),
      });
    }
  });

  if (!usedSheets.length) return fail('필수 머리글(처리구분, 의무위반사항, 요청일, 완료일, 변경기한일)을 가진 시트를 찾지 못했습니다.');

  const byDate = buildDaily(records);
  const items: MetricItem[] = [];
  const dates = Object.keys(byDate).sort().filter(d => (!startDate || d >= startDate) && (!endDate || d <= endDate));
  dates.forEach(d => {
    FLAT_KEYS.forEach(k => {
      const v = byDate[d][k];
      items.push({ CenterCode: CENTER, ReportDate: d, MetricGroup: '실적', MetricKey: k, Value: v, RawValue: String(v) });
    });
  });
  if (!dates.length) return fail('지정한 기간에 해당하는 접수 건이 없습니다.');
  return {
    ok: true,
    message: usedSheets.length + '개 시트(' + usedSheets.join(', ') + ') · ' + records.length + '건 → ' + dates.length + '일치 집계 (' + dates[0] + ' ~ ' + dates[dates.length - 1] + ')',
    dates: dates,
    items: items,
  };
}

function findHeaderRow(grid: Cell[][]): number {
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const vals = (grid[r] || []).map(v => cleanHeader(v));
    if (REQUIRED_HEADERS.every(h => vals.indexOf(h) >= 0)) return r;
  }
  return -1;
}

function norm(v: string): string { return v.replace(/[\s,，+＋\/／|·ㆍ]/g, '').trim(); }

// 의무위반사항·처리구분 어느 쪽에든 "목적물소멸"이 들어 있으면 목적물소멸 1건
function classify(obligation: string, process: string): string {
  const o = norm(obligation), p = norm(process);
  if (o.indexOf('목적물소멸') >= 0 || p.indexOf('목적물소멸') >= 0) return '목적물소멸';
  if (o === '고지의무') return '고지의무';
  if (o === '통지의무') return '통지의무';
  return '기타';
}

function buildDaily(records: LcRecord[]): { [date: string]: { [key: string]: number } } {
  const rows: { [date: string]: { [key: string]: number } } = {};
  const ensure = (d: string) => {
    if (!rows[d]) { const row: { [key: string]: number } = {}; FLAT_KEYS.forEach(k => { row[k] = 0; }); rows[d] = row; }
    return rows[d];
  };
  records.forEach(rec => {
    if (rec.requestDate) {
      const row = ensure(rec.requestDate);
      row['접수_' + rec.category]++; row['접수_Total']++;
      if (rec.done) { row['처리_' + rec.category]++; row['처리_Total']++; }
    }
    const o = norm(rec.obligation);
    if (rec.dueDate && (o === '고지의무' || o === '통지의무')) {
      const base = o + '_변경기한일';
      const row = ensure(rec.dueDate);
      row[base + '_대상건']++;
      if (rec.done) row[base + '_처리건']++; else row[base + '_미처리건']++;
    }
  });
  return rows;
}

function toDateKey(v: Cell, year: number): string {
  if (typeof v === 'number' && v > 25000 && v < 80000) return serialToIso(v);
  const s = String(v).trim();
  if (!s) return '';
  let m = s.match(/(20\d{2})[-.\/년\s]*(\d{1,2})[-.\/월\s]*(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[3]));
  m = s.match(/^(\d{1,2})[-.\/]\s*(\d{1,2})$/);
  if (m && year) return year + '-' + pad2(Number(m[1])) + '-' + pad2(Number(m[2]));
  return '';
}

function cleanHeader(v: Cell): string { return String(v).replace(/\s+/g, '').trim(); }

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
  if (c < 0) return '';
  const row = grid[r];
  if (!row || c >= row.length) return '';
  const v = row[c];
  return v === null || v === undefined ? '' : v;
}
function isBlank(v: Cell): boolean { return String(v).trim() === ''; }
function serialToIso(serial: number): string {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
}
function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }
function fail(message: string): ExtractResult { return { ok: false, message: message, dates: [], items: [] }; }
