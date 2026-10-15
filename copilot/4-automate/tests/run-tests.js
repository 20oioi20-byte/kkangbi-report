/**
 * Office Scripts 자체 검증
 *
 *   node copilot/4-automate/tests/run-tests.js
 *
 * 1) 타입 검사 — 스크립트 5개를 하나씩 strict 모드로 컴파일한다(Office Scripts 는 any 를 싫어한다).
 * 2) 원본 대조 — 같은 가짜 엑셀 격자를 app.js 의 원래 추출 함수와 새 스크립트에 함께 넣고 결과를 견준다.
 *    (실제 회사 파일은 공개 저장소에 둘 수 없으므로 숫자·이름은 전부 지어낸 것이다)
 * 3) HWPX — 원본은 브라우저 DOMParser 가 필요해 node 에서 못 돌린다. 기대값을 직접 적어 검사한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

function loadTs() {
  try { return require('typescript'); } catch (e) { /* 전역 설치 확인 */ }
  const root = execSync('npm root -g').toString().trim();
  return require(path.join(root, 'typescript'));
}
const ts = loadTs();

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS = path.resolve(__dirname, '..', 'office-scripts');
const STUB = path.join(__dirname, 'excelscript-stub.d.ts');

let pass = 0, failCount = 0;
const failures = [];
function eq(got, want, name) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) pass++;
  else { failCount++; failures.push(name + '\n      기대: ' + b + '\n      실제: ' + a); }
}
function ok(cond, name) { if (cond) pass++; else { failCount++; failures.push(name); } }

// ── 1. 타입 검사 ───────────────────────────────────────────────
const files = fs.readdirSync(SCRIPTS).filter(f => f.endsWith('.ts'));
files.forEach(f => {
  const program = ts.createProgram([STUB, path.join(SCRIPTS, f)], {
    target: ts.ScriptTarget.ES2019, lib: ['lib.es2019.d.ts'], strict: true, noEmit: true, noImplicitAny: true,
  });
  const diags = ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n') + (d.file ? ' @' + path.basename(d.file.fileName) + ':' + (d.file.getLineAndCharacterOfPosition(d.start).line + 1) : ''));
  eq(diags, [], '타입 검사: ' + f);
  const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
  ok(!/:\s*any\b|as any\b|<any>/.test(src), 'any 타입 금지: ' + f);
});

