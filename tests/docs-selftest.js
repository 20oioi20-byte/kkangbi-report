/**
 * 문서결재 요청 — 자체 검증
 *
 *   node tests/docs-selftest.js
 *
 * 자매 저장소 kkangbi-calendar 의 sandbox/manager-web/selftest.js(268건, 24장)에서
 * **이 저장소로 옮겨온 코드에 걸리는 장**만 가져왔다. 나머지 장(담당자 토큰 발급·
 * 서버 목·rec__ 충돌 경고)은 kkangbi-calendar 쪽 파일에 걸려 있어 여기서는 못 돈다
 * (mgr-token.sample.js · mgr-api.mock.js · api/_session.js 가 이 저장소에 없다).
 *
 * 이 저장소에는 package.json 도 test 러너도 없다(정적 파일 3개 + Edge Function 1개).
 * 그래서 의존성 없이 node 로 바로 돈다.
 *
 * 무엇을 지키나 — 전부 **조용히 깨지는** 자리다. 티가 안 나서 더 위험하다.
 *   · 서식 보존   : 태그는 한 글자도 안 바뀐다 (이게 깨지면 기능 전체가 무의미)
 *   · 0 은 값이다 : 빈칸으로 취급되면 «0원·0명» 이 사라진다
 *   · 합계        : 부가세를 매긴 칸만 더한다 (안 그러면 청구인원이 금액에 섞인다)
 *   · 전월값      : 지난 회차가 없으면 빈칸 (0 으로 채우면 거짓말이 된다)
 *   · 응대율      : 일별 평균이 아니라 Σ응대호 ÷ Σ인입호 (20%p 넘게 갈린다)
 *   · 값 자리 잡기: 넓은 것이 이긴다 / 두 달 견줄 때 숫자 한가운데가 안 잘린다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; failures.push(name); }
}
function eq(got, want, name) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) pass++;
  else { fail++; failures.push(name + '\n      기대: ' + b + '\n      실제: ' + a); }
}

// ── app.js 에서 CenterDocs 모듈만 떼어내 화면 없이 태운다 ──────────────
function loadModule() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const start = src.indexOf('const CenterDocs = (function () {');
  const end = src.indexOf('async function renderCenterDocs()');
  if (start < 0 || end < 0) throw new Error('app.js 에서 CenterDocs 모듈을 못 찾았습니다.');
  const code = src.slice(start, end);

  // boot() 이 도는 데 필요한 만큼만 흉내낸 DOM. 화면을 검사하는 것이 아니라
  // 규칙(계산·치환·추출)을 검사하는 것이 목적이다.
  function el() {
    const e = {
      innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
      dataset: {}, style: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {}, removeEventListener() {}, remove() {}, click() {},
      appendChild() {}, focus() {}, select() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      closest() { return null; }, getAttribute() { return null; }, setAttribute() {}
    };
    return e;
  }
  const document = {
    getElementById() { return el(); },
    createElement() { return el(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const sandbox = {
    document,
    window: { XLSX: null, name: '', getSelection() { return null; }, scrollTo() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console, setTimeout, clearTimeout, JSON, Math, Date, Number, String, Object, Array,
    fetch: async () => ({ json: async () => ({ success: false, error: 'test' }) }),
    // 모듈이 참조하는 앱 전역들
    SB_FUNCTION_URL: '', SB_ANON_KEY: '',
    workspaceUnlocked: false, workspacePasswordCache: '', centerTokenMap: {}, allCenters: [],
  };
  sandbox.window.document = document;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + '\nglobalThis.__CD = CenterDocs;', sandbox, { filename: 'app.js#CenterDocs' });
  return sandbox.__CD._boot()._test;
}

const T = loadModule();
const { textReplaceAll, textReplaceOnce, findVars, diffVars, coreOf,
        computeAuto, isBlank, num, comma, XE } = T;

// 태그만 뽑아 이어붙인다 — 서식 보존을 재는 자
const tagsOf = (html) => html.split(/(<[^>]+>)/).filter((_, i) => i % 2 === 1).join('');

console.log('');
console.log('문서결재 요청 — 자체 검증');
console.log('='.repeat(52));

// ─────────────── 1. 서식 보존 (제일 중요) ───────────────
console.log('1. 서식 보존 — 태그는 한 글자도 안 바뀐다');
{
  const body = '<table><tr><td width="11">인원</td><td>11명</td></tr>'
             + '<tr><td>금액</td><td>41,500원</td></tr></table>';

  const r1 = textReplaceAll(body, '11명', '{{인원}}');
  eq(tagsOf(r1), tagsOf(body), '값을 바꿔도 태그가 그대로다');
  ok(r1.includes('{{인원}}'), '값 자리가 바뀐다');
  ok(r1.includes('width="11"'), '태그 속성 안의 같은 글자(width="11")는 안 건드린다');

  const r2 = textReplaceAll(body, '41,500원', '{{금액}}');
  eq(tagsOf(r2), tagsOf(body), '금액을 바꿔도 태그가 그대로다');
  ok(r2.includes('{{금액}}'), '금액 자리가 바뀐다');

  // 아무것도 안 고치고 되돌려 넣으면 원래 문서와 같아야 한다
  eq(textReplaceAll(body, '없는글자', 'X'), body, '없는 글자를 바꾸면 문서가 그대로다');

  const once = textReplaceOnce('<p>11</p><p>11</p>', '11', 'A');
  eq(once, '<p>A</p><p>11</p>', '한 번만 바꾸기는 첫 자리만 바꾼다');
  eq(tagsOf(once), tagsOf('<p>11</p><p>11</p>'), '한 번만 바꿔도 태그가 그대로다');

  // 태그 길이가 한 글자도 안 바뀌는지 숫자로 못 박는다
  const big = '<td class="x11" style="width:11px">11명 / 41,500원</td>';
  const r3 = textReplaceAll(textReplaceAll(big, '11명', '{{A}}'), '41,500원', '{{B}}');
  eq(tagsOf(r3).length, tagsOf(big).length, '태그 길이가 한 글자도 안 바뀐다');

  // ⚠ 여기가 핵심이다 — 바꾸려는 글자가 **태그 속성 안에도 똑같이 있을 때**.
  //   그냥 split/join 으로 바꾸면 width="11" 의 11 까지 바뀌어 서식이 깨진다.
  //   («태그는 한 글자도 안 건드린다» 를 지키는지 실제로 가르는 자리)
  eq(textReplaceAll('<td width="11">11</td>', '11', 'X'),
     '<td width="11">X</td>', '태그 속성 안의 같은 글자는 절대 안 바꾼다');
  eq(textReplaceAll('<a href="/a/2026">2026</a>', '2026', '{{연도}}'),
     '<a href="/a/2026">{{연도}}</a>', '주소 안의 같은 숫자도 안 바꾼다');
  eq(textReplaceOnce('<td class="v11">11</td>', '11', 'Z'),
     '<td class="v11">Z</td>', '한 번만 바꾸기도 태그를 안 건드린다');
  // 태그 안 글자만 있고 본문에는 없으면 아무것도 안 바뀐다
  eq(textReplaceAll('<td width="11"></td>', '11', 'X'),
     '<td width="11"></td>', '본문에 없으면 태그를 뒤져서라도 바꾸지 않는다');
}

// ─────────────── 2. 0 은 값이다 ───────────────
console.log('2. `0` 은 값이다');
{
  ok(isBlank('') && isBlank(null) && isBlank(undefined), '빈 문자열·null·undefined 만 빈칸이다');
  ok(!isBlank(0), '숫자 0 은 빈칸이 아니다');
  ok(!isBlank('0'), '문자 "0" 도 빈칸이 아니다');
  ok(!isBlank(false), 'false 도 빈칸으로 치지 않는다');
  eq(num('0'), 0, '"0" 을 0 으로 읽는다');
  eq(num(''), null, '빈 문자열은 값이 없다');
  eq(num('41,500'), 41500, '쉼표가 섞인 숫자를 읽는다');
  eq(num(' 1 200 '), 1200, '공백이 섞여도 같은 값으로 읽는다');
  eq(num('열개'), null, '숫자가 아니면 값이 없다');
  eq(comma(41500), '41,500', '세 자리마다 쉼표를 넣는다');
  eq(comma(0), '0', '0 도 그대로 찍는다');
}

// ─────────────── 3. 저절로 채우는 칸 ───────────────
console.log('3. 저절로 채우는 칸 — 전월값 · 차이 · 부가세 · 합계');
{
  const bill = {
    id: 'x1',
    fields: [
      { key: '교육비', label: '교육비', type: 'number', unit: '원' },
      { key: '상담료', label: '상담료', type: 'number', unit: '원' },
      { key: '청구인원', label: '청구인원', type: 'number', unit: '명' },
    ],
    autoFields: [
      { key: '교육비_부가세', kind: 'vat', of: '교육비' },
      { key: '상담료_부가세', kind: 'vat', of: '상담료' },
      { key: '공급가합계', kind: 'sum' },
      { key: '부가세합계', kind: 'sumvat' },
      { key: '총합계', kind: 'total' },
      { key: '청구인원_전월', kind: 'prev', of: '청구인원' },
      { key: '청구인원_증감', kind: 'diff', of: '청구인원' },
    ],
  };
  const V = { 교육비: 3380000, 상담료: 12450000, 청구인원: 186 };

  // computeAuto 는 V 를 제자리에서 채우고, 값은 «쉼표 넣은 문자열» 로 넣는다
  // (가) 지난 회차가 있을 때
  const A = computeAuto(bill, Object.assign({}, V), { 청구인원: 182 });
  eq(A['교육비_부가세'], '338,000', '부가세는 그 칸의 10%');
  eq(A['상담료_부가세'], '1,245,000', '부가세를 칸마다 낸다');
  eq(A['공급가합계'], '15,830,000', '공급가 합계는 **부가세를 매긴 칸만** 더한다');
  ok(num(A['공급가합계']) !== 15830186, '청구인원 186 이 금액 합계에 안 섞인다');
  eq(A['부가세합계'], '1,583,000', '부가세 합계');
  eq(A['총합계'], '17,413,000', '총 합계 = 공급가 합계 + 부가세 합계');
  eq(A['청구인원_전월'], '182', '전월값은 지난 회차에서 그대로 가져온다');
  eq(A['청구인원_증감'], '▲4', '차이는 당월 − 전월 (186−182=4), 늘면 ▲');

  // (나) 지난 회차가 없을 때 — 0 으로 채우면 «지난달이 0» 이라는 거짓말이 된다
  const B = computeAuto(bill, Object.assign({}, V), null);
  eq(B['청구인원_전월'], '', '지난 회차가 없으면 전월값은 **빈칸**이다');
  eq(B['청구인원_증감'], '', '지난 회차가 없으면 차이도 **빈칸**이다');
  ok(B['청구인원_전월'] !== '0' && B['청구인원_전월'] !== 0,
     '전월값을 0 으로 채우지 않는다');

  // (다) 당월값이 하나도 없으면 합계도 빈칸 — 0원이라고 쓰면 안 된다
  const C = computeAuto(bill, {}, null);
  eq(C['총합계'], '', '당월값이 없으면 총 합계는 빈칸이다');
  eq(C['공급가합계'], '', '당월값이 없으면 공급가 합계도 빈칸이다');

  // (라) 0 도 값이라 합계에 든다
  const D = computeAuto(bill, { 교육비: 0, 상담료: 100 }, null);
  eq(D['공급가합계'], '100', '0 원도 합계 계산에 든다');
  eq(D['교육비_부가세'], '0', '0 원의 부가세는 0 원이다(빈칸이 아니다)');
  eq(D['총합계'], '110', '0 이 섞여도 총 합계가 나온다');

  // (마) 부가세를 매긴 칸이 하나도 없으면 숫자인 당월값을 모두 더한다
  const plain = { id: 'x2', fields: [{ key: 'a', type: 'number' }, { key: 'b', type: 'number' }],
                  autoFields: [{ key: '합', kind: 'sum' }] };
  eq(computeAuto(plain, { a: 3, b: 4 }, null)['합'], '7',
     '부가세를 매긴 칸이 없으면 숫자인 당월값을 모두 더한다');

  // (바) 줄어들면 ▼
  eq(computeAuto(bill, { 청구인원: 180 }, { 청구인원: 182 })['청구인원_증감'], '▼2',
     '줄어든 것은 ▼ 로 보인다');
}

// ─────────────── 4. 값 자리 잡기 ───────────────
console.log('4. 값 자리 잡기 — 넓은 것이 이긴다');
{
  const got = findVars('인입호 45,120건 / 응대율 98.6%');   // [{i,t,kind}]
  const texts = got.map((v) => v.t);
  const flat = JSON.stringify(texts);
  ok(flat.indexOf('45,120') >= 0, '45,120 이 통째로 잡힌다');
  ok(!/"120"/.test(flat), '45,120 에서 120 만 잘라 잡지 않는다 (넓은 것이 이긴다)');
}

// ─────────────── 5. 두 달 견주기 ───────────────
console.log('5. 두 달 견주기 — 숫자 한가운데가 잘리지 않는다');
{
  const A = '<table><tr><td>인입호</td><td>41,720건</td></tr>'
          + '<tr><td>고정 문구입니다</td><td>변함없음</td></tr></table>';
  const B = '<table><tr><td>인입호</td><td>41,500건</td></tr>'
          + '<tr><td>고정 문구입니다</td><td>변함없음</td></tr></table>';
  const d = diffVars(B, A);   // B(지난달) → A(이번달)
  ok(d.sameShape, '같은 양식이면 견줄 수 있다');
  const flat = JSON.stringify(d.vars.map((v) => [v.a, v.b]));
  ok(flat.indexOf('41,720') >= 0, '41,720 이 통째로 잡힌다 (앞의 "41," 이 같아도 안 잘린다)');
  ok(!/"720"/.test(flat) && !/"500"/.test(flat), '숫자 한가운데가 잘리지 않는다');
  ok(!/변함없음/.test(flat), '안 바뀐 문장은 값 자리로 잡지 않는다');
  ok(!/고정 문구입니다/.test(flat), '고정 문구에는 자리를 만들지 않는다');
}

// ─────────────── 6. 값 경계 넓히기 ───────────────
console.log('6. coreOf — 값 하나를 온전히 집는다');
{
  ok(typeof coreOf === 'function', 'coreOf 가 있다');
  eq(coreOf('41,500건').text, '41,500', '금액을 통째로 집는다');
  eq(coreOf('98.6%').kind, '비율', '비율을 비율로 알아본다');
  eq(coreOf('2026년 7월').kind, '월', '회차 표기를 «월» 로 알아본다');
  eq(coreOf('변함없는 문장').kind, '문장', '문장은 문장이다');
}

// ─────────────── 7. 엑셀 접기 ───────────────
console.log('7. 엑셀 — 응대율은 합계끼리 나눈다');
{
  // 한산한 날 100콜 50% · 바쁜 날 1,000콜 99%
  //   일별 평균 → 74.5%   합계로   → 94.5%   20%p 넘게 갈린다
  const rows = [{ 인입: 100, 응대: 50 }, { 인입: 1000, 응대: 990 }];
  const agg = [
    { key: '인입호', agg: 'sum', from: '인입' },
    { key: '응대호', agg: 'sum', from: '응대' },
    { key: '응대율', agg: 'ratio', num: '응대', den: '인입' },
    { key: '평균인입', agg: 'avg', from: '인입' },
  ];
  const r = XE.aggregate(rows, agg);
  const out = r.values;
  eq(out['인입호'], '1100', '인입호는 합계');
  eq(out['응대호'], '1040', '응대호는 합계');
  eq(r.days, 2, '날 수를 센다');
  const ratio = Number(out['응대율']);
  ok(Math.abs(ratio - 94.5) < 0.6, '응대율 = Σ응대 ÷ Σ인입 = 94.5% 쯤이다');
  ok(Math.abs(ratio - 74.5) > 5, '일별 평균(74.5%)과 확실히 다르다 — avg 로 바꾸면 조용히 틀린다');
  eq(out['평균인입'], '550', '평균은 평균대로 낸다');
  // 파일에서 읽은 0 도 값이다 — 빠지면 합계가 틀린다
  const z = XE.aggregate([{ x: 0 }, { x: 5 }], [{ key: 'k', agg: 'sum', from: 'x' }]).values;
  eq(z['k'], '5', '파일에서 읽은 0 도 값으로 센다');
}

// ─────────────── 8. 되풀이 줄 ───────────────
console.log('8. 되풀이 줄 — 회차마다 줄 수가 달라진다');
{
  const { repeatRows, expandRepeat, hasRepeat, allWeekdays, setYm } = T;
  const countTr = (h) => (h.match(/<tr[\s>]/g) || []).length;

  // 실제 공문(「이미지 파일 모니터링 점검」)과 같은 모양: 그 달의 월요일마다 한 줄.
  // 2026-07 은 월요일이 4번(6·13·20·27), 2026-08 은 5번(3·10·17·24·31).
  eq(allWeekdays('2026-07', 1).length, 4, '2026년 7월의 월요일은 4번이다');
  eq(allWeekdays('2026-08', 1).length, 5, '2026년 8월의 월요일은 5번이다');

  const doc = {
    id: 'r1',
    body: '<table><tr><th>점검일</th><th>인원</th></tr>'
        + '<tr><td>{{#점검일}}</td><td>{{#인원}}</td></tr></table>',
    fields: [], autoFields: [],
    repeat: { by: { kind: 'weekdays', wd: 1, avoid: 'next' },
              cols: [ { key: '점검일', label: '점검일', from: 'date' },
                      { key: '인원',   label: '인원',   type: 'number' } ] }
  };
  ok(hasRepeat(doc), '되풀이 줄이 있는 문서로 알아본다');

  setYm('2026-07'); const r7 = repeatRows(doc, '2026-07', null);
  setYm('2026-08'); const r8 = repeatRows(doc, '2026-08', null);
  eq(r7.length, 4, '7월은 4줄');
  eq(r8.length, 5, '8월은 5줄 — 줄 수가 저절로 달라진다');
  eq(r7[0]['점검일'], '2026-07-06', '첫 줄 날짜가 규칙에서 나온다');
  eq(r8[4]['점검일'], '2026-08-31', '마지막 줄 날짜도 규칙에서 나온다');

  // 본문이 실제로 늘어나는가
  setYm('2026-07'); const h7 = expandRepeat(doc.body, doc, r7);
  setYm('2026-08'); const h8 = expandRepeat(doc.body, doc, r8);
  eq(countTr(doc.body), 2, '틀은 머리줄 + 되풀이줄 = 2줄');
  eq(countTr(h7), 1 + 4, '7월 초안은 머리줄 + 4줄');
  eq(countTr(h8), 1 + 5, '8월 초안은 머리줄 + 5줄');

  // ⚠ 서식 보존 — 줄을 늘려도 태그는 복제될 뿐 바뀌지 않는다
  ok(h8.indexOf('<th>점검일</th>') >= 0, '머리줄 태그가 그대로다');
  ok(h8.indexOf('</table>') >= 0, '표 닫는 태그가 살아 있다');
  ok(!/\{\{#/.test(h8), '되풀이 표식이 초안에 남지 않는다');

  // 사람이 넣은 값은 규칙이 만든 줄에 얹힌다
  setYm('2026-08');
  const r8b = repeatRows(doc, '2026-08', [ {}, { '인원': 11 } ]);
  eq(r8b.length, 5, '사람이 2줄만 채워도 줄 수는 규칙대로 5줄');
  eq(r8b[1]['인원'], 11, '넣은 값이 그 줄에 남는다');
  eq(r8b[1]['점검일'], '2026-08-10', '안 건드린 날짜는 규칙 값 그대로');

  // 쉬는 날이면 민다
  const withHol = Object.assign({}, doc, { holidays: { '2026-08-10': '임시공휴일' } });
  eq(repeatRows(withHol, '2026-08', null)[1]['점검일'], '2026-08-11',
     '쉬는 날이면 다음 평일로 민다');

  // ⚠ 옮길 때 실제로 났던 사고 — 규칙이 만든 날짜를 «사람이 넣은 값» 으로 저장해 버리면,
  //    달을 바꿔도 지난달 날짜가 그대로 남고 줄 수도 안 바뀐다.
  //    저장에는 **사람이 손댄 것만** 담아야 한다.
  setYm('2026-07');
  const july = repeatRows(doc, '2026-07', null);          // 7월 줄(날짜가 채워져 있다)
  setYm('2026-08');
  const wrong = repeatRows(doc, '2026-08', july);         // 그것을 그대로 «사람 입력» 으로 넘기면
  ok(wrong[0]['점검일'] === '2026-07-06',
     '규칙이 만든 값을 그대로 넘기면 지난달 날짜가 남는다 — 그래서 넘기면 안 된다');
  const right = repeatRows(doc, '2026-08', [ {}, { '점검인원': 11 } ]);   // 손댄 것만 넘기면
  eq(right[0]['점검일'], '2026-08-03', '손댄 것만 넘기면 날짜는 그 달 것으로 다시 만들어진다');
  eq(right.length, 5, '줄 수도 그 달 기준으로 다시 센다');
  eq(right[1]['점검인원'], 11, '손댄 값은 그대로 남는다');
  // 되풀이 줄이 없는 문서는 본문이 한 글자도 안 바뀐다
  const plain = { id: 'p', body: '<table><tr><td>{{인입호}}</td></tr></table>', fields: [], autoFields: [] };
  eq(expandRepeat(plain.body, plain, []), plain.body, '되풀이 줄이 없으면 본문을 안 건드린다');
}

// ─────────────── 9. 새 규칙(op) ───────────────
console.log('9. 새 규칙 — 날짜 · 조건');
{
  const { computeAuto, setYm } = T;
  const mk = (autoFields, holidays) => ({ id: 'x', holidays: holidays || null,
    fields: [ { key: '휴무자', type: 'number' } ], autoFields: autoFields });

  setYm('2026-09');
  const A = computeAuto(mk([ { key: '점검일', kind: 'nth-wd', n: 2, wd: 3, avoid: 'next' } ]),
                        { __ym: '2026-09' }, null);
  eq(A['점검일'], '2026-09-09', '2026년 9월 둘째 수요일 = 9월 9일');

  const B = computeAuto(mk([ { key: '점검일', kind: 'nth-wd', n: 2, wd: 3, avoid: 'next' } ],
                           { '2026-09-09': '임시공휴일' }), { __ym: '2026-09' }, null);
  eq(B['점검일'], '2026-09-10', '그날이 공휴일이면 다음 평일(9월 10일)로 민다');

  const C = computeAuto(mk([ { key: '점검일', kind: 'nth-wd', n: 2, wd: 3, avoid: 'none' } ],
                           { '2026-09-09': '임시공휴일' }), { __ym: '2026-09' }, null);
  eq(C['점검일'], '2026-09-09', '«그대로» 를 고르면 안 민다');

  // 조건 문장 — 값에 따라 문장이 통째로 바뀐다
  const IF = { key: '휴무문구', kind: 'if', of: '휴무자', cmp: '=', v: 0,
               then: '휴무자 없음', else: '휴무자 {휴무자}명은 복귀 후 추가 점검' };
  eq(computeAuto(mk([IF]), { __ym: '2026-09', '휴무자': 0 }, null)['휴무문구'],
     '휴무자 없음', '0명이면 «휴무자 없음»');
  eq(computeAuto(mk([IF]), { __ym: '2026-09', '휴무자': 2 }, null)['휴무문구'],
     '휴무자 2명은 복귀 후 추가 점검', '0명이 아니면 문장이 통째로 바뀌고 값이 끼워진다');

  // 말일 기준
  const E = computeAuto(mk([ { key: '마감', kind: 'eom', back: 0, avoid: 'prev' } ]),
                        { __ym: '2026-08' }, null);
  eq(E['마감'], '2026-08-31', '2026년 8월 말일 = 8월 31일 (월요일이라 안 밀림)');

  // 옛 문서(kind 여섯 개)가 그대로 도는지 — 되돌릴 것이 없어야 한다
  const old = { id: 'o', fields: [ { key: '교육비', type: 'number' } ],
    autoFields: [ { key: '부가세', kind: 'vat', of: '교육비' }, { key: '합계', kind: 'total' } ] };
  const O = computeAuto(old, { __ym: '2026-09', '교육비': 1000000 }, null);
  eq(O['부가세'], '100,000', '옛 kind(vat)가 그대로 돈다');
  eq(O['합계'], '1,100,000', '옛 kind(total)도 그대로 돈다');
}
console.log('='.repeat(52));
if (fail) {
  console.log('');
  failures.forEach((f) => console.log('  FAIL: ' + f));
  console.log('');
}
console.log(pass + ' passed' + (fail ? ', ' + fail + ' failed' : ''));
process.exit(fail ? 1 : 0);
