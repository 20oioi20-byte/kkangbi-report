/**
 * parse-hwpx-dayreport.ts — 평택시청 일일업무보고(HWPX 안의 Contents/section0.xml) → 일별 실적·근태·업무유형별 건수
 * 규칙: 1-knowledge/K3_센터별_추출규칙.md 4장 (원본: app.js dayrptParseXml / dayrptParseDailyStats / dayrptParseCategoryStats)
 *
 * HWPX 는 zip 이다. Power Automate 가 압축을 풀어 section0.xml 의 글자를 넘겨준다(흐름 F3 참고).
 * Office Scripts 에는 DOMParser 가 없어서, 필요한 태그(tbl·tr·tc·t)만 직접 읽는 작은 파서를 둔다.
 * 엑셀 통합문서는 쓰지 않는다 — 스크립트 실행용 빈 통합문서(hwpx-runner.xlsx) 하나를 지정하면 된다.
 *
 * 매개변수
 *   xml           section0.xml 내용(글자)
 *   fileName      원본 파일 이름(제목에서 날짜를 못 찾을 때 파일 이름의 괄호 안 날짜를 쓴다)
 *   fallbackYear  제목 날짜에 연도가 없을 때 쓸 연도
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

interface XNode {
  name: string;
  children: XNode[];
  text: string;
}

const CENTER = 'pyeongtaek';

function main(workbook: ExcelScript.Workbook, xml: string, fileName: string, fallbackYear: number): ExtractResult {
  return parseDayReport(xml, fileName || '', fallbackYear);
}

// ── 순수 로직 ─────────────────────────────────────────────────

function parseDayReport(xml: string, fileName: string, fallbackYear: number): ExtractResult {
  if (!xml || xml.indexOf('<') < 0) return fail('section0.xml 내용이 비어 있습니다.');
  const root = parseXml(xml);
  const allText = descendants(root, 't').map(n => n.text).join('\n');
  const tables: string[][][] = descendants(root, 'tbl').map(tbl =>
    tbl.children.filter(ch => ch.name === 'tr').map(tr =>
      tr.children.filter(ch => ch.name === 'tc').map(tc => cellText(tc))));

  // 날짜: 첫 표 첫 칸 제목 → 본문 제목 → 파일 이름의 괄호 안
  const tableTitle = (tables[0] && tables[0][0] && tables[0][0][0]) ? tables[0][0][0].replace(/\s+/g, ' ').trim() : '';
  const tm = allText.match(/민원상담\s*콜센터\s*일일업무보고\s*\([^\n)]+\)/);
  const title = tableTitle || (tm ? tm[0] : '') || fileName;
  let dateRaw = (title.match(/\(([^)]+)\)/) || ['', ''])[1];
  if (!dateRaw) dateRaw = (fileName.match(/\(([^)]+)\)/) || ['', ''])[1];
  const iso = fullDate(dateRaw, fallbackYear);
  if (!iso) return fail('보고서 날짜를 읽지 못했습니다(제목·파일 이름의 괄호 안 날짜 확인): ' + title);

  const items: MetricItem[] = [];
  const push = (group: string, key: string, raw: string) => {
    const r = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!r) return;
    items.push({ CenterCode: CENTER, ReportDate: iso, MetricGroup: group, MetricKey: key, Value: toNum(r), RawValue: r });
  };

  // 일자별 실적 표
  const daily = tables.filter(t => t.length >= 2 && has(t[0], '인입호') && has(t[0], '응대호') && has(t[0], '포기호') && has(t[0], '응대율') && has(t[0], '1일평균상담건수'))[0];
  if (!daily) return fail('일자별 실적 표(인입호·응대호·포기호·응대율·1일평균상담건수)를 찾지 못했습니다.');
  const dh = daily[0];
  const drow = daily.filter(r => norm(r[0]).indexOf('응대현황') >= 0)[0] || daily[1] || [];
  push('실적', '요청호', byHeader(dh, drow, '인입호'));
  push('실적', '응답호', byHeader(dh, drow, '응대호'));
  push('실적', '응대율', byHeader(dh, drow, '응대율').replace(/%/g, ''));
  push('실적', '포기호', byHeader(dh, drow, '포기호'));
  push('실적', 'CPD', byHeader(dh, drow, '1일평균상담건수'));

  // 근태: 재직인원(운영인력 문구) · 투입인원(근무인원 계 − 관리자)
  const onRoll = allText.match(/콜센터\s*운영인력\s*[:：]\s*(\d+)\s*명/);
  if (onRoll) push('근태', '재직인원', onRoll[1]);
  const staff = tables.filter(t => t.length >= 2 && has(t[0], '계') && has(t[0], '관리자') && t.some(r => norm(r[0]).indexOf('근무인원') >= 0))[0];
  if (staff) {
    const srow = staff.filter(r => norm(r[0]).indexOf('근무인원') >= 0)[0] || [];
    const total = toNum(byHeader(staff[0], srow, '계'));
    const manager = toNum(byHeader(staff[0], srow, '관리자'));
    if (total !== null && manager !== null) push('근태', '투입인원', formatNum(total - manager));
  }

  // 업무유형별 건수 + 비중
  const cat = tables.filter(t => t.length >= 2 && has(t[0], '합계') && has(t[0], '복지') && has(t[0], '교통') && has(t[0], '환경') && t.some(r => norm(r[0]).indexOf('건수') === 0))[0];
  let categoryCount = 0;
  if (cat) {
    const heads = cat[0].map((h, i) => (i === 0 ? '구분' : norm(h)));
    const crow = cat.filter(r => norm(r[0]).indexOf('건수') === 0)[0] || [];
    const sum = toNum(crow[heads.indexOf('합계')] || '');
    heads.forEach((h, i) => {
      if (i === 0 || !h) return;
      const raw = (crow[i] || '').trim();
      if (!raw) return;
      push('실적', h, raw);
      categoryCount++;
      const n = toNum(raw);
      if (h !== '합계' && sum && n !== null) push('실적', h + '_비중', formatNum(n / sum * 100));
    });
  }

  return { ok: true, message: iso + ' 일일업무보고 · 항목 ' + items.length + '개(업무유형 ' + categoryCount + '개 포함)', dates: [iso], items: items };
}

// 아주 작은 XML 파서: 태그 이름(접두사 제거)과 계층, <t> 안의 글자만 남긴다
function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', children: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<(\/?)([A-Za-z_][\w.\-]*:)?([A-Za-z_][\w.\-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[6] !== undefined) {
      const top = stack[stack.length - 1];
      if (top.name === 't') top.text += decodeEntities(m[6]);
      continue;
    }
    const closing = m[1] === '/', selfClosing = m[5] === '/', name = m[3];
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) { if (stack[i].name === name) { stack.length = i; break; } }
      continue;
    }
    const node: XNode = { name: name, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}
function descendants(node: XNode, name: string): XNode[] {
  const out: XNode[] = [];
  const walk = (n: XNode) => { n.children.forEach(ch => { if (ch.name === name) out.push(ch); walk(ch); }); };
  walk(node);
  return out;
}
function cellText(tc: XNode): string {
  return descendants(tc, 't').map(n => n.text).join('').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
}
function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m: string, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function norm(s: string): string { return String(s || '').replace(/\s+/g, '').replace(/ /g, '').trim(); }
function has(row: string[], keyword: string): boolean { const k = norm(keyword); return (row || []).some(c => norm(c).indexOf(k) >= 0); }
function byHeader(headers: string[], row: string[], keyword: string): string {
  const k = norm(keyword);
  for (let i = 0; i < headers.length; i++) if (norm(headers[i]).indexOf(k) >= 0) return row[i] || '';
  return '';
}
function toNum(v: string): number | null {
  const n = parseFloat(String(v || '').replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}
function formatNum(n: number): string { return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(Math.round(n * 10) / 10); }
function fullDate(raw: string, fallbackYear: number): string {
  const nums = String(raw || '').match(/\d+/g) || [];
  if (nums.length >= 3) {
    const y = Number(nums[nums.length - 3]), mo = Number(nums[nums.length - 2]), d = Number(nums[nums.length - 1]);
    return (y < 100 ? 2000 + y : y) + '-' + pad2(mo) + '-' + pad2(d);
  }
  if (nums.length === 2 && fallbackYear) return fallbackYear + '-' + pad2(Number(nums[0])) + '-' + pad2(Number(nums[1]));
  return '';
}
function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }
function fail(message: string): ExtractResult { return { ok: false, message: message, dates: [], items: [] }; }