// 스크립트를 JS 로 바꿔 순수 함수만 꺼낸다
function loadScript(file, exportsList) {
  const js = ts.transpileModule(fs.readFileSync(path.join(SCRIPTS, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText;
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(js + '\n;this.__x = {' + exportsList.join(',') + '};', ctx);
  return ctx.__x;
}

// app.js 에서 이름으로 함수·상수를 떼어낸다(괄호 깊이를 세어 끝을 찾는다)
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
function grab(name) {
  let start = APP.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = APP.indexOf('\nconst ' + name + ' ');
  if (start < 0) start = APP.indexOf('\nasync function ' + name + '(');
  if (start < 0) throw new Error('app.js 에서 못 찾음: ' + name);
  let i = start + 1, depth = 0, seenOpen = false, quote = null;
  for (; i < APP.length; i++) {
    const ch = APP[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && APP[i + 1] === '/') { i = APP.indexOf('\n', i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; seenOpen = true; }
    if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (seenOpen && depth === 0) {
      // 함수 선언은 '}' 에서, 상수는 ';' 에서 끝난다
      if (APP.slice(start + 1, start + 9) === 'function' || APP.slice(start + 1, start + 15) === 'async function') { if (ch === '}') return APP.slice(start + 1, i + 1); }
      else if (ch === ';' || APP[i + 1] === ';') return APP.slice(start + 1, APP.indexOf(';', i) + 1);
    }
  }
  throw new Error('끝을 못 찾음: ' + name);
}
function loadOriginal(names, extraGlobals) {
  const ctx = Object.assign({ console: console }, extraGlobals || {});
  vm.createContext(ctx);
  vm.runInContext(names.map(grab).join('\n') + '\n;this.__o = {' + names.join(',') + '};', ctx);
  return ctx.__o;
}
// 배열 격자 → app.js 의 1부터 세는 Map 격자
function toMapSheet(grid) {
  const m = new Map(); let maxCol = 0;
  grid.forEach((row, r) => { row.forEach((v, c) => { if (v !== '' && v !== null && v !== undefined) m.set((r + 1) + ',' + (c + 1), v); }); if (row.length > maxCol) maxCol = row.length; });
  return { grid: m, maxRow: grid.length, maxCol: maxCol };
}
// SheetJS 흉내: sheet_to_json(header:1) 은 격자를 그대로 돌려준다
const FAKE_XLSX = { utils: { sheet_to_json: (sheet) => sheet.__aoa.map(r => r.slice()) } };
const serial = iso => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);

// ── 2-1. KB손보부천 ───────────────────────────────────────────
(function testKbSonhae() {
  const s = loadScript('extract-kb-sonhae.ts', ['extractKbSonhae']);
  const o = loadOriginal(['XLSX_FIELDS_KBSONHAE', 'xlsxGet', 'xlsxClean', 'xlsxIsBlank', 'xlsxIsBlankOrZero', 'xlsxIsDateSerial', 'xlsxExcelDate', 'xlsxNormalizeDate', 'xlsxDateScore', 'xlsxExtractDaily']);
  // 3단 머리글(병합은 이미 풀린 상태로 채움)
  const H1 = ['일자', '총원', '재적인원', '재적인원', '투입인원', '투입인원', 'Call현황', 'Call현황', 'Call현황', 'Call현황', 'Call현황', 'Call현황'];
  const H2 = ['', '', '제휴CS', '장기사고', '제휴상담', '제휴상담', '제휴상담', '제휴상담', '제휴상담', '장기손사', '장기손사', '장기손사'];
  const H3 = ['', '', '소계', '소계', '인원', '비율', '인입호', '응답율', 'S.L', 'Total 인입호', 'Total 응답율', 'Total S.L'];
  const d1 = serial('2026-07-01'), d2 = serial('2026-07-02'), d3 = serial('2026-07-03');
  const grid = [
    ['KB 일별 현황'], [],
    H1, H2, H3,
    [d1, 178, 120, 50, 110, 0.9167, 3200, 0.975, 88.2, 900, 0.951, 80],
    [d2, 177, 119, 50, 108, 0.9076, 0, '', '', 0, '', ''],   // 인입호 둘 다 0 → 제외
    [d3, 176, 119, 49, 107, 0.8992, 3100.4, 0.98, 90, 850, 0.96, 81.25],
    ['합계', '', '', '', '', '', 6300, '', '', 1750, '', ''],
    ['출근현황'], [d1, 999],
  ];
  const orig = o.xlsxExtractDaily({ sheets: [toMapSheet(grid)] }, o.XLSX_FIELDS_KBSONHAE);
  const res = s.extractKbSonhae([grid], 2026, '', '', '전체');
  eq(res.dates, ['2026-07-01', '2026-07-03'], 'KB부천: 날짜(인입호 0 행·합계·출근현황 제외)');
  eq(orig.map(r => r.date), ['7/1', '7/3'], 'KB부천: 원본도 같은 날짜');
  const pick = (d, k) => (res.items.find(i => i.ReportDate === d && i.MetricKey === k) || {}).Value;
  eq(pick('2026-07-01', '총원'), orig[0].total, 'KB부천: 총원 = 원본');
  eq(pick('2026-07-01', '제휴CS_소계'), orig[0].rec_cs_total, 'KB부천: 제휴CS_소계 = 원본');
  eq(pick('2026-07-03', '제휴상담_인입호'), Math.round(orig[1].cs_in), 'KB부천: 인입호 정수 = 원본');
  eq(pick('2026-07-01', '제휴상담_응답율'), 97.5, 'KB부천: 응답율 0.975 → 97.5');
  eq(pick('2026-07-03', '장기손사_SL'), 81.3, 'KB부천: SL 소수 첫째 자리(81.25 → 81.3)');
  eq(pick('2026-07-01', '투입률_제휴상담'), 91.7, 'KB부천: 투입인원 두 번째 열 = 투입률');
  const perfOnly = s.extractKbSonhae([grid], 2026, '', '', '실적');
  ok(perfOnly.items.every(i => i.MetricGroup === '실적') && perfOnly.items.length > 0, 'KB부천: 실적만 저장');
  eq(s.extractKbSonhae([grid], 2026, '2026-07-02', '2026-07-31', '전체').dates, ['2026-07-03'], 'KB부천: 기간 지정');
  ok(!s.extractKbSonhae([[['아무것도 없음']]], 2026, '', '', '전체').ok, 'KB부천: 양식 불일치면 실패');
})();

// ── 2-2. KB손보정비 ───────────────────────────────────────────
(function testKbJeongbi() {
  const s = loadScript('extract-kb-jeongbi.ts', ['extractKbJeongbi']);
  const o = loadOriginal(['LC_FLAT_KEYS', 'lcNorm', 'lcClassify', 'lcIsBlank', 'lcMakeEmptyRow', 'lcBuildDailyRows']);
  const head = ['No', '처리구분', '의무위반사항', '요청일', '완료일', '변경기한일'];
  const rows = [
    [1, '정상처리', '고지의무', '2026-07-01', '2026-07-02', '2026-07-05'],
    [2, '정상처리', '고지의무', '2026-07-01', '', '2026-07-05'],
    [3, '목적물소멸,담보소멸', '단순변경', '2026-07-01', '2026-07-01', ''],
    [4, '정상처리', '담보납입면제, 목적물소멸', serial('2026-07-02'), '', ''],
    [5, '정상처리', '통지의무', '2026-07-02', '2026-07-03', '2026-07-03'],
    ['No', '처리구분', '의무위반사항', '요청일', '완료일', '변경기한일'],   // 재삽입 머리글
    [6, '정상처리', '기타사항', '2026-07-02', '2026-07-02', ''],
  ];
  const grid = [['조회결과'], head].concat(rows);
  const res = s.extractKbJeongbi([{ name: 'RAW', grid: grid }], 2026, '', '');
  ok(res.ok, 'KB정비: 추출 성공 ' + res.message);
  // 원본 집계 함수에 같은 레코드를 넣는다
  const recs = rows.filter(r => r[2] !== '의무위반사항').map(r => {
    const toKey = v => typeof v === 'number' ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : v;
    return { obligation: r[2], process: r[1], requestDate: toKey(r[3]), dueDate: toKey(r[5]), category: o.lcClassify(r[2], r[1]), done: !o.lcIsBlank(r[4]) };
  });
  const orig = o.lcBuildDailyRows(recs);
  orig.forEach(day => {
    Object.keys(day.values).forEach(k => {
      const got = (res.items.find(i => i.ReportDate === day.dateKey && i.MetricKey === k) || {}).Value;
      eq(got, day.values[k], 'KB정비: ' + day.dateKey + ' ' + k + ' = 원본');
    });
  });
  const v = (d, k) => (res.items.find(i => i.ReportDate === d && i.MetricKey === k) || {}).Value;
  eq(v('2026-07-01', '접수_목적물소멸'), 1, 'KB정비: 처리구분 쪽 "목적물소멸,담보소멸" 도 목적물소멸');
  eq(v('2026-07-02', '접수_목적물소멸'), 1, 'KB정비: 의무위반사항 쪽 "…, 목적물소멸" 도 목적물소멸');
  eq(v('2026-07-05', '고지의무_변경기한일_미처리건'), 1, 'KB정비: 변경기한일 기준 미처리');
  eq(v('2026-07-02', '접수_Total'), 3, 'KB정비: 재삽입 머리글은 건수에 안 들어감');
})();

// ── 2-3. LG전자 summary ──────────────────────────────────────
(function testLge() {
  const s = loadScript('extract-lge-summary.ts', ['extractLge', 'pickSheetName']);
  const o = loadOriginal(['LGEX_TARGETS', 'LGEX_CENTER_CONFIG', 'lgexNormalize', 'lgexIsBlank', 'lgexIsErrorValue', 'lgexIsFormulaString', 'lgexMetricMatches', 'lgexAnyMetricInRow', 'lgexRowHasWord', 'lgexFindSheetName', 'lgexExcelSerialToDate', 'lgexParseDateValue', 'lgexIsoDate', 'lgexDateLabel', 'lgexFindDateColumns', 'lgexFindTargetRow', 'lgexToNumber', 'lgexFormatNumber', 'lgexFormatTime', 'lgexMeaningfulValue', 'lgexExtract'], { XLSX: FAKE_XLSX });
  const aoa = [
    ['LG전자 KPI'],
    ['구분', '', '', '', '', '', '7/1', '7/2', '7/3'],
    ['T-NPS', '상시', '', '', '', '', 70.12, 71, ''],
    ['', 'Total', '', '', '', '', 72.34, 73.06, 0],
    ['', '한시', 'Total', '', '', '', 60.5, 61.5, 0],
    ['생산성 (IN+OUT)', '상시(1파트)', '', '', '', '', 50, 51, ''],
    ['', 'Total', '', '', '', '', 55.55, 56, ''],
    ['', '한시', 'Total', '', '', '', 40, 41, ''],
    ['생산성\n(IN)', '상시 Total', '', '', '', '', 30, 31, ''],
    ['', '한시 Total', '', '', '', '', 20, 21, ''],
    ['통화시간 (IN+OUT)', '상시 Total', '', '', '', '', 0.16666667, '3:30:15', '#N/A'],
    ['', '한시 Total', '', '', '', '', 0.125, '2:00:00', ''],
  ];
  ['lge', 'lge_seongsu'].forEach(code => {
    const res = s.extractLge(aoa, code, 2026, '', '', 'summary');
    const orig = o.lgexExtract({ SheetNames: ['summary'], Sheets: { summary: { __aoa: aoa } } }, 2026, code);
    eq(res.dates, orig.rows.map(r => r.date), 'LG ' + code + ': 날짜 = 원본');
    orig.rows.forEach(r => {
      const g = k => (res.items.find(i => i.ReportDate === r.date && i.MetricKey === k) || {}).RawValue || '';
      eq([g('TNPS'), g('생산성_INOUT'), g('생산성_IN'), g('통화시간_INOUT')], r.values, 'LG ' + code + ' ' + r.date + ': 값 = 원본');
    });
  });
  eq((s.extractLge(aoa, 'lge', 2026, '', '', 'summary').items.find(i => i.MetricKey === '통화시간_INOUT') || {}).Value, 14400, 'LG: 통화시간 값은 초(4:00:00 → 14400)');
  eq(s.pickSheetName(['Raw', 'Summary(7월)', 'x']), 'Summary(7월)', 'LG: 이름에 summary 가 들어간 시트');
  ok(!s.extractLge(aoa, 'kbsonhae', 2026, '', '', 'summary').ok, 'LG: 다른 센터코드는 거절');
})();

// ── 2-4. 근태 ────────────────────────────────────────────────
(function testAttendance() {
  const s = loadScript('extract-attendance.ts', ['extractAttendance']);
  const o = loadOriginal(['ATTX_WORK_MARKS', 'attxNormalizeText', 'attxIsWorkStatus', 'attxClassifyRole', 'attxExcelSerialToDate', 'attxParseDate', 'attxDateKey', 'attxIsValidMonthSheetName', 'attxFindHeaderRow', 'attxFindColumn', 'attxAnalyzeSheet', 'attxExtractWorkbook'], { XLSX: FAKE_XLSX });
  const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-06', '2026-07-17'];   // 7/4 토, 7/17 공휴일
  const aoa = [
    ['7월 근태'],
    ['No', '성명', '업무', '입사일', '퇴사일'].concat(days.map(serial)),
    [1, '가상A', '상담사', '2025-01-01', '', 'O', 'O', 'O', 'O', 'O', 'O'],
    [2, '가상B', '상담사', '2025-01-01', '2026-07-02', 'O', 'O', 'O', '', '', ''],
    [3, '가상C', '팀장', '2025-01-01', '', '○', '', '●', '', 'ㅇ', ''],
    [4, '가상D', '상담사', '2026-07-03', '', 'O', 'O', 'O', '', 'O', ''],     // 입사 전 날짜는 안 센다
    [5, '가상E', '상담사', '2025-01-01', '', '연차', 'O', '', '', '', ''],
  ];
  const orig = o.attxExtractWorkbook({ SheetNames: ['2607'], Sheets: { '2607': { __aoa: aoa } } });
  const res = s.extractAttendance([{ name: '2607', grid: aoa }], 'lge', 0, '2026-07-17', '', '', '2026-07-06');
  const v = (d, k) => (res.items.find(i => i.ReportDate === d && i.MetricKey === k) || {}).Value;
  ['2026-07-01', '2026-07-02', '2026-07-03'].forEach(d => {
    eq(v(d, '재직인원'), orig.byDate[d].전체, '근태: ' + d + ' 재직인원 = 원본 전체');
    eq(v(d, '상담사_투입인원'), orig.byDate[d].상담사, '근태: ' + d + ' 투입인원 = 원본 상담사');
    eq(v(d, 'TO'), 19, '근태: ' + d + ' TO = LG AS 기본 19');
  });
  eq(res.dates, ['2026-07-01', '2026-07-02', '2026-07-03'], '근태: 토요일·공휴일·지정 제외일(7/6) 빠짐');
  eq(s.extractAttendance([{ name: '2607', grid: aoa }], 'lge', 21, '', '', '', '').items.find(i => i.MetricKey === 'TO').Value, 21, '근태: 월별TO 를 넘기면 그 값');
  ok(!s.extractAttendance([{ name: '2607', grid: aoa }], 'pyeongtaek', 0, '', '', '', '').ok, '근태: 대상 아닌 센터 거절');
})();

// ── 3. HWPX 일일업무보고 ─────────────────────────────────────
(function testHwpx() {
  const s = loadScript('parse-hwpx-dayreport.ts', ['parseDayReport', 'parseXml']);
  const tc = t => '<hp:tc><hp:subList><hp:p><hp:run><hp:t>' + t + '</hp:t></hp:run></hp:p></hp:subList></hp:tc>';
  const tr = cells => '<hp:tr>' + cells.map(tc).join('') + '</hp:tr>';
  const tbl = rows => '<hp:tbl rowCnt="2">' + rows.map(tr).join('') + '</hp:tbl>';
  const xml = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="x" xmlns:hp="y">'
    + tbl([['민원상담 콜센터 일일업무보고(26.07.24.)']])
    + '<hp:p><hp:run><hp:t>※ 콜센터 운영인력 :23명(센터장 1, 강사 1, 팀장 2, 상담사 19)</hp:t></hp:run></hp:p>'
    + tbl([['구분', '인입호', '응대호', '포기호', '응대율', '1일평균상담건수'], ['응대현황', '1,512', '1,480', '32', '97.9%', '82.2']])
    + tbl([['구분', '계', '관리자', '상담사'], ['근무인원', '21', '4', '17']])
    + tbl([['구분', '합계', '교통', '복지', '환경'], ['건수', '1,348', '674', '337', '337'], ['비율', '100', '50', '25', '25']])
    + '<hp:p><hp:run><hp:t>A&amp;B<hp:lineBreak/>C</hp:t></hp:run></hp:p></hs:sec>';
  const res = s.parseDayReport(xml, '민원상담 콜센터 일일업무보고(26.07.24.).hwpx', 2026);
  const v = k => (res.items.find(i => i.MetricKey === k) || {});
  eq(res.dates, ['2026-07-24'], 'HWPX: 제목의 두 자리 연도 날짜');
  eq([v('요청호').Value, v('응답호').Value, v('포기호').Value, v('응대율').Value, v('CPD').Value], [1512, 1480, 32, 97.9, 82.2], 'HWPX: 일자별 실적');
  eq(v('요청호').RawValue, '1,512', 'HWPX: 원본값은 쉼표 그대로');
  eq([v('재직인원').Value, v('투입인원').Value], [23, 17], 'HWPX: 재직인원(운영인력) · 투입인원(계−관리자)');
  eq([v('합계').Value, v('교통').Value, v('교통_비중').Value, v('복지_비중').Value], [1348, 674, 50, 25], 'HWPX: 업무유형 건수와 비중(합계 쉼표 제거)');
  ok(!res.items.some(i => i.MetricKey === '합계_비중'), 'HWPX: 합계에는 비중을 안 만든다');
  const noTitle = s.parseDayReport(xml.replace('일일업무보고(26.07.24.)', '일일업무보고'), '민원상담 콜센터 일일업무보고(7.25).hwpx', 2026);
  eq(noTitle.dates, ['2026-07-25'], 'HWPX: 제목에 날짜가 없으면 파일 이름 + 기준 연도');
  const root = s.parseXml('<a:x><a:t>A&amp;B<a:br/>C</a:t></a:x>');
  eq(root.children[0].children[0].text, 'A&BC', 'XML 파서: 엔티티 풀기 · 글자 사이 빈 태그');
  ok(!s.parseDayReport('', 'x.hwpx', 2026).ok, 'HWPX: 빈 내용은 실패');
})();

// ── 4. KPI 계산 (원본 avgMetricValue 와 대조) ─────────────────
(function testComputeKpi() {
  const s = loadScript('compute-kpi.ts', ['computeKpi', 'shiftRange']);
  const HOL = ['2026-07-17'];
  const origNames = ['KR_HOLIDAYS_2026', 'isWeekendOrHoliday', 'extractNum', 'avgExcludingHolidays', 'CENTER_COMPUTED_METRICS', 'LGE_TOTAL_MONTHLY_AVG_PERF_KEYS', 'getLgeTotalMonthlyAvgValue', 'RATIO_METRIC_DEFS', 'avgRatioMetric', 'avgMetricValue', 'LGE_TOTAL_LIVE_SUM_KEYS', 'lgeTotalLiveAttSum', 'resolveMetric', 'parseHMSToSeconds'];
  // 원본은 currentCenter 전역을 본다 — 센터마다 새로 불러온다
  const orig = center => {
    const ctx = { console: console, currentCenter: center };
    vm.createContext(ctx);
    vm.runInContext('var currentCenter = "' + center + '";\n' + origNames.map(grab).join('\n').replace(/\nconst KR_HOLIDAYS_2026[^;]*;/, '\nconst KR_HOLIDAYS_2026 = ' + JSON.stringify(HOL) + ';') + '\n;this.__o = { avgMetricValue, avgExcludingHolidays, extractNum };', ctx);
    return ctx.__o;
  };
  // 7월 1~31일 가짜 데이터(주말 포함)
  const days = []; for (let d = 1; d <= 31; d++) days.push('2026-07-' + String(d).padStart(2, '0'));
  const toIn = rows => { const out = []; rows.forEach(r => { Object.keys(r.attendance_data).concat(Object.keys(r.performance_data)).forEach(k => { const v = r.attendance_data[k] !== undefined ? r.attendance_data[k] : r.performance_data[k]; out.push({ d: r.report_date, k: k, v: v === '' ? null : Number(String(v).replace(/[%,]/g, '')) }); }); }); return out; };

  // KB정비: 처리율은 Σ/Σ, 접수건은 영업일 평균
  const jb = days.map((d, i) => ({ report_date: d, attendance_data: { 재직인원: 15 - (i % 2) }, performance_data: { 접수_고지의무: 10 + i, 처리_고지의무: 5 + (i % 7), 접수_통지의무: 3, 처리_통지의무: i % 3, 접수_목적물소멸: i % 4, 처리_목적물소멸: 0, 고지의무_변경기한일_처리건: i % 5, 고지의무_변경기한일_미처리건: 2 } }));
  const oj = orig('kbjeongbi');
  const rj = s.computeKpi('kbjeongbi', '2026-07-01', '2026-07-31', toIn(jb), HOL.join(','), [], 15);
  const mj = k => rj.metrics.find(m => m.key === k).value;
  const r2 = v => Math.round(v * 100) / 100;
  eq(mj('통합_처리율'), r2(oj.avgMetricValue('통합_처리율', jb)), 'KPI KB정비: 통합_처리율 = 원본(Σ/Σ)');
  eq(mj('고지의무_준수율'), r2(oj.avgMetricValue('고지의무_준수율', jb)), 'KPI KB정비: 고지의무_준수율 = 원본');
  eq(mj('통합_접수'), r2(oj.avgMetricValue('통합_접수', jb)), 'KPI KB정비: 통합_접수 일평균 = 원본');
  eq(mj('재직인원'), r2(oj.avgExcludingHolidays(jb, r => oj.extractNum(r, 'attendance_data', '재직인원'))), 'KPI KB정비: 재직인원 영업일 평균 = 원본');
  eq(rj.workdays, 22, 'KPI: 7월 영업일 22일(주말 8일 · 7/17 공휴일 제외)');

  // LG전자통합: 월평균 입력값 · 실시간 합계
  const lt = days.map((d, i) => ({ report_date: d, attendance_data: Object.assign({ 총재직인원_AS: 19, 상담사투입인원_AS: 14 }, i % 3 ? { 총재직인원_성수기: 40 } : {}), performance_data: Object.assign({ TNPS: 60 + i, 생산성_INOUT: 50, 생산성_IN: 30 }, i === 0 ? { TNPS_월평균: 77.7, 생산성_INOUT_월평균: 52, 생산성_IN_월평균: 31 } : {}) }));
  const ol = orig('lge_total');
  const rl = s.computeKpi('lge_total', '2026-07-01', '2026-07-31', toIn(lt), HOL.join(','), [], 0);
  const ml = k => rl.metrics.find(m => m.key === k).value;
  eq(ml('TNPS'), r2(ol.avgMetricValue('TNPS', lt)), 'KPI LG통합: T-NPS 는 월평균 입력값 = 원본');
  eq(ml('TNPS'), 77.7, 'KPI LG통합: 일별 평균이 아니라 1일 저장 월평균(77.7)');
  eq(ml('생산성_OUT_only'), r2(ol.avgMetricValue('생산성_OUT_only', lt)), 'KPI LG통합: 생산성(OUT) = 월평균 INOUT−IN = 원본');
  eq(ml('총재직인원_합계'), r2(ol.avgExcludingHolidays(lt, r => ol.extractNum(r, 'attendance_data', '총재직인원_합계'))), 'KPI LG통합: 총재직인원_합계 실시간 합산 = 원본');

  // 목표 판정·전월比
  const pt = days.concat(['2026-06-01', '2026-06-02', '2026-06-03']).map((d, i) => ({ report_date: d, attendance_data: { 투입인원: 18 }, performance_data: { 요청호: d < '2026-07' ? 1000 : 1200, 응답호: 1150, 응대율: d < '2026-07' ? '95.0%' : '96.5%', 포기호: 50, CPD: 80 } }));
  const tg = [{ k: '응대율', label: '응대율', ym: '기본', t: 97, o: 1 }, { k: '요청호', label: '요청호', ym: '2026-07', t: 1100, o: 2 }, { k: '요청호', label: '요청호', ym: '기본', t: 5000, o: 2 }];
  const rp = s.computeKpi('pyeongtaek', '2026-07-01', '2026-07-31', toIn(pt), HOL.join(','), tg, 20);
  eq(rp.metrics.map(m => m.key), ['응대율', '요청호'], 'KPI: KPI목표 등록 지표가 있으면 그 지표만(정렬순서)');
  const rate = rp.metrics[0], req = rp.metrics[1];
  eq([rate.judged, rate.momText], ['미달', '▲ 1.5%p'], 'KPI: 응대율 목표 미달 · 전월比 %p');
  eq([req.target, req.judged, req.momText], [1100, '달성', '▲ 20.0%'], 'KPI: 월별 목표가 기본 목표보다 우선 · 전월比 %');
  ok(rp.warnings.length === 1 && rp.warnings[0].indexOf('응대율') === 0, 'KPI: 미달 지표만 주의 목록');
  eq(s.shiftRange('2026-07-01', '2026-07-31', -1), { start: '2026-06-01', end: '2026-06-30' }, 'KPI: 전월 기간(말일 맞춤)');
  eq(s.shiftRange('2026-03-01', '2026-03-31', -1), { start: '2026-02-01', end: '2026-02-28' }, 'KPI: 2월 말일');
  ok(!s.computeKpi('lge', '2026-07-31', '2026-07-01', [], '', [], 0).ok, 'KPI: 기간 역순 거절');
  const none = s.computeKpi('lge', '2026-08-01', '2026-08-31', [], '', [], 19);
  eq([none.dataDays, none.metrics[0].display], [0, '-'], 'KPI: 데이터 없으면 0 이 아니라 "-"');
})();

// ── 결과 ─────────────────────────────────────────────────────
console.log('\nOffice Scripts 자체 검증: 통과 ' + pass + ' · 실패 ' + failCount);
if (failures.length) { console.log('\n실패 항목:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
