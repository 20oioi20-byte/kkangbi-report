const SB_FUNCTION_URL = 'https://zbiwyqwjehnogxkzlhxx.supabase.co/functions/v1/center-report-upload';
const SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiaXd5cXdqZWhub2d4a3psaHh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTQ1MzYsImV4cCI6MjA5NjY3MDUzNn0.SQJjHnDcMTRyElxtY9E-04yIkzPVF35L8hcx0lSyG48';

// UTC 변환 없이 로컬 달력 기준 YYYY-MM-DD 문자열을 만든다.
// Date.toISOString()은 UTC로 변환하므로, UTC보다 시간대가 빠른 한국(UTC+9)에서는
// 날짜 범위를 만들 때 하루 앞으로 밀려 보이는 버그가 있었다(예: 7/1~7/31 지정 시 첫 날짜가 6/30으로 표시).
function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 센터별 upload_token은 더 이상 하드코딩하지 않고, 비밀번호 인증 성공 시 서버에서 동적으로 받아옵니다.
const TO_TARGET = { 'kbsonhae': 178, 'pyeongtaek': 20, 'lge': 15, 'lge_seongsu': 35 }; // 평택시청/LG전자: 투입인원은 상담사만 집계되므로 상담사 정원 기준

// 센터별 전체 정원 정보 (전체 운영 요약 카드의 각주 표시용)
const CENTER_TO_INFO = {
  'kbsonhae': { total: 178, counselor: 178, staffAttKey: '총원', note: '' },
  'pyeongtaek': { total: 24, counselor: 20, staffAttKey: '투입인원', note: '관리자 4명 제외, 상담사 20명 기준' },
  'kbjeongbi': { total: 15, counselor: 14, staffAttKey: '재직인원', note: '관리자 1명 포함' },
  'lge': { total: 19, counselor: 15, staffAttKey: '재직인원', note: 'TO 19명(관리자4+상담사15) 기준, 근태 재직인원(전체)으로 집계' },
  // 성수기: 공식 TO는 상담사 35명(관리자 0명)이지만, 실제 운영기준은 관리자 6명 + 상담사 35명 = 41명
  'lge_seongsu': { total: 41, counselor: 35, staffAttKey: '재직인원', fullNote: '전체 정원 41명(관리자6+상담사35) 대비, 재직인원(전체)으로 집계 · 공식 TO는 상담사 35명' },
  // LG전자통합은 TO 자체가 고정값이 아니라 매일 데이터입력 화면에서 직접 입력하는 값이라,
  // 다른 센터처럼 고정 TO_TARGET과 비교하지 않고 그 기간에 입력된 TO_합계의 평균을 기준으로 삼는다(dynamicTargetAttKey).
  'lge_total': { total: null, counselor: null, staffAttKey: '총재직인원_합계', dynamicTargetAttKey: 'TO_합계', fullNote: 'TO는 매일 입력되는 값이라, 해당 기간에 입력된 TO 평균 대비로 계산됩니다.' }
};

const KR_HOLIDAYS_2026 = [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18',
  '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25',
  '2026-06-03', '2026-06-06', '2026-07-17', '2026-08-15', '2026-08-17',
  '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05',
  '2026-10-09', '2026-12-25'
];

// 센터별 주요지표(KPI) 구성 - 새 센터 추가 시 여기에 등록
const CENTER_KPI_DEFS = {
  'kbsonhae': [
    { label: '전체재직인원', type: 'staff', attKey: '총원' },
    { section: '제휴상담', label: '근태', type: 'people', attKey: '제휴CS_소계' },
    { label: '제휴 인입호', type: 'count', perfKey: '제휴상담_인입호' },
    { label: 'SL', type: 'rate', perfKey: '제휴상담_SL' },
    { section: '장기손사', label: '근태', type: 'people', attKey: '장기사고_소계' },
    { label: '손사 인입호', type: 'count', perfKey: '장기손사_인입호' },
    { label: 'SL', type: 'rate', perfKey: '장기손사_SL' },
  ],
  'pyeongtaek': [
    { label: '상담재직인원', type: 'staff', attKey: '투입인원' },
    { label: '요청호', type: 'count', perfKey: '요청호' },
    { label: '응답호', type: 'count', perfKey: '응답호' },
    { label: '응대율', type: 'rate', perfKey: '응대율' },
    { label: '포기호', type: 'count', perfKey: '포기호' },
    { label: 'CPD', type: 'number', perfKey: 'CPD' },
  ],
  'kbjeongbi': [
    { label: '전체재직인원', type: 'staff', attKey: '재직인원' },
    { label: '상담사 투입현황', type: 'people', attKey: '상담사_투입인원' },
    { section: '총', label: '접수건', type: 'count', perfKey: '통합_접수' },
    { section: '고지', label: '접수건', type: 'count', perfKey: '접수_고지의무' },
    { section: '통지', label: '접수건', type: 'count', perfKey: '접수_통지의무' },
    { section: '목적물', label: '접수건', type: 'count', perfKey: '접수_목적물소멸' },
  ],
  'lge': [
    { label: '전체재직인원(TO대비)', type: 'staff', attKey: '재직인원' },
    { label: 'T-NPS', type: 'number', perfKey: 'TNPS' },
    { label: '생산성(IN+OUT)', type: 'number', perfKey: '생산성_INOUT' },
    { label: '생산성(IN)', type: 'number', perfKey: '생산성_IN' },
    { label: '통화시간(IN+OUT)', type: 'duration', perfKey: '통화시간_INOUT_초' },
  ],
  'lge_seongsu': [
    { label: '전체재직인원(TO대비)', type: 'staff', attKey: '재직인원' },
    { label: 'T-NPS', type: 'number', perfKey: 'TNPS' },
    { label: '생산성(IN+OUT)', type: 'number', perfKey: '생산성_INOUT' },
    { label: '생산성(IN)', type: 'number', perfKey: '생산성_IN' },
    { label: '통화시간(IN+OUT)', type: 'duration', perfKey: '통화시간_INOUT_초' },
  ],
  'lge_total': [
    { label: 'TO', type: 'people', attKey: 'TO_합계' },
    { label: '총재직인원', type: 'people', attKey: '총재직인원_합계' },
    { label: 'AS재직인원', type: 'people', attKey: 'AS재직인원_합계' },
    { label: '성수기재직인원', type: 'people', attKey: '성수기재직인원_합계' },
    { label: '상담사투입인원', type: 'people', attKey: '상담사투입인원_합계' },
    { label: 'T-NPS', type: 'number', perfKey: 'TNPS' },
    { label: '생산성(IN+OUT)', type: 'number', perfKey: '생산성_INOUT' },
    { label: '생산성(IN)', type: 'number', perfKey: '생산성_IN' },
    { label: '통화시간(IN+OUT)', type: 'duration', perfKey: '통화시간_INOUT_초' },
  ],
};

// 저장된 원본 항목만으로는 부족한 "처리율/준수율" 등은 센터별 계산식으로 산출
const CENTER_COMPUTED_METRICS = {
  'kbjeongbi': {
    '고지의무_처리율': function(r) {
      const acc = extractNum(r, 'performance_data', '접수_고지의무'), proc = extractNum(r, 'performance_data', '처리_고지의무');
      return (acc !== null && acc !== 0 && proc !== null) ? (proc / acc * 100) : null;
    },
    '통지의무_처리율': function(r) {
      const acc = extractNum(r, 'performance_data', '접수_통지의무'), proc = extractNum(r, 'performance_data', '처리_통지의무');
      return (acc !== null && acc !== 0 && proc !== null) ? (proc / acc * 100) : null;
    },
    '고지의무_준수율': function(r) {
      const proc = extractNum(r, 'performance_data', '고지의무_변경기한일_처리건'), unproc = extractNum(r, 'performance_data', '고지의무_변경기한일_미처리건');
      const denom = (proc || 0) + (unproc || 0);
      return denom ? (proc / denom * 100) : null;
    },
    '통지의무_준수율': function(r) {
      const proc = extractNum(r, 'performance_data', '통지의무_변경기한일_처리건'), unproc = extractNum(r, 'performance_data', '통지의무_변경기한일_미처리건');
      const denom = (proc || 0) + (unproc || 0);
      return denom ? (proc / denom * 100) : null;
    },
    '목적물소멸_처리율': function(r) {
      const acc = extractNum(r, 'performance_data', '접수_목적물소멸'), proc = extractNum(r, 'performance_data', '처리_목적물소멸');
      return (acc !== null && acc !== 0 && proc !== null) ? (proc / acc * 100) : null;
    },
    // Total = 고지의무 + 통지의무 + 목적물소멸 (기타 제외)
    '통합_접수': function(r) {
      const a = extractNum(r, 'performance_data', '접수_고지의무') || 0, b = extractNum(r, 'performance_data', '접수_통지의무') || 0, c = extractNum(r, 'performance_data', '접수_목적물소멸') || 0;
      return a + b + c;
    },
    '통합_처리': function(r) {
      const a = extractNum(r, 'performance_data', '처리_고지의무') || 0, b = extractNum(r, 'performance_data', '처리_통지의무') || 0, c = extractNum(r, 'performance_data', '처리_목적물소멸') || 0;
      return a + b + c;
    },
    '통합_처리율': function(r) {
      const a = extractNum(r, 'performance_data', '접수_고지의무') || 0, b = extractNum(r, 'performance_data', '접수_통지의무') || 0, c = extractNum(r, 'performance_data', '접수_목적물소멸') || 0;
      const acc = a + b + c;
      const pa = extractNum(r, 'performance_data', '처리_고지의무') || 0, pb = extractNum(r, 'performance_data', '처리_통지의무') || 0, pc = extractNum(r, 'performance_data', '처리_목적물소멸') || 0;
      const proc = pa + pb + pc;
      return acc ? (proc / acc * 100) : null;
    },
  },
  // 통화시간(IN+OUT)은 "H:MM:SS" 텍스트로 저장되므로, 차트/KPI 평균 계산을 위해 초 단위 숫자로 변환
  // 생산성_OUT_only: 누적막대에서 "생산성(IN+OUT) 안에 포함된 생산성(IN)"을 구분해 보여주기 위한 파생값(=IN+OUT 총량 - IN)
  'lge': {
    '통화시간_INOUT_초': function(r) {
      const raw = r.performance_data && r.performance_data['통화시간_INOUT'];
      return parseHMSToSeconds(raw);
    },
    '생산성_OUT_only': function(r) {
      const total = extractNum(r, 'performance_data', '생산성_INOUT');
      const inOnly = extractNum(r, 'performance_data', '생산성_IN');
      return (total !== null && inOnly !== null) ? Math.max(0, total - inOnly) : null;
    },
  },
  'lge_seongsu': {
    '통화시간_INOUT_초': function(r) {
      const raw = r.performance_data && r.performance_data['통화시간_INOUT'];
      return parseHMSToSeconds(raw);
    },
    '생산성_OUT_only': function(r) {
      const total = extractNum(r, 'performance_data', '생산성_INOUT');
      const inOnly = extractNum(r, 'performance_data', '생산성_IN');
      return (total !== null && inOnly !== null) ? Math.max(0, total - inOnly) : null;
    },
  },
  // LG전자통합은 통화시간_INOUT_초를 이미 초 단위 숫자로 그대로 저장하므로(데이터입력 화면에서 H:MM:SS를
  // 입력받아 변환 후 저장) 별도 변환 함수가 필요 없다 — 생산성(OUT)만 IN+OUT/IN 두 값으로부터 파생 계산한다.
  'lge_total': {
    '생산성_OUT_only': function(r) {
      const total = extractNum(r, 'performance_data', '생산성_INOUT');
      const inOnly = extractNum(r, 'performance_data', '생산성_IN');
      return (total !== null && inOnly !== null) ? Math.max(0, total - inOnly) : null;
    },
  },
};

// LG전자통합의 T-NPS/생산성(IN+OUT)/생산성(IN)/통화시간, 이 4개 실적지표는 일별 실측값의 평균이 아니라
// 데이터입력 화면(월평균 실적 입력, "대상 월" 선택)에서 관리자가 그 달 1일 데이터에 직접 입력해둔
// "{key}_월평균" 값을 그대로 사용한다(여러 달이 걸친 기간이면 그 달들의 월평균값을 평균).
const LGE_TOTAL_MONTHLY_AVG_PERF_KEYS = ['TNPS', '생산성_INOUT', '생산성_IN', '통화시간_INOUT_초'];

function getLgeTotalMonthlyAvgValue(perfKey, rows) {
  const months = {};
  rows.forEach(function(r) { months[r.report_date.slice(0, 7)] = true; });
  const vals = Object.keys(months).map(function(ym) {
    const monthStartRow = rows.find(function(r) { return r.report_date === ym + '-01'; });
    const raw = monthStartRow && monthStartRow.performance_data ? monthStartRow.performance_data[perfKey + '_월평균'] : undefined;
    return (raw === undefined || raw === null || raw === '') ? null : Number(raw);
  }).filter(function(v) { return v !== null && !isNaN(v); });
  return vals.length ? (vals.reduce(function(a, b) { return a + b; }, 0) / vals.length) : null;
}

// 지표 하나의 평균값을 구하는 공용 함수. LG전자통합의 위 4개 지표만 예외적으로 "월평균" 수동입력값을 쓰고,
// 그 외 모든 센터/지표는 기존과 동일하게 주말·공휴일 제외 일별 실측값 평균을 사용한다.
function avgMetricValue(key, rows) {
  if (currentCenter === 'lge_total') {
    if (LGE_TOTAL_MONTHLY_AVG_PERF_KEYS.indexOf(key) !== -1) return getLgeTotalMonthlyAvgValue(key, rows);
    // 생산성(OUT)은 파생값(INOUT-IN)이라, 일별 실측이 아니라 월평균 기준의 INOUT/IN으로 같은 방식으로 계산해야
    // 카드에 표시되는 IN+OUT 숫자가 서로 어긋나지 않는다.
    if (key === '생산성_OUT_only') {
      const inout = getLgeTotalMonthlyAvgValue('생산성_INOUT', rows);
      const inOnly = getLgeTotalMonthlyAvgValue('생산성_IN', rows);
      return (inout !== null && inOnly !== null) ? Math.max(0, inout - inOnly) : null;
    }
  }
  return avgExcludingHolidays(rows, function(r) { return resolveMetric(r, key); });
}

// LG전자통합의 TO_합계/총재직인원_합계/상담사투입인원_합계는 원래 저장 시점에 AS·성수기 두 값을 더해서 저장하지만,
// 과거에 한쪽만 입력된 날짜(또는 다른 저장 경로로 합계가 누락된 날짜)까지 항상 정확히 보이도록,
// 저장된 값을 그대로 믿지 않고 AS·성수기 두 항목을 조회할 때마다 실시간으로 더해서 보여준다(extractNum에서 가로챔).
// 두 항목 다 값이 없는 날짜는 여전히 빈칸(null)으로 남긴다 — 억지로 0을 만들어내지 않기 위함.
const LGE_TOTAL_LIVE_SUM_KEYS = {
  'TO_합계': ['TO_AS', 'TO_성수기'],
  '총재직인원_합계': ['총재직인원_AS', '총재직인원_성수기'],
  '상담사투입인원_합계': ['상담사투입인원_AS', '상담사투입인원_성수기']
};
function lgeTotalLiveAttSum(row, key) {
  const parts = LGE_TOTAL_LIVE_SUM_KEYS[key];
  const att = row.attendance_data || {};
  const toNum = function(raw) { return (raw === undefined || raw === null || raw === '') ? null : parseFloat(String(raw).replace(/[%,]/g, '')); };
  const n0 = toNum(att[parts[0]]), n1 = toNum(att[parts[1]]);
  if (n0 === null && n1 === null) return null;
  return (n0 || 0) + (n1 || 0);
}

// TO및목표값설정 화면에서 "목표값"을 시:분:초(예: 4:00:00)로 입력받아야 하는 지표.
// 저장은 항상 초 단위 숫자(target_value)로 되며, 화면 표시만 H:MM:SS로 변환한다.
const DURATION_METRIC_KEYS = {
  'lge': ['통화시간_INOUT_초'],
  'lge_seongsu': ['통화시간_INOUT_초'],
  'lge_total': ['통화시간_INOUT_초']
};
function isDurationMetricKey(centerCode, key) {
  return (DURATION_METRIC_KEYS[centerCode] || []).indexOf(key) !== -1;
}

// AI 응답, 사용자 입력 등 신뢰할 수 없는 텍스트를 innerHTML에 넣기 전 이스케이프
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function sumMetric(rows, key) {
  return rows.reduce(function(sum, r) { const v = resolveMetric(r, key); return sum + (v || 0); }, 0);
}

// 성능 데이터 키를 값으로 변환: 계산지표로 등록돼 있으면 계산식 사용, 아니면 원본 값 그대로 조회
function resolveMetric(row, key) {
  const fn = CENTER_COMPUTED_METRICS[currentCenter] && CENTER_COMPUTED_METRICS[currentCenter][key];
  if (fn) return fn(row);
  return extractNum(row, 'performance_data', key);
}

// 센터별 지표 추이 차트 구성 - 새 센터 추가 시 여기에 등록
// group: { title, barKeys(막대,합계/평균), barLabels, lineKeys(선), lineLabels, threshold: {key, value, label} }
// 센터별 대시보드 테마 색상 (KB손보부천은 기존 브랜드 색상 유지, 평택시청은 평택시 시그니처 컬러 반영)
// main: pantone 320C(teal), sub: pantone 072C(navy) 기준
// 기간 토글(단월/분기누적/반기누적/연초누적)은 전 센터 공통으로 KT 기본색을 사용한다.
// 센터별 브랜드 색상은 차트(CENTER_CHART_CONFIG)와 원형그래프 팔레트에서만 반영하며,
// 이 토글 UI에는 앞으로도 별도 등록하지 않는다.
const CENTER_DASH_THEME = {};
const DEFAULT_DASH_THEME = { accent: '#FE2E36', dark: '#3a1518', soft: '#FFE8E9' };

function getDashTheme() {
  return CENTER_DASH_THEME[currentCenter] || DEFAULT_DASH_THEME;
}

const CENTER_CHART_CONFIG = {
  'kbsonhae': {
    excludeBarOnMonthly: '응대호', // 월별 탭에서 제외할 막대 라벨
    barColors: ['#8A8478', '#FFBC00', '#B7C4D6'],
    lineColor: '#545045',
    groups: [
      {
        title: '제휴상담', barKeys: ['제휴상담_인입호', '제휴상담_응답호'], barLabels: ['인입호', '응대호'],
        lineKeys: ['제휴상담_응답율', '제휴상담_SL'], lineLabels: ['응답율(%)', 'SL'],
        threshold: { key: '제휴상담_SL', value: 92, label: 'SL기준(92)' }
      },
      {
        title: '장기손사', barKeys: ['장기손사_인입호', '장기손사_응답호'], barLabels: ['인입호', '응대호'],
        lineKeys: ['장기손사_응답율', '장기손사_SL'], lineLabels: ['응답율(%)', 'SL'],
        threshold: { key: '장기손사_SL', value: 92, label: 'SL기준(92)' }
      },
    ]
  },
  'pyeongtaek': {
    barColors: ['#009DA5', '#303192', '#7ED9DD'],
    lineColor: '#303192',
    groups: [
      {
        title: '평택시청', barKeys: ['요청호', '응답호'], barLabels: ['요청호', '응답호'],
        lineKeys: ['응대율', 'CPD'], lineLabels: ['응대율(%)', 'CPD'],
        threshold: { key: '응대율', value: 90, label: '응대율목표(90)' }
      },
    ]
  },
  'kbjeongbi': {
    barColors: ['#60584C', '#FFBC00', '#B7C4D6'],
    lineColor: '#545045',
    groups: [
      {
        title: '접수건 구성', stacked: true,
        barKeys: ['접수_고지의무', '접수_통지의무', '접수_목적물소멸'], barLabels: ['고지의무', '통지의무', '목적물소멸'],
        lineKeys: [], lineLabels: []
      },
    ]
  },
  // LG 브랜드 컬러 가이드 기준: LG RED #A50034 · LG GRAY #6b6b6b · WHITE #FFFFFF, 가이드에 없는 보조색상은 그린 사용
  'lge': {
    barColors: ['#2E7D32', '#6b6b6b', '#B7C4D6'],
    lineColor: '#A50034',
    groups: [
      {
        title: '생산성', stacked: true,
        barKeys: ['생산성_IN', '생산성_OUT_only'], barLabels: ['생산성(IN)', '생산성(OUT)'],
        lineKeys: ['TNPS'], lineLabels: ['T-NPS']
      },
    ]
  },
  'lge_seongsu': {
    barColors: ['#2E7D32', '#6b6b6b', '#B7C4D6'],
    lineColor: '#A50034',
    groups: [
      {
        title: '생산성', stacked: true,
        barKeys: ['생산성_IN', '생산성_OUT_only'], barLabels: ['생산성(IN)', '생산성(OUT)'],
        lineKeys: ['TNPS'], lineLabels: ['T-NPS']
      },
    ]
  },
  // LG전자성수기와 동일한 형태로 구성(요청사항) — 생산성 IN/OUT 누적막대 + T-NPS 선.
  'lge_total': {
    barColors: ['#2E7D32', '#6b6b6b', '#B7C4D6'],
    lineColor: '#A50034',
    groups: [
      {
        title: '생산성', stacked: true, barMax: 100,
        barKeys: ['생산성_IN', '생산성_OUT_only'], barLabels: ['생산성(IN)', '생산성(OUT)'],
        lineKeys: ['TNPS'], lineLabels: ['T-NPS'],
        // 요약카드를 기존 막대/선 구성(생산성 IN·OUT·T-NPS 3칸 한 줄)이 아니라
        // 1줄: T-NPS·통화시간(IN+OUT)·생산성(IN+OUT), 2줄: 생산성(IN)·생산성(OUT) 형태로 보여달라는 요청 —
        // summaryRows가 있으면 renderSummaryCards()가 이 목록(줄 단위 배열)으로 카드 전체를 대체(차트 자체 구성은 그대로 유지).
        summaryRows: [
          [
            { key: 'TNPS', label: 'T-NPS' },
            { key: '통화시간_INOUT_초', label: '통화시간(IN+OUT)' },
            { key: '생산성_INOUT', label: '생산성(IN+OUT)' }
          ],
          [
            { key: '생산성_IN', label: '생산성(IN)' },
            { key: '생산성_OUT_only', label: '생산성(OUT)' }
          ]
        ]
      },
    ]
  },
};

let allCentersMeta = [];
let centerTokenMap = {};
let unlockedCenters = new Set();
let workspaceUnlocked = false;
let workspacePasswordCache = '';

const SS_WORKSPACE_PW = 'kkangbi_ws_pw';
const SS_UNLOCKED_CENTERS = 'kkangbi_unlocked_centers';
const SS_CENTER_TOKENS = 'kkangbi_center_tokens';

let allCenters = [];
let allRows = [];

// 센터 전환/재진입 시 네트워크 응답을 기다리지 않고 먼저 화면부터 그리기 위한 캐시.
// 세션 중엔 메모리(centerRowsCache)로, 새로고침 이후에도 첫 화면을 빠르게 보여주기 위해
// 마지막으로 본 센터 1곳만 localStorage에도 함께 저장한다(용량 문제 방지).
let centerRowsCache = {};
const ROWS_CACHE_LS_KEY = 'kkangbi_admin_rows_cache_v1';

function getCachedRows(centerCode) {
  if (centerRowsCache[centerCode]) return centerRowsCache[centerCode];
  try {
    const raw = localStorage.getItem(ROWS_CACHE_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.centerCode === centerCode && Array.isArray(parsed.rows)) return parsed.rows;
  } catch (e) { /* 캐시 없어도 정상 동작(그냥 기존처럼 네트워크 응답을 기다림) */ }
  return null;
}

function setCachedRows(centerCode, rows) {
  centerRowsCache[centerCode] = rows;
  try { localStorage.setItem(ROWS_CACHE_LS_KEY, JSON.stringify({ centerCode: centerCode, rows: rows, ts: Date.now() })); } catch (e) { /* 저장 실패해도 무시 */ }
}
let currentCenter = null;
let currentMonth = localDateStr(new Date()).slice(0, 7);
let viewMode = 'single';
let aggView = 'daily';
let currentMainTab = 'dashboard';
let rowSchema = [];
let parsedRows = [];
let miniCharts = [];

function isWeekendOrHoliday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  return dow === 0 || dow === 6 || KR_HOLIDAYS_2026.includes(dateStr);
}

// ============================================
// 인증 / 세션 (워크스페이스·센터별 비밀번호)
// 주의: 정적 파일 + anon key 구조라 완벽한 서버 인증은 아니며,
// 비밀번호를 모르는 일반 사용자를 막는 수준의 보호입니다.
// ============================================
function restoreSession() {
  try {
    workspacePasswordCache = sessionStorage.getItem(SS_WORKSPACE_PW) || '';
    workspaceUnlocked = !!workspacePasswordCache;
    const uc = sessionStorage.getItem(SS_UNLOCKED_CENTERS);
    unlockedCenters = new Set(uc ? JSON.parse(uc) : []);
    const ct = sessionStorage.getItem(SS_CENTER_TOKENS);
    centerTokenMap = ct ? JSON.parse(ct) : {};
  } catch (e) { /* ignore */ }
}

function persistSession() {
  sessionStorage.setItem(SS_WORKSPACE_PW, workspaceUnlocked ? workspacePasswordCache : '');
  sessionStorage.setItem(SS_UNLOCKED_CENTERS, JSON.stringify(Array.from(unlockedCenters)));
  sessionStorage.setItem(SS_CENTER_TOKENS, JSON.stringify(centerTokenMap));
}

async function loadCentersMeta() {
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=centers-manage-list&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
    const data = await res.json();
    if (data.success) allCentersMeta = data.centers || [];
    allCenters = allCentersMeta;
  } catch (e) { /* ignore */ }
}

async function tryWorkspaceLogin(password, silent) {
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=verify-workspace-password', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password })
    });
    const data = await res.json();
    if (data.success && data.valid) {
      workspaceUnlocked = true;
      workspacePasswordCache = password;
      centerTokenMap = {};
      (data.centers || []).forEach(function(c) { centerTokenMap[c.center_code] = c.upload_token; });
      persistSession();
      return true;
    }
    if (!silent) alert('관리자화면 비밀번호가 일치하지 않습니다.');
    if (silent) { workspaceUnlocked = false; workspacePasswordCache = ''; persistSession(); }
    return false;
  } catch (e) {
    if (!silent) alert('오류: ' + e.message);
    return false;
  }
}

function promptWorkspaceLogin() {
  const pw = (prompt('관리자화면 비밀번호(6자리)를 입력하세요:') || '').trim();
  if (!pw) return;
  tryWorkspaceLogin(pw, false).then(function(ok) { if (ok) refreshAfterAuthChange(); });
}

function lockWorkspace() {
  workspaceUnlocked = false;
  workspacePasswordCache = '';
  viewingWorkspaceOverview = false;
  viewingSettingsPage = false;
  persistSession();
  refreshAfterAuthChange();
}

function promptCenterPassword(code) {
  const meta = allCentersMeta.find(function(c) { return c.center_code === code; });
  const pw = (prompt((meta ? meta.center_name : code) + ' 비밀번호(6자리)를 입력하세요:') || '').trim();
  if (!pw) return;
  fetch(SB_FUNCTION_URL + '?action=verify-center-password', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ center_code: code, password: pw })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.success && data.valid) {
      unlockedCenters.add(code);
      centerTokenMap[code] = data.upload_token;
      persistSession();
      if (currentCenter !== code) resetDashboardStateForNewCenter();
      currentCenter = code;
      refreshAfterAuthChange();
    } else {
      alert('비밀번호가 일치하지 않습니다.');
    }
  }).catch(function(e) { alert('오류: ' + e.message); });
}

async function refreshAfterAuthChange() {
  if (!workspaceUnlocked) { viewingWorkspaceOverview = false; viewingSettingsPage = false; }
  const available = allCentersMeta.filter(function(c) { return workspaceUnlocked || unlockedCenters.has(c.center_code); });
  if (!viewingWorkspaceOverview && !viewingSettingsPage && !available.find(function(c) { return c.center_code === currentCenter; })) {
    currentCenter = available.length ? available[0].center_code : null;
  }
  renderTopbarAuth();
  renderSidebar();
  if (!viewingWorkspaceOverview && !viewingSettingsPage) {
    if (currentCenter) { await loadOverviewForCurrent(); } else { allRows = []; }
  }
  renderMain();
}

function renderTopbarAuth() {
  const el = document.getElementById('topbarActions');
  if (!el) return;
  const centerPwItem = currentCenter ? '<button onclick="closeAccountMenu();showChangeCenterPw()">🔑 센터 비번변경</button>' : '';
  if (workspaceUnlocked) {
    el.innerHTML = '<span class="btn-outline" style="cursor:default;">관리자 모드</span>'
      + '<div class="account-menu-wrap">'
      + '<button class="btn-ghost" onclick="toggleAccountMenu(event)">⚙ 계정 ▾</button>'
      + '<div class="account-menu" id="accountMenu">'
      + centerPwItem
      + '<button onclick="closeAccountMenu();showChangeWorkspacePw()">🔑 관리자화면 비번변경</button>'
      + '<button onclick="closeAccountMenu();toggleBackupPanel()">💾 백업/복원</button>'
      + '<button onclick="closeAccountMenu();lockWorkspace()" class="danger">🔒 잠그기</button>'
      + '</div></div>';
  } else {
    el.innerHTML = '<div class="account-menu-wrap">'
      + '<button class="btn-ghost" onclick="toggleAccountMenu(event)">⚙ 계정 ▾</button>'
      + '<div class="account-menu" id="accountMenu">'
      + centerPwItem
      + '<button onclick="closeAccountMenu();toggleBackupPanel()">💾 백업/복원</button>'
      + '</div></div>'
      + '<button class="btn-primary" onclick="promptWorkspaceLogin()">관리자화면 로그인</button>';
  }
}

function toggleAccountMenu(evt) {
  evt.stopPropagation();
  const menu = document.getElementById('accountMenu');
  const isOpen = menu.classList.contains('open');
  closeAccountMenu();
  if (!isOpen) menu.classList.add('open');
}
function closeAccountMenu() {
  const menu = document.getElementById('accountMenu');
  if (menu) menu.classList.remove('open');
}
document.addEventListener('click', closeAccountMenu);

function showChangeWorkspacePw() {
  const cur = (prompt('현재 관리자화면 비밀번호:') || '').trim();
  if (!cur) return;
  const next = (prompt('새 비밀번호(숫자 6자리):') || '').trim();
  if (!next) return;
  fetch(SB_FUNCTION_URL + '?action=change-workspace-password', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: cur, new_password: next })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data.success) { alert('변경 실패: ' + data.error); return; }
    alert('관리자화면 비밀번호가 변경되었습니다.');
    workspacePasswordCache = next;
    persistSession();
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function showChangeCenterPw() {
  if (!currentCenter) { alert('센터를 먼저 선택하세요.'); return; }
  const payload = { center_code: currentCenter };
  if (workspaceUnlocked) {
    payload.workspace_password = workspacePasswordCache;
  } else {
    const cur = (prompt('현재 센터 비밀번호:') || '').trim();
    if (!cur) return;
    payload.current_password = cur;
  }
  const next = (prompt('새 비밀번호(숫자 6자리):') || '').trim();
  if (!next) return;
  payload.new_password = next;
  fetch(SB_FUNCTION_URL + '?action=change-center-password', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data.success) { alert('변경 실패: ' + data.error); return; }
    alert('비밀번호가 변경되었습니다.');
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function addCenterPrompt() {
  const code = prompt('새 센터 코드를 입력하세요 (영문/숫자, 예: samsung):');
  if (!code) return;
  const name = prompt('센터 이름을 입력하세요 (예: 삼성화재):');
  if (!name) return;
  fetch(SB_FUNCTION_URL + '?action=center-create', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_password: workspacePasswordCache, center_code: code.trim(), center_name: name.trim() })
  }).then(function(r) { return r.json(); }).then(async function(data) {
    if (!data.success) { alert('추가 실패: ' + data.error); return; }
    await loadCentersMeta();
    alert('센터가 추가되었습니다. 기본 비밀번호는 000000입니다. (데이터입력 양식은 별도 설정 필요)');
    renderSidebar();
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function renameCenterPrompt(code) {
  const meta = allCentersMeta.find(function(c) { return c.center_code === code; });
  const name = prompt('새 센터 이름을 입력하세요:', meta ? meta.center_name : '');
  if (!name) return;
  fetch(SB_FUNCTION_URL + '?action=center-update', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_password: workspacePasswordCache, center_code: code, center_name: name.trim() })
  }).then(function(r) { return r.json(); }).then(async function(data) {
    if (!data.success) { alert('수정 실패: ' + data.error); return; }
    await loadCentersMeta();
    renderSidebar();
    if (code === currentCenter) renderMain();
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function deleteCenterPrompt(code) {
  const meta = allCentersMeta.find(function(c) { return c.center_code === code; });
  if (!confirm((meta ? meta.center_name : code) + ' 센터를 삭제하시겠습니까?\n등록된 실적 데이터는 DB에 남지만 목록에서는 사라집니다.')) return;
  fetch(SB_FUNCTION_URL + '?action=center-delete', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_password: workspacePasswordCache, center_code: code })
  }).then(function(r) { return r.json(); }).then(async function(data) {
    if (!data.success) { alert('삭제 실패: ' + data.error); return; }
    delete centerTokenMap[code];
    unlockedCenters.delete(code);
    persistSession();
    await loadCentersMeta();
    if (currentCenter === code) currentCenter = null;
    await refreshAfterAuthChange();
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function moveCenterOrder(code, dir) {
  const sorted = allCentersMeta.slice().sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  const idx = sorted.findIndex(function(c) { return c.center_code === code; });
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  const tmp = a.sort_order; a.sort_order = b.sort_order; b.sort_order = tmp;
  allCentersMeta = allCentersMeta.map(function(c) {
    if (c.center_code === a.center_code) return Object.assign({}, c, { sort_order: a.sort_order });
    if (c.center_code === b.center_code) return Object.assign({}, c, { sort_order: b.sort_order });
    return c;
  });
  renderSidebar();
  fetch(SB_FUNCTION_URL + '?action=center-reorder', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_password: workspacePasswordCache,
      orders: [{ center_code: a.center_code, sort_order: a.sort_order }, { center_code: b.center_code, sort_order: b.sort_order }]
    })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data.success) alert('순서 변경 실패: ' + data.error);
  }).catch(function(e) { alert('오류: ' + e.message); });
}

async function tryDomainAutoUnlock() {
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=domain-auto-unlock', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success && data.valid) {
      workspaceUnlocked = true;
      centerTokenMap = {};
      (data.centers || []).forEach(function(c) { centerTokenMap[c.center_code] = c.upload_token; });
      return true;
    }
  } catch (e) { /* 무시하고 일반 로그인 절차로 진행 */ }
  return false;
}

// 데이터입력의 모든 업로드 박스(.panel, .entry-wrap)에 파일 드래그앤드롭 첨부를 공통 적용
// #main에 한 번만 이벤트를 걸어두고(이벤트 위임), 화면이 다시 그려져도 계속 동작한다.
function initDragDropZones() {
  const main = document.getElementById('main');
  if (!main || main.dataset.dndBound) return;
  main.dataset.dndBound = '1';

  main.addEventListener('dragover', function(e) {
    const zone = e.target.closest('.panel, .entry-wrap');
    if (!zone || !zone.querySelector('input[type="file"]')) return;
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  main.addEventListener('dragleave', function(e) {
    const zone = e.target.closest('.panel, .entry-wrap');
    if (zone) zone.classList.remove('drag-over');
  });
  main.addEventListener('drop', function(e) {
    const zone = e.target.closest('.panel, .entry-wrap');
    if (!zone) return;
    const input = zone.querySelector('input[type="file"]');
    if (!input) return;
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

async function init() {
  restoreSession();
  await loadCentersMeta();
  const autoUnlocked = await tryDomainAutoUnlock();
  if (!autoUnlocked && workspaceUnlocked) { await tryWorkspaceLogin(workspacePasswordCache, true); }
  const available = allCentersMeta.filter(function(c) { return workspaceUnlocked || unlockedCenters.has(c.center_code); });
  if (workspaceUnlocked) {
    viewingWorkspaceOverview = true;
  } else if (available.length > 0) {
    currentCenter = available[0].center_code;
  }
  renderTopbarAuth();
  loadColPrefs();
  renderSidebar();

  // 새로고침 직후라도 마지막으로 봤던 센터의 캐시가 있으면, 네트워크 응답을 기다리지 않고 먼저 그 데이터로 화면부터 그린다.
  if (!viewingWorkspaceOverview && currentCenter) {
    const cached = getCachedRows(currentCenter);
    if (cached) { allRows = cached; renderMain(); }
  }

  // 설정데이터(월별TO/핵심지표)와 실적 데이터는 서로 의존하지 않으므로 병렬로 불러와 초기 로딩 시간을 단축한다
  await Promise.all([
    loadAllSettingsData(),
    loadLastUploadMap(),
    viewingWorkspaceOverview ? loadAllCentersOverview() : (currentCenter ? loadOverviewForCurrent() : Promise.resolve())
  ]);
  renderSidebar(); // 신호등 데이터 반영해 다시 그림
  renderMain();
  initDragDropZones();
}

// 반환값: 실제로 화면에 보이는 데이터(allRows)가 바뀌었는지 여부.
// true면 호출부에서 renderMain()을 다시 불러야 하고, false면 이미 캐시로 보여준 화면 그대로 둬도 된다
// (같은 내용을 또 그리는 불필요한 재렌더링을 피하기 위함).
async function loadOverviewForCurrent() {
  try {
    // 이 함수는 "특정 센터 화면"(대시보드/데이터입력 등)에서만 호출된다 — 워크스페이스 전체현황은
    // 별도로 loadAllCentersOverview()가 전체 센터 데이터를 불러온다. 그런데 예전엔 관리자(workspaceUnlocked)일
    // 때 여기서도 센터 필터 없이 "전체 센터 통틀어 최근 300건"을 요청했었다. 센터가 여러 개면 다른 센터들의
    // 최근 데이터만으로 300건이 채워져서, 지금 보는 센터의 오래된 데이터는 실제로 저장돼 있어도
    // 대시보드/조회 어디에도 안 나오는 버그가 있었다 — 항상 이 센터로 한정해서 요청하도록 수정.
    const centerParam = '&center=' + encodeURIComponent(currentCenter);
    const needsSchema = categorySchemaCache[currentCenter] === undefined;
    const token = centerTokenMap[currentCenter];
    const targetCenter = currentCenter; // 응답이 오는 동안 센터를 또 바꿨을 경우를 대비해 고정

    const overviewPromise = fetch(SB_FUNCTION_URL + '?action=admin-overview' + centerParam + '&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' }).then(function(r) { return r.json(); });
    const schemaPromise = (needsSchema && token)
      ? fetch(SB_FUNCTION_URL + '?action=schema&token=' + encodeURIComponent(token) + '&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' }).then(function(r) { return r.json(); })
      : Promise.resolve(null);

    const [data, sdata] = await Promise.all([overviewPromise, schemaPromise]);

    // 응답이 오는 사이에 다른 센터로 이동했다면 이 응답은 더 이상 최신이 아니므로 버린다(화면 덮어쓰기 방지)
    if (targetCenter !== currentCenter) return false;

    let changed = false;
    if (data.success) {
      const newRows = data.rows || [];
      changed = JSON.stringify(newRows) !== JSON.stringify(allRows);
      allRows = newRows;
      setCachedRows(targetCenter, newRows);
    }

    if (needsSchema) {
      categorySchemaCache[currentCenter] = (sdata && sdata.success) ? (sdata.category_schema || []) : [];
    }
    return changed;
  } catch (e) {
    document.getElementById('main').innerHTML = '<div class="empty">데이터 로드 실패: ' + e.message + '</div>';
    return false;
  }
}

let viewingWorkspaceOverview = false;
let viewingSettingsPage = false;
let viewingUploadArchive = false;
let viewingNotificationSettings = false;
let categorySchemaCache = {}; // 센터별 업무유형별 스키마 캐시 (누락되어 ReferenceError를 일으키던 선언 추가)
let monthlyToCache = {};
let kpiSettingsCache = {};
let kpiMonthlyTargetsCache = {};
let settingsYear = new Date().getFullYear();

function renderSidebarCustom() {
  const area = document.getElementById('sidebarCustomArea');
  if (!area) return;
  if (!workspaceUnlocked) {
    area.innerHTML = '<div class="sidebar-custom">'
      + '<button class="sidebar-custom-locked" onclick="unlockCustomPanel()">🔒 커스터마이징 (관리자화면 비밀번호 필요)</button>'
      + '</div>';
    return;
  }
  area.innerHTML = '<details class="sidebar-custom">'
    + '<summary>⚙ 커스터마이징</summary>'
    + '<div class="sidebar-custom-body">'
    + '<a href="https://claude.ai/chat/3f1eb3bd-7071-41f6-9bb4-6f3c95c65ca1" target="_blank" rel="noopener">💬 이 채팅방 (Claude 대화)</a>'
    + '<a href="https://github.com/20oioi20-byte/kkangbi-report/blob/main/admin.html" target="_blank" rel="noopener">🐙 GitHub 저장소 (admin.html)</a>'
    + '<a href="https://supabase.com/dashboard/project/zbiwyqwjehnogxkzlhxx/sql/92974b5d-555f-48c7-957f-d666b743fd3b" target="_blank" rel="noopener">🗄 Supabase 대시보드</a>'
    + '<a href="https://vercel.com/kangseongho-s-projects/kkangbi-report" target="_blank" rel="noopener">▲ Vercel 대시보드</a>'
    + '<div class="sidebar-custom-key">'
    + '<div style="font-size:11px;color:#86868b;margin-bottom:4px;">Supabase Anon Key (공개용)</div>'
    + '<div class="key-row">'
    + '<input type="text" readonly id="sidebarAnonKeyDisplay" value="' + SB_ANON_KEY + '">'
    + '<button onclick="copySidebarAnonKey()" title="복사">복사</button>'
    + '</div></div></div></details>';
}

async function unlockCustomPanel() {
  if (workspaceUnlocked) { renderSidebarCustom(); return; }
  const pw = (prompt('관리자화면 비밀번호를 입력하세요:') || '').trim();
  if (!pw) return;
  const ok = await tryWorkspaceLogin(pw, false);
  if (ok) {
    renderTopbarAuth();
    renderSidebar();
    if (!currentCenter && !viewingWorkspaceOverview) { await selectWorkspaceOverview(); } else { renderSidebarCustom(); }
  }
}

function copySidebarAnonKey() {
  const input = document.getElementById('sidebarAnonKeyDisplay');
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(function() {
    const btn = event.target;
    const old = btn.textContent;
    btn.textContent = '복사됨';
    setTimeout(function() { btn.textContent = old; }, 1500);
  }).catch(function() { alert('복사에 실패했습니다. 직접 선택해 복사해 주세요.'); });
}

// 상단 고정 탭이 사라진 대신, 사이드바에서 현재 선택된 센터 바로 아래에만 노출된다.
const MAIN_TABS = [
  { key: 'dashboard', label: '📊 대시보드' },
  { key: 'entry', label: '✏️ 데이터입력' },
  { key: 'issues', label: '📝 이슈 및 히스토리' },
  { key: 'settings', label: '🎯 TO 및 목표값설정' }
];

function renderCenterSubmenu(code) {
  if (currentCenter !== code || viewingWorkspaceOverview || viewingUploadArchive || viewingNotificationSettings) return '';
  return '<div class="center-submenu">' + MAIN_TABS.map(function(t) {
    return '<div class="center-subitem ' + (currentMainTab === t.key ? 'active' : '') + '" onclick="event.stopPropagation();switchMainTab(\'' + t.key + '\')">' + t.label + '</div>';
  }).join('') + '</div>';
}

function filterCenterList(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#centerList .center-item').forEach(function(el) {
    const text = (el.getAttribute('title') || el.textContent || '').toLowerCase();
    const show = (!q || text.includes(q));
    el.style.display = show ? '' : 'none';
    const submenu = el.nextElementSibling;
    if (submenu && submenu.classList.contains('center-submenu')) submenu.style.display = show ? '' : 'none';
  });
}

function renderSidebar() {
  renderSidebarCustom();
  const listLabel = document.getElementById('centerListLabel');
  if (listLabel) listLabel.textContent = '센터 (' + allCentersMeta.length + ')';
  const list = document.getElementById('centerList');
  const overviewHtml = workspaceUnlocked
    ? '<div class="center-item ' + (viewingWorkspaceOverview ? 'active' : '') + '" onclick="selectWorkspaceOverview()" style="font-weight:700;border-bottom:1px solid #2a2e38;margin-bottom:4px;">'
      + '<span class="center-name-text">📊 전체 현황</span>'
      + '</div>'
    : '';

  const archiveHtml = workspaceUnlocked
    ? '<div class="center-item ' + (viewingUploadArchive ? 'active' : '') + '" onclick="selectUploadArchive()" style="font-weight:700;border-bottom:1px solid #2a2e38;margin-bottom:4px;">'
      + '<span class="center-name-text">📁 업로드 자료함</span>'
      + '</div>'
    : '';
  const notifyHtml = workspaceUnlocked
    ? '<div class="center-item ' + (viewingNotificationSettings ? 'active' : '') + '" onclick="selectNotificationSettings()" style="font-weight:700;border-bottom:1px solid #2a2e38;margin-bottom:4px;">'
      + '<span class="center-name-text">🔔 알림 설정</span>'
      + '</div>'
    : '';

  if (allCentersMeta.length === 0) { list.innerHTML = overviewHtml + archiveHtml + notifyHtml + '<div class="empty">등록된 센터가 없습니다.</div>'; return; }

  const sorted = allCentersMeta.slice().sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

  list.innerHTML = overviewHtml + archiveHtml + notifyHtml + sorted.map(function(c, idx) {
    const isUnlocked = workspaceUnlocked || unlockedCenters.has(c.center_code);
    const lockIcon = isUnlocked ? '' : '🔒 ';
    const activeCls = (!viewingWorkspaceOverview && c.center_code === currentCenter) ? 'active' : '';
    const signal = getCenterUploadSignal(c.center_code);
    const signalDot = '<span class="signal-dot signal-' + signal.color + '" title="' + signal.label + '"></span>';
    const adminControls = workspaceUnlocked
      ? '<span class="center-admin-controls" onclick="event.stopPropagation();">'
        + '<button class="mv" onclick="moveCenterOrder(\'' + c.center_code + '\',-1)" title="위로" ' + (idx === 0 ? 'disabled' : '') + '>▲</button>'
        + '<button class="mv" onclick="moveCenterOrder(\'' + c.center_code + '\',1)" title="아래로" ' + (idx === sorted.length - 1 ? 'disabled' : '') + '>▼</button>'
        + '<span class="kebab-wrap">'
        + '<button class="mv" onclick="toggleCenterMenu(event, \'' + c.center_code + '\')" title="더보기">⋯</button>'
        + '<div class="kebab-menu" id="kebabMenu_' + c.center_code + '">'
        + '<button onclick="closeCenterMenus();renameCenterPrompt(\'' + c.center_code + '\')">✎ 이름변경</button>'
        + '<button onclick="closeCenterMenus();deleteCenterPrompt(\'' + c.center_code + '\')" class="danger">✕ 삭제</button>'
        + '</div>'
        + '</span>'
        + '</span>'
      : '';
    return '<div class="center-item ' + activeCls + '" onclick="selectCenter(\'' + c.center_code + '\')" title="' + c.center_name + ' · ' + signal.label + '">'
      + '<span class="center-name-text">' + signalDot + '🏢 ' + lockIcon + c.center_name + '</span>'
      + adminControls
      + '</div>'
      + renderCenterSubmenu(c.center_code);
  }).join('')
  + (workspaceUnlocked ? '<div class="add-center" style="cursor:pointer;color:#FE2E36;font-weight:600;" onclick="addCenterPrompt()">+ 센터 추가</div>' : '')
  ;
}

// ============================================
// 센터별 업로드 신호등 (초록: 3일 이내 / 주황: 3일째 미업로드 / 빨강: 7일째 미업로드)
// ============================================
let lastUploadMap = {}; // { center_code: 'ISO timestamp' }

async function loadLastUploadMap() {
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=list-last-upload&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
    const data = await res.json();
    lastUploadMap = data.success ? (data.lastUpload || {}) : {};
  } catch (e) { lastUploadMap = {}; }
}

function getCenterUploadSignal(centerCode) {
  const last = lastUploadMap[centerCode];
  if (!last) return { color: 'gray', label: '업로드 기록 없음', days: null };
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  if (days < 3) return { color: 'green', label: '정상 (최근 ' + days + '일 이내 업로드)', days: days };
  if (days < 7) return { color: 'orange', label: '주의 (' + days + '일째 업로드 없음)', days: days };
  return { color: 'red', label: '경고 (' + days + '일째 업로드 없음)', days: days };
}

function toggleCenterMenu(evt, code) {
  evt.stopPropagation();
  const menu = document.getElementById('kebabMenu_' + code);
  const isOpen = menu.classList.contains('open');
  closeCenterMenus();
  if (!isOpen) menu.classList.add('open');
}

function closeCenterMenus() {
  document.querySelectorAll('.kebab-menu.open').forEach(function(m) { m.classList.remove('open'); });
}
document.addEventListener('click', closeCenterMenus);

async function loadAllCentersOverview() {
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=admin-overview&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
    const data = await res.json();
    if (data.success) { allRows = data.rows || []; }
  } catch (e) {
    document.getElementById('main').innerHTML = '<div class="empty">데이터 로드 실패: ' + e.message + '</div>';
  }
}

async function selectWorkspaceOverview(forceRefresh) {
  viewingWorkspaceOverview = true;
  viewingSettingsPage = false;
  viewingUploadArchive = false;
  viewingNotificationSettings = false;
  renderSidebar();
  renderTopbarAuth();
  await Promise.all([loadAllCentersOverview(), loadAllSettingsData(forceRefresh), loadLastUploadMap()]);
  renderMain();
}

async function selectSettingsPage() {
  viewingWorkspaceOverview = false;
  viewingSettingsPage = true;
  viewingUploadArchive = false;
  viewingNotificationSettings = false;
  renderSidebar();
  renderTopbarAuth();
  await loadAllSettingsData();
  renderMain();
}

async function selectUploadArchive() {
  viewingWorkspaceOverview = false;
  viewingSettingsPage = false;
  viewingUploadArchive = true;
  viewingNotificationSettings = false;
  renderSidebar();
  renderTopbarAuth();
  await loadUploadArchive();
  renderMain();
}

async function selectNotificationSettings() {
  viewingWorkspaceOverview = false;
  viewingSettingsPage = false;
  viewingUploadArchive = false;
  viewingNotificationSettings = true;
  renderSidebar();
  renderTopbarAuth();
  await loadNotificationData();
  renderMain();
}

let settingsDataLoadedAt = 0;
const SETTINGS_CACHE_TTL_MS = 15000; // 탭을 자주 오갈 때 매번 재조회하지 않도록 15초간 캐시 재사용

async function loadAllSettingsData(force) {
  if (!force && Date.now() - settingsDataLoadedAt < SETTINGS_CACHE_TTL_MS) return; // 캐시 유효 → 네트워크 호출 생략
  try {
    const ts = Date.now();
    const [toRes, kpiRes, kpiMonthlyRes] = await Promise.all([
      fetch(SB_FUNCTION_URL + '?action=list-monthly-to&_ts=' + ts, { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' }),
      fetch(SB_FUNCTION_URL + '?action=list-kpi-settings&_ts=' + ts, { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' }),
      fetch(SB_FUNCTION_URL + '?action=list-kpi-monthly-targets&_ts=' + ts, { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' })
    ]);
    const [toData, kpiData, kpiMonthlyData] = await Promise.all([toRes.json(), kpiRes.json(), kpiMonthlyRes.json()]);

    monthlyToCache = {};
    (toData.settings || []).forEach(function(s) {
      if (!monthlyToCache[s.center_code]) monthlyToCache[s.center_code] = [];
      monthlyToCache[s.center_code].push(s);
    });

    kpiSettingsCache = {};
    (kpiData.settings || []).forEach(function(s) {
      if (!kpiSettingsCache[s.center_code]) kpiSettingsCache[s.center_code] = [];
      kpiSettingsCache[s.center_code].push(s);
    });

    kpiMonthlyTargetsCache = {};
    (kpiMonthlyData.targets || []).forEach(function(t) {
      if (!kpiMonthlyTargetsCache[t.center_code]) kpiMonthlyTargetsCache[t.center_code] = {};
      if (!kpiMonthlyTargetsCache[t.center_code][t.metric_key]) kpiMonthlyTargetsCache[t.center_code][t.metric_key] = {};
      kpiMonthlyTargetsCache[t.center_code][t.metric_key][t.year_month] = t.target_value;
    });
    settingsDataLoadedAt = Date.now();
  } catch (e) { /* 실패 시 캐시가 비워진 채 진행됨(설정 없음으로 처리) */ }
}

function getMonthlyTO(centerCode, yearMonth) {
  const list = monthlyToCache[centerCode] || [];
  return list.find(function(s) { return s.year_month === yearMonth; }) || null;
}

// 지표별 월별 목표치 조회 (없으면 null → 호출부에서 기본 목표값/기준선으로 폴백)
function getMonthlyKpiTarget(centerCode, key, yearMonth) {
  const m = kpiMonthlyTargetsCache[centerCode];
  if (!m || !m[key]) return null;
  const v = m[key][yearMonth];
  return (v !== undefined && v !== null) ? v : null;
}

// 센터를 새로 선택(전환)할 때마다 화면 상태를 초기값으로 되돌린다.
// (탭/기간 선택이 이전 센터에서 보던 상태로 고정되어 넘어오는 문제 방지)
function resetDashboardStateForNewCenter() {
  currentMainTab = 'dashboard';
  currentMonth = localDateStr(new Date()).slice(0, 7);
  viewMode = 'single';
  aggView = 'daily';
}

async function selectCenter(code) {
  if (!workspaceUnlocked && !unlockedCenters.has(code)) { promptCenterPassword(code); return; }
  viewingSettingsPage = false;
  viewingWorkspaceOverview = false;
  viewingUploadArchive = false;
  viewingNotificationSettings = false;
  if (currentCenter !== code) resetDashboardStateForNewCenter();
  currentCenter = code;
  loadColPrefs();
  renderSidebar();
  renderTopbarAuth();

  // 이 센터를 이전에 본 적이 있으면(캐시 있음) 네트워크 응답을 기다리지 않고 먼저 그 데이터로 화면을 그린다.
  // 그 뒤 실제 최신 데이터를 받아와서, 캐시와 다를 때만 조용히 한 번 더 갱신한다(같으면 재렌더링 생략).
  const cached = getCachedRows(code);
  if (cached) { allRows = cached; renderMain(); }

  const changed = await loadOverviewForCurrent();
  if (!cached || changed) renderMain();
}

// 센터 옆 서브메뉴(대시보드/데이터입력/이슈 및 히스토리/TO 및 목표값설정) 전환.
// 상단 고정 탭 대신 사이드바에서 센터별로 노출된다.
function switchMainTab(tab) {
  currentMainTab = tab;
  renderSidebar();
  renderMain();
}

function toggleBackupPanel() {
  document.getElementById('backupPanel').classList.toggle('open');
}

function renderMain() {
  if (viewingWorkspaceOverview) { renderWorkspaceOverview(); return; }
  if (viewingUploadArchive) { renderUploadArchive(); return; }
  if (viewingNotificationSettings) { renderNotificationSettings(); return; }
  if (!currentCenter) {
    document.getElementById('main').innerHTML = '<div class="empty" style="padding:100px 24px;">왼쪽에서 센터를 선택해 비밀번호를 입력하거나,<br>상단의 "관리자화면 로그인"으로 전체 센터를 확인하세요.</div>';
    return;
  }
  if (currentMainTab === 'dashboard') renderDashboard();
  else if (currentMainTab === 'issues') renderIssues();
  else if (currentMainTab === 'settings') renderCenterSettingsTab();
  else renderEntry();
}

let colPrefs = { order: [], hidden: [] };
let colPopoverOpen = false;

function colPrefsKey() { return 'kkangbi_cols_' + currentCenter; }
function presetsKey() { return 'kkangbi_colpresets_' + currentCenter; }
function pinnedPresetKey() { return 'kkangbi_pinned_preset_' + currentCenter; }

function getPinnedPresetName() {
  try { return localStorage.getItem(pinnedPresetKey()) || null; } catch (e) { return null; }
}
function setPinnedPresetName(name) {
  try {
    if (name) localStorage.setItem(pinnedPresetKey(), name);
    else localStorage.removeItem(pinnedPresetKey());
  } catch (e) { /* ignore */ }
}

// 고정된 설정이 있으면 항상 그 설정을 최우선 적용 (재접속·탭 이동과 무관하게 유지)
function applyPinnedPresetIfAny() {
  const pinned = getPinnedPresetName();
  if (!pinned) return;
  const preset = loadPresets().find(function(p) { return p.name === pinned; });
  if (preset) {
    colPrefs = { order: preset.order.slice(), hidden: preset.hidden.slice() };
    saveColPrefs();
  }
}

function togglePinPreset(name, checked) {
  if (checked) {
    setPinnedPresetName(name);
    applyPreset(name);
  } else {
    if (getPinnedPresetName() === name) setPinnedPresetName(null);
    colPopoverOpen = true;
    refreshTablePanel();
  }
}

function loadColPrefs() {
  try {
    const raw = localStorage.getItem(colPrefsKey());
    colPrefs = raw ? JSON.parse(raw) : { order: [], hidden: [] };
  } catch (e) { colPrefs = { order: [], hidden: [] }; }
  applyPinnedPresetIfAny(); // 고정 설정이 있으면 마지막 조작 상태보다 항상 우선 적용
}

function saveColPrefs() {
  localStorage.setItem(colPrefsKey(), JSON.stringify(colPrefs));
}

function loadPresets() {
  try {
    const raw = localStorage.getItem(presetsKey());
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function savePresetsList(list) {
  localStorage.setItem(presetsKey(), JSON.stringify(list));
}

function saveCurrentAsPreset() {
  const input = document.getElementById('presetNameInput');
  const name = (input.value || '').trim();
  if (!name) { input.focus(); return; }
  const presets = loadPresets().filter(function(p) { return p.name !== name; });
  presets.push({ name: name, order: colPrefs.order.slice(), hidden: colPrefs.hidden.slice() });
  savePresetsList(presets);
  colPopoverOpen = true;
  refreshTablePanel();
}

function applyPreset(name) {
  const preset = loadPresets().find(function(p) { return p.name === name; });
  if (!preset) return;
  colPrefs = { order: preset.order.slice(), hidden: preset.hidden.slice() };
  saveColPrefs();
  colPopoverOpen = true;
  refreshTablePanel();
}

function deletePreset(name) {
  savePresetsList(loadPresets().filter(function(p) { return p.name !== name; }));
  if (getPinnedPresetName() === name) setPinnedPresetName(null);
  colPopoverOpen = true;
  refreshTablePanel();
}

function ensureColOrder(allKeys) {
  const known = colPrefs.order.filter(function(k) { return allKeys.includes(k); });
  const newKeys = allKeys.filter(function(k) { return !known.includes(k); });
  colPrefs.order = known.concat(newKeys);
  saveColPrefs();
  return colPrefs.order.filter(function(k) { return !colPrefs.hidden.includes(k); });
}

function moveCol(key, dir) {
  const idx = colPrefs.order.indexOf(key);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= colPrefs.order.length) return;
  const tmp = colPrefs.order[idx];
  colPrefs.order[idx] = colPrefs.order[swapIdx];
  colPrefs.order[swapIdx] = tmp;
  saveColPrefs();
  colPopoverOpen = true;
  refreshTablePanel();
}

function toggleColVisible(key) {
  if (colPrefs.hidden.includes(key)) colPrefs.hidden = colPrefs.hidden.filter(function(k) { return k !== key; });
  else colPrefs.hidden.push(key);
  saveColPrefs();
  colPopoverOpen = true;
  refreshTablePanel();
}

function setAllColsVisible(show) {
  colPrefs.hidden = show ? [] : colPrefs.order.slice();
  saveColPrefs();
  colPopoverOpen = true;
  refreshTablePanel();
}

function toggleColPopover() {
  colPopoverOpen = !colPopoverOpen;
  refreshTablePanel();
}

function computeSortedTargetRows() {
  const centerRows = allRows.filter(function(r) { return r.center_code === currentCenter; });
  const parts = currentMonth.split('-').map(Number);
  const y = parts[0], m = parts[1];
  const monthRows = centerRows.filter(function(r) { return r.report_date.startsWith(currentMonth); });
  const cumulativeRows = centerRows.filter(function(r) {
    const d = new Date(r.report_date);
    return d.getFullYear() === y && (d.getMonth() + 1) <= m;
  });
  const quarterStart = Math.floor((m - 1) / 3) * 3 + 1;
  const quarterRows = centerRows.filter(function(r) {
    const d = new Date(r.report_date);
    const mm = d.getMonth() + 1;
    return d.getFullYear() === y && mm >= quarterStart && mm <= m;
  });
  const halfStart = m <= 6 ? 1 : 7;
  const halfRows = centerRows.filter(function(r) {
    const d = new Date(r.report_date);
    const mm = d.getMonth() + 1;
    return d.getFullYear() === y && mm >= halfStart && mm <= m;
  });
  const targetRows = viewMode === 'single' ? monthRows
    : viewMode === 'quarter' ? quarterRows
    : viewMode === 'half' ? halfRows
    : cumulativeRows;
  let sortedTarget = targetRows.slice().sort(function(a, b) { return a.report_date.localeCompare(b.report_date); });
  if (aggView === 'quarter' || aggView === 'half') {
    sortedTarget = cumulativeRows.slice().sort(function(a, b) { return a.report_date.localeCompare(b.report_date); });
  }
  return sortedTarget;
}

function buildTablePanelInner(sortedTarget) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
    + '<h3 style="margin:0;">' + aggLabel(aggView) + ' 현황 (' + sortedTarget.length + '건 기준)</h3>'
    + '<div style="display:flex;gap:6px;align-items:center;">'
    + '<button class="copy-icon-btn" title="표 복사" onclick="copyTableToClipboard()">' + COPY_ICON_SVG + '</button>'
    + (aggView === 'daily' ? renderColToggleButton(sortedTarget) : '')
    + '</div>'
    + '</div>'
    + '<div id="tableArea">' + (sortedTarget.length === 0 ? '<div class="empty">해당 기간에 등록된 실적이 없습니다.</div>' : renderAggTable(sortedTarget, aggView)) + '</div>'
    ;
}

function bindColToggleButton() {
  document.querySelectorAll('.col-toggle-btn').forEach(function(btn) {
    btn.onclick = function() { toggleColPopover(); };
  });
}

// 표시항목 체크·순서변경·프리셋 적용 시 그래프는 그대로 두고 표 영역만 갱신
// (그래프까지 다시 그리면 캔버스가 파괴·재생성되며 화면이 출렁이는 문제가 있었음)
function refreshTablePanel() {
  const panel = document.getElementById('tablePanel');
  if (!panel) { renderDashboard(); return; }

  const scrollY = window.scrollY;
  const prevPopover = document.getElementById('colPopover');
  const popoverScrollTop = prevPopover ? prevPopover.scrollTop : 0;
  const prevTableScroll = panel.querySelector('.table-scroll');
  const tableScrollLeft = prevTableScroll ? prevTableScroll.scrollLeft : 0;

  const sortedTarget = computeSortedTargetRows();
  panel.innerHTML = buildTablePanelInner(sortedTarget);
  bindColToggleButton();

  const newPopover = document.getElementById('colPopover');
  if (newPopover) newPopover.scrollTop = popoverScrollTop;
  const newTableScroll = panel.querySelector('.table-scroll');
  if (newTableScroll) newTableScroll.scrollLeft = tableScrollLeft;
  window.scrollTo(0, scrollY);
}

// ============================================
// 워크스페이스 전체 현황 (상단 종합지표 + 요약 테이블형, KT 스타일)
// 센터가 추가/삭제/변경되어도 등록된 설정(CENTER_TO_INFO, CENTER_CHART_CONFIG)만
// 있으면 자동으로 행이 생기고, 없으면 "대기"로 처리되어 유연하게 대응한다.
// ============================================

// 센터별 기본 핵심지표 세트 (설정 화면에서 커스텀 등록을 하지 않았을 때 사용되는 기본값)
// 워크스페이스 핵심지표 표시 시, "값이 100 이하면 %로 표시" 같은 추측 대신 지표 키 기준으로 정확한 단위를 지정
const METRIC_UNITS = { '생산성_INOUT': '건', '생산성_IN': '건', '통화시간_INOUT_초': 'duration' };

const DEFAULT_HEADLINE_METRICS = {
  'kbsonhae': [{ label: '제휴상담 SL', key: '제휴상담_SL' }, { label: '장기손사 SL', key: '장기손사_SL' }],
  'kbjeongbi': [{ label: '고지위반 처리율', key: '고지의무_처리율' }, { label: '통지위반 처리율', key: '통지의무_처리율' }, { label: '목적물소멸 처리율', key: '목적물소멸_처리율' }],
  'pyeongtaek': [{ label: '응대율', key: '응대율' }],
  'lge': [{ label: 'T-NPS', key: 'TNPS' }, { label: '생산성(IN+OUT)', key: '생산성_INOUT', unit: '건' }, { label: '통화시간(IN+OUT)', key: '통화시간_INOUT_초', unit: 'duration' }],
  'lge_seongsu': [{ label: 'T-NPS', key: 'TNPS' }, { label: '생산성(IN+OUT)', key: '생산성_INOUT', unit: '건' }, { label: '통화시간(IN+OUT)', key: '통화시간_INOUT_초', unit: 'duration' }],
  'lge_total': [{ label: 'T-NPS', key: 'TNPS' }, { label: '생산성(IN+OUT)', key: '생산성_INOUT', unit: '건' }, { label: '통화시간(IN+OUT)', key: '통화시간_INOUT_초', unit: 'duration' }]
};

// 특정 지표 키에 대해 CENTER_CHART_CONFIG에 등록된 기준선(threshold)이 있으면 반환
function findThresholdForKey(code, key) {
  const chartConfig = CENTER_CHART_CONFIG[code];
  if (!chartConfig || !chartConfig.groups) return null;
  for (let i = 0; i < chartConfig.groups.length; i++) {
    const g = chartConfig.groups[i];
    if (g.threshold && g.threshold.key === key) return g.threshold;
  }
  return null;
}

function computeCenterHeadline(code, rows) {
  const savedCenter = currentCenter;
  currentCenter = code; // resolveMetric 등 계산지표 함수가 currentCenter를 참조하므로 임시 전환
  try {
    const toInfo = CENTER_TO_INFO[code];
    const chartConfig = CENTER_CHART_CONFIG[code];
    const sorted = rows.slice().sort(function(a, b) { return b.report_date.localeCompare(a.report_date); });
    const latest = sorted[0] || null;

    if (!latest) return { status: 'pending', staffText: null, metrics: [], updated: null };

    // 이상징후 판정·재직인원·핵심지표는 모두 "마지막 저장일 하루"가 아니라
    // 연초~최신 데이터월까지의 누적 일평균값(주말·공휴일 제외)을 기준으로 계산한다.
    const ym = latest.report_date.slice(0, 7);
    const y = Number(ym.slice(0, 4));
    const cumRows = rows.filter(function(r) {
      const ry = Number(r.report_date.slice(0, 4));
      return ry === y && r.report_date.slice(0, 7) <= ym;
    });
    const monthRows = rows.filter(function(r) { return r.report_date.slice(0, 7) === ym; });

    const monthlyTO = getMonthlyTO(code, ym);
    let staffText = null;
    const staffAttKey = toInfo ? toInfo.staffAttKey : null;
    const staffAvg = staffAttKey ? avgExcludingHolidays(cumRows, function(r) { return extractNum(r, 'attendance_data', staffAttKey); }) : null;
    if (monthlyTO) {
      const totalTO = (monthlyTO.to_manager || 0) + (monthlyTO.to_counselor || 0);
      if (staffAvg !== null && totalTO) {
        staffText = staffAvg.toFixed(1) + '명 / ' + totalTO + '명 (' + (staffAvg / totalTO * 100).toFixed(0) + '%)';
      } else if (totalTO) {
        staffText = '정원 ' + totalTO + '명 (관리자 ' + monthlyTO.to_manager + '·상담사 ' + monthlyTO.to_counselor + ')';
      }
    } else if (toInfo && staffAvg !== null) {
      staffText = staffAvg.toFixed(1) + '명 / ' + toInfo.total + '명 (' + (staffAvg / toInfo.total * 100).toFixed(0) + '%)';
    }

    // 핵심지표: 설정 화면에서 등록한 지표가 있으면 그것(전체)을 사용, 없으면 센터별 기본 지표세트 사용
    const customKpis = (kpiSettingsCache[code] || []).slice().sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    const defs = customKpis.length > 0
      ? customKpis.map(function(k) { return { label: k.metric_label, key: k.metric_key, target: k.target_value }; })
      : (DEFAULT_HEADLINE_METRICS[code] || []);
    const hasConfig = defs.length > 0;

    const metrics = defs.map(function(d) {
      const val = avgMetricValue(d.key, cumRows);
      const monthVal = avgMetricValue(d.key, monthRows);
      // 지표별 월별 목표치가 등록되어 있으면 최우선 사용 (연도+해당월 기준), 없으면 기존 방식(등록된 단일 목표값 → 차트 기준선)
      let target = getMonthlyKpiTarget(code, d.key, ym);
      if (target === null) target = (d.target !== null && d.target !== undefined) ? d.target : null;
      if (target === null) { const th = findThresholdForKey(code, d.key); if (th) target = th.value; }
      const isWarn = (val !== null && target !== null) ? (val < target) : false;
      const unit = METRIC_UNITS[d.key] || d.unit || null; // 지표 출처(설정화면 등록 vs 기본값)와 무관하게 항상 올바른 단위 적용
      return { label: d.label, value: val, monthValue: monthVal, target: target, isWarn: isWarn, unit: unit };
    });
    const isWarn = metrics.some(function(m) { return m.isWarn; });

    const status = !hasConfig ? 'pending' : (isWarn ? 'warn' : 'ok');
    return { status: status, staffText: staffText, staffAvg: staffAvg, metrics: metrics, updated: latest.report_date };
  } finally {
    currentCenter = savedCenter;
  }
}

function formatHeadlineMetric(m) {
  const fmt = function(v) {
    if (v === null) return '-';
    if (m.unit === 'duration') return formatSecondsHMS(v);
    if (m.unit) return v.toFixed(1) + m.unit;
    return v.toFixed(1) + (Math.abs(v) <= 100 ? '%' : '');
  };
  if (m.value === null && m.monthValue === null) return m.label + ' -';
  // 이번달 값과 연초~이번달 누적평균값을 함께 표기해, "왜 이 값이 나왔는지" 산출 기준을 항상 알 수 있게 한다.
  if (m.monthValue !== null && m.value !== null && m.monthValue.toFixed(1) !== m.value.toFixed(1)) {
    return m.label + ' ' + fmt(m.monthValue) + ' <span style="color:#86868b;font-weight:400;">(누적 ' + fmt(m.value) + ')</span>';
  }
  return m.label + ' ' + fmt(m.value !== null ? m.value : m.monthValue);
}

function renderWorkspaceOverview() {
  const main = document.getElementById('main');
  const sorted = allCentersMeta.slice().sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

  const centerStats = sorted.map(function(c) {
    const rows = allRows.filter(function(r) { return r.center_code === c.center_code; });
    const h = computeCenterHeadline(c.center_code, rows);
    return Object.assign({ code: c.center_code, name: c.center_name, rows: rows }, h);
  });

  const totalCenters = centerStats.length;
  const warnStats = centerStats.filter(function(s) { return s.status === 'warn'; });
  const totalStaffAvg = centerStats.reduce(function(sum, s) { return sum + (s.staffAvg || 0); }, 0);

  function formatPlainNum(v, unit) {
    if (v === null || v === undefined) return '-';
    if (unit === 'duration') return formatSecondsHMS(v);
    if (unit) return v.toFixed(1) + unit;
    const isPct = Math.abs(v) <= 100;
    return v.toFixed(1) + (isPct ? '%' : '');
  }

  // 이슈감지내용: 어떤 센터의 어떤 지표가 기준 미달인지 구체적으로 나열 (월별 누적 일평균값 기준 판정, 이번달 값도 함께 표기)
  const issueLines = [];
  warnStats.forEach(function(s) {
    s.metrics.filter(function(m) { return m.isWarn; }).forEach(function(m) {
      const monthPart = (m.monthValue !== null && m.monthValue.toFixed(1) !== (m.value === null ? '' : m.value.toFixed(1))) ? ' / 이번달 ' + formatPlainNum(m.monthValue, m.unit) : '';
      issueLines.push(s.name + ' ' + m.label + ' 누적 ' + formatPlainNum(m.value, m.unit) + monthPart + ' (목표 ' + formatPlainNum(m.target, m.unit) + '↓)');
    });
  });

  const kpiHtml = '<div class="ws-kpi-strip">'
    + '<div class="ws-kpi-card"><div class="l">전체 센터</div><div class="v">' + totalCenters + '개</div></div>'
    + '<div class="ws-kpi-card"><div class="l">전체 월평균 재직인원</div><div class="v">' + totalStaffAvg.toFixed(1) + '명</div></div>'
    + '<div class="ws-kpi-card' + (warnStats.length > 0 ? ' warn' : '') + '"><div class="l">주의 센터</div><div class="v">' + warnStats.length + '개</div>'
    + (issueLines.length ? '<div style="font-size:11px;color:#FF6B70;margin-top:6px;line-height:1.5;">' + issueLines.join('<br>') + '</div>' : '')
    + '</div>'
    + '</div>';

  // 상태 기준 자동정렬은 제거하고, 센터 목록과 동일한 고정 순서(sort_order)를 그대로 사용.
  // 순서를 바꾸고 싶으면 행의 ▲▼ 버튼(사이드바 순서와 동일하게 연동)으로 직접 변경한다.
  const badgeText = { ok: '정상', warn: '주의', pending: '대기' };
  const rowsHtml = centerStats.map(function(s, idx) {
    const reorderHtml = workspaceUnlocked
      ? '<span onclick="event.stopPropagation();" style="display:inline-flex;flex-direction:column;gap:0;margin-left:8px;vertical-align:middle;line-height:1;">'
        + '<button class="mv" onclick="moveCenterOrder(\'' + s.code + '\',-1);selectWorkspaceOverview();" title="위로" ' + (idx === 0 ? 'disabled' : '') + '>▲</button>'
        + '<button class="mv" onclick="moveCenterOrder(\'' + s.code + '\',1);selectWorkspaceOverview();" title="아래로" ' + (idx === centerStats.length - 1 ? 'disabled' : '') + '>▼</button>'
        + '</span>'
      : '';
    const metricsHtml = s.metrics.length
      ? '<div style="display:flex;flex-wrap:wrap;column-gap:18px;row-gap:4px;">' + s.metrics.map(function(m) { return '<span style="' + (m.isWarn ? 'color:#FF6B70;font-weight:700;' : '') + '">' + formatHeadlineMetric(m) + '</span>'; }).join('') + '</div>'
      : '<span style="color:#86868b;">데이터 준비중</span>';

    return '<tr class="ws-row" onclick="selectCenter(\'' + s.code + '\')">'
      + '<td style="font-weight:700;">' + s.name + reorderHtml + '</td>'
      + '<td>' + (s.staffText || '<span style="color:#86868b;">-</span>') + '</td>'
      + '<td>' + metricsHtml + '</td>'
      + '<td><span class="ws-badge ' + s.status + '">' + badgeText[s.status] + '</span></td>'
      + '</tr>';
  }).join('');

  // 센터별 추이 카드: 작은 표 셀 안에 스파크라인을 우겨넣던 방식은 축·범례가 없어 가독성이 매우 떨어졌다.
  // 대신 표 아래에 센터별로 별도 카드를 두어, 각 카드마다 범례·축 눈금·데이터포인트를 모두 보여준다(Small multiples 방식).
  const trendCardsHtml = centerStats
    .filter(function(s) { return CENTER_CARD_TREND[s.code]; })
    .map(function(s) {
      return '<div class="panel" style="padding:14px 16px;">'
        + '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">' + s.name + '</div>'
        + '<div style="height:200px;"><canvas id="wsTrend_' + s.code + '"></canvas></div>'
        + '</div>';
    }).join('');
  const trendSectionHtml = trendCardsHtml
    ? '<div style="margin-top:16px;">'
      + '<h3 style="margin:0 0 10px;font-size:15px;">센터별 핵심지표 추이 (최근 6개월, 월평균)</h3>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;">' + trendCardsHtml + '</div>'
      + '</div>'
    : '';

  // 센터 실적 업데이트현황: 센터별로 데이터를 매일 잘 올리고 있는지 신호등으로 한눈에 확인
  const uploadStatusHtml = '<div class="panel" style="margin-bottom:16px;">'
    + '<h3 style="margin:0 0 12px;font-size:15px;">🚦 센터 실적 업데이트현황</h3>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">'
    + sorted.map(function(c) {
        const sig = getCenterUploadSignal(c.center_code);
        const last = lastUploadMap[c.center_code];
        const lastText = last ? new Date(last).toLocaleDateString('ko-KR') : '기록 없음';
        return '<div style="border:1px solid #2c2c2e;border-radius:10px;padding:10px 12px;cursor:pointer;" onclick="selectCenter(\'' + c.center_code + '\')">'
          + '<div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;"><span class="signal-dot signal-' + sig.color + '"></span>' + c.center_name + '</div>'
          + '<div style="font-size:11px;color:#86868b;margin-top:4px;">최근 업로드: ' + lastText + (sig.days !== null ? ' (' + sig.days + '일 전)' : '') + '</div>'
          + '</div>';
      }).join('')
    + '</div>'
    + '<p style="font-size:11px;color:#86868b;margin-top:10px;">🟢 3일 이내 업로드 · 🟠 3일째 미업로드(주의) · 🔴 7일째 미업로드(경고) — 알림 발송 조건은 좌측 "🔔 알림 설정"에서 관리합니다</p>'
    + '</div>';

  main.innerHTML = '<div style="--dash-accent:#FE2E36;--dash-accent-dark:#3a1518;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
    + '<h2 style="margin:0;font-size:20px;">관리자화면 전체 현황</h2>'
    + '<button class="btn-outline" style="padding:6px 12px;font-size:12px;" onclick="selectWorkspaceOverview(true)">새로고침</button>'
    + '</div>'
    + kpiHtml
    + uploadStatusHtml
    + '<div class="panel"><div class="table-scroll"><table class="ws-table"><thead><tr><th>센터</th><th>재직(TO대비)</th><th>핵심지표(이번달/누적)</th><th>상태</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + (workspaceUnlocked ? '<div style="text-align:center;padding:14px;color:#86868b;font-size:12px;cursor:pointer;" onclick="addCenterPrompt()">+ 센터 추가</div>' : '')
    + '</div>'
    + trendSectionHtml
    + '</div>';

  drawWorkspaceSparklines(centerStats);
}

// 센터별 카드 미니 추이그래프 구성 (월별 집계, mode: avg=일평균 / sum=월합계)
// barSeries: 막대(주로 인입량/접수건 등 물량), lineSeries: 꺾은선(SL/응대율/T-NPS 등 비율·점수)
// stacked: true면 막대를 누적(스택)으로 쌓음 (센터별 대시보드의 "접수건 구성" 차트와 동일한 방식)
// sameAxis: true면 막대·선을 같은 축(단위가 같을 때, 예: 건수+합계건수)에 표시, 아니면 선은 오른쪽 보조축(y1) 사용
// lineAxis: 선 지표의 y축 범위를 직접 지정 (예: 응대율처럼 95% 이상이 정상 구간인 지표는 80~100으로 좁혀서
//           체감상 변동폭이 과장되어 보이지 않도록 함)
const CENTER_CARD_TREND = {
  'kbsonhae': {
    months: 6,
    barSeries: [
      { label: '제휴 인입량', key: '제휴상담_인입호', mode: 'avg' },
      { label: '장기 인입량', key: '장기손사_인입호', mode: 'avg' }
    ],
    lineSeries: [
      { label: '제휴SL', key: '제휴상담_SL', mode: 'avg' },
      { label: '장기SL', key: '장기손사_SL', mode: 'avg' }
    ],
    lineAxis: { max: 110 } // SL 보조축 최대값을 110으로 여유를 둬 100에 가까운 값들이 축 상단에 눌리지 않게 함
  },
  'kbjeongbi': {
    months: 6,
    stacked: true,
    sameAxis: true, // 막대(구성)와 선(합계)이 모두 "건수" 단위라 같은 축 사용
    barSeries: [
      { label: '고지 접수건', key: '접수_고지의무', mode: 'avg' },
      { label: '통지 접수건', key: '접수_통지의무', mode: 'avg' },
      { label: '목적물소멸 접수건', key: '접수_목적물소멸', mode: 'avg' }
    ],
    lineSeries: [
      { label: '합계', key: '통합_접수', mode: 'avg' }
    ]
  },
  'pyeongtaek': {
    months: 6,
    barSeries: [
      { label: '일평균인입량', key: '요청호', mode: 'avg' }
    ],
    lineSeries: [
      { label: '응대율', key: '응대율', mode: 'avg' }
    ],
    lineAxis: { min: 80, max: 100 } // 95% 이상이면 정상 수준인 지표라, 축을 80~100으로 좁혀 변동폭 과장을 방지
  },
  'lge': {
    months: 6,
    stacked: true,
    barsOnSecondary: true, // T-NPS(선)를 주축에, 생산성(막대)을 보조축에 배치
    // 전체현황 추이차트는 다른 센터와 동일하게 회색계열 팔레트(WS_BAR_COLORS/WS_LINE_COLORS)를 그대로 사용한다
    barSeries: [
      { label: '생산성(IN)', key: '생산성_IN', mode: 'avg' },
      { label: '생산성(OUT)', key: '__생산성_OUT_derived__', mode: 'avg', derivedFrom: { totalKey: '생산성_INOUT', subKey: '생산성_IN' } }
    ],
    lineSeries: [
      { label: 'T-NPS', key: 'TNPS', mode: 'avg' }
    ],
    lineAxis: { min: 0, max: 110 } // T-NPS 주축 고정 범위
  },
  'lge_seongsu': {
    months: 6,
    stacked: true,
    barsOnSecondary: true,
    barSeries: [
      { label: '생산성(IN)', key: '생산성_IN', mode: 'avg' },
      { label: '생산성(OUT)', key: '__생산성_OUT_derived__', mode: 'avg', derivedFrom: { totalKey: '생산성_INOUT', subKey: '생산성_IN' } }
    ],
    lineSeries: [
      { label: 'T-NPS', key: 'TNPS', mode: 'avg' }
    ],
    lineAxis: { min: 0, max: 110 }
  }
};
// 회색계열 팔레트: 막대(물량)는 옅은 회색, 선(비율/점수)은 짙은 회색~검정으로 대비
const WS_BAR_COLORS = ['rgba(180,190,202,0.55)', 'rgba(206,213,222,0.5)', 'rgba(232,236,242,0.55)'];
const WS_LINE_COLORS = ['#8b93a3', '#c3c8d1', '#e5e7eb'];
let wsSparkCharts = [];

function drawWorkspaceSparklines(centerStats) {
  wsSparkCharts.forEach(function(c) { if (c) c.destroy(); });
  wsSparkCharts = [];

  const savedCenter = currentCenter;
  centerStats.forEach(function(s) {
    const cfg = CENTER_CARD_TREND[s.code];
    const canvas = document.getElementById('wsTrend_' + s.code);
    if (!cfg || !canvas) return;
    currentCenter = s.code; // resolveMetric이 currentCenter를 참조

    const byMonth = {};
    s.rows.forEach(function(r) { const ym = r.report_date.slice(0, 7); if (!byMonth[ym]) byMonth[ym] = []; byMonth[ym].push(r); });
    const months = Object.keys(byMonth).sort().slice(-cfg.months); // 데이터가 있는 최근 N개월만 사용 → 지표 없는 달은 자연히 생략됨

    function aggSeries(sr) {
      return months.map(function(ym) {
        const rows = byMonth[ym];
        // derivedFrom: "총계 - 부분계산" 형태의 파생 시리즈 (예: 생산성(OUT) = 생산성(IN+OUT) - 생산성(IN))
        // 두 지표를 단순히 더해서 쌓는 게 아니라, IN+OUT 안에 포함된 IN을 구분해서 보여주기 위함
        if (sr.derivedFrom) {
          const totals = rows.map(function(r) { return resolveMetric(r, sr.derivedFrom.totalKey); }).filter(function(n) { return n !== null && !isNaN(n); });
          const subs = rows.map(function(r) { return resolveMetric(r, sr.derivedFrom.subKey); }).filter(function(n) { return n !== null && !isNaN(n); });
          if (totals.length === 0 || subs.length === 0) return null;
          const totalAvg = totals.reduce(function(a, b) { return a + b; }, 0) / totals.length;
          const subAvg = subs.reduce(function(a, b) { return a + b; }, 0) / subs.length;
          return Math.max(0, totalAvg - subAvg);
        }
        const vals = rows.map(function(r) { return resolveMetric(r, sr.key); }).filter(function(n) { return n !== null && !isNaN(n); });
        if (vals.length === 0) return null;
        const sum = vals.reduce(function(a, b) { return a + b; }, 0);
        return sr.mode === 'sum' ? sum : (sum / vals.length);
      });
    }

    const barSeries = cfg.barSeries || [];
    const lineSeries = cfg.lineSeries || [];
    // barsOnSecondary: true면 막대(생산성 등)를 보조축(y1)에, 선(T-NPS 등)을 주축(y)에 배치 (기본은 반대)
    const barsOnSecondary = !!cfg.barsOnSecondary;
    const barYAxisId = barsOnSecondary ? 'y1' : 'y';
    const lineYAxisId = cfg.sameAxis ? 'y' : (barsOnSecondary ? 'y' : 'y1');

    const barColors = cfg.barColors || WS_BAR_COLORS;
    const lineColors = cfg.lineColors || WS_LINE_COLORS;
    const barDatasets = barSeries.map(function(sr, i) {
      return {
        type: 'bar', label: sr.label, data: aggSeries(sr), yAxisID: barYAxisId,
        backgroundColor: barColors[i % barColors.length], borderWidth: 0,
        stack: cfg.stacked ? 'vol' : undefined, order: 2
      };
    });
    const lineDatasets = lineSeries.map(function(sr, i) {
      return {
        type: 'line', label: sr.label, data: aggSeries(sr), yAxisID: lineYAxisId,
        borderColor: lineColors[i % lineColors.length], backgroundColor: lineColors[i % lineColors.length],
        borderWidth: 2, tension: 0.25, pointRadius: 3, pointHoverRadius: 5, spanGaps: false, order: 1
      };
    });
    const datasets = barDatasets.concat(lineDatasets);

    const scales = {
      x: { display: true, ticks: { font: { size: 11 } }, grid: { display: false }, stacked: !!cfg.stacked },
      y: {
        display: true, position: 'left', grid: { color: '#2c2c2e' }, stacked: !!cfg.stacked && !barsOnSecondary,
        ticks: { font: { size: 10 }, callback: function(v) { return Number(v).toFixed(1); } }
      }
    };
    // lineAxis(축 범위 고정)는 실제로 선이 그려지는 축에 적용한다 (barsOnSecondary면 주축 y, 아니면 보조축 y1)
    if (!cfg.sameAxis && (barSeries.length > 0 || lineSeries.length > 0)) {
      scales.y1 = {
        display: true, position: 'right', grid: { display: false }, stacked: !!cfg.stacked && barsOnSecondary,
        ticks: { font: { size: 10 }, callback: function(v) { return Number(v).toFixed(1); } }
      };
    }
    if (cfg.lineAxis) {
      const targetScale = (cfg.sameAxis || barsOnSecondary) ? scales.y : scales.y1;
      if (targetScale) { targetScale.min = cfg.lineAxis.min; targetScale.max = cfg.lineAxis.max; }
    }

    wsSparkCharts.push(new Chart(canvas, {
      type: 'bar',
      data: { labels: months.map(function(m) { return m.slice(5) + '월'; }), datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            enabled: true,
            callbacks: {
              // 소수점 둘째자리에서 반올림해 항상 첫째자리까지만 표시 (툴팁 값의 자리수를 표에서 보이는 값과 동일하게 맞춤)
              label: function(ctx) {
                const v = ctx.parsed.y;
                return ctx.dataset.label + ': ' + (v === null || v === undefined ? '-' : Number(v).toFixed(1));
              }
            }
          }
        },
        scales: scales
      }
    }));
  });
  currentCenter = savedCenter;
}


// ============================================
// 센터별 설정 페이지 (월별 TO, 핵심지표 목표치)
// ============================================
async function renderCenterSettingsTab() {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty" style="padding:60px 0;">불러오는 중...</div>';
  await Promise.all([loadCenterSettingsData(currentCenter), loadSettingsMetricSchema(currentCenter)]);

  const c = allCentersMeta.find(function(x) { return x.center_code === currentCenter; });
  const yearOptions = [settingsYear - 1, settingsYear, settingsYear + 1].map(function(y) {
    return '<option value="' + y + '"' + (y === settingsYear ? ' selected' : '') + '>' + y + '년</option>';
  }).join('');

  // 지표 키를 직접 타이핑하지 않도록, 이 센터에 실제로 존재하는 항목을 드롭다운으로 제공
  const metricOptions = buildMetricOptionsForCenter(currentCenter);
  const optionsHtml = '<option value="">직접 선택...</option>' + metricOptions.map(function(o) {
    return '<option value="' + o.key + '">' + o.label + '</option>';
  }).join('');

  main.innerHTML = '<div style="--dash-accent:#FE2E36;--dash-accent-dark:#3a1518;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">'
    + '<h2 style="margin:0;">' + (c ? c.center_name : '') + ' · TO 및 목표값설정</h2>'
    + '<div><label style="font-size:13px;color:#a1a1a6;margin-right:6px;">연도</label><select onchange="changeSettingsYear(this.value)" style="padding:5px 8px;border:1px solid #2c2c2e;border-radius:6px;font-size:13px;">' + yearOptions + '</select></div>'
    + '</div>'

    + '<div class="panel" style="margin-bottom:16px;">'
    + '<h3 style="margin-bottom:6px;">월별 TO 설정 (' + settingsYear + '년)</h3>'
    + '<p style="font-size:12px;color:#86868b;margin:0 0 10px;">1~12월 값을 각 칸에 직접 입력하거나, 상단 "선택" 체크박스로 여러 달을 고른 뒤 일괄값을 반영할 수 있습니다. 반영된 값도 각 칸에서 바로 수정 가능합니다.</p>'
    + renderToGrid(currentCenter, settingsYear)
    + '<button class="btn-primary" style="margin-top:10px;" onclick="saveToGrid(\'' + currentCenter + '\')">TO 전체 저장</button>'
    + '<div class="status-msg" id="toGridStatus"></div>'
    + '</div>'

    + '<div class="panel">'
    + '<h3 style="margin-bottom:6px;">주요지표 목표치 설정 (' + settingsYear + '년)</h3>'
    + '<p style="font-size:12px;color:#86868b;margin:0 0 10px;">목록 맨 위(첫 번째) 지표가 전체 현황 카드의 "핵심지표"로 표시됩니다. 아래에서 지표를 먼저 추가한 뒤, 월별 목표치 표에서 1~12월 값을 채워주세요. 월별 값을 비워두면 "기본 목표값"이 대신 적용됩니다.</p>'
    + '<div class="entry-row"><label>지표 선택</label><select id="kpiKeySelect_' + currentCenter + '" onchange="onKpiKeySelected(\'' + currentCenter + '\')" style="min-width:220px;">' + optionsHtml + '</select></div>'
    + '<div class="entry-row"><label>지표 키</label><input type="text" id="kpiKey_' + currentCenter + '" placeholder="위에서 선택하거나 직접 입력" style="width:200px;"></div>'
    + '<div class="entry-row"><label>표시 라벨</label><input type="text" id="kpiLabel_' + currentCenter + '" placeholder="예: 응답율" style="width:140px;"></div>'
    + '<div class="entry-row"><label>기본 목표값</label><input type="text" id="kpiTarget_' + currentCenter + '" placeholder="월별 미입력시 적용 (통화시간류는 4:00:00처럼 입력)" style="width:220px;"></div>'
    + '<input type="hidden" id="kpiEditId_' + currentCenter + '" value="">'
    + '<button class="btn-secondary" onclick="saveKpiSetting(\'' + currentCenter + '\')">지표 추가/기본값 수정</button>'
    + '<button class="btn-ghost" onclick="clearKpiForm(\'' + currentCenter + '\')">취소</button>'
    + renderKpiGrid(currentCenter, settingsYear)
    + '<button class="btn-primary" style="margin-top:10px;" onclick="saveKpiGrid(\'' + currentCenter + '\')">월별 목표치 전체 저장</button>'
    + '<div class="status-msg" id="kpiGridStatus"></div>'
    + '</div>'
    + '</div>';
}

function changeSettingsYear(y) {
  settingsYear = Number(y);
  renderMain();
}

function monthKey(year, m) { return year + '-' + String(m).padStart(2, '0'); }

// ============================================
// 월별 TO 설정 - 연도별 1~12월 가로 표 + 체크박스 일괄반영
// ============================================
function renderToGrid(centerCode, year) {
  const list = monthlyToCache[centerCode] || [];
  const byYm = {};
  list.forEach(function(s) { byYm[s.year_month] = s; });

  const headerCells = [];
  const checkCells = [];
  const managerCells = [];
  const counselorCells = [];
  for (let m = 1; m <= 12; m++) {
    const ym = monthKey(year, m);
    const idx = m - 1;
    const s = byYm[ym];
    headerCells.push('<th>' + m + '월</th>');
    checkCells.push('<td><input type="checkbox" class="to-grid-check" data-idx="' + idx + '"></td>');
    managerCells.push('<td><input type="number" class="to-grid-input" data-idx="' + idx + '" data-field="manager" value="' + (s ? s.to_manager : '') + '" style="width:56px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>');
    counselorCells.push('<td><input type="number" class="to-grid-input" data-idx="' + idx + '" data-field="counselor" value="' + (s ? s.to_counselor : '') + '" style="width:56px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>');
  }

  return '<div class="table-scroll"><table>'
    + '<thead><tr><th style="position:sticky;left:0;background:#111113;"></th>' + headerCells.join('') + '</tr></thead>'
    + '<tbody>'
    + '<tr><td style="position:sticky;left:0;background:#111113;font-size:11px;color:#86868b;"><label style="cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;" title="전체 월 선택/해제"><input type="checkbox" onchange="toGridToggleAll(this.checked)"> 전체</label></td>' + checkCells.join('') + '</tr>'
    + '<tr><td style="position:sticky;left:0;background:#1d1d1f;font-weight:600;">관리자</td>' + managerCells.join('') + '</tr>'
    + '<tr><td style="position:sticky;left:0;background:#1d1d1f;font-weight:600;">상담사</td>' + counselorCells.join('') + '</tr>'
    + '</tbody></table></div>'
    + '<div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
    + '<span style="font-size:12px;color:#a1a1a6;">선택한 월에 일괄 반영:</span>'
    + '<label style="font-size:12px;">관리자 <input type="number" id="toBulkManager" style="width:60px;margin-left:4px;"></label>'
    + '<label style="font-size:12px;">상담사 <input type="number" id="toBulkCounselor" style="width:60px;margin-left:4px;"></label>'
    + '<button class="btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="applyToGridBulk()">일괄 반영</button>'
    + '</div>';
}

function toGridToggleAll(checked) {
  document.querySelectorAll('.to-grid-check').forEach(function(cb) { cb.checked = checked; });
}

function applyToGridBulk() {
  const checked = Array.from(document.querySelectorAll('.to-grid-check:checked')).map(function(c) { return c.dataset.idx; });
  if (checked.length === 0) { alert('먼저 일괄 반영할 월을 체크해 주세요.'); return; }
  const mgr = document.getElementById('toBulkManager').value;
  const cns = document.getElementById('toBulkCounselor').value;
  if (mgr === '' && cns === '') { alert('관리자 또는 상담사 값 중 하나는 입력해 주세요.'); return; }
  checked.forEach(function(idx) {
    if (mgr !== '') document.querySelector('.to-grid-input[data-idx="' + idx + '"][data-field="manager"]').value = mgr;
    if (cns !== '') document.querySelector('.to-grid-input[data-idx="' + idx + '"][data-field="counselor"]').value = cns;
  });
  document.getElementById('toBulkManager').value = '';
  document.getElementById('toBulkCounselor').value = '';
}

async function saveToGrid(centerCode) {
  const statusEl = document.getElementById('toGridStatus');
  const entries = [];
  for (let m = 1; m <= 12; m++) {
    const idx = m - 1;
    const mgrInput = document.querySelector('.to-grid-input[data-idx="' + idx + '"][data-field="manager"]');
    const cnsInput = document.querySelector('.to-grid-input[data-idx="' + idx + '"][data-field="counselor"]');
    const mgr = mgrInput ? mgrInput.value : '', cns = cnsInput ? cnsInput.value : '';
    if (mgr === '' && cns === '') continue; // 값이 없는 달은 저장 대상에서 제외
    entries.push({ year_month: monthKey(settingsYear, m), to_manager: Number(mgr) || 0, to_counselor: Number(cns) || 0 });
  }
  if (entries.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '저장할 값이 없습니다.'; return; }
  statusEl.className = 'status-msg'; statusEl.textContent = '저장 중...';
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=save-monthly-to-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, token: centerTokenMap[centerCode], center_code: centerCode, entries: entries })
    });
    const data = await res.json();
    if (!data.success) { statusEl.className = 'status-msg err'; statusEl.textContent = '저장 실패: ' + data.error; return; }
    statusEl.className = 'status-msg ok'; statusEl.textContent = entries.length + '개월 저장 완료되었습니다.';
    await loadCenterSettingsData(centerCode);
    renderMain();
  } catch (e) { statusEl.className = 'status-msg err'; statusEl.textContent = '오류: ' + e.message; }
}

// ============================================
// 주요지표 목표치 설정 - 연도별 1~12월 가로 표 + 체크박스 일괄반영
// ============================================
function renderKpiGrid(centerCode, year) {
  const kpiList = (kpiSettingsCache[centerCode] || []).slice().sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  if (kpiList.length === 0) return '<p class="empty" style="margin-top:10px;">등록된 핵심지표가 없습니다. 위에서 지표를 먼저 추가해 주세요.</p>';

  const monthlyMap = kpiMonthlyTargetsCache[centerCode] || {};

  const headerCells = [];
  for (let m = 1; m <= 12; m++) headerCells.push('<th>' + m + '월</th>');
  const checkCells = [];
  for (let m = 1; m <= 12; m++) checkCells.push('<td><input type="checkbox" class="kpi-grid-check" data-idx="' + (m - 1) + '"></td>');

  const bodyRows = kpiList.map(function(k, ri) {
    const isDur = isDurationMetricKey(centerCode, k.metric_key);
    const cells = [];
    for (let m = 1; m <= 12; m++) {
      const idx = m - 1;
      const ym = monthKey(year, m);
      const override = monthlyMap[k.metric_key] ? monthlyMap[k.metric_key][ym] : undefined;
      const rawV = (override !== undefined && override !== null) ? override : '';
      const v = formatKpiTargetDisplay(centerCode, k.metric_key, rawV);
      const placeholder = formatKpiTargetDisplay(centerCode, k.metric_key, k.target_value);
      cells.push('<td><input type="text" class="kpi-grid-input" data-idx="' + idx + '" data-key="' + k.metric_key + '" value="' + v + '" placeholder="' + placeholder + '" style="width:' + (isDur ? '70' : '60') + 'px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>');
    }
    return '<tr><td style="position:sticky;left:0;background:#1d1d1f;font-weight:600;">'
      + (ri === 0 ? '<span class="ws-badge ok" style="margin-right:4px;">핵심</span>' : '') + k.metric_label
      + '<div style="font-size:11px;color:#86868b;font-weight:400;">기본값 ' + (formatKpiTargetDisplay(centerCode, k.metric_key, k.target_value) || '없음') + (isDur ? ' (시:분:초)' : '') + '</div></td>'
      + cells.join('')
      + '<td><button style="border:none;background:none;color:#FF6B70;font-size:12px;cursor:pointer;" onclick="deleteKpiSetting(\'' + k.id + '\')">삭제</button></td></tr>';
  }).join('');

  const bulkKeyOptions = kpiList.map(function(k) { return '<option value="' + k.metric_key + '">' + k.metric_label + '</option>'; }).join('');

  return '<div class="table-scroll" style="margin-top:12px;"><table>'
    + '<thead><tr><th style="position:sticky;left:0;background:#111113;">지표</th>' + headerCells.join('') + '<th></th></tr></thead>'
    + '<tbody>'
    + '<tr><td style="position:sticky;left:0;background:#111113;font-size:11px;color:#86868b;"><label style="cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;" title="전체 월 선택/해제"><input type="checkbox" onchange="kpiGridToggleAll(this.checked)"> 전체</label></td>' + checkCells.join('') + '<td></td></tr>'
    + bodyRows
    + '</tbody></table></div>'
    + '<div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
    + '<span style="font-size:12px;color:#a1a1a6;">선택한 월에 일괄 반영할 지표:</span>'
    + '<select id="kpiBulkKey" style="font-size:12px;padding:4px 6px;border:1px solid #2c2c2e;border-radius:4px;">' + bulkKeyOptions + '</select>'
    + '<label style="font-size:12px;">목표값 <input type="text" id="kpiBulkValue" placeholder="숫자 또는 4:00:00" style="width:100px;margin-left:4px;"></label>'
    + '<button class="btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="applyKpiGridBulk(\'' + centerCode + '\')">일괄 반영 후 저장</button>'
    + '</div>';
}

function kpiGridToggleAll(checked) {
  document.querySelectorAll('.kpi-grid-check').forEach(function(cb) { cb.checked = checked; });
}

// 체크된 월에 값을 채운 뒤 곧바로 saveKpiGrid()까지 호출해서 실제로 저장까지 끝낸다.
// (예전엔 DOM 입력칸만 채우고 "월별 목표치 전체 저장"을 따로 눌러야 했는데, 그걸 잊으면
//  화면 이동/새로고침 시 입력한 값이 그대로 사라져 "반영이 안 된다"는 문제로 이어졌음)
async function applyKpiGridBulk(centerCode) {
  const checked = Array.from(document.querySelectorAll('.kpi-grid-check:checked')).map(function(c) { return c.dataset.idx; });
  if (checked.length === 0) { alert('먼저 일괄 반영할 월을 체크해 주세요.'); return; }
  const key = document.getElementById('kpiBulkKey').value;
  const val = document.getElementById('kpiBulkValue').value;
  if (!key) { alert('지표를 선택해 주세요.'); return; }
  if (val === '') { alert('목표값을 입력해 주세요.'); return; }
  checked.forEach(function(idx) {
    const input = document.querySelector('.kpi-grid-input[data-key="' + key + '"][data-idx="' + idx + '"]');
    if (input) input.value = val;
  });
  document.getElementById('kpiBulkValue').value = '';
  await saveKpiGrid(centerCode);
}

async function saveKpiGrid(centerCode) {
  const statusEl = document.getElementById('kpiGridStatus');
  const kpiList = kpiSettingsCache[centerCode] || [];
  const entries = [];
  const invalid = [];
  kpiList.forEach(function(k) {
    for (let m = 1; m <= 12; m++) {
      const idx = m - 1;
      const input = document.querySelector('.kpi-grid-input[data-key="' + k.metric_key + '"][data-idx="' + idx + '"]');
      if (!input || input.value === '') continue;
      const parsed = parseKpiTargetInput(input.value);
      if (parsed === null) { invalid.push(k.metric_label + ' ' + m + '월'); continue; }
      entries.push({ metric_key: k.metric_key, year_month: monthKey(settingsYear, m), target_value: parsed });
    }
  });
  if (invalid.length) { statusEl.className = 'status-msg err'; statusEl.textContent = '입력값을 확인해 주세요(숫자 또는 4:00:00 형식): ' + invalid.join(', '); return; }
  if (entries.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '저장할 값이 없습니다.'; return; }
  statusEl.className = 'status-msg'; statusEl.textContent = '저장 중...';
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=save-kpi-monthly-targets-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, token: centerTokenMap[centerCode], center_code: centerCode, entries: entries })
    });
    const data = await res.json();
    if (!data.success) { statusEl.className = 'status-msg err'; statusEl.textContent = '저장 실패: ' + data.error; return; }
    statusEl.className = 'status-msg ok'; statusEl.textContent = entries.length + '건 저장 완료되었습니다.';
    await loadCenterSettingsData(centerCode);
    renderMain();
  } catch (e) { statusEl.className = 'status-msg err'; statusEl.textContent = '오류: ' + e.message; }
}

// 센터의 row_schema/계산지표를 기반으로 드롭다운 선택지 구성 (오타 방지)
// "지표 선택" 드롭다운용 센터별 실적항목 캐시. 데이터입력 화면의 전역 rowSchema는 "마지막으로 연 센터"
// 기준이라 설정화면을 다른 센터에서 그대로 열면 엉뚱한(또는 빈) 목록이 뜨는 문제가 있었음 — 이 캐시는
// loadSettingsMetricSchema()가 설정화면을 열 때마다 해당 센터 걸로 새로 채운다.
let settingsMetricSchemaCache = {};

async function loadSettingsMetricSchema(centerCode) {
  if (INTEGRATED_FORM_CENTERS[centerCode]) {
    // LG전자통합은 서버 row_schema가 따로 없고, 클라이언트에 고정된 실적항목 4개(LGE_TOTAL_PERF_METRICS)를 그대로 씀
    settingsMetricSchemaCache[centerCode] = LGE_TOTAL_PERF_METRICS.map(function(m) { return { key: m.key, group: 'performance' }; });
    return;
  }
  const token = centerTokenMap[centerCode];
  if (!token) { settingsMetricSchemaCache[centerCode] = []; return; }
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=schema&token=' + encodeURIComponent(token) + '&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
    const data = await res.json();
    settingsMetricSchemaCache[centerCode] = data.success ? (data.row_schema || []) : [];
  } catch (e) { settingsMetricSchemaCache[centerCode] = []; }
}

function buildMetricOptionsForCenter(centerCode) {
  const options = [];
  (settingsMetricSchemaCache[centerCode] || []).filter(function(col) { return col.group === 'performance'; }).forEach(function(col) {
    options.push({ key: col.key, label: col.key });
  });
  const computed = CENTER_COMPUTED_METRICS[centerCode];
  if (computed) {
    Object.keys(computed).forEach(function(k) { options.push({ key: k, label: k + ' (계산지표)' }); });
  }
  return options;
}

function onKpiKeySelected(centerCode) {
  const select = document.getElementById('kpiKeySelect_' + centerCode);
  const val = select.value;
  if (!val) return;
  document.getElementById('kpiKey_' + centerCode).value = val;
  if (!document.getElementById('kpiLabel_' + centerCode).value) {
    document.getElementById('kpiLabel_' + centerCode).value = val.replace(/_/g, ' ');
  }
}

async function loadCenterSettingsData(centerCode) {
  try {
    const ts = Date.now();
    const [toRes, kpiRes, kpiMonthlyRes] = await Promise.all([
      fetch(SB_FUNCTION_URL + '?action=list-monthly-to&center_code=' + encodeURIComponent(centerCode) + '&_ts=' + ts, { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' }),
      fetch(SB_FUNCTION_URL + '?action=list-kpi-settings&center_code=' + encodeURIComponent(centerCode) + '&_ts=' + ts, { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' }),
      fetch(SB_FUNCTION_URL + '?action=list-kpi-monthly-targets&center_code=' + encodeURIComponent(centerCode) + '&_ts=' + ts, { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' })
    ]);
    const [toData, kpiData, kpiMonthlyData] = await Promise.all([toRes.json(), kpiRes.json(), kpiMonthlyRes.json()]);
    monthlyToCache[centerCode] = toData.settings || [];
    kpiSettingsCache[centerCode] = kpiData.settings || [];
    const grouped = {};
    (kpiMonthlyData.targets || []).forEach(function(t) {
      if (!grouped[t.metric_key]) grouped[t.metric_key] = {};
      grouped[t.metric_key][t.year_month] = t.target_value;
    });
    kpiMonthlyTargetsCache[centerCode] = grouped;
  } catch (e) { /* 실패 시 해당 센터는 "설정 없음"으로 표시됨 */ }
}

async function saveKpiSetting(centerCode) {
  const label = document.getElementById('kpiLabel_' + centerCode).value.trim();
  const key = document.getElementById('kpiKey_' + centerCode).value.trim();
  const targetRaw = document.getElementById('kpiTarget_' + centerCode).value;
  const editId = document.getElementById('kpiEditId_' + centerCode).value;
  if (!label || !key) { alert('라벨과 지표 키를 입력해 주세요.'); return; }
  const targetVal = targetRaw === '' ? null : parseKpiTargetInput(targetRaw);
  if (targetRaw !== '' && targetVal === null) { alert('기본 목표값 형식을 확인해 주세요 (숫자 또는 4:00:00 형식).'); return; }
  try {
    const payload = { workspace_password: workspacePasswordCache, token: centerTokenMap[centerCode], center_code: centerCode, metric_key: key, metric_label: label, target_value: targetVal, sort_order: 0 };
    if (editId) payload.id = editId;
    const res = await fetch(SB_FUNCTION_URL + '?action=save-kpi-setting', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) { alert('저장 실패: ' + data.error); return; }
    clearKpiForm(centerCode);
    await loadCenterSettingsData(currentCenter);
    renderMain();
  } catch (e) { alert('오류: ' + e.message); }
}

function clearKpiForm(centerCode) {
  document.getElementById('kpiLabel_' + centerCode).value = '';
  document.getElementById('kpiKey_' + centerCode).value = '';
  document.getElementById('kpiTarget_' + centerCode).value = '';
  document.getElementById('kpiEditId_' + centerCode).value = '';
}

function loadKpiSettingForEdit(id) {
  let target = null, centerCode = null;
  Object.keys(kpiSettingsCache).forEach(function(cc) {
    (kpiSettingsCache[cc] || []).forEach(function(k) { if (k.id === id) { target = k; centerCode = cc; } });
  });
  if (!target) return;
  document.getElementById('kpiLabel_' + centerCode).value = target.metric_label;
  document.getElementById('kpiKey_' + centerCode).value = target.metric_key;
  document.getElementById('kpiTarget_' + centerCode).value = formatKpiTargetDisplay(centerCode, target.metric_key, target.target_value);
  document.getElementById('kpiEditId_' + centerCode).value = target.id;
}

async function deleteKpiSetting(id) {
  if (!confirm('이 핵심지표 설정을 삭제하시겠습니까? (월별 목표치도 함께 삭제됩니다)')) return;
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=delete-kpi-setting', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, id: id })
    });
    const data = await res.json();
    if (!data.success) { alert('삭제 실패: ' + data.error); return; }
    await loadCenterSettingsData(currentCenter);
    renderMain();
  } catch (e) { alert('오류: ' + e.message); }
}

function renderDashboard() {
  const scrollY = window.scrollY;
  const prevPopover = document.getElementById('colPopover');
  const popoverScrollTop = prevPopover ? prevPopover.scrollTop : 0;
  const main = document.getElementById('main');
  if (!currentCenter) { main.innerHTML = '<div class="empty">센터를 선택해 주세요.</div>'; return; }

  const centerInfo = allCenters.find(function(c) { return c.center_code === currentCenter; });
  const centerRows = allRows.filter(function(r) { return r.center_code === currentCenter; });

  const parts = currentMonth.split('-').map(Number);
  const y = parts[0], m = parts[1];
  const monthRows = centerRows.filter(function(r) { return r.report_date.startsWith(currentMonth); });
  const cumulativeRows = centerRows.filter(function(r) {
    const d = new Date(r.report_date);
    return d.getFullYear() === y && (d.getMonth() + 1) <= m;
  });
  const quarterStart = Math.floor((m - 1) / 3) * 3 + 1;
  const quarterRows = centerRows.filter(function(r) {
    const d = new Date(r.report_date);
    const mm = d.getMonth() + 1;
    return d.getFullYear() === y && mm >= quarterStart && mm <= m;
  });
  const halfStart = m <= 6 ? 1 : 7;
  const halfRows = centerRows.filter(function(r) {
    const d = new Date(r.report_date);
    const mm = d.getMonth() + 1;
    return d.getFullYear() === y && mm >= halfStart && mm <= m;
  });
  const targetRows = viewMode === 'single' ? monthRows
    : viewMode === 'quarter' ? quarterRows
    : viewMode === 'half' ? halfRows
    : cumulativeRows;
  let sortedTarget = targetRows.slice().sort(function(a, b) { return a.report_date.localeCompare(b.report_date); });

  // 분기별/반기별 집계탭은 개별 분기·반기를 비교하는 화면이므로,
  // 상단 기간토글(단월 등)과 무관하게 항상 연초~현재월 전체 데이터를 사용한다.
  if (aggView === 'quarter' || aggView === 'half') {
    sortedTarget = cumulativeRows.slice().sort(function(a, b) { return a.report_date.localeCompare(b.report_date); });
  }

  const prevYearMonth = (y - 1) + '-' + String(m).padStart(2, '0');
  const prevYearMonthRows = centerRows.filter(function(r) { return r.report_date.startsWith(prevYearMonth); });

  const prevMonthDate = new Date(y, m - 2, 1); // m은 1~12, m-2로 지난달(0-indexed) 계산
  const prevMonthStr = prevMonthDate.getFullYear() + '-' + String(prevMonthDate.getMonth() + 1).padStart(2, '0');
  const prevMonthRows = centerRows.filter(function(r) { return r.report_date.startsWith(prevMonthStr); });

  const alertInfo = computeAlert(centerRows);
  // 상단 기간 토글(단월/분기누적/반기누적/연초누적)에 따라 "일평균" 기준 구간이 바뀌도록 targetRows를 그대로 사용한다.
  const trendHtml = renderTrendList(targetRows, cumulativeRows, prevYearMonthRows, prevMonthRows);

  // 상단 핵심지표 카드의 "누적" 수치도 토글에 맞춰 범위가 바뀌어야 한다.
  // - 단월: 연초~현재월(기존과 동일, "이번달 vs 연초누적" 비교 기준으로 유지)
  // - 분기누적/반기누적: 해당 분기·반기 범위로 좁혀서 누적
  // - 연초누적: 연초~현재월(= cumulativeRows와 동일하므로 그대로)
  const cardCumRows = viewMode === 'quarter' ? quarterRows : viewMode === 'half' ? halfRows : cumulativeRows;

  const chartConfig = CENTER_CHART_CONFIG[currentCenter] || { groups: [] };
  const excludeBarLabel = (aggView === 'monthly' && chartConfig.excludeBarOnMonthly) ? chartConfig.excludeBarOnMonthly : null;

  let chartBoxes = '';
  let copyButtonsHtml = '';
  for (let i = 0; i < chartConfig.groups.length; i++) {
    const group = chartConfig.groups[i];
    const visibleBarLabels = group.barLabels.filter(function(l) { return l !== excludeBarLabel; });
    const barTitle = visibleBarLabels.join('/') + '(막대)';
    const lineTitle = group.lineLabels.join('/') + '(선' + (group.threshold ? ', 기준 ' + group.threshold.value : '') + ')';
    const summaryHtml = aggView === 'daily' ? '' : renderChartSummary(group, sortedTarget, excludeBarLabel);
    chartBoxes += '<div class="mini-chart-box"><div class="title">' + group.title + ' · ' + barTitle + ' · ' + lineTitle + '</div><div class="canvas-wrap"><canvas id="miniChart' + i + '"></canvas></div>' + summaryHtml + '</div>';
    copyButtonsHtml += '<button class="copy-icon-btn" title="' + group.title + ' 복사" onclick="copyChartImage(' + i + ')">' + COPY_ICON_SVG + '</button>';
  }
  const wideRange = viewMode === 'cumulative' || viewMode === 'quarter' || viewMode === 'half';
  const chartsClass = (aggView === 'daily' || wideRange) ? 'mini-charts vertical' : 'mini-charts';

  const theme = getDashTheme();
  main.innerHTML = '<div style="--dash-accent:' + theme.accent + ';--dash-accent-dark:' + theme.dark + ';">'
    + '<div class="month-bar">'
    + '<button class="nav" onclick="shiftMonth(-1)">‹</button>'
    + '<div class="month-label">' + currentMonth + '</div>'
    + '<button class="nav" onclick="shiftMonth(1)">›</button>'
    + '<div class="toggle-group">'
    + '<button class="' + (viewMode === 'single' ? 'active' : '') + '" onclick="setViewMode(\'single\')">단월</button>'
    + '<button class="' + (viewMode === 'quarter' ? 'active' : '') + '" onclick="setViewMode(\'quarter\')">분기누적</button>'
    + '<button class="' + (viewMode === 'half' ? 'active' : '') + '" onclick="setViewMode(\'half\')">반기누적</button>'
    + '<button class="' + (viewMode === 'cumulative' ? 'active' : '') + '" onclick="setViewMode(\'cumulative\')">연초누적</button>'
    + '</div>'
    + '<span style="font-size:11px;color:#86868b;margin-left:auto;">평균값은 주말·공휴일 제외 기준</span>'
    + '</div>'
    + alertInfo.html
    + (currentCenter === 'kbjeongbi' ? renderKbjeongbiSummaryCards2(targetRows, cardCumRows) : renderSummaryCards(targetRows, cardCumRows, prevMonthRows))
    + '<div class="split">'
    + '<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3 style="margin:0;">지표 추이</h3><div style="display:flex;gap:6px;">' + copyButtonsHtml + '</div></div><div class="' + chartsClass + '">' + chartBoxes + '</div></div>'
    + '<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3 style="margin:0;">' + (centerInfo ? centerInfo.center_name : '') + ' · 주요지표 (일평균 / 누적평균)</h3><button class="copy-icon-btn" title="주요지표 복사" onclick="copyTrendList()">' + COPY_ICON_SVG + '</button></div><div class="trend-list">' + trendHtml + '</div></div>'
    + '</div>'
    + (currentCenter === 'kbjeongbi' ? renderKbjeongbiDueDateTables(sortedTarget) : '')
    + renderCategoryOverviewPanel(centerRows, monthRows, prevMonthRows)
    + renderCategoryTrendPanel(centerRows)
    + '<div class="agg-tabs">'
    + '<div class="agg-tab ' + (aggView === 'daily' ? 'active' : '') + '" style="' + (viewMode !== 'single' ? 'opacity:.4;cursor:not-allowed;' : '') + '" title="' + (viewMode !== 'single' ? '단월 범위에서만 일별 표를 볼 수 있습니다' : '') + '" onclick="' + (viewMode !== 'single' ? '' : "setAggView('daily')") + '">일별</div>'
    + '<div class="agg-tab ' + (aggView === 'weekly' ? 'active' : '') + '" onclick="setAggView(\'weekly\')">주별</div>'
    + '<div class="agg-tab ' + (aggView === 'dow' ? 'active' : '') + '" onclick="setAggView(\'dow\')">요일별</div>'
    + '<div class="agg-tab ' + (aggView === 'monthly' ? 'active' : '') + '" onclick="setAggView(\'monthly\')">월별</div>'
    + '<div class="agg-tab ' + (aggView === 'quarter' ? 'active' : '') + '" onclick="setAggView(\'quarter\')">분기별</div>'
    + '<div class="agg-tab ' + (aggView === 'half' ? 'active' : '') + '" onclick="setAggView(\'half\')">반기별</div>'
    + '</div>'
    + '<div class="panel" id="tablePanel">' + buildTablePanelInner(sortedTarget) + '</div>'
    + '</div>';


  drawMiniCharts(sortedTarget);
  drawCategoryPieChart(centerRows);
  
  ['catOverviewDetails', 'catTrendDetails'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) {
      el.ontoggle = function() {
        if (this.open) {
          if (categoryPieChartInstance) categoryPieChartInstance.resize();
          if (categoryTrendChartInstance) categoryTrendChartInstance.resize();
        }
      };
    }
  });

  bindColToggleButton();

  const newPopover = document.getElementById('colPopover');
  if (newPopover) newPopover.scrollTop = popoverScrollTop;
  window.scrollTo(0, scrollY);
}

function shiftMonth(delta) {
  const parts = currentMonth.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1 + delta, 1);
  currentMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderDashboard();
}
function setViewMode(mode) {
  viewMode = mode;
  if (mode !== 'single' && aggView === 'daily') aggView = 'weekly';
  if (mode === 'single') aggView = 'daily';
  renderDashboard();
}
function setAggView(v) {
  if (v === 'daily' && viewMode !== 'single') return;
  aggView = v;
  renderDashboard();
}
function aggLabel(v) { return { daily: '일자별', weekly: '주별', dow: '요일별', monthly: '월별', quarter: '분기별', half: '반기별' }[v]; }

function renderChartSummary(group, records, excludeBarLabel) {
  const stats = [];

  group.barKeys.forEach(function(key, i) {
    const label = group.barLabels[i];
    if (label === excludeBarLabel) return;
    const avg = avgExcludingHolidays(records, function(r) { return resolveMetric(r, key); });
    stats.push({ l: '평균 ' + label, v: avg !== null ? Math.round(avg).toLocaleString() : '-' });
  });

  group.lineKeys.forEach(function(key, i) {
    const label = group.lineLabels[i];
    const isThresholdLine = group.threshold && group.threshold.key === key;
    const vals = records.filter(function(r) { return !isWeekendOrHoliday(r.report_date); })
      .map(function(r) { return resolveMetric(r, key); })
      .filter(function(n) { return n !== null && !isNaN(n); });
    const avg = vals.length ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : null;
    const isPct = /응답율|응대율|율/.test(label);
    stats.push({ l: '평균 ' + label, v: avg !== null ? avg.toFixed(1) + (isPct ? '%' : '') : '-' });

    if (isThresholdLine) {
      const belowCount = vals.filter(function(v) { return v < group.threshold.value; }).length;
      stats.push({ l: label + ' 미달일수', v: vals.length ? belowCount + '/' + vals.length + '일' : '-', warn: belowCount > 0 });
    }
  });

  return '<div class="chart-summary">' + stats.map(function(s) {
    return '<div class="stat"><div class="l">' + s.l + '</div><div class="v' + (s.warn ? ' warn' : '') + '">' + s.v + '</div></div>';
  }).join('') + '</div>';
}

function avgExcludingHolidays(rows, getVal) {
  const filtered = rows.filter(function(r) { return !isWeekendOrHoliday(r.report_date); });
  const nums = filtered.map(getVal).filter(function(n) { return n !== null && !isNaN(n); });
  if (nums.length === 0) return null;
  return nums.reduce(function(a, b) { return a + b; }, 0) / nums.length;
}

function extractNum(row, field, key) {
  if (currentCenter === 'lge_total' && field === 'attendance_data' && LGE_TOTAL_LIVE_SUM_KEYS[key]) {
    return lgeTotalLiveAttSum(row, key);
  }
  const obj = row[field];
  if (!obj || obj[key] === undefined || obj[key] === null || obj[key] === '') return null;
  return parseFloat(String(obj[key]).replace(/[%,]/g, ''));
}

function getAvgForDef(def, rows) {
  if (def.type === 'staff') return avgExcludingHolidays(rows, function(r) { return extractNum(r, 'attendance_data', def.attKey); });
  if (def.type === 'count' || def.type === 'people') {
    if (def.attKey) return avgExcludingHolidays(rows, function(r) { return extractNum(r, 'attendance_data', def.attKey); });
    return avgMetricValue(def.perfKey, rows);
  }
  return avgMetricValue(def.perfKey, rows);
}

function formatKpiValue(def, avg) {
  if (avg === null) return '-';
  if (def.type === 'staff') {
    const to = TO_TARGET[currentCenter] || null;
    return avg.toFixed(1) + '명' + (to ? ' (' + (avg / to * 100).toFixed(0) + '%)' : '');
  }
  if (def.type === 'people') return Math.round(avg).toLocaleString() + '명';
  if (def.type === 'count') return Math.round(avg).toLocaleString() + '건';
  if (def.type === 'number') return avg.toFixed(1);
  if (def.type === 'duration') return formatSecondsHMS(avg);
  return avg.toFixed(1) + '%';
}

// 초 단위 숫자를 H:MM:SS 형식으로 변환 (LG전자 통화시간 등 duration 타입 지표 표시용)
function formatSecondsHMS(totalSeconds) {
  const sec = Math.round(totalSeconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// "H:MM:SS" 또는 "HH:MM:SS" 텍스트를 초 단위 숫자로 변환 (계산지표에서 사용)
function parseHMSToSeconds(text) {
  if (text === undefined || text === null || String(text).trim() === '') return null;
  const parts = String(text).trim().split(':').map(function(p) { return parseInt(p, 10); });
  if (parts.some(function(n) { return isNaN(n); })) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// TO및목표값설정 입력값 파싱: "4:00:00"처럼 콜론이 있으면 시:분:초로, 아니면 일반 숫자로 해석.
// (통화시간류 duration 지표의 목표값도 다른 지표와 동일한 입력창에서 함께 처리하기 위함)
function parseKpiTargetInput(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s.indexOf(':') !== -1) return parseHMSToSeconds(s);
  const n = Number(s);
  return isNaN(n) ? null : n;
}

// 저장된 목표값(초 단위 숫자)을 화면에 표시할 때, duration 지표면 H:MM:SS로 되돌려 보여준다.
function formatKpiTargetDisplay(centerCode, key, val) {
  if (val === null || val === undefined || val === '') return '';
  return isDurationMetricKey(centerCode, key) ? formatSecondsHMS(val) : val;
}

// 전월비/전년동월비의 절대 차이값을 각 지표 단위에 맞게 표기 (근태=명, 실적=건, 응답율/SL=%p)
function formatDiffAbs(def, diff) {
  const abs = Math.abs(diff);
  if (def.type === 'staff' || def.type === 'people') return Math.round(abs).toLocaleString() + '명';
  if (def.type === 'count') return Math.round(abs).toLocaleString() + '건';
  if (def.type === 'number') return abs.toFixed(1);
  if (def.type === 'duration') return formatSecondsHMS(abs);
  return abs.toFixed(1) + '%p';
}

let lastTrendLines = [];

function periodAvgLabel() {
  if (viewMode === 'quarter') return '분기평균 ';
  if (viewMode === 'half') return '반기평균 ';
  if (viewMode === 'cumulative') return '연초평균 ';
  return '';
}

// 핵심지표 카드의 "누적" 계열 라벨: 토글에 맞춰 분기누적/반기누적/연초누적으로 표시 (단월 모드는 연초누적 기준 유지)
function periodCumLabel() {
  if (viewMode === 'quarter') return '분기누적';
  if (viewMode === 'half') return '반기누적';
  return '연초누적';
}

// 지표·일평균·평균·전월比·전년동월比를 고정된 열로 나눠 표로 정렬하는 방식.
// 값이 없는 칸은 "–"로 채워서 항목마다 글자 길이·전월比/전년동월比 유무에 상관없이
// 모든 행이 정확히 같은 높이가 된다(2026-07-19, 3가지 레이아웃 시안을 제안 후 이 방식으로 확정).
function renderTrendList(monthRows, cumulativeRows, prevYearMonthRows, prevMonthRows) {
  const dailyHeaderLabel = periodAvgLabel() || '일평균';
  lastTrendLines = ['지표\t' + dailyHeaderLabel + '\t전월비\t전년동월비\t평균'];
  const defs = CENTER_KPI_DEFS[currentCenter] || [];
  const bodyHtml = defs.map(function(def) {
    const dailyAvg = getAvgForDef(def, monthRows);
    const cumAvg = getAvgForDef(def, cumulativeRows);
    const prevMonthAvg = prevMonthRows && prevMonthRows.length ? getAvgForDef(def, prevMonthRows) : null;
    const prevYearAvg = prevYearMonthRows && prevYearMonthRows.length ? getAvgForDef(def, prevYearMonthRows) : null;

    const dailyDisplay = formatKpiValue(def, dailyAvg);
    const cumDisplay = formatKpiValue(def, cumAvg);

    function compareCellHtml(base) {
      if (dailyAvg === null || base === null) return '<span class="dash">–</span>';
      const diff = dailyAvg - base;
      const up = diff >= 0;
      const absStr = formatDiffAbs(def, diff);
      const pctStr = base !== 0 ? Math.abs(diff / base * 100).toFixed(1) + '%' : '-';
      return '<span class="arrow ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + '</span>' + absStr + ', ' + pctStr;
    }

    const momCellHtml = compareCellHtml(prevMonthAvg);
    const yoyCellHtml = compareCellHtml(prevYearAvg);

    lastTrendLines.push(def.label + '\t' + dailyDisplay
      + '\t' + (prevMonthAvg !== null ? formatKpiValue(def, prevMonthAvg) : '-')
      + '\t' + (prevYearAvg !== null ? formatKpiValue(def, prevYearAvg) : '-')
      + '\t' + cumDisplay);

    const labelText = (def.section ? def.section + ' ' : '') + def.label;

    return '<tr><td>' + labelText + '</td><td>' + dailyDisplay + '</td><td>' + cumDisplay + '</td><td>' + momCellHtml + '</td><td>' + yoyCellHtml + '</td></tr>';
  }).join('');

  return '<div class="tbl-scroll"><table class="trend-tbl">'
    + '<thead><tr><th>지표</th><th>' + dailyHeaderLabel + '</th><th>평균</th><th>전월比</th><th>전년동월比</th></tr></thead>'
    + '<tbody>' + bodyHtml + '</tbody>'
    + '</table></div>';
}

function copyTrendList() {
  navigator.clipboard.writeText(lastTrendLines.join('\n'))
    .then(function() { alert('주요지표가 클립보드에 복사되었습니다. 엑셀에 붙여넣기(Ctrl+V) 하세요.'); })
    .catch(function(e) { alert('복사 실패: ' + e.message); });
}

function copyTableToClipboard() {
  const table = document.querySelector('#tableArea table');
  if (!table) { alert('복사할 표가 없습니다.'); return; }
  const rows = Array.from(table.querySelectorAll('tr')).map(function(tr) {
    return Array.from(tr.querySelectorAll('th,td')).map(function(cell) { return cell.textContent.trim(); }).join('\t');
  });
  navigator.clipboard.writeText(rows.join('\n'))
    .then(function() { alert('표가 클립보드에 복사되었습니다. 엑셀에 붙여넣기(Ctrl+V) 하세요.'); })
    .catch(function(e) { alert('복사 실패: ' + e.message); });
}

function copyChartImage(idx) {
  const canvas = document.getElementById('miniChart' + idx);
  if (!canvas) { alert('그래프를 찾을 수 없습니다.'); return; }
  canvas.toBlob(function(blob) {
    if (!blob) { alert('이미지 생성에 실패했습니다.'); return; }
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(function() { alert('그래프 이미지가 클립보드에 복사되었습니다.'); })
        .catch(function() { downloadChartImage(canvas, idx); });
    } else {
      downloadChartImage(canvas, idx);
    }
  });
}

function downloadChartImage(canvas, idx) {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = 'chart_' + idx + '_' + localDateStr(new Date()) + '.png';
  a.click();
  alert('이 브라우저는 이미지 클립보드 복사를 지원하지 않아 파일로 다운로드했습니다.');
}

function computeAlert(centerRows) {
  const sorted = centerRows.slice().sort(function(a, b) { return b.report_date.localeCompare(a.report_date); });

  // 우측 보조 배지: 임계값에 근접(임계값 이상 ~ +5 이내)한 그룹은 "모니터링 권장"으로 안내
  const chartConfig = CENTER_CHART_CONFIG[currentCenter];
  const monthRowsForAlert = centerRows.filter(function(r) { return r.report_date.startsWith(currentMonth); });
  const chips = [];
  if (chartConfig) {
    chartConfig.groups.forEach(function(group) {
      if (!group.threshold) return;
      const avg = avgExcludingHolidays(monthRowsForAlert, function(r) { return extractNum(r, 'performance_data', group.threshold.key); });
      if (avg !== null && avg >= group.threshold.value && avg < group.threshold.value + 5) {
        chips.push(group.title + ' ' + group.threshold.key.split('_').pop() + ' 모니터링 권장');
      }
    });
  }
  const chipsHtml = chips.length ? chips.map(function(c) { return '<span class="alert-chip">⚠ ' + c + '</span>'; }).join('') : '';

  if (sorted.length < 2) return { html: '<div class="alert-card none"><div><b>이상징후</b>비교할 데이터가 충분하지 않습니다.</div>' + chipsHtml + '</div>' };
  const latest = sorted[0], prev = sorted[1];
  const keys = Object.keys(latest.performance_data || {}).filter(function(k) { return k.includes('응답율') || k.includes('응대율'); });
  const issues = [];
  keys.forEach(function(k) {
    const cur = parseFloat(String(latest.performance_data[k]).replace('%', ''));
    const prevVal = prev.performance_data ? prev.performance_data[k] : undefined;
    if (prevVal === undefined) return;
    const before = parseFloat(String(prevVal).replace('%', ''));
    if (!isNaN(cur) && !isNaN(before) && before - cur >= 5) {
      issues.push(k + ' ' + before + '% → ' + cur + '% (▼' + (before - cur).toFixed(1) + 'p)');
    }
  });
  if (issues.length === 0) return { html: '<div class="alert-card none"><div><b>이상징후 없음</b>최근 대비 응답율, SL, 인입 등 주요 지표가 안정적으로 유지되고 있습니다.</div>' + chipsHtml + '</div>' };
  return { html: '<div class="alert-card"><div><b>이상징후 감지 (' + latest.report_date + ' 기준)</b>' + issues.join(' · ') + '</div>' + chipsHtml + '</div>' };
}

// ============================================
// 전체 현황 요약 카드 (이상징후와 지표추이 사이) - 센터별 설정 기반 공통 함수
// ============================================
const GROUP_ICONS = ['🎧', '🚗', '📋', '💼', '🏢'];
// 복사 버튼 아이콘(다크 테마 중립톤 버튼에 사용) - 텍스트 "복사" 대신 아이콘+title 툴팁으로 표시
const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

// ============================================
// KB손보정비 전용 대시보드 (참고 이미지 반영)
// 최신 일자(금일) 스냅샷 기준 KPI + 접수구성 도넛 + 인력/처리 성과표 + 변경기한일 준수현황
// ============================================
let kbjComposeDonut = null, kbjComplianceDonut1 = null, kbjComplianceDonut2 = null;

function kbjNum(row, key, group) { return extractNum(row, group || 'performance_data', key); }

function kbjStatBox(label, val, pct) {
  return '<div class="kbj-stat-box"><div class="l">' + label + '</div><div class="v">' + val.toLocaleString() + '건</div><div class="p">(' + pct.toFixed(1) + '%)</div></div>';
}

function renderKbjeongbiExtraDashboard(centerRows, monthRows, prevMonthRows) {
  const sorted = centerRows.slice().sort(function(a, b) { return b.report_date.localeCompare(a.report_date); });
  const latest = sorted.find(function(r) { return r.performance_data && r.performance_data['접수_Total'] !== undefined; });
  if (!latest) return '<div class="panel" style="margin-bottom:18px;"><div class="empty">등록된 데이터가 없습니다.</div></div>';

  const others = monthRows.filter(function(r) { return r.report_date !== latest.report_date && !isWeekendOrHoliday(r.report_date) && r.performance_data && r.performance_data['접수_Total'] !== undefined; });
  function avgOf(key) {
    const vals = others.map(function(r) { return kbjNum(r, key); }).filter(function(n) { return n !== null && !isNaN(n); });
    return vals.length ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : null;
  }
  function avgOfAtt(key) {
    const vals = others.map(function(r) { return kbjNum(r, key, 'attendance_data'); }).filter(function(n) { return n !== null && !isNaN(n); });
    return vals.length ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : null;
  }
  const jVal = function(key) { const v = kbjNum(latest, key); return v === null ? 0 : v; };
  const jAtt = function(key) { return kbjNum(latest, key, 'attendance_data'); };

  const jr = { g: jVal('접수_고지의무'), t: jVal('접수_통지의무'), m: jVal('접수_목적물소멸'), e: jVal('접수_기타'), total: jVal('접수_Total') };
  const jp = { g: jVal('처리_고지의무'), t: jVal('처리_통지의무'), m: jVal('처리_목적물소멸'), e: jVal('처리_기타'), total: jVal('처리_Total') };
  const ju = { g: jr.g - jp.g, t: jr.t - jp.t, m: jr.m - jp.m, e: jr.e - jp.e, total: jr.total - jp.total };
  const rate = jr.total ? (jp.total / jr.total * 100) : 0;

  const staffTotal = jAtt('재직인원');
  const inputCounselor = jAtt('상담사_투입인원');
  const managerCount = 1; // 고정 관리자 인원
  const counselorTotal = staffTotal !== null ? staffTotal - managerCount : null;
  const efficiency = (inputCounselor !== null && staffTotal) ? (inputCounselor / staffTotal * 100) : null;

  const breakdownLine = function(o) { return '고지의무 ' + o.g + ' · 통지의무 ' + o.t + ' · 목적물소멸 ' + o.m + ' · 기타 ' + o.e; };

  const kpiCards = [
    { l: '📥 접수 Total', v: jr.total.toLocaleString() + '건', s: breakdownLine(jr) },
    { l: '✅ 처리 Total', v: jp.total.toLocaleString() + '건', s: breakdownLine(jp) },
    { l: '🎯 처리율', v: rate.toFixed(1) + '%', s: '접수 대비 처리 비율' },
    { l: '⏳ 미처리건', v: ju.total.toLocaleString() + '건', s: breakdownLine(ju) },
    { l: '🎧 투입상담사', v: (inputCounselor !== null ? inputCounselor : '-') + '명', s: '상담사 ' + (counselorTotal !== null ? counselorTotal : '-') + '명 중 투입 ' + (inputCounselor !== null ? inputCounselor : '-') + '명' },
    { l: '📈 인력 운영효율', v: (efficiency !== null ? efficiency.toFixed(0) : '-') + '%', s: '투입상담사 ' + (inputCounselor !== null ? inputCounselor : '-') + '명 / 총 인원 ' + (staffTotal !== null ? staffTotal : '-') + '명' }
  ];
  const kpiHtml = '<div class="kbj-kpi-grid">' + kpiCards.map(function(c) {
    return '<div class="kbj-kpi-card"><div class="l">' + c.l + '</div><div class="v">' + c.v + '</div><div class="s">' + c.s + '</div></div>';
  }).join('') + '</div>';

  // 인력 및 처리 성과 분석 표 (금일 / 전일평균 / 전일대비)
  const staffAvg = avgOfAtt('재직인원');
  const counselorAvgVal = staffAvg !== null ? staffAvg - managerCount : null;
  const inputAvg = avgOfAtt('상담사_투입인원');
  const receiveAvg = avgOf('접수_Total');
  const processAvg = avgOf('처리_Total');
  const rateAvg = (receiveAvg !== null && processAvg !== null && receiveAvg !== 0) ? (processAvg / receiveAvg * 100) : null;

  function fmt1(n) { return n === null ? '-' : (Number.isInteger(n) ? n.toString() : n.toFixed(1)); }
  function diffArrow(cur, base, unit, isPct) {
    if (cur === null || base === null) return '-';
    const d = cur - base;
    const up = d >= 0;
    const color = up ? '#FF6B70' : '#5ac8fa';
    return '<span style="color:' + color + ';font-weight:600;">' + (up ? '▲' : '▼') + Math.abs(d).toFixed(isPct ? 1 : 1) + unit + '</span>';
  }

  const perfTable = '<table class="kbj-perf-table">'
    + '<thead><tr><th>상담사</th><th>투입상담사</th><th>접수 Total</th><th>처리 Total</th><th>처리율</th></tr></thead>'
    + '<tbody>'
    + '<tr><td colspan="5" style="text-align:left;font-weight:700;background:#111113;">금일 (' + latest.report_date + ')</td></tr>'
    + '<tr><td>' + (counselorTotal !== null ? counselorTotal + '명' : '-') + '</td><td>' + (inputCounselor !== null ? inputCounselor + '명' : '-') + '</td><td>' + jr.total.toLocaleString() + '건</td><td>' + jp.total.toLocaleString() + '건</td><td>' + rate.toFixed(1) + '%</td></tr>'
    + '<tr><td colspan="5" style="text-align:left;font-weight:700;background:#111113;">전일 평균</td></tr>'
    + '<tr><td>' + (counselorAvgVal !== null ? fmt1(counselorAvgVal) + '명' : '-') + '</td><td>' + (inputAvg !== null ? fmt1(inputAvg) + '명' : '-') + '</td><td>' + (receiveAvg !== null ? Math.round(receiveAvg).toLocaleString() + '건' : '-') + '</td><td>' + (processAvg !== null ? Math.round(processAvg).toLocaleString() + '건' : '-') + '</td><td>' + (rateAvg !== null ? rateAvg.toFixed(1) + '%' : '-') + '</td></tr>'
    + '<tr><td colspan="5" style="text-align:left;font-weight:700;background:#111113;">전일 대비</td></tr>'
    + '<tr><td>' + diffArrow(counselorTotal, counselorAvgVal, '명') + '</td><td>' + diffArrow(inputCounselor, inputAvg, '명') + '</td><td>' + diffArrow(jr.total, receiveAvg, '건') + '</td><td>' + diffArrow(jp.total, processAvg, '건') + '</td><td>' + diffArrow(rate, rateAvg, '%p', true) + '</td></tr>'
    + '</tbody></table>'
    + '<p style="font-size:11px;color:#86868b;margin-top:8px;">※ 인력 운영효율 = 투입상담사 / 총 인원 기준</p>';

  // 변경기한일 준수 현황 (고지의무 / 통지의무)
  function compliancePanel(label, canvasId, target, proc, unproc) {
    const denom = proc + unproc;
    const procRate = denom ? (proc / denom * 100) : 0;
    const unprocRate = 100 - procRate;
    return '<div class="panel">'
      + '<h3 style="margin-bottom:12px;">' + label + ' 변경기한일 준수 현황 <span style="font-size:12px;color:#86868b;font-weight:400;">대상 ' + target.toLocaleString() + '건</span></h3>'
      + '<div style="display:flex;gap:10px;margin-bottom:14px;">'
      + kbjStatBox('대상건', target, 100)
      + kbjStatBox('처리건', proc, procRate)
      + kbjStatBox('미처리건', unproc, unprocRate)
      + '</div>'
      + '<div style="width:110px;height:110px;margin:0 auto;"><canvas id="' + canvasId + '"></canvas></div>'
      + '<div style="text-align:center;font-size:12px;color:#86868b;margin-top:8px;">처리율 ' + procRate.toFixed(1) + '% · 미처리율 ' + unprocRate.toFixed(1) + '%</div>'
      + '</div>';
  }

  const gojiTarget = jVal('고지의무_변경기한일_대상건'), gojiProc = jVal('고지의무_변경기한일_처리건'), gojiUnproc = jVal('고지의무_변경기한일_미처리건');
  const tongjiTarget = jVal('통지의무_변경기한일_대상건'), tongjiProc = jVal('통지의무_변경기한일_처리건'), tongjiUnproc = jVal('통지의무_변경기한일_미처리건');

  return kpiHtml
    + '<div class="kbj-split2">'
    + '<div class="panel"><h3 style="margin-bottom:12px;">인력 및 처리 성과 분석</h3>' + perfTable + '</div>'
    + '<div class="panel"><h3 style="margin-bottom:12px;">접수건 구성 비중 <span style="font-size:12px;color:#86868b;font-weight:400;">(Total ' + jr.total.toLocaleString() + '건)</span></h3>'
    + '<div style="width:100%;max-width:220px;height:220px;margin:0 auto;"><canvas id="kbjComposeChart"></canvas></div></div>'
    + '</div>'
    + '<div class="kbj-split2">'
    + compliancePanel('고지의무', 'kbjComplianceChart1', gojiTarget, gojiProc, gojiUnproc)
    + compliancePanel('통지의무', 'kbjComplianceChart2', tongjiTarget, tongjiProc, tongjiUnproc)
    + '</div>';
}

function drawKbjeongbiDonut(centerRows) {
  [kbjComposeDonut, kbjComplianceDonut1, kbjComplianceDonut2].forEach(function(c) { if (c) c.destroy(); });
  kbjComposeDonut = null; kbjComplianceDonut1 = null; kbjComplianceDonut2 = null;

  const sorted = centerRows.slice().sort(function(a, b) { return b.report_date.localeCompare(a.report_date); });
  const latest = sorted.find(function(r) { return r.performance_data && r.performance_data['접수_Total'] !== undefined; });
  if (!latest) return;
  const jVal = function(key) { const v = kbjNum(latest, key); return v === null ? 0 : v; };
  const theme = getDashTheme();
  const palette = [theme.accent, theme.dark, '#B7C4D6', '#D9C89A'];

  const composeCanvas = document.getElementById('kbjComposeChart');
  if (composeCanvas) {
    kbjComposeDonut = new Chart(composeCanvas, {
      type: 'doughnut',
      data: {
        labels: ['고지의무', '통지의무', '목적물소멸', '기타'],
        datasets: [{ data: [jVal('접수_고지의무'), jVal('접수_통지의무'), jVal('접수_목적물소멸'), jVal('접수_기타')], backgroundColor: palette }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, font: { size: 10 } } } } }
    });
  }

  function drawComplianceDonut(canvasId, proc, unproc) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    return new Chart(canvas, {
      type: 'doughnut',
      data: { labels: ['처리', '미처리'], datasets: [{ data: [proc, unproc], backgroundColor: [theme.accent, '#3a3f47'] }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
    });
  }
  kbjComplianceDonut1 = drawComplianceDonut('kbjComplianceChart1', jVal('고지의무_변경기한일_처리건'), jVal('고지의무_변경기한일_미처리건'));
  kbjComplianceDonut2 = drawComplianceDonut('kbjComplianceChart2', jVal('통지의무_변경기한일_처리건'), jVal('통지의무_변경기한일_미처리건'));
}

// ============================================
// KB손보정비 전용: 4개 카테고리(총합계/고지의무/통지의무/목적물소멸) 요약카드
// ============================================
const KBJ_CATEGORY_CARDS = [
  { title: 'Total 현황', icon: '📊', accKey: '통합_접수', procKey: '통합_처리' },
  { title: '고지의무 현황', icon: '📋', accKey: '접수_고지의무', procKey: '처리_고지의무' },
  { title: '통지의무 현황', icon: '📨', accKey: '접수_통지의무', procKey: '처리_통지의무' },
  { title: '목적물소멸 현황', icon: '🏠', accKey: '접수_목적물소멸', procKey: '처리_목적물소멸' },
];

function renderKbjeongbiSummaryCards2(monthRows, cumulativeRows) {
  // 상단 토글 기본값(단월)에서는 "월누적"(=이번 달 실적, 해당 월 지표)을 보여주고,
  // 분기/반기/연초누적 토글 시에는 그 기간 전체(periodCumLabel/cumulativeRows)로 자동 전환된다.
  const cumSourceRows = viewMode === 'single' ? monthRows : cumulativeRows;
  const cumLabel = viewMode === 'single' ? '월누적' : periodCumLabel();
  const cards = KBJ_CATEGORY_CARDS.map(function(c, i) {
    const dailyAcc = avgExcludingHolidays(monthRows, function(r) { return resolveMetric(r, c.accKey); });
    const dailyProc = avgExcludingHolidays(monthRows, function(r) { return resolveMetric(r, c.procKey); });
    const dailyUnproc = avgExcludingHolidays(monthRows, function(r) {
      const acc = resolveMetric(r, c.accKey), proc = resolveMetric(r, c.procKey);
      return (acc !== null && proc !== null) ? (acc - proc) : null;
    });
    const cumAcc = sumMetric(cumSourceRows, c.accKey);
    const cumProc = sumMetric(cumSourceRows, c.procKey);
    const cumUnproc = cumAcc - cumProc;
    const cardId = 'kbjSumCard' + i;
    return '<div class="summary-card2" id="' + cardId + '">'
      + '<div class="sc-head"><span class="sc-title">' + c.icon + ' ' + c.title + (periodAvgLabel() ? ' (' + periodAvgLabel().trim() + ')' : '') + '</span><button class="sc-copy" title="복사" onclick="copySummaryCard(\'' + cardId + '\')">' + COPY_ICON_SVG + '</button></div>'
      + '<div class="sc-row" style="grid-template-columns:repeat(3,1fr);">'
      + '<div class="sc-stat"><div class="l">일평균 접수건</div><div class="v">' + (dailyAcc !== null ? dailyAcc.toFixed(1) : '-') + '건</div></div>'
      + '<div class="sc-stat"><div class="l">일평균 처리건</div><div class="v">' + (dailyProc !== null ? dailyProc.toFixed(1) : '-') + '건</div></div>'
      + '<div class="sc-stat"><div class="l">일평균 미처리건</div><div class="v">' + (dailyUnproc !== null ? dailyUnproc.toFixed(1) : '-') + '건</div></div>'
      + '</div>'
      + '<div class="sc-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">'
      + '<div class="sc-stat"><div class="l">' + cumLabel + ' 접수건</div><div class="v">' + cumAcc.toLocaleString() + '건</div></div>'
      + '<div class="sc-stat"><div class="l">' + cumLabel + ' 처리건</div><div class="v">' + cumProc.toLocaleString() + '건</div></div>'
      + '<div class="sc-stat"><div class="l">' + cumLabel + ' 미처리건</div><div class="v warn">' + cumUnproc.toLocaleString() + '건</div></div>'
      + '</div>'
      + '</div>';
  }).join('');
  return '<div class="summary-cards">' + cards + '</div>';
}

// ============================================
// KB손보정비 전용: 변경기한일 일자별 현황(대상건/처리건/처리율)
// ============================================
function renderKbjeongbiDueDateTable(label, targetKey, procKey, records) {
  const valid = records.filter(function(r) { return r.performance_data && r.performance_data[targetKey] !== undefined; });
  if (valid.length === 0) return '<div class="panel"><h3>' + label + ' 변경기한일 ' + aggLabel(aggView) + ' 현황</h3><div class="empty">등록된 데이터가 없습니다.</div></div>';

  let bucketEntries;
  if (aggView === 'daily') {
    bucketEntries = valid.slice().sort(function(a, b) { return b.report_date.localeCompare(a.report_date); })
      .map(function(r) {
        const md = r.report_date.match(/-(\d{2})-(\d{2})$/);
        return { label: md ? (Number(md[1]) + '/' + Number(md[2])) : r.report_date, rows: [r] };
      });
  } else {
    const buckets = groupByBucket(valid, aggView);
    bucketEntries = Object.keys(buckets).map(function(k) { return { label: k, rows: buckets[k] }; });
    if (aggView !== 'dow') bucketEntries.reverse(); // 최신 순 (요일별은 월~일 고정 순서 유지)
  }

  const rows = bucketEntries.map(function(b) {
    const targetSum = b.rows.reduce(function(s, r) { return s + (resolveMetric(r, targetKey) || 0); }, 0);
    const procSum = b.rows.reduce(function(s, r) { return s + (resolveMetric(r, procKey) || 0); }, 0);
    const days = b.rows.length;
    const targetAvg = days ? targetSum / days : 0;
    const procAvg = days ? procSum / days : 0;
    const rate = targetSum ? (procSum / targetSum * 100) : 0;
    const showAvg = aggView !== 'daily';
    return '<tr><td>' + b.label + '</td>'
      + '<td>' + targetSum.toLocaleString() + '건' + (showAvg ? ' <span style="color:#86868b;font-size:11px;">(일평균 ' + targetAvg.toFixed(1) + ')</span>' : '') + '</td>'
      + '<td>' + procSum.toLocaleString() + '건' + (showAvg ? ' <span style="color:#86868b;font-size:11px;">(일평균 ' + procAvg.toFixed(1) + ')</span>' : '') + '</td>'
      + '<td><span style="background:rgba(255,107,112,.14);color:#FF6B70;font-weight:700;padding:3px 10px;border-radius:12px;font-size:12px;">' + rate.toFixed(1) + '%</span></td></tr>';
  }).join('');

  return '<div class="panel"><h3 style="margin-bottom:10px;">' + label + ' 변경기한일 ' + aggLabel(aggView) + ' 현황</h3>'
    + '<div class="table-scroll" style="max-height:320px;overflow-y:auto;"><table><thead><tr><th>' + (aggView === 'daily' ? '일자' : '기간') + '</th><th>대상건</th><th>처리건</th><th>처리율</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '</div>';
}

function renderKbjeongbiDueDateTables(records) {
  return '<div class="kbj-split-even">'
    + renderKbjeongbiDueDateTable('고지의무', '고지의무_변경기한일_대상건', '고지의무_변경기한일_처리건', records)
    + renderKbjeongbiDueDateTable('통지의무', '통지의무_변경기한일_대상건', '통지의무_변경기한일_처리건', records)
    + '</div>';
}

function renderSummaryCards(monthRows, cumulativeRows, prevMonthRows) {
  const toInfo = CENTER_TO_INFO[currentCenter];
  const chartConfig = CENTER_CHART_CONFIG[currentCenter];
  if (!toInfo || !chartConfig) return '';

  // LG전자통합처럼 TO가 고정값이 아니라 매일 입력되는 값인 센터는(dynamicTargetAttKey), 각 기간(이번달/전월/누적)에
  // 입력된 TO의 평균을 그 기간의 목표치로 사용한다. 그 외 센터는 기존처럼 고정 TO_TARGET/정원을 그대로 쓴다.
  const targetFor = function(rows) {
    if (toInfo.dynamicTargetAttKey) return avgExcludingHolidays(rows, function(r) { return extractNum(r, 'attendance_data', toInfo.dynamicTargetAttKey); });
    return TO_TARGET[currentCenter] || toInfo.counselor;
  };
  const toMonth = targetFor(monthRows);
  const toCum = targetFor(cumulativeRows);
  const toPrevMonth = prevMonthRows && prevMonthRows.length ? targetFor(prevMonthRows) : null;
  const staffAvgMonth = avgExcludingHolidays(monthRows, function(r) { return extractNum(r, 'attendance_data', toInfo.staffAttKey); });
  const staffAvgCum = avgExcludingHolidays(cumulativeRows, function(r) { return extractNum(r, 'attendance_data', toInfo.staffAttKey); });
  const staffAvgPrevMonth = prevMonthRows && prevMonthRows.length ? avgExcludingHolidays(prevMonthRows, function(r) { return extractNum(r, 'attendance_data', toInfo.staffAttKey); }) : null;

  const curPct = staffAvgMonth !== null && toMonth ? (staffAvgMonth / toMonth * 100) : null;
  const prevPct = staffAvgPrevMonth !== null && toPrevMonth ? (staffAvgPrevMonth / toPrevMonth * 100) : null;
  const cumPct = staffAvgCum !== null && toCum ? (staffAvgCum / toCum * 100) : null;
  const pctDiff = (curPct !== null && prevPct !== null) ? (curPct - prevPct) : null;

  const overviewCard = '<div class="summary-card2" id="sumCardOverview">'
    + '<div class="sc-head"><span class="sc-title">👥 전체 운영 요약' + (periodAvgLabel() ? ' (' + periodAvgLabel().trim() + ')' : '') + '</span><button class="sc-copy" title="복사" onclick="copySummaryCard(\'sumCardOverview\')">' + COPY_ICON_SVG + '</button></div>'
    + '<div class="sc-row" style="grid-template-columns:repeat(3,1fr);">'
    + '<div class="sc-stat"><div class="l">전체 재직인원(TO대비)</div><div class="v">' + (staffAvgMonth !== null ? staffAvgMonth.toFixed(1) : '-') + '명</div><div class="sub">(' + (curPct !== null ? curPct.toFixed(0) : '-') + '%)</div></div>'
    + '<div class="sc-stat"><div class="l">운영 안정도</div><div class="v">' + (curPct !== null ? curPct.toFixed(0) : '-') + '%</div><div class="sub">' + (pctDiff !== null ? ('전월比 ' + (pctDiff >= 0 ? '▲' : '▼') + Math.abs(pctDiff).toFixed(0) + '%p') : '-') + '</div></div>'
    + '<div class="sc-stat"><div class="l">' + periodCumLabel() + ' 평균 재직인원</div><div class="v">' + (staffAvgCum !== null ? staffAvgCum.toFixed(1) : '-') + '명</div><div class="sub">(' + (cumPct !== null ? cumPct.toFixed(0) : '-') + '%)</div></div>'
    + '</div>'
    + (toInfo.fullNote ? '<div class="sub" style="text-align:center;color:#86868b;">※ ' + toInfo.fullNote + '</div>' : (toInfo.note ? '<div class="sub" style="text-align:center;color:#86868b;">※ 전체 정원 ' + toInfo.total + '명 중 ' + toInfo.note + '</div>' : ''))
    + '</div>';

  const groupCards = chartConfig.groups.map(function(group, gi) {
    const inboundAvg = avgMetricValue(group.barKeys[0], monthRows);
    const answeredAvg = group.barKeys[1] ? avgMetricValue(group.barKeys[1], monthRows) : null;
    const rateAvg = avgMetricValue(group.lineKeys[0], monthRows);
    const secondAvg = group.lineKeys[1] ? avgMetricValue(group.lineKeys[1], monthRows) : null;

    let missText = '-';
    if (group.threshold) {
      const vals = monthRows.filter(function(r) { return !isWeekendOrHoliday(r.report_date); })
        .map(function(r) { return resolveMetric(r, group.threshold.key); })
        .filter(function(n) { return n !== null && !isNaN(n); });
      const below = vals.filter(function(v) { return v < group.threshold.value; }).length;
      missText = vals.length ? below + '/' + vals.length + '일' : '-';
    }

    const cardId = 'sumCardGroup' + gi;
    const secondLabel = group.lineLabels[1] || group.lineLabels[0];
    // "미달일수"는 threshold가 걸린 실제 지표명을 따라가야 한다 (항상 두번째 지표가 아닐 수 있음)
    const thresholdIdx = group.threshold ? group.lineKeys.indexOf(group.threshold.key) : -1;
    const thresholdLabel = thresholdIdx >= 0 ? group.lineLabels[thresholdIdx].replace('(%)', '') : secondLabel;

    // summaryRows가 지정돼 있으면(예: LG전자통합) 막대/선 구성 그대로가 아니라
    // 지정된 줄·순서·항목으로 카드 본문 전체를 재구성한다(차트 자체 구성은 영향 없음).
    const primaryRowHtml = group.summaryRows
      ? group.summaryRows.map(function(rowDefs, ri) {
          const cells = rowDefs.map(function(s) {
            const avg = avgMetricValue(s.key, monthRows);
            const isDur = METRIC_UNITS[s.key] === 'duration';
            const display = avg === null ? '-' : (isDur ? formatSecondsHMS(avg) : avg.toFixed(1));
            return '<div class="sc-stat"><div class="l">' + s.label + '</div><div class="v">' + display + '</div></div>';
          }).join('');
          return '<div class="sc-row" style="grid-template-columns:repeat(' + rowDefs.length + ',1fr);' + (ri === group.summaryRows.length - 1 ? 'margin-bottom:0;' : '') + '">' + cells + '</div>';
        }).join('')
      : '<div class="sc-row" style="grid-template-columns:repeat(3,1fr);">'
        + '<div class="sc-stat"><div class="l">' + group.barLabels[0] + '</div><div class="v">' + (inboundAvg !== null ? Math.round(inboundAvg).toLocaleString() : '-') + '건</div></div>'
        + (group.barKeys[1] ? '<div class="sc-stat"><div class="l">' + group.barLabels[1] + '</div><div class="v">' + (answeredAvg !== null ? Math.round(answeredAvg).toLocaleString() : '-') + '건</div></div>' : '')
        + '<div class="sc-stat"><div class="l">' + group.lineLabels[0].replace('(%)', '') + '</div><div class="v">' + (rateAvg !== null ? rateAvg.toFixed(1) + '%' : '-') + '</div></div>'
        + '</div>';

    return '<div class="summary-card2" id="' + cardId + '">'
      + '<div class="sc-head"><span class="sc-title">' + GROUP_ICONS[gi % GROUP_ICONS.length] + ' ' + group.title + (periodAvgLabel() ? ' (' + periodAvgLabel().trim() + ')' : '') + '</span><button class="sc-copy" title="' + group.title + ' 복사" onclick="copySummaryCard(\'' + cardId + '\')">' + COPY_ICON_SVG + '</button></div>'
      + primaryRowHtml
      + (!group.summaryRows && group.lineKeys[1] ? '<div class="sc-row" style="grid-template-columns:repeat(2,1fr);margin-bottom:0;">'
        + '<div class="sc-stat"><div class="l">' + secondLabel + '</div><div class="v">' + (secondAvg !== null ? secondAvg.toFixed(1) : '-') + '</div></div>'
        + '<div class="sc-stat"><div class="l">' + thresholdLabel + ' 미달일수</div><div class="v warn">' + missText + '</div></div>'
        + '</div>' : '')
      + '</div>';
  }).join('');

  return '<div class="summary-cards">' + overviewCard + groupCards + '</div>';
}

function copySummaryCard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.innerText.replace(/\n{2,}/g, '\n');
  navigator.clipboard.writeText(text)
    .then(function() { alert('요약 카드 내용이 클립보드에 복사되었습니다.'); })
    .catch(function(e) { alert('복사 실패: ' + e.message); });
}

function formatChartLabel(bucketLabel) {
  if (aggView !== 'daily') return bucketLabel;
  const d = new Date(bucketLabel + 'T00:00:00');
  if (isNaN(d.getTime())) return bucketLabel;
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return d.getDate() + '일(' + dow + ')';
}

// ============================================
// 업무유형별 인입현황 - 원형그래프(최신일자) + 상위3 트렌드 + 전월대비 증감 랭킹표
// ============================================
let categoryPieChartInstance = null;
let categoryTrendChartInstance = null;

const CENTER_CATEGORY_PALETTE = {
  'pyeongtaek': ['#009DA5', '#303192', '#7ED9DD', '#6C7FC9', '#00C2C2', '#1D2A6B', '#4FB8BD', '#8891D6', '#00838A', '#5A6BB0', '#B9EDEF', '#3A4A9A']
};
const DEFAULT_CATEGORY_PALETTE = ['#FFBC00', '#60584C', '#8A8478', '#B7C4D6', '#9B9E9F', '#545045', '#D9C89A', '#C7B299', '#A9A9A9', '#E8D9B5', '#7A7062', '#C9C0B0'];
function getCategoryPalette() { return CENTER_CATEGORY_PALETTE[currentCenter] || DEFAULT_CATEGORY_PALETTE; }

// 이상징후 기준: 증감률 30%↑ AND 절대증가 100건↑ 동시 충족 시에만 "이상"으로 표기
const CATEGORY_ANOMALY_PCT = 30;
const CATEGORY_ANOMALY_ABS = 100;

function categoryMonthlySum(rows, key) {
  return rows.reduce(function(sum, r) {
    const n = parseFloat(String((r.performance_data && r.performance_data[key]) || '0').replace(/,/g, '')) || 0;
    return sum + n;
  }, 0);
}

// 기간 내 일평균 (해당 기간에 등록된 일수로 나눔)
function categoryDailyAvg(rows, key) {
  if (!rows.length) return 0;
  return categoryMonthlySum(rows, key) / rows.length;
}

function renderCategoryOverviewPanel(centerRows, monthRows, prevMonthRows) {
  const schema = categorySchemaCache[currentCenter] || [];
  if (schema.length === 0) return '';

  const totalKey = schema[0].key;
  const catCols = schema.slice(1);
  const validRows = centerRows.filter(function(r) { return r.performance_data && r.performance_data[totalKey] !== undefined; });

  if (validRows.length === 0) {
    return '<div class="panel" style="margin-bottom:18px;"><h3>업무유형별 인입건수 비율</h3><div class="empty">등록된 데이터가 없습니다.</div></div>';
  }

  // 원형그래프/비중표: 전체 누적기간 일평균 기준
  const avgAll = {};
  schema.forEach(function(c) { avgAll[c.key] = categoryDailyAvg(validRows, c.key); });

  // 전월 대비 증감(일평균 비교)
  const rankRows = catCols.map(function(c) {
    const curAvg = categoryDailyAvg(monthRows, c.key);
    const prevAvg = categoryDailyAvg(prevMonthRows, c.key);
    const diff = curAvg - prevAvg;
    const pct = prevAvg !== 0 ? (diff / prevAvg * 100) : (curAvg > 0 ? 100 : 0);
    const isAnomaly = Math.abs(pct) >= CATEGORY_ANOMALY_PCT && Math.abs(diff) >= CATEGORY_ANOMALY_ABS;
    return { key: c.key, curAvg: curAvg, prevAvg: prevAvg, diff: diff, pct: pct, isAnomaly: isAnomaly };
  }).sort(function(a, b) { return b.pct - a.pct; });

  const rankHtml = rankRows.map(function(r) {
    const up = r.diff >= 0;
    const arrowColor = up ? '#FF6B70' : '#5ac8fa';
    return '<tr' + (r.isAnomaly ? ' style="background:rgba(255,107,112,.14);"' : '') + '>'
      + '<td>' + r.key + (r.isAnomaly ? ' ⚠' : '') + '</td>'
      + '<td>' + r.curAvg.toFixed(1) + '건/일</td>'
      + '<td>' + r.prevAvg.toFixed(1) + '건/일</td>'
      + '<td style="color:' + arrowColor + ';font-weight:600;">' + (up ? '▲' : '▼') + Math.abs(r.diff).toFixed(1) + '건/일 (' + Math.abs(r.pct).toFixed(1) + '%)</td>'
      + '</tr>';
  }).join('');

  const shareRows = catCols.map(function(c) {
    const pct = avgAll[totalKey] ? (avgAll[c.key] / avgAll[totalKey] * 100).toFixed(1) : '0.0';
    return '<tr><td>' + c.key + '</td><td>' + avgAll[c.key].toFixed(1) + '건/일</td><td>' + pct + '%</td></tr>';
  }).join('');

  return '<details class="panel" id="catOverviewDetails" style="margin-bottom:18px;">'
    + '<summary style="cursor:pointer;font-weight:700;font-size:15px;">업무유형별 인입건수 비율 (누적 일평균 기준, ' + validRows.length + '일 누적) · 전월 대비 증감</summary>'
    + '<div style="margin-top:16px;">'
    + '<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-bottom:20px;">'
    + '<div style="width:260px;height:260px;"><canvas id="categoryPieChart"></canvas></div>'
    + '<div class="table-scroll" style="flex:1;min-width:240px;"><table><thead><tr><th>업무유형</th><th>일평균</th><th>비중</th></tr></thead><tbody>' + shareRows + '</tbody></table></div>'
    + '</div>'
    + '<h3 style="margin-top:10px;">업무유형별 전월 대비 증감 (일평균 비교, 증감률 ' + CATEGORY_ANOMALY_PCT + '%↑ · 절대증가 ' + CATEGORY_ANOMALY_ABS + '건/일↑ 동시 충족 시 ⚠)</h3>'
    + '<div class="table-scroll"><table><thead><tr><th>업무유형</th><th>이번달 일평균</th><th>전월 일평균</th><th>증감</th></tr></thead><tbody>' + rankHtml + '</tbody></table></div>'
    + '</div></details>';
}

function renderCategoryTrendPanel(centerRows) {
  const schema = categorySchemaCache[currentCenter] || [];
  if (schema.length === 0) return '';
  const totalKey = schema[0].key;
  const catCols = schema.slice(1);
  const validRows = centerRows.filter(function(r) { return r.performance_data && r.performance_data[totalKey] !== undefined; });
  if (validRows.length === 0) return '';

  const sorted = validRows.slice().sort(function(a, b) { return b.report_date.localeCompare(a.report_date); });
  const recent30 = sorted.slice(0, 30);
  const sumsRecent = {};
  catCols.forEach(function(c) { sumsRecent[c.key] = categoryMonthlySum(recent30, c.key); });
  const top3 = catCols.map(function(c) { return c.key; }).sort(function(a, b) { return sumsRecent[b] - sumsRecent[a]; }).slice(0, 3);

  return '<details class="panel" id="catTrendDetails" style="margin-bottom:18px;">'
    + '<summary style="cursor:pointer;font-weight:700;font-size:15px;">상위 3개 유형 추이 (' + top3.join(' · ') + ')</summary>'
    + '<div style="margin-top:16px;height:240px;"><canvas id="categoryTrendChart"></canvas></div>'
    + '</details>';
}

function drawCategoryPieChart(centerRows) {
  if (categoryPieChartInstance) { categoryPieChartInstance.destroy(); categoryPieChartInstance = null; }
  if (categoryTrendChartInstance) { categoryTrendChartInstance.destroy(); categoryTrendChartInstance = null; }

  const schema = categorySchemaCache[currentCenter] || [];
  if (schema.length === 0) return;
  const totalKey = schema[0].key;
  const catCols = schema.slice(1);
  const validRows = centerRows.filter(function(r) { return r.performance_data && r.performance_data[totalKey] !== undefined; });
  if (validRows.length === 0) return;
  const palette = getCategoryPalette();

  const pieCanvas = document.getElementById('categoryPieChart');
  if (pieCanvas) {
    const avgAll = {};
    catCols.forEach(function(c) { avgAll[c.key] = categoryDailyAvg(validRows, c.key); });

    // 값 기준 내림차순 정렬 후 상위 6개만 남기고 나머지는 "기타"로 통합
    const sortedCats = catCols.slice().sort(function(a, b) { return avgAll[b.key] - avgAll[a.key]; });
    const top6 = sortedCats.slice(0, 6);
    const rest = sortedCats.slice(6);
    const restSum = rest.reduce(function(s, c) { return s + avgAll[c.key]; }, 0);

    const labels = top6.map(function(c) { return c.key; });
    const values = top6.map(function(c) { return Math.round(avgAll[c.key] * 10) / 10; });
    if (rest.length > 0) {
      labels.push('기타(' + rest.length + '개 통합)');
      values.push(Math.round(restSum * 10) / 10);
    }

    // 조각 위에 "항목명 · 건수"를 직접 표시하는 커스텀 플러그인
    const pieLabelPlugin = {
      id: 'pieLabelPlugin',
      afterDatasetsDraw: function(chart) {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = '11px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        meta.data.forEach(function(arc, i) {
          const val = chart.data.datasets[0].data[i];
          if (!val) return;
          const pos = arc.tooltipPosition();
          ctx.fillStyle = '#f5f5f7';
          ctx.fillText(chart.data.labels[i], pos.x, pos.y - 6);
          ctx.fillText(val.toFixed(1) + '건', pos.x, pos.y + 8);
        });
        ctx.restore();
      }
    };

    categoryPieChartInstance = new Chart(pieCanvas, {
      type: 'pie',
      data: { labels: labels, datasets: [{ data: values, backgroundColor: palette }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, font: { size: 10 } } } }
      },
      plugins: [pieLabelPlugin]
    });
  }

  const trendCanvas = document.getElementById('categoryTrendChart');
  if (trendCanvas) {
    const sorted = validRows.slice().sort(function(a, b) { return b.report_date.localeCompare(a.report_date); });
    const recent30 = sorted.slice(0, 30).slice().reverse();
    const sumsRecent = {};
    catCols.forEach(function(c) { sumsRecent[c.key] = categoryMonthlySum(sorted.slice(0, 30), c.key); });
    const top3Keys = catCols.map(function(c) { return c.key; }).sort(function(a, b) { return sumsRecent[b] - sumsRecent[a]; }).slice(0, 3);

    const trendLabels = recent30.map(function(r) { return r.report_date; });
    const trendDatasets = top3Keys.map(function(key, i) {
      return {
        label: key,
        data: recent30.map(function(r) { return parseFloat(String((r.performance_data && r.performance_data[key]) || '0').replace(/,/g, '')) || 0; }),
        borderColor: palette[i % palette.length],
        backgroundColor: 'transparent',
        tension: 0.25,
        pointRadius: 2
      };
    });
    categoryTrendChartInstance = new Chart(trendCanvas, {
      type: 'line',
      data: { labels: trendLabels, datasets: trendDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, font: { size: 10 } } } },
        scales: { y: { beginAtZero: true, ticks: { font: { size: 9 } } }, x: { ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } } }
      }
    });
  }
}

function drawMiniCharts(records) {
  miniCharts.forEach(function(c) { if (c) c.destroy(); });
  miniCharts = [];

  let buckets;
  if (aggView === 'daily') {
    buckets = {};
    // KB손보정비 단월 일별 지표추이 그래프는 주말·공휴일 일자를 그래프에서만 제외한다(데이터 자체는 그대로 유지·저장됨).
    const dailyRecords = (currentCenter === 'kbjeongbi')
      ? records.filter(function(r) { return !isWeekendOrHoliday(r.report_date); })
      : records;
    dailyRecords.forEach(function(r) { buckets[r.report_date] = [r]; });
  } else {
    buckets = groupByBucket(records, aggView);
  }
  const bucketKeys = Object.keys(buckets);
  const labels = bucketKeys.map(formatChartLabel);

  const chartConfig = CENTER_CHART_CONFIG[currentCenter] || { groups: [] };
  const excludeBarLabel = (aggView === 'monthly' && chartConfig.excludeBarOnMonthly) ? chartConfig.excludeBarOnMonthly : null;

  function sumSeries(key) {
    return bucketKeys.map(function(bk) {
      const rows = buckets[bk];
      const nums = rows.map(function(r) { return resolveMetric(r, key); }).filter(function(n) { return n !== null && !isNaN(n); });
      return nums.length ? nums.reduce(function(a, b) { return a + b; }, 0) : null;
    });
  }
  function avgSeries(key) {
    // 일별(daily) 뷰는 버킷마다 그 날짜 1건뿐이라 "휴일/주말 제외 평균"을 적용하면
    // 주말·공휴일에 실제로 입력된 값까지 통째로 null 처리되어 그래프에서 사라지는 문제가 있었다
    // (예: 제헌절(7/17)처럼 KR_HOLIDAYS_2026에 등록된 날짜, 또는 LG전자AS처럼 주말에도 실제로 운영하는 센터).
    // 1건짜리 버킷은 그냥 그 값을 그대로 보여주고(값이 없으면 null), 여러 날을 묶는 주/월별 등 집계 뷰에서만
    // 기존처럼 근무일 기준 평균을 적용한다.
    if (aggView === 'daily') {
      return bucketKeys.map(function(bk) {
        const n = resolveMetric(buckets[bk][0], key);
        return (n !== null && !isNaN(n)) ? n : null;
      });
    }
    return bucketKeys.map(function(bk) { return avgExcludingHolidays(buckets[bk], function(r) { return resolveMetric(r, key); }); });
  }
  // 일별은 막대가 하루 실측치이므로 합계=평균과 동일하나, 주/요일/월별 집계 막대는 평균값으로 표기
  const countSeries = aggView === 'daily' ? sumSeries : avgSeries;
  const barColors = chartConfig.barColors || ['#8A8478', '#FFBC00', '#B7C4D6'];
  const lineColor = chartConfig.lineColor || '#545045';

  chartConfig.groups.forEach(function(group, i) {
    const canvas = document.getElementById('miniChart' + i);
    if (!canvas) return;

    const datasets = [];
    group.barKeys.forEach(function(key, bi) {
      const label = group.barLabels[bi];
      if (label === excludeBarLabel) return;
      datasets.push({ type: 'bar', label: label, data: countSeries(key), backgroundColor: barColors[(i + bi) % barColors.length], yAxisID: 'yCount', order: 3 });
    });

    group.lineKeys.forEach(function(key, li) {
      const label = group.lineLabels[li];
      const isThresholdLine = group.threshold && group.threshold.key === key;
      const data = avgSeries(key);

      if (!isThresholdLine) {
        datasets.push({
          type: 'line', label: label, data: data, borderColor: lineColor, backgroundColor: 'transparent',
          yAxisID: 'yRate', tension: 0.25, pointRadius: 2, order: 1, spanGaps: true
        });
        return;
      }

      const thVal = group.threshold.value;
      datasets.push({
        type: 'line', label: label, data: data, borderColor: lineColor, backgroundColor: 'transparent',
        yAxisID: 'yRate', tension: 0.25, pointRadius: 3, order: 0, borderWidth: 2, spanGaps: true,
        segment: {
          borderColor: function(ctx) {
            const y0 = ctx.p0.parsed.y, y1 = ctx.p1.parsed.y;
            return (y0 < thVal || y1 < thVal) ? '#FF6B70' : lineColor;
          }
        },
        pointBackgroundColor: function(ctx) {
          const v = ctx.raw;
          return (v !== null && v < thVal) ? '#FF6B70' : lineColor;
        }
      });
      datasets.push({
        type: 'line', label: group.threshold.label, data: labels.map(function() { return thVal; }), borderColor: '#FF6B70',
        borderDash: [4, 4], borderWidth: 1, pointRadius: 0, yAxisID: 'yRate', order: 2
      });
    });

    miniCharts[i] = new Chart(canvas, {
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 8, font: { size: 10 } } },
          tooltip: group.stacked ? {
            callbacks: {
              footer: function(tooltipItems) {
                const sum = tooltipItems.filter(function(ti) { return ti.dataset.type === 'bar'; })
                  .reduce(function(s, ti) { return s + (ti.parsed.y || 0); }, 0);
                return '총합계: ' + sum.toLocaleString() + '건';
              }
            }
          } : {}
        },
        scales: {
          yCount: { position: 'left', beginAtZero: true, max: group.barMax || undefined, stacked: !!group.stacked, ticks: { font: { size: 9 } } },
          yRate: { position: 'right', min: 0, max: 110, grid: { drawOnChartArea: false }, ticks: { font: { size: 9 } } },
          x: { stacked: !!group.stacked, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } }
        }
      }
    });
  });
}

function renderColToggleButton(records) {
  const attKeys = collectKeys(records, 'attendance_data');
  const perfKeys = collectKeys(records, 'performance_data');
  const allKeys = attKeys.concat(perfKeys);
  ensureColOrder(allKeys);

  // 실제 컬럼 순서(colPrefs.order)는 그대로 두고, 팝오버 표시용으로만
  // 체크된 항목(표시중)을 상단 그룹, 해제된 항목(숨김)을 하단 그룹으로 재배치
  const visibleOrder = colPrefs.order.filter(function(k) { return !colPrefs.hidden.includes(k); });
  const hiddenOrder = colPrefs.order.filter(function(k) { return colPrefs.hidden.includes(k); });
  const displayOrder = visibleOrder.concat(hiddenOrder);

  const itemsHtml = displayOrder.map(function(k, displayIdx) {
    const idx = colPrefs.order.indexOf(k); // ▲▼는 실제 순서 기준으로 동작
    const grp = attKeys.includes(k) ? '근태' : '실적';
    const checked = !colPrefs.hidden.includes(k);
    const dividerBefore = displayIdx === visibleOrder.length && hiddenOrder.length > 0
      ? '<div style="font-size:10px;color:#FF6B70;margin:6px 0 2px;border-top:1px dashed #2c2c2e;padding-top:6px;">숨김 항목</div>' : '';
    return dividerBefore + '<div class="col-item">'
      + '<button class="mv" onclick="moveCol(\'' + k + '\',-1)" ' + (idx === 0 ? 'disabled' : '') + '>▲</button>'
      + '<button class="mv" onclick="moveCol(\'' + k + '\',1)" ' + (idx === colPrefs.order.length - 1 ? 'disabled' : '') + '>▼</button>'
      + '<label><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="toggleColVisible(\'' + k + '\')"> ' + grp + '·' + k + '</label>'
      + '</div>';
  }).join('');

  const presets = loadPresets();
  const pinnedName = getPinnedPresetName();
  const presetListHtml = presets.length === 0
    ? '<div style="font-size:11px;color:#86868b;">저장된 설정이 없습니다.</div>'
    : presets.map(function(p) {
        const isPinned = p.name === pinnedName;
        return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
          + '<label style="display:flex;align-items:center;gap:3px;font-size:10px;color:#86868b;cursor:pointer;" title="이 설정을 항상 기본값으로 고정">'
          + '<input type="checkbox" ' + (isPinned ? 'checked' : '') + ' onchange="togglePinPreset(\'' + p.name + '\', this.checked)"> 고정'
          + '</label>'
          + '<button style="flex:1;text-align:left;font-size:11px;padding:5px 8px;border:1px solid ' + (isPinned ? '#FE2E36' : '#2c2c2e') + ';background:#1d1d1f;border-radius:5px;cursor:pointer;" onclick="applyPreset(\'' + p.name + '\')">' + p.name + (isPinned ? ' 📌' : '') + '</button>'
          + '<button style="border:none;background:none;color:#FF6B70;font-size:11px;cursor:pointer;" onclick="deletePreset(\'' + p.name + '\')">삭제</button>'
          + '</div>';
      }).join('');

  return '<div class="col-toggle-wrap">'
    + '<button class="col-toggle-btn" type="button">표시 항목 ▾</button>'
    + '<div class="col-popover' + (colPopoverOpen ? ' open' : '') + '" id="colPopover">'
    + '<div style="padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid #2c2c2e;">'
    + '<div style="font-size:11px;color:#86868b;margin-bottom:6px;font-weight:600;">저장된 설정</div>'
    + presetListHtml
    + '<div style="display:flex;gap:4px;margin-top:8px;">'
    + '<input type="text" id="presetNameInput" placeholder="설정 이름" style="flex:1;font-size:12px;padding:5px 7px;border:1px solid #2c2c2e;border-radius:5px;">'
    + '<button style="font-size:11px;padding:5px 10px;border:1px solid #FE2E36;background:#FE2E36;color:#FFFFFF;border-radius:5px;cursor:pointer;" onclick="saveCurrentAsPreset()">현재설정 저장</button>'
    + '</div>'
    + '</div>'
    + '<div style="font-size:10px;color:#86868b;margin-bottom:8px;">"고정"에 체크하면 접속·탭 이동과 무관하게 항상 이 설정이 기본으로 적용됩니다. (일별·주별·요일별·월별·분기별·반기별 표 공통 적용)</div>'
    + '<div style="font-size:11px;color:#86868b;margin-bottom:6px;">체크 해제 시 표에서 숨겨집니다. ▲▼로 순서 변경 (주별·요일별·월별에도 동일 적용)</div>'
    + itemsHtml
    + '<div class="actions"><button onclick="setAllColsVisible(true)">전체 표시</button><button onclick="setAllColsVisible(false)">전체 숨김</button></div>'
    + '</div></div>';
}

function renderHiddenChips() {
  if (colPrefs.hidden.length === 0) return '';
  const chips = colPrefs.hidden.map(function(k) {
    return '<span class="hidden-chip" onclick="toggleColVisible(\'' + k + '\')">' + k + ' 다시보기</span>';
  }).join('');
  return '<div style="font-size:11px;color:#86868b;margin-top:12px;">숨겨진 항목 (클릭하면 다시 표시):</div><div class="hidden-chips">' + chips + '</div>';
}

function renderAggTable(records, view) {
  if (view === 'daily') return buildMatrix(records);

  const buckets = groupByBucket(records, view);
  const attKeysAll = collectKeys(records, 'attendance_data');
  const perfKeysAll = collectKeys(records, 'performance_data');
  const visible = ensureColOrder(attKeysAll.concat(perfKeysAll));
  const allKeys = visible;
  const attKeys = visible.filter(function(k) { return attKeysAll.includes(k); });

  const headTop = allKeys.map(function(k) {
    const isRate = /응답율|CPD|S\.?L/i.test(k);
    return '<th colspan="' + (isRate ? 1 : 2) + '" style="text-align:center;">' + k + '</th>';
  }).join('');
  const headSub = allKeys.map(function(k) {
    const isRate = /응답율|CPD|S\.?L/i.test(k);
    return isRate ? '<th>평균</th>' : '<th>합계</th><th>평균</th>';
  }).join('');

  const bodyHtml = Object.keys(buckets).map(function(label) {
    const rows = buckets[label];
    const cells = allKeys.map(function(k) {
      const isRate = /응답율|CPD|S\.?L/i.test(k);
      const isDuration = DURATION_TABLE_KEYS.includes(k);
      const field = attKeys.includes(k) ? 'attendance_data' : 'performance_data';
      const nums = rows.map(function(r) { return extractNum(r, field, k); }).filter(function(n) { return n !== null && !isNaN(n); });
      const avg = avgExcludingHolidays(rows, function(r) { return extractNum(r, field, k); });
      if (isRate) return '<td>' + (avg !== null ? avg.toFixed(1) + '%' : '-') + '</td>';
      const sumNum = nums.length ? nums.reduce(function(a, b) { return a + b; }, 0) : null;
      const sum = sumNum === null ? '-' : (isDuration ? formatSecondsHMS(sumNum) : sumNum.toLocaleString());
      const avgDisp = avg === null ? '-' : (isDuration ? formatSecondsHMS(avg) : Math.round(avg).toLocaleString());
      return '<td>' + sum + '</td><td>' + avgDisp + '</td>';
    }).join('');
    return '<tr><td style="position:sticky;left:0;background:#1d1d1f;font-weight:600;">' + label + '</td><td>' + rows.length + '</td>' + cells + '</tr>';
  }).join('');

  return '<div class="table-scroll"><table>'
    + '<thead><tr><th style="position:sticky;left:0;background:#111113;">' + aggLabel(view) + '</th><th>일수</th>' + headTop + '</tr>'
    + '<tr><th style="position:sticky;left:0;background:#111113;"></th><th></th>' + headSub + '</tr></thead>'
    + '<tbody>' + bodyHtml + '</tbody></table></div>';
}

function groupByBucket(records, view) {
  const buckets = {};
  const dowNames = ['일', '월', '화', '수', '목', '금', '토'];
  records.forEach(function(r) {
    const d = new Date(r.report_date + 'T00:00:00');
    let label;
    if (view === 'weekly') { const week = Math.ceil(d.getDate() / 7); label = (d.getMonth() + 1) + '월 ' + week + '주'; }
    else if (view === 'dow') { label = dowNames[d.getDay()] + '요일'; }
    else if (view === 'monthly') { label = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
    else if (view === 'quarter') { const q = Math.ceil((d.getMonth() + 1) / 3); label = d.getFullYear() + ' ' + q + '분기'; }
    else if (view === 'half') { const h = (d.getMonth() + 1) <= 6 ? '상반기' : '하반기'; label = d.getFullYear() + ' ' + h; }
    if (!buckets[label]) buckets[label] = [];
    buckets[label].push(r);
  });
  if (view === 'dow') {
    const ordered = {};
    dowNames.forEach(function(n) { const key = n + '요일'; if (buckets[key]) ordered[key] = buckets[key]; });
    return ordered;
  }
  return buckets;
}

const ZERO_WARN_KEYS = ['총원', '제휴CS_소계', '장기사고_소계', '장기손사_SL', '제휴상담_SL', '장기손사_CPD', '제휴상담_CPD', '장기손사_인입호', '제휴상담_인입호'];

const DURATION_TABLE_KEYS = ['통화시간_INOUT_초'];

function zeroWarnCell(value, key) {
  const n = parseFloat(String(value === undefined || value === null ? '' : value).replace(/[%,]/g, ''));
  const isZero = ZERO_WARN_KEYS.includes(key) && n === 0;
  const style = isZero ? ' style="background:rgba(255,107,112,.14);color:#FF6B70;font-weight:700;" title="주의: 값이 0입니다"' : '';
  const isDuration = DURATION_TABLE_KEYS.includes(key) && !isNaN(n) && value !== undefined && value !== null && value !== '';
  const display = isDuration ? formatSecondsHMS(n) : fmt(value);
  return '<td' + style + '>' + display + (isZero ? ' ⚠' : '') + '</td>';
}

function buildMatrix(records) {
  const attKeysAll = collectKeys(records, 'attendance_data');
  const perfKeysAll = collectKeys(records, 'performance_data');
  const visible = ensureColOrder(attKeysAll.concat(perfKeysAll));
  const attKeys = visible.filter(function(k) { return attKeysAll.includes(k); });
  const perfKeys = visible.filter(function(k) { return perfKeysAll.includes(k); });

  const headHtml = '<th style="position:sticky;left:0;background:#111113;">날짜</th>'
    + attKeys.map(function(k) { return '<th>' + k + '</th>'; }).join('')
    + perfKeys.map(function(k) { return '<th>' + k + '</th>'; }).join('');

  const bodyHtml = records.slice().reverse().map(function(r) {
    return '<tr><td style="position:sticky;left:0;background:#1d1d1f;font-weight:600;">' + r.report_date + (isWeekendOrHoliday(r.report_date) ? ' 🔸' : '') + '</td>'
      + attKeys.map(function(k) {
          const live = (currentCenter === 'lge_total' && LGE_TOTAL_LIVE_SUM_KEYS[k]) ? lgeTotalLiveAttSum(r, k) : undefined;
          const val = live !== undefined ? live : (r.attendance_data ? r.attendance_data[k] : undefined);
          return zeroWarnCell(val, k);
        }).join('')
      + perfKeys.map(function(k) { return zeroWarnCell(r.performance_data ? r.performance_data[k] : undefined, k); }).join('')
      + '</tr>';
  }).join('');

  return '<div class="table-scroll"><table><thead><tr>' + headHtml + '</tr></thead><tbody>' + bodyHtml + '</tbody></table></div>';
}

// 데이터 표에서 항상 숨길 항목: 월평균 수동입력값(_월평균 접미사, 일별 원자료가 아니라 별도 요약값)과
// 자동계산으로 인해 다른 항목과 값이 항상 동일한 중복 항목(근태·AS재직인원_합계=근태·총재직인원_AS, 근태·성수기재직인원_합계=근태·총재직인원_성수기)
const HIDDEN_DUPLICATE_ATT_KEYS = ['AS재직인원_합계', '성수기재직인원_합계'];
function filterVisibleTableKeys(keysAll, field) {
  return keysAll.filter(function(k) {
    if (field === 'performance_data' && /_월평균$/.test(k)) return false;
    if (field === 'attendance_data' && HIDDEN_DUPLICATE_ATT_KEYS.includes(k)) return false;
    return true;
  });
}

function collectKeys(records, field) {
  const keys = new Set();
  records.forEach(function(r) { const obj = r[field]; if (obj && typeof obj === 'object') Object.keys(obj).forEach(function(k) { keys.add(k); }); });
  return filterVisibleTableKeys(Array.from(keys), field);
}
function fmt(v) { return (v === undefined || v === null || v === '') ? '-' : v; }
function statusLabel(s) { return { success: '완료', pending: '분석중', needs_review: '확인필요' }[s] || s; }

// ============================================
// 이슈 및 히스토리 탭
// ============================================
let editingIssueId = null;
let allIssuesCache = [];

async function renderIssues() {
  const main = document.getElementById('main');
  if (!currentCenter) { main.innerHTML = '<div class="empty">센터를 선택해 주세요.</div>'; return; }
  const token = centerTokenMap[currentCenter];
  if (!token) { main.innerHTML = '<div class="empty">이 센터는 아직 토큰이 등록되지 않았습니다.</div>'; return; }

  editingIssueId = null;
  const centerInfo = allCenters.find(function(c) { return c.center_code === currentCenter; });
  const today = localDateStr(new Date());

  main.innerHTML = '<div class="panel" style="max-width:720px;margin-bottom:16px;" id="issueFormPanel">'
    + '<h3 id="issueFormTitle">' + (centerInfo ? centerInfo.center_name : '') + ' · 이슈 등록</h3>'
    + '<div class="entry-row"><label>날짜</label><input type="date" id="issueDate" value="' + today + '"></div>'
    + '<div class="entry-row" style="align-items:flex-start;"><label style="padding-top:8px;">제목</label>'
    + '<input type="text" id="issueTitle" placeholder="예: 6/15 SL 급락, 신입 5명 입사 등" style="flex:1;padding:8px 10px;border:1px solid #2c2c2e;border-radius:6px;font-size:13px;"></div>'
    + '<textarea id="issueContent" class="paste-box" style="font-family:inherit;min-height:80px;" placeholder="상세 내용(선택)"></textarea>'
    + '<button class="btn-primary" id="issueSubmitBtn" onclick="submitIssue()">등록</button>'
    + '<button class="btn-ghost" id="issueCancelBtn" style="display:none;" onclick="cancelEditIssue()">취소</button>'
    + '<div class="status-msg" id="issueStatus"></div>'
    + '</div>'
    + '<div class="panel">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap;">'
    + '<h3 style="margin:0;">히스토리 (최신순)</h3>'
    + '<div style="display:flex;gap:8px;align-items:center;">'
    + '<button class="btn-secondary" id="issueAiSummaryBtn" style="padding:6px 12px;font-size:12px;" onclick="summarizeIssuesWithAI()">🤖 AI 요약</button>'
    + '<input type="text" id="issueSearch" placeholder="제목·내용 검색" oninput="filterIssueList()" style="padding:7px 10px;border:1px solid #2c2c2e;border-radius:6px;font-size:13px;width:220px;">'
    + '</div>'
    + '</div>'
    + '<div id="issueAiSummary"></div>'
    + '<div id="issueList"><div class="loading">불러오는 중...</div></div></div>';

  await loadIssueList();
}

// 이슈/히스토리 목록을 AI로 요약 (반복 패턴·미해결 추정 건·특이사항). 서강MOT API 우선 호출, 실패 시 Claude API로 자동 전환(백엔드 처리).
// AI(서강MOT API) 호출이 실패했을 때 - 이제 다른 Provider로 자동 전환하지 않으므로,
// 사용자가 헷갈리지 않도록 "AI는 잠시 안 되고, 기존 방식(직접 입력/붙여넣기)은 그대로 된다"를 명확히 안내한다.
function renderAiUnavailableNotice(rawError, manualHint) {
  const isCredit = /AI_UNAVAILABLE|크레딧|credit|quota|429|402|403/i.test(rawError || '');
  return '<div class="panel" style="background:rgba(245,166,35,.10);border:1px solid rgba(245,166,35,.5);margin-bottom:14px;padding:14px 16px;">'
    + '<div style="font-size:13px;font-weight:700;color:#f5a623;margin-bottom:4px;">⚠️ AI 기능을 지금 사용할 수 없습니다' + (isCredit ? ' (크레딧 소진 등)' : '') + '</div>'
    + '<div style="font-size:13px;line-height:1.6;color:#f5f5f7;">' + manualHint + '</div>'
    + '<div style="font-size:11px;color:#86868b;margin-top:6px;">(상세 오류: ' + escapeHtml(rawError || '') + ')</div>'
    + '</div>';
}

async function summarizeIssuesWithAI() {
  const box = document.getElementById('issueAiSummary');
  const btn = document.getElementById('issueAiSummaryBtn');
  if (!allIssuesCache || allIssuesCache.length === 0) {
    box.innerHTML = '<p style="font-size:13px;color:#86868b;margin-bottom:10px;">요약할 이슈가 없습니다.</p>';
    return;
  }
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = '요약 중...';
  box.innerHTML = '<div class="loading">AI가 이슈 히스토리를 읽고 있습니다...</div>';
  try {
    const issuesPayload = allIssuesCache.slice(0, 50).map(function(i) { return { date: i.issue_date, title: i.title, content: i.content || '' }; });
    const res = await fetch(SB_FUNCTION_URL + '?action=ai-summarize-issues', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, token: centerTokenMap[currentCenter], issues: issuesPayload })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'AI 요약 실패');
    box.innerHTML = '<div class="panel" style="background:rgba(0,165,255,.08);border:1px solid rgba(0,165,255,.3);margin-bottom:14px;padding:14px 16px;">'
      + '<div style="font-size:12px;color:#5ac8fa;font-weight:700;margin-bottom:6px;">🤖 AI 요약 (최근 ' + issuesPayload.length + '건 기준)</div>'
      + '<div style="font-size:13px;line-height:1.6;white-space:pre-wrap;">' + escapeHtml(data.summary) + '</div>'
      + '</div>';
  } catch (e) {
    box.innerHTML = renderAiUnavailableNotice(e.message, '이슈 목록은 아래에서 그대로 확인하실 수 있고, 등록·수정·삭제도 평소처럼 하실 수 있습니다. 요약만 잠시 제공되지 않는 상태입니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

async function loadIssueList() {
  const token = centerTokenMap[currentCenter];
  const listEl = document.getElementById('issueList');
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=issues-list&token=' + encodeURIComponent(token), {
      headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }
    });
    const data = await res.json();
    if (!data.success) { listEl.innerHTML = '<div class="empty">불러오기 실패: ' + data.error + '</div>'; return; }
    allIssuesCache = data.issues || [];
    filterIssueList();
  } catch (e) {
    listEl.innerHTML = '<div class="empty">불러오기 오류: ' + e.message + '</div>';
  }
}

function filterIssueList() {
  const searchEl = document.getElementById('issueSearch');
  const keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const filtered = !keyword ? allIssuesCache : allIssuesCache.filter(function(item) {
    const inTitle = (item.title || '').toLowerCase().includes(keyword);
    const inContent = (item.content || '').toLowerCase().includes(keyword);
    return inTitle || inContent;
  });
  renderIssueList(filtered, keyword);
}

function renderIssueList(issues, keyword) {
  const listEl = document.getElementById('issueList');
  if (allIssuesCache.length === 0) { listEl.innerHTML = '<div class="empty">등록된 이슈/히스토리가 없습니다.</div>'; return; }
  if (issues.length === 0) { listEl.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>'; return; }

  listEl.innerHTML = '<div style="font-size:12px;color:#86868b;margin-bottom:6px;">' + issues.length + '건' + (keyword ? ' (검색: "' + keyword + '")' : '') + '</div>'
    + issues.map(function(item) {
    // 목록에는 제목·날짜만 보이고, 클릭(펼치기)하면 상세 내용이 나타난다.
    return '<details class="issue-item" style="padding:0 4px;border-top:1px solid #2c2c2e;">'
      + '<summary style="padding:12px 0;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:baseline;gap:10px;">'
      + '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="font-weight:700;font-size:13px;">' + item.title + '</span>'
      + '<span style="color:#86868b;font-size:12px;margin-left:8px;">' + item.issue_date + '</span></span>'
      + '<span style="display:flex;gap:10px;flex-shrink:0;" onclick="event.preventDefault();event.stopPropagation();">'
      + '<button style="border:none;background:none;color:#a1a1a6;font-size:12px;cursor:pointer;" onclick="startEditIssue(\'' + item.id + '\')">수정</button>'
      + '<button style="border:none;background:none;color:#FF6B70;font-size:12px;cursor:pointer;" onclick="deleteIssue(\'' + item.id + '\')">삭제</button>'
      + '</span>'
      + '</summary>'
      + '<div style="font-size:13px;color:#f5f5f7;margin:0 0 12px;white-space:pre-wrap;">' + (item.content || '<span style="color:#86868b;">상세 내용 없음</span>') + '</div>'
      + '</details>';
  }).join('');
}

function startEditIssue(id) {
  const item = allIssuesCache.find(function(i) { return i.id === id; });
  if (!item) return;
  editingIssueId = id;
  document.getElementById('issueDate').value = item.issue_date;
  document.getElementById('issueTitle').value = item.title;
  document.getElementById('issueContent').value = item.content || '';
  document.getElementById('issueFormTitle').textContent = '이슈 수정';
  document.getElementById('issueSubmitBtn').textContent = '수정 저장';
  document.getElementById('issueCancelBtn').style.display = 'inline-block';
  document.getElementById('issueFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEditIssue() {
  editingIssueId = null;
  document.getElementById('issueDate').value = localDateStr(new Date());
  document.getElementById('issueTitle').value = '';
  document.getElementById('issueContent').value = '';
  document.getElementById('issueFormTitle').textContent = (allCenters.find(function(c) { return c.center_code === currentCenter; }) || {}).center_name + ' · 이슈 등록';
  document.getElementById('issueSubmitBtn').textContent = '등록';
  document.getElementById('issueCancelBtn').style.display = 'none';
  document.getElementById('issueStatus').textContent = '';
}

async function submitIssue() {
  const token = centerTokenMap[currentCenter];
  const issueDate = document.getElementById('issueDate').value;
  const title = document.getElementById('issueTitle').value.trim();
  const content = document.getElementById('issueContent').value.trim();
  const statusEl = document.getElementById('issueStatus');

  if (!title) { statusEl.className = 'status-msg err'; statusEl.textContent = '제목을 입력해 주세요.'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = editingIssueId ? '수정 중...' : '등록 중...';
  try {
    const action = editingIssueId ? 'issues-update' : 'issues-create';
    const payload = editingIssueId
      ? { token: token, id: editingIssueId, issue_date: issueDate, title: title, content: content }
      : { token: token, issue_date: issueDate, title: title, content: content };

    const res = await fetch(SB_FUNCTION_URL + '?action=' + action, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || (editingIssueId ? '수정 실패' : '등록 실패'));

    statusEl.className = 'status-msg ok';
    statusEl.textContent = editingIssueId ? '수정되었습니다.' : '등록되었습니다.';
    cancelEditIssue();
    await loadIssueList();
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = (editingIssueId ? '수정 실패: ' : '등록 실패: ') + e.message;
  }
}

async function deleteIssue(id) {
  if (!confirm('이 이슈를 삭제하시겠습니까?')) return;
  const token = centerTokenMap[currentCenter];
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=issues-delete', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, id: id })
    });
    const data = await res.json();
    if (!data.success) { alert('삭제 실패: ' + data.error); return; }
    if (editingIssueId === id) cancelEditIssue();
    await loadIssueList();
  } catch (e) { alert('삭제 오류: ' + e.message); }
}


const KBSONHAE_GUIDE_IMAGE = 'data:image/png;base64,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';

const KBSONHAE_SAMPLE_ROW = ['171.5','33','91.5','29.5','89.4%','84.0','91.8%','4','11','','13','2','11','26','6','6','1,801','1,786','26','456','5','99.4%','79.2','88.0','8,467','8,408','425','31','99.7%','103.5','92.7'];
const PYEONGTAEK_GUIDE_IMAGE = 'data:image/png;base64,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';
const PYEONGTAEK_SAMPLE_ROW = ['1,476','1,470','99.6','6','19','77.4'];
const PYEONGTAEK_CATEGORY_SAMPLE_ROW = ['1,493','99','235','261','240','184','45','75','80','16','11','219','28'];
const PYEONGTAEK_COMBINED_GUIDE_IMAGE = 'data:image/png;base64,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';

const KBJEONGBI_GUIDE_IMAGE = 'data:image/png;base64,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';
const KBJEONGBI_SAMPLE_ROW = ['62','76','1','1','140','62','76','0','0','138','62','76','226','62','76','226'];
const LGE_GUIDE_IMAGE = 'data:image/png;base64,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';
const LGE_SAMPLE_ROW = ['100.0','72.9','52.6','2:58:38'];

// 센터별 사용설명(가이드 이미지 + 예시행) 매핑 - 새 센터 추가 시 여기에 등록
const CENTER_GUIDES = {
  'kbsonhae': { image: KBSONHAE_GUIDE_IMAGE, sample: KBSONHAE_SAMPLE_ROW, date: '6/29' },
  'pyeongtaek': { image: PYEONGTAEK_COMBINED_GUIDE_IMAGE, sample: PYEONGTAEK_SAMPLE_ROW, categorySample: PYEONGTAEK_CATEGORY_SAMPLE_ROW, date: '7/2' },
  'kbjeongbi': { image: KBJEONGBI_GUIDE_IMAGE, sample: KBJEONGBI_SAMPLE_ROW, date: '5/4' },
  'lge': { image: LGE_GUIDE_IMAGE, sample: LGE_SAMPLE_ROW, date: '6/30' },
  'lge_seongsu': { image: LGE_GUIDE_IMAGE, sample: LGE_SAMPLE_ROW, date: '6/30' }
};

function buildGuideTable(schema, sample) {
  return schema.map(function(col, i) {
    const val = sample[i] !== undefined ? sample[i] : '-';
    return '<tr><td style="padding:5px 8px;color:#86868b;">' + (i + 1) + '</td>'
      + '<td style="padding:5px 8px;">' + col.key + '</td>'
      + '<td style="padding:5px 8px;font-family:monospace;">' + (val === '' ? '(공란)' : val) + '</td></tr>';
  }).join('');
}

// 사용설명 이미지가 작아서 안 보이는 문제 - 클릭하면 원본 크기로 팝업해서 보여준다
function openImageLightbox(src) {
  let overlay = document.getElementById('imgLightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'imgLightbox';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(20,20,25,.85);z-index:9999;cursor:zoom-out;align-items:center;justify-content:center;padding:30px;';
    overlay.onclick = function() { overlay.style.display = 'none'; };
    const img = document.createElement('img');
    img.id = 'imgLightboxImg';
    img.style.cssText = 'max-width:95vw;max-height:92vh;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.4);cursor:zoom-out;';
    overlay.appendChild(img);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') overlay.style.display = 'none'; });
  }
  document.getElementById('imgLightboxImg').src = src;
  overlay.style.display = 'flex';
}

// ============================================
// 업로드 자료함: 데이터입력 시 첨부한 원본 파일을 누적 보관 · 센터별 조회/검색/재다운로드
// ============================================
let archiveFiles = [];
let archiveCenterFilter = '';
let archiveSearchQuery = '';

// 파일을 base64로 인코딩해 서버에 저장 요청 (실패해도 메인 추출 흐름을 막지 않도록 조용히 처리)
async function uploadFileToArchive(file, fileType) {
  try {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    await fetch(SB_FUNCTION_URL + '?action=archive-upload-file', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: centerTokenMap[currentCenter], file_name: file.name, file_type: fileType, file_base64: base64 })
    });
  } catch (e) { /* 자료함 저장 실패는 데이터입력 자체를 막지 않는다 - 조용히 무시 */ }
}

async function loadUploadArchive() {
  try {
    const params = new URLSearchParams({ workspace_password: workspacePasswordCache, _ts: Date.now() });
    if (archiveCenterFilter) params.set('center_code', archiveCenterFilter);
    if (archiveSearchQuery) params.set('search', archiveSearchQuery);
    const res = await fetch(SB_FUNCTION_URL + '?action=archive-list-files&' + params.toString(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
    const data = await res.json();
    archiveFiles = data.success ? (data.files || []) : [];
  } catch (e) { archiveFiles = []; }
}

// ============================================
// 알림 설정 페이지: 담당자 연락처 관리 + 주의/경고 메일 템플릿·발송조건 관리
// ============================================
let notificationSettingsCache = null;
let allContactsCache = [];
let notifSelectedCenter = '';

async function loadNotificationData() {
  try {
    const [settingsRes, contactsRes] = await Promise.all([
      fetch(SB_FUNCTION_URL + '?action=get-notification-settings&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' }),
      fetch(SB_FUNCTION_URL + '?action=list-contacts&workspace_password=' + encodeURIComponent(workspacePasswordCache) + '&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' })
    ]);
    const settingsData = await settingsRes.json();
    const contactsData = await contactsRes.json();
    notificationSettingsCache = settingsData.success ? settingsData.settings : null;
    allContactsCache = contactsData.success ? (contactsData.contacts || []) : [];
  } catch (e) { /* 실패 시 빈 상태로 진행 */ }
}

function renderNotificationSettings() {
  const main = document.getElementById('main');
  const s = notificationSettingsCache || {};
  if (!notifSelectedCenter && allCentersMeta.length) notifSelectedCenter = allCentersMeta[0].center_code;

  const centerOptions = allCentersMeta.map(function(c) {
    return '<option value="' + c.center_code + '"' + (notifSelectedCenter === c.center_code ? ' selected' : '') + '>' + c.center_name + '</option>';
  }).join('');
  const notifSelectedCenterMeta = allCentersMeta.find(function(c) { return c.center_code === notifSelectedCenter; });
  const notifSelectedCenterName = notifSelectedCenterMeta ? notifSelectedCenterMeta.center_name : notifSelectedCenter;

  const centerContacts = allContactsCache.filter(function(c) { return c.center_code === notifSelectedCenter; });
  const contactsRowsHtml = centerContacts.map(function(c) {
    return '<tr>'
      + '<td>' + (c.name || '-') + '</td>'
      + '<td>' + c.email + '</td>'
      + '<td><input type="checkbox" ' + (c.is_active ? 'checked' : '') + ' onchange="toggleContactActive(\'' + c.id + '\', this.checked)"></td>'
      + '<td><button style="border:none;background:none;color:#FF6B70;font-size:12px;cursor:pointer;" onclick="deleteContact(\'' + c.id + '\')">삭제</button></td>'
      + '</tr>';
  }).join('');

  main.innerHTML = '<div style="--dash-accent:#FE2E36;--dash-accent-dark:#3a1518;">'
    + '<h2 style="margin:0 0 16px;font-size:20px;">🔔 알림 설정</h2>'

    + '<div class="panel" style="margin-bottom:16px;">'
    + '<h3 style="margin-bottom:6px;">센터별 담당자 관리</h3>'
    + '<p style="font-size:12px;color:#86868b;margin:0 0 10px;">센터당 여러 명 등록 가능하며, 체크 해제 시 발송 대상에서만 제외되고 기록은 남습니다.</p>'
    + '<div class="entry-row"><label>센터</label><select id="notifCenterSelect" onchange="changeNotifCenter(this.value)">' + centerOptions + '</select></div>'
    + '<table style="width:100%;font-size:13px;margin-top:8px;"><thead><tr><th style="text-align:left;padding:6px;">이름</th><th style="text-align:left;padding:6px;">이메일</th><th style="padding:6px;">발송대상</th><th></th></tr></thead>'
    + '<tbody>' + (contactsRowsHtml || '<tr><td colspan="4" style="color:#86868b;padding:10px;">등록된 담당자가 없습니다.</td></tr>') + '</tbody></table>'
    + '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">'
    + '<input type="text" id="newContactName" placeholder="이름(선택)" style="width:120px;padding:7px 10px;border:1px solid #2c2c2e;border-radius:6px;">'
    + '<input type="email" id="newContactEmail" placeholder="이메일" style="flex:1;min-width:180px;padding:7px 10px;border:1px solid #2c2c2e;border-radius:6px;">'
    + '<button class="btn-primary" onclick="addContact()">담당자 추가</button>'
    + '</div>'
    + '<div class="status-msg" id="contactStatus"></div>'
    + '</div>'

    + '<div class="panel">'
    + '<h3 style="margin-bottom:6px;">발송 조건 및 메일 문구</h3>'
    + '<p style="font-size:12px;color:#86868b;margin:0 0 10px;">제목/본문에 {center_name}, {days}, {site_link}를 넣으면 발송 시 자동으로 치환됩니다. 저장한 내용은 매시 정각 자동 점검에서 계속 재사용됩니다.</p>'

    + '<div class="entry-row"><label>전체 발송 정지</label><input type="checkbox" id="notifPaused" ' + (s.is_paused ? 'checked' : '') + '> <span style="font-size:12px;color:#86868b;">체크하면 모든 알림 발송이 즉시 중단됩니다</span></div>'
    + '<div class="entry-row"><label>발송 시각</label><input type="time" id="notifSendTime" value="' + (s.send_time || '09:00') + '"><span style="font-size:12px;color:#86868b;">매시 정각 점검 중 이 시각에만 실제 발송</span></div>'
    + '<div class="entry-row"><label>반복 발송</label><input type="checkbox" id="notifRepeat" ' + (s.repeat_enabled !== false ? 'checked' : '') + '> <span style="font-size:12px;color:#86868b;">해결 전까지 계속 재발송</span></div>'
    + '<div class="entry-row"><label>반복 주기(일)</label><input type="number" id="notifRepeatInterval" value="' + (s.repeat_interval_days || 1) + '" style="width:70px;"></div>'

    + '<h4 style="margin:18px 0 6px;font-size:13px;color:#f5a623;">🟠 주의 메일 (미업로드 ' + (s.warn_send_on_day || 4) + '일째 발송)</h4>'
    + '<div class="entry-row"><label>발송 시점(며칠째)</label><input type="number" id="notifWarnDay" value="' + (s.warn_send_on_day || 4) + '" style="width:70px;"></div>'
    + '<div class="entry-row" style="align-items:flex-start;"><label>제목</label><input type="text" id="notifWarnSubject" value="' + (s.warn_subject || '').replace(/"/g, '&quot;') + '" style="flex:1;"></div>'
    + '<textarea id="notifWarnBody" rows="4" style="width:100%;padding:8px;border:1px solid #2c2c2e;border-radius:6px;font-size:13px;">' + (s.warn_body || '') + '</textarea>'

    + '<h4 style="margin:18px 0 6px;font-size:13px;color:#FF6B70;">🔴 경고 메일 (미업로드 ' + (s.danger_send_on_day || 8) + '일째 발송)</h4>'
    + '<div class="entry-row"><label>발송 시점(며칠째)</label><input type="number" id="notifDangerDay" value="' + (s.danger_send_on_day || 8) + '" style="width:70px;"></div>'
    + '<div class="entry-row" style="align-items:flex-start;"><label>제목</label><input type="text" id="notifDangerSubject" value="' + (s.danger_subject || '').replace(/"/g, '&quot;') + '" style="flex:1;"></div>'
    + '<textarea id="notifDangerBody" rows="4" style="width:100%;padding:8px;border:1px solid #2c2c2e;border-radius:6px;font-size:13px;">' + (s.danger_body || '') + '</textarea>'

    + '<button class="btn-primary" style="margin-top:14px;" onclick="saveNotificationSettings()">설정 저장</button>'
    + '<button class="btn-secondary" style="margin-top:14px;margin-left:8px;color:#f5a623;border-color:#f5a623;" onclick="sendNotificationNow(false)">⚡ 이 센터만 즉시발송</button>'
    + '<button class="btn-secondary" style="margin-top:14px;margin-left:8px;color:#FF6B70;border-color:#FF6B70;" onclick="sendNotificationNow(true)">⚡⚡ 전체 센터 즉시발송</button>'
    + '<div style="font-size:11px;color:#86868b;margin-top:4px;">발송 시각·반복주기·중복방지를 무시하고, 지금 조건(며칠째)에 맞는 센터에 바로 발송합니다. "이 센터만"은 위에서 선택한 센터(' + (notifSelectedCenterName || notifSelectedCenter || '') + ') 기준입니다.</div>'
    + '<div class="status-msg" id="notifSettingsStatus"></div>'
    + '</div>'
    + '</div>';
}

function changeNotifCenter(code) {
  notifSelectedCenter = code;
  renderNotificationSettings();
}

async function addContact() {
  const name = document.getElementById('newContactName').value.trim();
  const email = document.getElementById('newContactEmail').value.trim();
  const statusEl = document.getElementById('contactStatus');
  if (!email) { statusEl.className = 'status-msg err'; statusEl.textContent = '이메일을 입력해 주세요.'; return; }
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=save-contact', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, center_code: notifSelectedCenter, name: name, email: email, is_active: true })
    });
    const data = await res.json();
    if (!data.success) { statusEl.className = 'status-msg err'; statusEl.textContent = '등록 실패: ' + data.error; return; }
    await loadNotificationData();
    renderNotificationSettings();
  } catch (e) { statusEl.className = 'status-msg err'; statusEl.textContent = '오류: ' + e.message; }
}

async function toggleContactActive(id, checked) {
  await fetch(SB_FUNCTION_URL + '?action=save-contact', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_password: workspacePasswordCache, id: id, is_active: checked })
  });
  await loadNotificationData();
}

async function deleteContact(id) {
  if (!confirm('이 담당자를 삭제하시겠습니까?')) return;
  await fetch(SB_FUNCTION_URL + '?action=delete-contact', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_password: workspacePasswordCache, id: id })
  });
  await loadNotificationData();
  renderNotificationSettings();
}

async function saveNotificationSettings() {
  const statusEl = document.getElementById('notifSettingsStatus');
  const payload = {
    workspace_password: workspacePasswordCache,
    is_paused: document.getElementById('notifPaused').checked,
    send_time: document.getElementById('notifSendTime').value || '09:00',
    repeat_enabled: document.getElementById('notifRepeat').checked,
    repeat_interval_days: Number(document.getElementById('notifRepeatInterval').value) || 1,
    warn_send_on_day: Number(document.getElementById('notifWarnDay').value) || 4,
    warn_subject: document.getElementById('notifWarnSubject').value,
    warn_body: document.getElementById('notifWarnBody').value,
    danger_send_on_day: Number(document.getElementById('notifDangerDay').value) || 8,
    danger_subject: document.getElementById('notifDangerSubject').value,
    danger_body: document.getElementById('notifDangerBody').value,
  };
  statusEl.className = 'status-msg';
  statusEl.textContent = '저장 중...';
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=save-notification-settings', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) { statusEl.className = 'status-msg err'; statusEl.textContent = '저장 실패: ' + data.error; return; }
    statusEl.className = 'status-msg ok';
    statusEl.textContent = '저장되었습니다. 다음 발송부터 이 설정이 적용됩니다.';
    await loadNotificationData();
  } catch (e) { statusEl.className = 'status-msg err'; statusEl.textContent = '오류: ' + e.message; }
}

// "즉시 발송" 버튼: 매시 정각 발송시각 체크와 반복발송 중복방지를 건너뛰고,
// 지금 이 순간 조건(며칠째 미업로드)에 맞는 센터에 바로 발송한다.
// allCenters=false면 알림설정에서 선택된 센터 1곳만, true면 활성 센터 전체를 대상으로 한다.
async function sendNotificationNow(allCenters) {
  const statusEl = document.getElementById('notifSettingsStatus');
  const selectedMeta = allCentersMeta.find(function(c) { return c.center_code === notifSelectedCenter; });
  const targetLabel = allCenters ? '전체 센터' : ('"' + (selectedMeta ? selectedMeta.center_name : notifSelectedCenter) + '" 센터만');
  if (!confirm(targetLabel + '을 대상으로, 발송 시각·반복주기·중복방지 조건을 모두 무시하고 지금 바로 발송합니다. 계속할까요?')) return;
  statusEl.className = 'status-msg';
  statusEl.textContent = '즉시 발송 중... (' + targetLabel + ')';
  try {
    const payload = { workspace_password: workspacePasswordCache };
    if (!allCenters) payload.center_code = notifSelectedCenter;
    const res = await fetch(SB_FUNCTION_URL + '?action=send-notification-now', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) { statusEl.className = 'status-msg err'; statusEl.textContent = '발송 실패: ' + data.error; return; }
    const results = data.results || [];
    const sentCount = results.filter(function(r) { return r.sendOk; }).length;
    const noContact = results.filter(function(r) { return r.skipped === 'no-contacts'; }).length;

    if (results.length === 0) {
      statusEl.className = 'status-msg ok';
      statusEl.textContent = targetLabel + ' 중 지금 조건(주의/경고 며칠째)에 해당하는 센터가 없습니다.';
      await loadNotificationData();
      return;
    }

    // "센터 수(대상 N건)"와 "담당자 등록 건수"는 서로 다른 숫자라 헷갈릴 수 있어, 센터별로 결과와 실패 사유를 상세히 보여준다.
    const rowsHtml = results.map(function(r) {
      const levelBadge = r.level === 'danger' ? '🔴 경고' : '🟠 주의';
      if (r.skipped === 'no-contacts') {
        return '<tr><td>' + (r.center_name || r.center) + '</td><td>' + levelBadge + '(' + r.daysSince + '일째)</td><td colspan="2" style="color:#86868b;">담당자 미등록으로 건너뜀</td></tr>';
      }
      const statusText = r.sendOk ? '<span style="color:#34c759;">✅ 발송 성공</span>' : '<span style="color:#FF6B70;">❌ 발송 실패</span>';
      return '<tr><td>' + (r.center_name || r.center) + '</td><td>' + levelBadge + '(' + r.daysSince + '일째)</td><td>' + statusText + ' (' + (r.emails || []).length + '명)</td><td style="color:#86868b;font-size:11px;">' + escapeHtml(r.sendError || '') + '</td></tr>';
    }).join('');

    statusEl.className = sentCount > 0 ? 'status-msg ok' : 'status-msg err';
    statusEl.innerHTML = '<div style="margin-bottom:6px;">즉시 발송 완료(' + targetLabel + '): 대상 센터 ' + results.length + '건 중 발송 성공 ' + sentCount + '건'
      + (noContact ? ' · 담당자 미등록 ' + noContact + '건' : '') + '</div>'
      + '<div class="table-scroll"><table style="width:100%;font-size:12px;"><thead><tr><th style="text-align:left;padding:4px 6px;">센터</th><th style="text-align:left;padding:4px 6px;">단계</th><th style="text-align:left;padding:4px 6px;">결과</th><th style="text-align:left;padding:4px 6px;">실패 사유</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
    await loadNotificationData();
  } catch (e) { statusEl.className = 'status-msg err'; statusEl.textContent = '오류: ' + e.message; }
}

function renderUploadArchive() {
  const main = document.getElementById('main');
  const centerOptions = '<option value="">전체 센터</option>' + allCentersMeta.map(function(c) {
    return '<option value="' + c.center_code + '"' + (archiveCenterFilter === c.center_code ? ' selected' : '') + '>' + c.center_name + '</option>';
  }).join('');

  const rows = archiveFiles.map(function(f) {
    const centerMeta = allCentersMeta.find(function(c) { return c.center_code === f.center_code; });
    const sizeKb = f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-';
    const uploadedAt = f.uploaded_at ? new Date(f.uploaded_at).toLocaleString('ko-KR') : '-';
    return '<tr>'
      + '<td><input type="checkbox" class="archive-check" value="' + f.id + '" onchange="updateArchiveCheckedCount()"></td>'
      + '<td>' + (centerMeta ? centerMeta.center_name : f.center_code) + '</td>'
      + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + f.file_name + '">' + f.file_name + '</td>'
      + '<td>' + (f.file_type || '-') + '</td>'
      + '<td>' + sizeKb + '</td>'
      + '<td>' + uploadedAt + '</td>'
      + '<td style="white-space:nowrap;"><button class="btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="downloadArchiveFile(\'' + f.id + '\')">⬇ 다운로드</button> '
      + '<button style="padding:4px 10px;font-size:12px;border:none;background:none;color:#FF6B70;cursor:pointer;" onclick="deleteArchiveFile(\'' + f.id + '\')">✕ 삭제</button></td>'
      + '</tr>';
  }).join('');

  main.innerHTML = '<div style="--dash-accent:#FE2E36;--dash-accent-dark:#3a1518;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
    + '<h2 style="margin:0;font-size:20px;">📁 업로드 자료함</h2>'
    + '<button class="btn-outline" style="padding:6px 12px;font-size:12px;" onclick="selectUploadArchive()">새로고침</button>'
    + '</div>'
    + '<div class="panel" style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">'
    + '<select id="archiveCenterSelect" onchange="applyArchiveFilter()" style="padding:8px 10px;border:1px solid #2c2c2e;border-radius:8px;font-size:13px;">' + centerOptions + '</select>'
    + '<input type="text" id="archiveSearchInput" placeholder="🔍 파일명 검색" value="' + archiveSearchQuery + '" onkeydown="if(event.key===\'Enter\')applyArchiveFilter()" style="flex:1;min-width:180px;padding:8px 10px;border:1px solid #2c2c2e;border-radius:8px;font-size:13px;">'
    + '<button class="btn-primary" style="padding:8px 14px;" onclick="applyArchiveFilter()">검색</button>'
    + '<button class="btn-secondary" style="padding:8px 14px;color:#FF6B70;" onclick="deleteArchiveSelected()" id="archiveBulkDeleteBtn" disabled>선택 삭제 (<span id="archiveCheckedCount">0</span>)</button>'
    + '</div>'
    + '<div class="panel"><div class="table-scroll"><table class="ws-table">'
    + '<thead><tr><th><input type="checkbox" id="archiveCheckAll" onchange="toggleArchiveCheckAll(this)"></th><th>센터</th><th>파일명</th><th>구분</th><th>용량</th><th>업로드일시</th><th></th></tr></thead>'
    + '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;color:#86868b;padding:24px;">저장된 파일이 없습니다.</td></tr>') + '</tbody>'
    + '</table></div></div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:10px;">최근 300건까지 표시됩니다 · 데이터입력에서 파일을 첨부/추출할 때마다 원본이 자동으로 여기에 보관됩니다</p>'
    + '</div>';
}

function toggleArchiveCheckAll(el) {
  document.querySelectorAll('.archive-check').forEach(function(c) { c.checked = el.checked; });
  updateArchiveCheckedCount();
}

function updateArchiveCheckedCount() {
  const count = document.querySelectorAll('.archive-check:checked').length;
  const countEl = document.getElementById('archiveCheckedCount');
  if (countEl) countEl.textContent = String(count);
  const btn = document.getElementById('archiveBulkDeleteBtn');
  if (btn) btn.disabled = count === 0;
}

async function deleteArchiveFile(id) {
  if (!confirm('이 파일을 삭제하시겠습니까? 원본 파일과 기록이 모두 삭제되며 되돌릴 수 없습니다.')) return;
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=archive-delete-file', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, token: centerTokenMap[currentCenter], id: id })
    });
    const data = await res.json();
    if (!data.success) { alert('삭제 실패: ' + data.error); return; }
    await loadUploadArchive();
    renderUploadArchive();
  } catch (e) { alert('삭제 실패: ' + e.message); }
}

async function deleteArchiveSelected() {
  const ids = Array.from(document.querySelectorAll('.archive-check:checked')).map(function(c) { return c.value; });
  if (ids.length === 0) return;
  if (!confirm(ids.length + '개 파일을 삭제하시겠습니까? 원본 파일과 기록이 모두 삭제되며 되돌릴 수 없습니다.')) return;
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=archive-delete-files-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, token: centerTokenMap[currentCenter], ids: ids })
    });
    const data = await res.json();
    if (!data.success) { alert('삭제 실패: ' + data.error); return; }
    await loadUploadArchive();
    renderUploadArchive();
  } catch (e) { alert('삭제 실패: ' + e.message); }
}

function applyArchiveFilter() {
  archiveCenterFilter = document.getElementById('archiveCenterSelect').value;
  archiveSearchQuery = document.getElementById('archiveSearchInput').value.trim();
  loadUploadArchive().then(renderUploadArchive);
}

async function downloadArchiveFile(id) {
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=archive-file-url', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, token: centerTokenMap[currentCenter], id: id })
    });
    const data = await res.json();
    if (!data.success) { alert('다운로드 실패: ' + data.error); return; }
    const a = document.createElement('a');
    a.href = data.url;
    a.download = data.file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) { alert('다운로드 실패: ' + e.message); }
}

function renderInputGuide() {
  const guide = CENTER_GUIDES[currentCenter];
  if (!guide || !rowSchema || rowSchema.length === 0) return '';

  // 평택시청: 일자별 실적 + 업무유형별 인입현황 사용설명을 하나로 통합
  if (currentCenter === 'pyeongtaek') {
    if (!categorySchema || categorySchema.length === 0) return '';
    const rows1 = buildGuideTable(rowSchema, guide.sample);
    const rows2 = buildGuideTable(categorySchema, guide.categorySample);

    return '<details class="panel" style="max-width:100%;margin-bottom:16px;">'
      + '<summary style="cursor:pointer;font-weight:700;font-size:14px;line-height:1.5;">사용설명보기<br><span style="font-size:12px;font-weight:400;color:#86868b;">(원본 양식 예시 · 항목 대응표)</span></summary>'
      + '<div style="margin-top:14px;">'
      + '<img src="' + guide.image + '" onclick="openImageLightbox(this.src)" title="클릭하면 크게 보기" style="max-width:100%;border:1px solid #2c2c2e;border-radius:8px;margin-bottom:18px;cursor:zoom-in;">'

      + '<p style="font-size:14px;font-weight:700;margin-bottom:6px;">1) 일자별 실적 직접입력 방법</p>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">원본 양식 예시 (일별실적 표 기준) — 위 이미지처럼 "일자" 행 전체를 그대로 복사하시면 됩니다.</p>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">항목 대응표 (총 ' + rowSchema.length + '개 항목, 예시는 <span style="color:#009DA5;font-weight:700;">' + guide.date + '</span> 데이터 기준)</p>'
      + '<div class="table-scroll" style="max-height:260px;overflow-y:auto;margin-bottom:18px;">'
      + '<table><thead><tr><th>순서</th><th>표준 항목명</th><th>예시값</th></tr></thead><tbody>' + rows1 + '</tbody></table>'
      + '</div>'

      + '<p style="font-size:14px;font-weight:700;margin-bottom:6px;">2) 업무유형별 현황 입력 방법</p>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">원본 양식 예시 (상담유형 인입호 표 기준) — 위 이미지처럼 "일자" 행 전체를 그대로 복사하시면 됩니다.</p>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">항목 대응표 (총 ' + categorySchema.length + '개 항목, 예시는 <span style="color:#009DA5;font-weight:700;">' + guide.date + '</span> 데이터 기준)</p>'
      + '<div class="table-scroll" style="max-height:320px;overflow-y:auto;">'
      + '<table><thead><tr><th>순서</th><th>표준 항목명</th><th>예시값</th></tr></thead><tbody>' + rows2 + '</tbody></table>'
      + '</div>'
      + '</div></details>';
  }

  const rows = buildGuideTable(rowSchema, guide.sample);

  return '<details class="panel" style="max-width:100%;margin-bottom:16px;">'
    + '<summary style="cursor:pointer;font-weight:700;font-size:14px;line-height:1.5;">사용설명보기<br><span style="font-size:12px;font-weight:400;color:#86868b;">(원본 양식 예시 · 항목 대응표)</span></summary>'
    + '<div style="margin-top:14px;">'
    + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;"><b>1) 원본 양식 예시</b> (<span style="color:#FE2E36;font-weight:700;">' + guide.date + '</span> 데이터 기준) — 아래처럼 "일자" 행 전체를 그대로 복사하시면 됩니다.</p>'
    + '<img src="' + guide.image + '" onclick="openImageLightbox(this.src)" title="클릭하면 크게 보기" style="max-width:100%;border:1px solid #2c2c2e;border-radius:8px;margin-bottom:16px;cursor:zoom-in;">'
    + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;"><b>2) 항목 대응표</b> (총 ' + rowSchema.length + '개 항목, 예시는 <span style="color:#FE2E36;font-weight:700;">' + guide.date + '</span> 데이터 기준)</p>'
    + '<div class="table-scroll" style="max-height:320px;overflow-y:auto;">'
    + '<table><thead><tr><th>순서</th><th>표준 항목명</th><th>예시값</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '</div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:10px;">※ 병합된 셀(예: 큰 제목 행)은 무시하고, 실제 숫자가 들어있는 맨 아래 줄 기준으로 순서를 맞추면 됩니다.</p>'
    + '</div></details>';
}

// ============================================
// LG전자 - 엑셀(summary 시트 상시 Total) 자동추출 → 직접입력 템플릿에 반영
// (사용자가 제공한 "LG전자 KPI 상시 Total 자동추출 시스템" 로직 이식)
// 파일 하나에 여러 날짜가 컬럼으로 들어있으므로, 파싱 결과를 그대로
// 기존 parsedRows/renderPreviewTable/saveAllRows() 흐름에 태워 재사용한다.
// ============================================
const LGEX_TARGETS = [
  { key: 'TNPS', label: 'T-NPS', aliases: ['T-NPS', 'TNPS'] },
  { key: '생산성_INOUT', label: '생산성 (IN+OUT)', aliases: ['생산성 (IN+OUT)', '생산성\n(IN+OUT)', '생산성(IN+OUT)', '생산성 IN+OUT'] },
  { key: '생산성_IN', label: '생산성 (IN)', aliases: ['생산성 (IN)', '생산성\n(IN)', '생산성(IN)', '생산성 IN'] },
  { key: '통화시간_INOUT', label: '통화시간 (IN+OUT)', aliases: ['통화시간 (IN+OUT)', '통화시간\n(IN+OUT)', '통화시간(IN+OUT)', '통화시간 IN+OUT'] }
];

// LG전자AS는 "상시" Total, LG전자성수기는 "한시" Total 행을 찾는다는 점만 다르고 나머지 추출 로직은 동일하다.
const LGEX_CENTER_CONFIG = {
  'lge': { targetGroup: '상시', otherGroups: ['한시'] },
  'lge_seongsu': { targetGroup: '한시', otherGroups: ['상시'] }
};

function lgexNormalize(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[（）]/g, function(m) { return m === '（' ? '(' : ')'; })
    .replace(/[–—]/g, '-')
    .replace(/\r/g, '\n')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}
function lgexIsBlank(value) { return value === undefined || value === null || String(value).trim() === ''; }
function lgexIsErrorValue(value) { return typeof value === 'string' && /^#/.test(value.trim()); }
function lgexIsFormulaString(value) { return typeof value === 'string' && value.trim().startsWith('='); }
function lgexMetricMatches(value, target) {
  const nv = lgexNormalize(value);
  if (!nv) return false;
  return target.aliases.some(function(alias) { return nv === lgexNormalize(alias); });
}
function lgexAnyMetricInRow(row, limit) {
  for (let c = 0; c < Math.min(limit, row.length); c++) {
    if (LGEX_TARGETS.some(function(t) { return lgexMetricMatches(row[c], t); })) return true;
  }
  return false;
}
// v2: 정확히 일치하지 않아도 셀 텍스트에 단어가 포함돼 있으면(2자 이상) 인정 — "상시(1파트)"처럼 부가 텍스트가 붙은 경우 대응
function lgexRowHasWord(row, word, limit) {
  const nw = lgexNormalize(word);
  for (let c = 0; c < Math.min(limit, row.length); c++) {
    const cell = lgexNormalize(row[c]);
    if (cell === nw) return true;
    if (nw.length >= 2 && cell.includes(nw)) return true;
  }
  return false;
}
function lgexFindSheetName(workbook) {
  const exact = workbook.SheetNames.find(function(name) { return lgexNormalize(name) === 'SUMMARY'; });
  if (exact) return exact;
  const includes = workbook.SheetNames.find(function(name) { return lgexNormalize(name).includes('SUMMARY'); });
  return includes || workbook.SheetNames[0];
}
function lgexExcelSerialToDate(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  if (serial < 20000 || serial > 60000) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000);
  const date = new Date(utc);
  return isNaN(date.getTime()) ? null : date;
}
function lgexParseDateValue(value, fallbackYear) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'number') return lgexExcelSerialToDate(value);
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  // v2: 날짜가 문자열 형태의 엑셀 일련번호(5자리)로 들어오는 경우도 지원
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = lgexExcelSerialToDate(Number(s));
    if (d) return d;
  }
  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/);
  if (m) { const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})$/);
  if (m) { const d = new Date(Date.UTC(fallbackYear, Number(m[1]) - 1, Number(m[2]))); return isNaN(d.getTime()) ? null : d; }
  return null;
}
function lgexIsoDate(date) {
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
}
function lgexDateLabel(date) { return (date.getUTCMonth() + 1) + '/' + date.getUTCDate(); }

function lgexFindDateColumns(aoa, fallbackYear) {
  let best = { rowIndex: -1, columns: [] };
  const maxRows = Math.min(45, aoa.length); // v2: 25→45행으로 탐색범위 확대 (헤더가 더 아래에 있는 파일 대응)
  for (let r = 0; r < maxRows; r++) {
    const row = aoa[r] || [];
    const columns = [];
    for (let c = 0; c < row.length; c++) {
      const date = lgexParseDateValue(row[c], fallbackYear);
      if (date) columns.push({ colIndex: c, date: date });
    }
    if (columns.length > best.columns.length) best = { rowIndex: r, columns: columns };
  }
  if (best.columns.length === 0) throw new Error('날짜 헤더를 찾지 못했습니다. summary 시트 상단 날짜가 엑셀 일련번호/날짜/문자 날짜 중 어떤 형태인지 확인해 주세요.');
  return best;
}

// v2: targetGroup(상시/한시)이 명시적으로 발견되지 않아도, otherGroups가 나오기 전의 마지막 Total 행을 대체 후보로 사용한다.
// (기존 버전은 "상시" 라벨을 못 찾으면 바로 실패 처리되어 실제 파일 구조와 안 맞는 경우 업로드 자체가 막히는 문제가 있었음)
function lgexFindTargetRow(aoa, target, leftLimit, targetGroup, otherGroups) {
  const starts = [];
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < Math.min(leftLimit, row.length); c++) {
      if (lgexMetricMatches(row[c], target)) { starts.push(r); break; }
    }
  }
  for (let si = 0; si < starts.length; si++) {
    const start = starts[si];
    let end = aoa.length;
    for (let r = start + 1; r < aoa.length; r++) { if (lgexAnyMetricInRow(aoa[r] || [], leftLimit)) { end = r; break; } }

    let seenTargetGroup = false, targetGroupRow = -1;
    for (let r = start; r < end; r++) {
      const row = aoa[r] || [];
      const hasTargetGroup = lgexRowHasWord(row, targetGroup, leftLimit);
      const hasTotal = lgexRowHasWord(row, 'Total', leftLimit);
      const hasOtherGroup = otherGroups.some(function(g) { return lgexRowHasWord(row, g, leftLimit); });

      if (hasTargetGroup && hasTotal) return r;
      if (hasTargetGroup) { seenTargetGroup = true; targetGroupRow = r; }
      if (seenTargetGroup && r > targetGroupRow && hasTotal) return r;
      if (seenTargetGroup && hasOtherGroup) break;
    }

    // 보조 fallback: targetGroup 라벨이 명시되지 않았더라도, otherGroups 구간 이전의 마지막 Total 행을 후보로 사용
    let fallback = -1;
    for (let r = start; r < end; r++) {
      const row = aoa[r] || [];
      const hasTotal = lgexRowHasWord(row, 'Total', leftLimit);
      const hasOtherGroup = otherGroups.some(function(g) { return lgexRowHasWord(row, g, leftLimit); });
      if (hasOtherGroup) break;
      if (hasTotal) fallback = r;
    }
    if (fallback >= 0) return fallback;
  }
  return -1;
}

function lgexToNumber(value) {
  if (lgexIsBlank(value) || lgexIsErrorValue(value) || lgexIsFormulaString(value)) return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, '').replace(/%/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}
function lgexFormatNumber(value, decimals) {
  const n = lgexToNumber(value);
  if (n === null) return '';
  return n.toFixed(decimals);
}
function lgexFormatTime(value) {
  if (lgexIsBlank(value) || lgexIsErrorValue(value) || lgexIsFormulaString(value)) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.getUTCHours() + ':' + String(value.getUTCMinutes()).padStart(2, '0') + ':' + String(value.getUTCSeconds()).padStart(2, '0');
  }
  let v = value;
  if (typeof v === 'string') {
    const raw = v.trim();
    if (/^\d{1,3}:\d{2}:\d{2}$/.test(raw)) return raw;
    const n = lgexToNumber(raw);
    if (n === null) return raw;
    v = n;
  }
  if (typeof v === 'number' && isFinite(v)) {
    let seconds;
    if (v > 0 && v < 1.5) seconds = Math.round(v * 86400);
    else seconds = Math.round(v);
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  return String(v);
}
function lgexMeaningfulValue(raw) {
  if (lgexIsBlank(raw) || lgexIsErrorValue(raw) || lgexIsFormulaString(raw)) return false;
  const n = lgexToNumber(raw);
  if (n === null) return String(raw).trim() !== '';
  return n !== 0;
}

function lgexExtract(workbook, fallbackYear, centerCode) {
  const groupCfg = LGEX_CENTER_CONFIG[centerCode] || LGEX_CENTER_CONFIG['lge'];
  const sheetName = lgexFindSheetName(workbook);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('summary 시트를 읽을 수 없습니다.');
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const dateInfo = lgexFindDateColumns(aoa, fallbackYear);
  const firstDateCol = Math.min.apply(null, dateInfo.columns.map(function(x) { return x.colIndex; }));
  const leftLimit = Math.max(6, Math.min(firstDateCol, 16)); // v2: 14→16열로 탐색범위 확대

  const targetRows = {};
  const missing = [];
  LGEX_TARGETS.forEach(function(target) {
    const rowIndex = lgexFindTargetRow(aoa, target, leftLimit, groupCfg.targetGroup, groupCfg.otherGroups);
    targetRows[target.key] = rowIndex;
    if (rowIndex < 0) missing.push(target.label);
  });
  if (missing.length) throw new Error(groupCfg.targetGroup + ' Total 행을 찾지 못한 항목: ' + missing.join(', ') + ' / 탐색 범위: 날짜 시작열 이전 ' + leftLimit + '열');

  const rows = [];
  dateInfo.columns.forEach(function(dc) {
    const tnpsRaw = aoa[targetRows['TNPS']] ? aoa[targetRows['TNPS']][dc.colIndex] : undefined;
    const prodAllRaw = aoa[targetRows['생산성_INOUT']] ? aoa[targetRows['생산성_INOUT']][dc.colIndex] : undefined;
    const prodInRaw = aoa[targetRows['생산성_IN']] ? aoa[targetRows['생산성_IN']][dc.colIndex] : undefined;
    const callTimeRaw = aoa[targetRows['통화시간_INOUT']] ? aoa[targetRows['통화시간_INOUT']][dc.colIndex] : undefined;

    const hasMeaningful = [tnpsRaw, prodAllRaw, prodInRaw, callTimeRaw].some(lgexMeaningfulValue);
    if (!hasMeaningful) return;

    rows.push({
      date: lgexIsoDate(dc.date),
      dateLabel: lgexDateLabel(dc.date),
      values: [
        lgexFormatNumber(tnpsRaw, 1),
        lgexFormatNumber(prodAllRaw, 1),
        lgexFormatNumber(prodInRaw, 1),
        lgexFormatTime(callTimeRaw)
      ],
      dateSort: dc.date.getTime()
    });
  });

  rows.sort(function(a, b) { return a.dateSort - b.dateSort; });
  return { sheetName: sheetName, targetGroup: groupCfg.targetGroup, rows: rows };
}

async function extractLgeExcelAndFill() {
  const statusEl = document.getElementById('lgeExcelStatus');
  const fileInput = document.getElementById('lgeExcelFile');
  const file = fileInput && fileInput.files[0];
  if (!file) { statusEl.className = 'status-msg err'; statusEl.textContent = '엑셀 파일을 선택해 주세요.'; return; }
  pendingPerfArchiveFile = file; // 실제 저장 성공 시 업로드

  // jsdelivr CDN이 막힌 네트워크에서는 보조 CDN(unpkg) 재시도가 끝날 때까지 잠시 기다려 준다.
  if (!window.XLSX) {
    statusEl.className = 'status-msg';
    statusEl.textContent = '엑셀 해석 라이브러리를 불러오는 중입니다...';
    for (let i = 0; i < 30 && !window.XLSX; i++) { await new Promise(function(res) { setTimeout(res, 100); }); }
  }
  if (!window.XLSX) { statusEl.className = 'status-msg err'; statusEl.textContent = '엑셀 해석 라이브러리를 불러오지 못했습니다. 네트워크(사내망 차단 등)를 확인하거나 페이지를 새로고침해 주세요.'; return; }

  const fallbackYear = Number(document.getElementById('entryYear').value) || new Date().getFullYear();
  const rangeStart = document.getElementById('lgeExcelStart').value; // 'YYYY-MM-DD', 미입력 시 전체
  const rangeEnd = document.getElementById('lgeExcelEnd').value;
  statusEl.className = 'status-msg';
  statusEl.textContent = file.name + ' 파일을 읽는 중입니다.';
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: true });
    const result = lgexExtract(workbook, fallbackYear, currentCenter);
    if (result.rows.length === 0) throw new Error('추출 대상 행은 찾았지만 표시할 날짜 데이터가 없습니다.');

    let rows = result.rows;
    if (rangeStart) rows = rows.filter(function(r) { return r.date >= rangeStart; });
    if (rangeEnd) rows = rows.filter(function(r) { return r.date <= rangeEnd; });
    if (rows.length === 0) throw new Error('지정한 기간(' + (rangeStart || '전체') + ' ~ ' + (rangeEnd || '전체') + ')에 해당하는 날짜가 파일에 없습니다.');

    parsedRows = rows.map(function(r) { return { date: r.date, dateLabel: r.dateLabel, values: r.values }; });

    // row_schema(입력양식)가 아직 로딩되지 않았거나 등록돼 있지 않으면, 화면이 깨지는 대신 원인을 바로 알 수 있게 안내한다.
    if (rowSchema.length === 0) {
      statusEl.className = 'status-msg';
      statusEl.textContent = '입력양식을 다시 확인하는 중입니다...';
      try {
        const schemaRes = await fetch(SB_FUNCTION_URL + '?action=schema&token=' + encodeURIComponent(centerTokenMap[currentCenter]) + '&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
        const schemaData = await schemaRes.json();
        rowSchema = schemaData.success ? (schemaData.row_schema || []) : [];
      } catch (e) { /* 아래에서 최종 오류로 처리 */ }
    }
    if (rowSchema.length === 0) {
      statusEl.className = 'status-msg err';
      statusEl.textContent = '이 센터의 입력양식(row_schema)이 등록되지 않아 추출 결과를 표에 채울 수 없습니다. Supabase에서 row_schema 등록 SQL을 실행했는지 확인한 뒤, 페이지를 새로고침하고 다시 시도해 주세요.';
      return;
    }
    if (rowSchema.length !== parsedRows[0].values.length) {
      statusEl.className = 'status-msg err';
      statusEl.textContent = '입력양식 항목 수(' + rowSchema.length + '개)와 추출된 값 개수(' + parsedRows[0].values.length + '개)가 달라 표를 채울 수 없습니다. row_schema 등록 내용을 확인해 주세요.';
      return;
    }

    renderPreviewTable();
    document.getElementById('manualSaveBtn').style.display = parsedRows.length ? 'inline-block' : 'none';

    const rangeNote = (rangeStart || rangeEnd) ? (' · 기간필터 ' + (rangeStart || '처음') + ' ~ ' + (rangeEnd || '끝') + ' 적용(파일 내 전체 ' + result.rows.length + '일 중)') : '';
    statusEl.className = 'status-msg ok';
    statusEl.textContent = '추출 완료 · ' + result.sheetName + ' 시트(' + result.targetGroup + ' Total 기준)에서 ' + parsedRows.length + '일치를 찾았습니다' + rangeNote + '. 아래 표에서 확인 후 "전체 저장"을 눌러주세요.';
    // 재직현황에는 "실제 데이터가 있던 마지막 날짜"가 아니라 "사용자가 지정한 추출 기간" 그대로를 넘긴다.
    // (데이터가 없는 날이 껴서 rows의 실제 범위가 좁아져도, 지정한 기간은 그대로 유지되어야 함)
    promptGoToAttendance(rangeStart || rows[0].date, rangeEnd || rows[rows.length - 1].date);
  } catch (err) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '추출 실패: ' + (err.message || err);
  }
}

// ============================================
// HWPX 자동 추출 (hwpx_call_report_extractor_v2.html 로직 이식)
// 센터별로 보고서 항목 순서가 다를 수 있어 매핑을 별도로 관리
// ============================================
// ============================================
// 일일업무보고 HWPX 자동 추출 (하루치 문서에서 일별실적+상담유형별 인입호 동시 추출)
// pyeongtaek_daily_category_and_call_extractor_v5.html 로직 이식
// ============================================
const DAY_REPORT_CENTERS = { 'pyeongtaek': true };

// LG전자통합: 기존 LG전자AS/LG전자성수기와 완전히 독립된 별도 센터. 파일첨부가 아니라
// "항목을 만들고 숫자만 입력"하는 전용 폼으로 데이터를 넣는다 (renderIntegratedFormEntry 참고).
const INTEGRATED_FORM_CENTERS = { 'lge_total': true };

// 항목마다 parts(2개) + 합계로 구성되고, 합계는 항상 parts 두 값의 자동 합산이다.
// 저장 키 규칙: {key}_{parts[0]}, {key}_{parts[1]}, {key}_합계 (전부 attendance 그룹)
// derivedFrom이 있는 항목(총재직인원)은 직접 입력받지 않고, 지정된 다른 항목의 "합계"를 그대로 읽기전용으로 가져온다.
const LGE_TOTAL_ATT_METRICS = [
  { key: 'TO', label: 'TO', parts: ['AS', '성수기'] },
  { key: '총재직인원', label: '총 재직인원', parts: ['AS', '성수기'], derivedFrom: { AS: 'AS재직인원', 성수기: '성수기재직인원' } },
  { key: 'AS재직인원', label: 'AS 재직인원', parts: ['관리자', '상담사'] },
  { key: '성수기재직인원', label: '성수기 재직인원', parts: ['관리자', '상담사'] },
  { key: '상담사투입인원', label: '상담사 투입인원', parts: ['AS', '성수기'] }
];
// 실적 4개 항목은 AS/성수기 구분 없이 통합된 값 하나만 입력 (매일 새로 입력, 이월 없음). performance 그룹.
const LGE_TOTAL_PERF_METRICS = [
  { key: 'TNPS', label: 'T-NPS' },
  { key: '생산성_INOUT', label: '생산성(IN+OUT)' },
  { key: '생산성_IN', label: '생산성(IN)' },
  { key: '통화시간_INOUT_초', label: '통화시간', duration: true }
];

function dayrptElemsByLocal(root, name) { return Array.from(root.getElementsByTagName('*')).filter(function(el) { return el.localName === name; }); }
function dayrptTextOf(el) { return dayrptElemsByLocal(el, 't').map(function(n) { return n.textContent || ''; }).join('').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim(); }
function dayrptNormalize(s) { return String(s || '').replace(/\s+/g, '').replace(/\u00a0/g, '').trim(); }
function dayrptHas(row, keyword) { const k = dayrptNormalize(keyword); return row.some(function(c) { return dayrptNormalize(c).includes(k); }); }

function dayrptParseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror')[0]) throw new Error('section0.xml 파싱 실패');
  const allText = dayrptElemsByLocal(doc, 't').map(function(n) { return n.textContent || ''; }).join('\n');
  const tables = dayrptElemsByLocal(doc, 'tbl').map(function(tbl) {
    return Array.from(tbl.children).filter(function(ch) { return ch.localName === 'tr'; })
      .map(function(tr) { return Array.from(tr.children).filter(function(ch) { return ch.localName === 'tc'; }).map(dayrptTextOf); });
  });
  return { allText: allText, tables: tables };
}

function dayrptFormatDate(raw) {
  const nums = String(raw || '').match(/\d+/g) || [];
  if (nums.length >= 3) {
    const m = parseInt(nums[nums.length - 2], 10), d = parseInt(nums[nums.length - 1], 10);
    if (!isNaN(m) && !isNaN(d)) return m + '/' + d;
  }
  if (nums.length === 2) {
    const m = parseInt(nums[0], 10), d = parseInt(nums[1], 10);
    if (!isNaN(m) && !isNaN(d)) return m + '/' + d;
  }
  return '';
}

function dayrptParseTitleAndDate(allText, tables, filename) {
  const tableTitle = String((tables[0] && tables[0][0] && tables[0][0][0]) || '').replace(/\s+/g, ' ').trim();
  const textMatch = allText.match(/민원상담\s*콜센터\s*일일업무보고\s*\([^\n)]+\)/);
  const textTitle = textMatch ? textMatch[0].replace(/\s+/g, ' ').trim() : '';
  const title = tableTitle || textTitle || filename;
  let dateRaw = (title.match(/\(([^)]+)\)/) || [, ''])[1];
  if (!dateRaw) dateRaw = (filename.match(/\(([^)]+)\)/) || [, ''])[1];
  return { title: title, date: dayrptFormatDate(dateRaw) };
}

function dayrptHeaderIndex(headers, keyword) {
  const target = dayrptNormalize(keyword);
  for (let i = 0; i < headers.length; i++) { if (dayrptNormalize(headers[i]).includes(target)) return i; }
  return -1;
}
function dayrptValueByHeader(headers, row, keyword) {
  const idx = dayrptHeaderIndex(headers, keyword);
  return idx >= 0 ? (row[idx] || '') : '';
}
function dayrptCleanPercent(v) { return String(v || '').replace(/%/g, '').trim(); }
function dayrptToNum(v) {
  const n = parseFloat(String(v || '').replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}
function dayrptFormatComputed(n) {
  if (!isFinite(n)) return '';
  return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function dayrptParseStaffInput(tables) {
  const tbl = tables.find(function(t) {
    return t.length >= 2 && dayrptHas(t[0] || [], '계') && dayrptHas(t[0] || [], '관리자')
      && t.some(function(r) { return dayrptNormalize(r[0]).includes('근무인원'); });
  });
  if (!tbl) return '';
  const headers = tbl[0] || [];
  const row = tbl.find(function(r) { return dayrptNormalize(r[0]).includes('근무인원'); }) || [];
  const total = dayrptToNum(dayrptValueByHeader(headers, row, '계'));
  const manager = dayrptToNum(dayrptValueByHeader(headers, row, '관리자'));
  if (total === null || manager === null) return '';
  return dayrptFormatComputed(total - manager);
}

function dayrptParseDailyStats(tables) {
  const tbl = tables.find(function(t) {
    return t.length >= 2 && dayrptHas(t[0] || [], '인입호') && dayrptHas(t[0] || [], '응대호')
      && dayrptHas(t[0] || [], '포기호') && dayrptHas(t[0] || [], '응대율') && dayrptHas(t[0] || [], '1일평균상담건수');
  });
  if (!tbl) return null;
  const sourceHeaders = tbl[0] || [];
  const row = tbl.find(function(r) { return dayrptNormalize(r[0]).includes('응대현황'); }) || tbl[1] || [];
  const staffInput = dayrptParseStaffInput(tables);
  return {
    '요청호': dayrptValueByHeader(sourceHeaders, row, '인입호'),
    '응답호': dayrptValueByHeader(sourceHeaders, row, '응대호'),
    '응대율': dayrptCleanPercent(dayrptValueByHeader(sourceHeaders, row, '응대율')),
    '포기호': dayrptValueByHeader(sourceHeaders, row, '포기호'),
    '투입인원': staffInput,
    'CPD': dayrptValueByHeader(sourceHeaders, row, '1일평균상담건수')
  };
}

function dayrptFirstRowByLabel(tbl, label) {
  const target = dayrptNormalize(label);
  return tbl.find(function(r) { return dayrptNormalize(r[0]).includes(target); }) || [];
}

function dayrptParseCategoryStats(tables) {
  const tbl = tables.find(function(t) {
    return t.length >= 2 && dayrptHas(t[0] || [], '합계') && dayrptHas(t[0] || [], '복지')
      && dayrptHas(t[0] || [], '교통') && dayrptHas(t[0] || [], '환경')
      && t.some(function(r) { return dayrptNormalize(r[0]).startsWith('건수'); });
  });
  if (!tbl) return null;
  const sourceHeaders = (tbl[0] || []).map(function(h, i) { return i === 0 ? '구분' : dayrptNormalize(h); });
  const countRow = dayrptFirstRowByLabel(tbl, '건수');
  if (!countRow.length) return null;
  const row = {};
  sourceHeaders.forEach(function(h, i) { row[h] = countRow[i] || ''; });
  delete row['구분'];
  return row;
}

async function extractDailyReportAndFill() {
  const statusEl = document.getElementById('dayReportStatus');
  const fileInput = document.getElementById('dayReportFile');
  const f = fileInput.files[0];
  if (!f) { statusEl.className = 'status-msg err'; statusEl.textContent = '먼저 .hwpx 파일을 선택해 주세요.'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = '일일업무보고 파일을 읽는 중...';
  try {
    const xml = await hwpxUnzipOne(await f.arrayBuffer(), 'Contents/section0.xml');
    const parsed = dayrptParseXml(xml);
    const titleInfo = dayrptParseTitleAndDate(parsed.allText, parsed.tables, f.name);
    const dailyStats = dayrptParseDailyStats(parsed.tables);
    const categoryStats = dayrptParseCategoryStats(parsed.tables);

    if (!titleInfo.date) throw new Error('문서 제목에서 날짜를 찾지 못했습니다.');
    if (!dailyStats && !categoryStats) throw new Error('일별실적/상담유형별 인입호 표를 찾지 못했습니다.');

    if (dailyStats && rowSchema && rowSchema.length) {
      const line = titleInfo.date + '\t' + rowSchema.map(function(col) { return dailyStats[col.key] !== undefined ? dailyStats[col.key] : ''; }).join('\t');
      const pasteBoxEl = document.getElementById('pasteBox');
      if (pasteBoxEl) pasteBoxEl.value = line;
    }
    if (categoryStats && categorySchema && categorySchema.length) {
      const line = titleInfo.date + '\t' + categorySchema.map(function(col) { return categoryStats[col.key] !== undefined ? categoryStats[col.key] : ''; }).join('\t');
      const catBoxEl = document.getElementById('categoryPasteBox');
      if (catBoxEl) catBoxEl.value = line;
    }

    pendingPerfArchiveFile = f; // "전체저장" 성공 시에만 업로드 자료함에 반영 (saveEverything 참고)
    statusEl.className = 'status-msg ok';
    statusEl.textContent = titleInfo.date + ' 자료 추출 완료. "전체 양식에 반영"을 눌러 두 표에 함께 반영하세요.';
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '추출 실패: ' + e.message;
  }
}

function applyBothForms() {
  parseMultiPaste();
  parseCategoryPaste();
}

async function saveEverything() {
  const statusEl = document.getElementById('dayReportStatus');
  parseMultiPaste();
  parseCategoryPaste();
  // saveAllRows()가 내부에서 pendingPerfArchiveFile을 소비(및 초기화)하므로,
  // saveCategoryRows()만 성공한 경우(=일별실적표는 없고 업무유형별 인입호만 추출된 경우)에도
  // 자료함 반영을 판단할 수 있도록 미리 별도로 붙잡아 둔다.
  const fileToArchive = pendingPerfArchiveFile;
  if (statusEl) { statusEl.className = 'status-msg'; statusEl.textContent = '일자별 실적 저장 중...'; }
  let dailyOk = false, categoryOk = false;
  if (typeof parsedRows !== 'undefined' && parsedRows.length) dailyOk = await saveAllRows();
  if (statusEl) statusEl.textContent = '업무유형별 인입현황 저장 중...';
  if (typeof categoryParsedRows !== 'undefined' && categoryParsedRows.length) categoryOk = await saveCategoryRows();
  if (statusEl) { statusEl.className = 'status-msg ok'; statusEl.textContent = '일자별 실적 + 업무유형별 인입현황 저장을 모두 완료했습니다.'; }
  // dailyOk일 때는 saveAllRows()가 이미 자료함에 반영했으므로 중복 업로드하지 않는다.
  if (!dailyOk && categoryOk && fileToArchive) { uploadFileToArchive(fileToArchive, '실적파일'); pendingPerfArchiveFile = null; }
}

const HWPX_FIELD_ORDER = {
  'pyeongtaek': ['request', 'answer', 'rate', 'abandoned', 'staff', 'cpd'] // 요청호,응답호,응대율,포기호,투입인원,CPD
};

function hwpxU16(dv, o) { return dv.getUint16(o, true); }
function hwpxU32(dv, o) { return dv.getUint32(o, true); }
function hwpxDecodeUtf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }

async function hwpxInflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축해제를 지원하지 않습니다. 최신 Chrome/Edge를 사용해 주세요.');
  let ds;
  try { ds = new DecompressionStream('deflate-raw'); } catch (e) { ds = new DecompressionStream('deflate'); }
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function hwpxFindEOCD(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (hwpxU32(dv, i) === 0x06054b50) return i;
  }
  throw new Error('ZIP 종료 레코드를 찾지 못했습니다. HWPX 파일이 손상되었을 수 있습니다.');
}

async function hwpxUnzipOne(arrayBuffer, targetName) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const eocd = hwpxFindEOCD(bytes);
  const cdSize = hwpxU32(dv, eocd + 12);
  const cdOffset = hwpxU32(dv, eocd + 16);
  let p = cdOffset;
  const end = cdOffset + cdSize;
  while (p < end) {
    if (hwpxU32(dv, p) !== 0x02014b50) throw new Error('ZIP 중앙 디렉터리 파싱 실패');
    const method = hwpxU16(dv, p + 10);
    const compSize = hwpxU32(dv, p + 20);
    const fileNameLen = hwpxU16(dv, p + 28);
    const extraLen = hwpxU16(dv, p + 30);
    const commentLen = hwpxU16(dv, p + 32);
    const localOffset = hwpxU32(dv, p + 42);
    const fileName = hwpxDecodeUtf8(bytes.slice(p + 46, p + 46 + fileNameLen));
    if (fileName === targetName) {
      if (hwpxU32(dv, localOffset) !== 0x04034b50) throw new Error('ZIP 로컬 헤더 파싱 실패');
      const lfNameLen = hwpxU16(dv, localOffset + 26);
      const lfExtraLen = hwpxU16(dv, localOffset + 28);
      const dataStart = localOffset + 30 + lfNameLen + lfExtraLen;
      const compData = bytes.slice(dataStart, dataStart + compSize);
      if (method === 0) return hwpxDecodeUtf8(compData);
      if (method === 8) return hwpxDecodeUtf8(await hwpxInflateRaw(compData));
      throw new Error('지원하지 않는 압축 방식입니다: ' + method);
    }
    p += 46 + fileNameLen + extraLen + commentLen;
  }
  throw new Error(targetName + ' 파일을 HWPX 내부에서 찾지 못했습니다.');
}

function hwpxLocalChildren(node, name) { return Array.from(node.children).filter(function(e) { return e.localName === name; }); }
function hwpxLocalDesc(node, name) { return Array.from(node.getElementsByTagName('*')).filter(function(e) { return e.localName === name; }); }
function hwpxCellText(cell) { return hwpxLocalDesc(cell, 't').map(function(e) { return e.textContent || ''; }).join('').replace(/\s+/g, ' ').trim(); }

function hwpxExtractTables(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) throw new Error('XML 파싱 오류');
  return hwpxLocalDesc(doc, 'tbl').map(function(tbl) {
    return hwpxLocalChildren(tbl, 'tr').map(function(tr) { return hwpxLocalChildren(tr, 'tc').map(hwpxCellText); });
  });
}

function hwpxToNum(v) { return (v || '').trim(); }
function hwpxLooksDate(v) { return /^\d{1,2}\/\d{1,2}$/.test((v || '').trim()); }

function hwpxParseDaily(tables) {
  const table = tables.find(function(rows) {
    return rows.some(function(r) { return (r[0] || '').includes('요청호'); })
      && rows.some(function(r) { return (r[0] || '').includes('투입인원'); })
      && rows.some(function(r) { return (r[0] || '').includes('CPD'); });
  });
  if (!table) return [];
  const daily = [];
  for (let start = 0; start < table.length; start++) {
    const header = table[start];
    if (!header || !header[0] || !header[0].replace(/\s/g, '').includes('구분')) continue;
    const labels = table.slice(start + 1, start + 7);
    const find = function(kw) { return labels.find(function(r) { return (r[0] || '').includes(kw); }) || []; };
    const req = find('요청호'), ans = find('응답호'), rate = find('응대율'), aban = find('포기호'), staff = find('투입인원'), cpd = find('CPD');
    for (let i = 1; i < header.length; i++) {
      const date = (header[i] || '').trim();
      if (!hwpxLooksDate(date)) continue;
      daily.push({
        date: date,
        request: hwpxToNum(req[i]), answer: hwpxToNum(ans[i]), rate: hwpxToNum(rate[i]),
        abandoned: hwpxToNum(aban[i]), staff: hwpxToNum(staff[i]), cpd: hwpxToNum(cpd[i])
      });
    }
  }
  return daily;
}

// ============================================
// 엑셀(XLSX) 자동 추출 (kb_daily_visible_items_extractor_v2.html 로직 이식)
// XLSX도 ZIP 포맷이라 hwpxUnzipOne(단일 항목 추출)을 그대로 재사용한다.
// ============================================
const XLSX_FIELDS_KBSONHAE = [
  ['total', 'num1', ['총원']],
  ['rec_cs_total', 'num1', ['재적인원', '제휴CS', '소계']],
  ['rec_long_total', 'num1', ['재적인원', '장기사고', '소계']],
  ['input_cs', 'num1', ['투입인원', '제휴상담'], 0],
  ['input_cs_rate', 'pct1', ['투입인원', '제휴상담'], 1],
  ['input_long', 'num1', ['투입인원', '장기사고'], 0],
  ['input_long_rate', 'pct1', ['투입인원', '장기사고'], 1],
  ['chat', 'num1', ['기타업무', '채팅상담']],
  ['support', 'num1', ['기타업무', '지원업무']],
  ['lapse', 'num1', ['기타업무', '실효안내']],
  ['manager_team', 'num1', ['관리자', '팀장']],
  ['manager_special', 'num1', ['관리자', '특화']],
  ['manager_qa', 'num1', ['관리자', 'QA']],
  ['manager_total', 'num1', ['관리자', '소계']],
  ['trainee_total', 'num1', ['교육생', '소계']],
  ['exclude_hold', 'num1', ['제외', '보유계약']],
  ['cs_in', 'int', ['Call현황', '제휴상담', '인입호']],
  ['cs_answer', 'int', ['Call현황', '제휴상담', '응답호']],
  ['cs_support', 'int', ['Call현황', '제휴상담', '손사지원']],
  ['cs_out', 'int', ['Call현황', '제휴상담', 'OutCall']],
  ['cs_callback', 'int', ['Call현황', '제휴상담', '콜백']],
  ['cs_rate', 'pct1', ['Call현황', '제휴상담', '응답율']],
  ['cs_cpd', 'num1', ['Call현황', '제휴상담', 'CPD']],
  ['cs_sl', 'num1', ['Call현황', '제휴상담', 'S.L']],
  ['lt_in', 'int', ['Call현황', '장기손사', 'Total', '인입호']],
  ['lt_answer', 'int', ['Call현황', '장기손사', 'Total', '응답호']],
  ['lt_out', 'int', ['Call현황', '장기손사', 'Total', 'OutCall']],
  ['lt_callback', 'int', ['Call현황', '장기손사', 'Total', '콜백']],
  ['lt_rate', 'pct1', ['Call현황', '장기손사', 'Total', '응답율']],
  ['lt_cpd', 'num1', ['Call현황', '장기손사', 'Total', 'CPD']],
  ['lt_sl', 'num1', ['Call현황', '장기손사', 'Total', 'S.L']]
];

const XLSX_EXTRACTOR_FIELDS = { 'kbsonhae': XLSX_FIELDS_KBSONHAE };

// ============================================
// KB손보정비 - 장기계약정비센터 RAW 엑셀 자동추출
// long_contract_maintenance_auto_extractor.html 로직 이식
// ============================================
const LONG_CONTRACT_CENTERS = { 'kbjeongbi': true };
const LC_FLAT_KEYS = ['접수_고지의무', '접수_통지의무', '접수_목적물소멸', '접수_기타', '접수_Total', '처리_고지의무', '처리_통지의무', '처리_목적물소멸', '처리_기타', '처리_Total', '고지의무_변경기한일_대상건', '고지의무_변경기한일_처리건', '고지의무_변경기한일_미처리건', '통지의무_변경기한일_대상건', '통지의무_변경기한일_처리건', '통지의무_변경기한일_미처리건'];

function lcCleanHeader(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, '').trim(); }

function lcFindHeaderRow(sheet) {
  const required = ['처리구분', '의무위반사항', '요청일', '완료일', '변경기한일'];
  for (let r = 1; r <= Math.min(sheet.maxRow, 30); r++) {
    const rowVals = [];
    for (let c = 1; c <= sheet.maxCol; c++) rowVals.push(lcCleanHeader(xlsxGet(sheet.grid, r, c)));
    if (required.every(function(h) { return rowVals.includes(h); })) return r;
  }
  return -1;
}

function lcFindCol(sheet, headerRow, label) {
  const target = lcCleanHeader(label);
  for (let c = 1; c <= sheet.maxCol; c++) { if (lcCleanHeader(xlsxGet(sheet.grid, headerRow, c)) === target) return c; }
  return -1;
}

function lcNorm(v) { return String(v === null || v === undefined ? '' : v).replace(/[\s,，+＋\/／|·ㆍ]/g, '').trim(); }

function lcClassify(obligation, process) {
  const o = lcNorm(obligation), p = lcNorm(process);
  // "목적물소멸"이 의무위반사항/처리구분 어느 쪽 값에든 단어로 포함돼 있으면 하나의 목적물소멸 건으로 센다.
  // 예: "목적물소멸,담보소멸", "담보납입면제,목적물소멸,담보무효취소"처럼 다른 사유와 콤마로 같이 적혀 있어도 전부 포함.
  if (o.includes('목적물소멸') || p.includes('목적물소멸')) return '목적물소멸';
  if (o === '고지의무') return '고지의무';
  if (o === '통지의무') return '통지의무';
  return '기타';
}

function lcIsBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }

function lcExcelSerialToDate(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function lcToDateKey(v) {
  if (lcIsBlank(v)) return '';
  if (typeof v === 'number' && v > 25000 && v < 80000) return lcExcelSerialToDate(v);
  const s = String(v).trim();
  let m = s.match(/(20\d{2})[-.\/년\s]*(\d{1,2})[-.\/월\s]*(\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  m = s.match(/(\d{1,2})[-.\/]\s*(\d{1,2})/);
  if (m) return '1900-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
  return s;
}

function lcDisplayDate(dateKey) {
  const m = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (Number(m[2]) + '/' + Number(m[3])) : (dateKey || '');
}

function lcMakeEmptyRow() {
  const row = {};
  LC_FLAT_KEYS.forEach(function(k) { row[k] = 0; });
  return row;
}

function lcBuildDailyRows(records) {
  const dateSet = {};
  records.forEach(function(r) { if (r.requestDate) dateSet[r.requestDate] = true; if (r.dueDate) dateSet[r.dueDate] = true; });
  const rowsByDate = {};
  Object.keys(dateSet).sort().forEach(function(d) { rowsByDate[d] = lcMakeEmptyRow(); });
  records.forEach(function(r) {
    if (r.requestDate && rowsByDate[r.requestDate]) {
      const row = rowsByDate[r.requestDate];
      row['접수_' + r.category]++; row['접수_Total']++;
      if (r.done) { row['처리_' + r.category]++; row['처리_Total']++; }
    }
    if (r.dueDate && rowsByDate[r.dueDate] && (lcNorm(r.obligation) === '고지의무' || lcNorm(r.obligation) === '통지의무')) {
      const base = lcNorm(r.obligation) === '고지의무' ? '고지의무_변경기한일' : '통지의무_변경기한일';
      const row = rowsByDate[r.dueDate];
      row[base + '_대상건']++;
      if (r.done) row[base + '_처리건']++; else row[base + '_미처리건']++;
    }
  });
  return Object.keys(rowsByDate).sort().map(function(d) { return { dateKey: d, values: rowsByDate[d] }; });
}

async function extractLongContractAndFill() {
  const statusEl = document.getElementById('lcStatus');
  const fileInput = document.getElementById('lcFile');
  const f = fileInput.files[0];
  if (!f) { statusEl.className = 'status-msg err'; statusEl.textContent = '먼저 .xlsx 파일을 선택해 주세요.'; return; }
  pendingPerfArchiveFile = f; // 실제 저장 성공 시 업로드

  statusEl.className = 'status-msg';
  statusEl.textContent = '엑셀 파일을 읽는 중...';
  try {
    const workbook = await xlsxParseWorkbook(await f.arrayBuffer());
    // 필수 컬럼을 가진 시트가 여러 개(예: 월별로 시트가 나뉜 파일)면 첫 번째 시트만 읽고 나머지를 버리던 버그가 있었음 —
    // 이제 조건을 만족하는 시트를 전부 찾아서 각각 파싱한 뒤 레코드를 합친다.
    const matchingSheets = [];
    for (let i = 0; i < workbook.sheets.length; i++) {
      const hr = lcFindHeaderRow(workbook.sheets[i]);
      if (hr > 0) matchingSheets.push({ sheet: workbook.sheets[i], headerRow: hr });
    }
    if (matchingSheets.length === 0) throw new Error('필수 컬럼(처리구분, 의무위반사항, 요청일, 완료일, 변경기한일)을 가진 시트를 찾지 못했습니다.');

    const records = [];
    matchingSheets.forEach(function(ms) {
      const target = ms.sheet, headerRow = ms.headerRow;
      const colObligation = lcFindCol(target, headerRow, '의무위반사항');
      const colProcess = lcFindCol(target, headerRow, '처리구분');
      const colRequest = lcFindCol(target, headerRow, '요청일');
      const colComplete = lcFindCol(target, headerRow, '완료일');
      const colDue = lcFindCol(target, headerRow, '변경기한일');
      for (let r = headerRow + 1; r <= target.maxRow; r++) {
        const obligation = String(xlsxGet(target.grid, r, colObligation) || '').trim();
        const process = String(xlsxGet(target.grid, r, colProcess) || '').trim();
        // 여러 조회결과를 이어붙인 원본 파일은 중간에 헤더 행이 그대로 다시 끼어있는 경우가 있다(실제 파일에서 확인됨).
        // 이 행을 데이터로 취급하면 "요청일"이라는 글자가 그대로 날짜 값으로 들어가 정렬 시 맨 뒤로 밀리며 깨진 항목이 생긴다.
        if (lcCleanHeader(obligation) === '의무위반사항' && lcCleanHeader(process) === '처리구분') continue;
        const requestDate = lcToDateKey(xlsxGet(target.grid, r, colRequest));
        const completeDate = lcToDateKey(xlsxGet(target.grid, r, colComplete));
        const dueDate = lcToDateKey(xlsxGet(target.grid, r, colDue));
        if (lcIsBlank(obligation) && lcIsBlank(process) && lcIsBlank(requestDate) && lcIsBlank(completeDate) && lcIsBlank(dueDate)) continue;
        records.push({ obligation: obligation, process: process, requestDate: requestDate, completeDate: completeDate, dueDate: dueDate, category: lcClassify(obligation, process), done: !lcIsBlank(completeDate) });
      }
    });
    if (records.length === 0) throw new Error('집계 가능한 데이터 행을 찾지 못했습니다.');
    const sheetNote = matchingSheets.length > 1 ? (' · ' + matchingSheets.length + '개 시트(' + matchingSheets.map(function(ms) { return ms.sheet.name; }).join(', ') + ') 합산') : '';

    let dailyRows = lcBuildDailyRows(records);
    const rangeStartVal = document.getElementById('lcStart').value;
    const rangeEndVal = document.getElementById('lcEnd').value;
    if (rangeStartVal && rangeEndVal && rangeStartVal > rangeEndVal) throw new Error('추출 시작일이 종료일보다 늦을 수 없습니다.');
    const fullRangeNote = ' (파일 내 전체 기간 ' + (dailyRows.length ? dailyRows[0].dateKey + ' ~ ' + dailyRows[dailyRows.length - 1].dateKey : '-') + ')';
    if (rangeStartVal || rangeEndVal) {
      dailyRows = dailyRows.filter(function(row) {
        return (!rangeStartVal || row.dateKey >= rangeStartVal) && (!rangeEndVal || row.dateKey <= rangeEndVal);
      });
      if (dailyRows.length === 0) throw new Error('지정한 기간에 해당하는 데이터가 없습니다.' + fullRangeNote);
    }
    const lines = dailyRows.map(function(row) {
      const dateLabel = lcDisplayDate(row.dateKey);
      const values = LC_FLAT_KEYS.map(function(k) { return row.values[k]; });
      return dateLabel + '\t' + values.join('\t');
    });
    document.getElementById('pasteBox').value = lines.join('\n');
    statusEl.className = 'status-msg ok';
    statusEl.textContent = dailyRows.length + '일치 추출 완료(원본 ' + records.length + '건)' + ((rangeStartVal || rangeEndVal) ? ' · 지정 기간만 반영' : '') + fullRangeNote + sheetNote + '. 직접입력 화면으로 이동해 표를 채웠습니다. 확인 후 "전체 저장"을 눌러 실적을 먼저 저장해 주세요(근태는 별도로 "재직 및 투입현황" 탭에서 저장합니다).';
    selectEntryMethod('paste');
    parseMultiPaste();
    const lcDates = dailyRows.map(function(row) { return row.dateKey; }).sort();
    promptGoToAttendance(lcDates[0], lcDates[lcDates.length - 1]);
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '추출 실패: ' + e.message;
  }
}

function xlsxRefToRc(ref) { const m = /([A-Z]+)(\d+)/.exec(ref); return [Number(m[2]), xlsxColToNum(m[1])]; }
function xlsxColToNum(s) { let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
function xlsxRangeToCoords(ref) { const parts = ref.split(':'); const a = xlsxRefToRc(parts[0]), b = xlsxRefToRc(parts[1]); return { r1: a[0], c1: a[1], r2: b[0], c2: b[1] }; }
function xlsxGet(grid, r, c) { return grid.get(r + ',' + c); }
function xlsxClean(v) { return String(v === null || v === undefined ? '' : v).replace(/[\n\r\s_]/g, '').trim(); }
function xlsxIsBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }
function xlsxIsBlankOrZero(v) { return xlsxIsBlank(v) || Number(v) === 0; }
function xlsxIsDateSerial(v) { return typeof v === 'number' && v > 40000 && v < 60000; }
function xlsxExcelDate(v) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86400000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }
function xlsxNormalizeDate(v) {
  if (xlsxIsDateSerial(v)) return xlsxExcelDate(v);
  const s = String(v === null || v === undefined ? '' : v).trim();
  const m = s.match(/(\d{1,2})\s*[\/.-]\s*(\d{1,2})/);
  return m ? (Number(m[1]) + '/' + Number(m[2])) : '';
}
function xlsxDateScore(grid, c, hdr, maxRow) { let n = 0; for (let r = hdr + 3; r <= maxRow; r++) { if (xlsxIsDateSerial(xlsxGet(grid, r, c))) n++; } return n; }

function xlsxParseSheet(doc, shared) {
  const grid = new Map();
  Array.from(doc.getElementsByTagName('c')).forEach(function(c) {
    const ref = c.getAttribute('r'); if (!ref) return;
    const rc = xlsxRefToRc(ref);
    const type = c.getAttribute('t');
    let val = null;
    const vNode = Array.from(c.childNodes).find(function(n) { return n.nodeName === 'v'; });
    if (type === 's') {
      val = vNode && vNode.textContent !== '' ? (shared[Number(vNode.textContent)] || '') : '';
    } else if (type === 'inlineStr') {
      val = Array.from(c.getElementsByTagName('t')).map(function(t) { return t.textContent || ''; }).join('');
    } else if (vNode && vNode.textContent !== null && vNode.textContent !== '') {
      const n = Number(vNode.textContent);
      val = isFinite(n) ? n : vNode.textContent;
    }
    if (val !== null) grid.set(rc[0] + ',' + rc[1], val);
  });
  const merges = [];
  Array.from(doc.getElementsByTagName('mergeCell')).forEach(function(mc) { merges.push(xlsxRangeToCoords(mc.getAttribute('ref'))); });
  merges.forEach(function(m) {
    const key = m.r1 + ',' + m.c1;
    if (!grid.has(key)) return;
    const val = grid.get(key);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) { const k = r + ',' + c; if (!grid.has(k)) grid.set(k, val); }
  });
  let maxRow = 0, maxCol = 0;
  grid.forEach(function(v, k) { const parts = k.split(','); const r = Number(parts[0]), c = Number(parts[1]); if (r > maxRow) maxRow = r; if (c > maxCol) maxCol = c; });
  return { grid: grid, maxRow: maxRow, maxCol: maxCol };
}

async function xlsxParseWorkbook(arrayBuffer) {
  const wbXmlText = await hwpxUnzipOne(arrayBuffer, 'xl/workbook.xml');
  const relXmlText = await hwpxUnzipOne(arrayBuffer, 'xl/_rels/workbook.xml.rels');
  let sharedStrings = [];
  try {
    const sstText = await hwpxUnzipOne(arrayBuffer, 'xl/sharedStrings.xml');
    const sstDoc = new DOMParser().parseFromString(sstText, 'application/xml');
    sharedStrings = Array.from(sstDoc.getElementsByTagName('si')).map(function(si) { return si.textContent || ''; });
  } catch (e) { /* 공유문자열이 없는 파일도 있음 */ }

  const wbDoc = new DOMParser().parseFromString(wbXmlText, 'application/xml');
  const relDoc = new DOMParser().parseFromString(relXmlText, 'application/xml');
  const relMap = {};
  Array.from(relDoc.getElementsByTagName('Relationship')).forEach(function(rel) {
    relMap[rel.getAttribute('Id')] = 'xl/' + rel.getAttribute('Target').replace(/^\.?\//, '');
  });

  const sheets = [];
  const sheetEls = Array.from(wbDoc.getElementsByTagName('sheet'));
  for (let i = 0; i < sheetEls.length; i++) {
    const sh = sheetEls[i];
    const name = sh.getAttribute('name');
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = relMap[rid];
    if (!target) continue;
    let sheetXmlText;
    try { sheetXmlText = await hwpxUnzipOne(arrayBuffer, target); } catch (e) { continue; }
    const sheetDoc = new DOMParser().parseFromString(sheetXmlText, 'application/xml');
    const parsed = xlsxParseSheet(sheetDoc, sharedStrings);
    sheets.push({ name: name, grid: parsed.grid, maxRow: parsed.maxRow, maxCol: parsed.maxCol });
  }
  return { sheets: sheets };
}

function xlsxExtractDaily(workbook, fields) {
  const allRows = [];
  workbook.sheets.forEach(function(sheet) {
    const grid = sheet.grid, maxRow = sheet.maxRow, maxCol = sheet.maxCol;
    let hdr = null;
    for (let r = 1; r <= Math.min(maxRow, 12); r++) {
      let text = '';
      for (let c = 1; c <= maxCol; c++) { const v = xlsxGet(grid, r, c); text += ' ' + String(v === null || v === undefined ? '' : v).replace(/[\n\r]/g, ''); }
      if (text.includes('일자') && (text.includes('Call') || text.includes('콜'))) { hdr = r; break; }
    }
    if (!hdr) return;

    // "출근현황" 요약박스(월별 스냅샷)가 메인 표 아래쪽에 별도로 있고, 날짜 열이 메인 표와 겹쳐
    // 별도 날짜 데이터로 잘못 추출되는 문제가 있어, 이 박스가 시작되는 행 이후는 통째로 제외한다.
    let attendanceBoxRow = null;
    for (let r = hdr + 1; r <= maxRow && !attendanceBoxRow; r++) {
      for (let c = 1; c <= maxCol; c++) {
        const v = xlsxGet(grid, r, c);
        if (v && String(v).replace(/[\n\r\s]/g, '').includes('출근현황')) { attendanceBoxRow = r; break; }
      }
    }
    const effectiveMaxRow = attendanceBoxRow ? attendanceBoxRow - 1 : maxRow;

    const paths = {};
    for (let c = 1; c <= maxCol; c++) {
      const arr = [];
      for (let r = hdr; r <= hdr + 2; r++) { const v = xlsxGet(grid, r, c); if (!xlsxIsBlank(v)) arr.push(xlsxClean(v)); }
      if (arr.join('|').includes('출근')) continue;
      paths[c] = arr;
    }
    function findCols(tokens) {
      const res = [];
      Object.keys(paths).forEach(function(c) {
        const joined = paths[c].join('|');
        if (tokens.every(function(t) { return joined.includes(t); })) res.push(Number(c));
      });
      return res.sort(function(a, b) { return a - b; });
    }

    const dateCandidates = findCols(['일자']);
    const dateCol = dateCandidates.slice().sort(function(a, b) { return xlsxDateScore(grid, b, hdr, effectiveMaxRow) - xlsxDateScore(grid, a, hdr, effectiveMaxRow); })[0] || null;

    const colMap = {};
    fields.forEach(function(f) {
      const arr = findCols(f[2]);
      colMap[f[0]] = arr[f[3] || 0] || null;
    });

    for (let r = hdr + 3; r <= effectiveMaxRow; r++) {
      const dv = dateCol ? xlsxGet(grid, r, dateCol) : null;
      const date = xlsxNormalizeDate(dv);
      if (!date) continue;
      if (['합계', '평균'].indexOf(String(dv).trim()) > -1) continue;

      const obj = { date: date };
      fields.forEach(function(f) {
        const c = colMap[f[0]];
        obj[f[0]] = c ? xlsxGet(grid, r, c) : null;
      });
      if (xlsxIsBlankOrZero(obj.cs_in) && xlsxIsBlankOrZero(obj.lt_in)) continue; // Call 현황이 비어있거나 인입호가 0인 행은 제외
      allRows.push(obj);
    }
  });
  return allRows;
}

function xlsxFmtValue(v, type) {
  if (xlsxIsBlank(v)) return '';
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  if (type === 'pct1') return (n * 100).toFixed(1) + '%';
  if (type === 'int') return Math.round(n).toLocaleString('ko-KR');
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString('ko-KR', { minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1, maximumFractionDigits: 1 });
}

// 엑셀 양식이 바뀌어 기본 헤더 키워드(XLSX_EXTRACTOR_FIELDS)로 못 찾을 때, AI가 제안하고 사용자가 저장한
// 대체 키워드를 센터별로 캐시해뒀다가 기본값 위에 덮어써서 사용한다.
let xlsxFieldOverrideCache = {}; // { centerCode: { field_key: [tokens...] } }

function getEffectiveXlsxFields(centerCode) {
  const base = XLSX_EXTRACTOR_FIELDS[centerCode];
  if (!base) return base;
  const override = xlsxFieldOverrideCache[centerCode];
  if (!override) return base;
  return base.map(function(f) {
    const newTokens = override[f[0]];
    return (newTokens && newTokens.length) ? [f[0], f[1], newTokens, f[3]] : f;
  });
}

async function loadXlsxFieldOverride(centerCode) {
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=get-xlsx-field-override&center_code=' + encodeURIComponent(centerCode) + '&token=' + encodeURIComponent(centerTokenMap[centerCode] || ''), {
      headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }
    });
    const data = await res.json();
    if (data.success) xlsxFieldOverrideCache[centerCode] = data.override || null;
  } catch (e) { /* 저장된 override가 없거나 조회 실패해도 기본값으로 계속 동작 */ }
}

function xlsxReadHeaderBlockText(workbook) {
  // AI에게 보여줄 헤더 추정 구간(시트별 최대 12행)을 사람이 읽기 쉬운 표 텍스트로 변환
  const blocks = [];
  workbook.sheets.forEach(function(sheet, si) {
    const rows = [];
    for (let r = 1; r <= Math.min(sheet.maxRow, 12); r++) {
      const cells = [];
      for (let c = 1; c <= Math.min(sheet.maxCol, 40); c++) {
        const v = xlsxGet(sheet.grid, r, c);
        cells.push(v === null || v === undefined ? '' : String(v));
      }
      rows.push((r) + '행: ' + cells.join(' | '));
    }
    blocks.push('[시트 ' + (si + 1) + ']\n' + rows.join('\n'));
  });
  return blocks.join('\n\n');
}

// 엑셀 자동추출이 실패했을 때(또는 사용자가 직접 요청할 때) AI에게 헤더 구조를 보여주고
// 새 헤더 키워드 매핑을 제안받는다. 서강MOT API 우선 → 실패 시 Claude API로 자동 전환(백엔드 처리, 사용자는 결과만 받음).
async function aiAnalyzeXlsxFormat() {
  const statusEl = document.getElementById('xlsxStatus');
  const fileInput = document.getElementById('xlsxFile');
  const f = fileInput && fileInput.files[0];
  if (!f) { statusEl.className = 'status-msg err'; statusEl.textContent = '먼저 .xlsx 파일을 선택해 주세요.'; return; }
  const fields = XLSX_EXTRACTOR_FIELDS[currentCenter];
  statusEl.className = 'status-msg';
  statusEl.textContent = '🤖 AI가 엑셀 헤더 구조를 분석하는 중입니다... (최대 20초)';
  try {
    const workbook = await xlsxParseWorkbook(await f.arrayBuffer());
    const headerText = xlsxReadHeaderBlockText(workbook);
    const fieldDefs = fields.map(function(fd) { return { field_key: fd[0], expected_tokens: fd[2] }; });
    const res = await fetch(SB_FUNCTION_URL + '?action=ai-suggest-xlsx-mapping', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, token: centerTokenMap[currentCenter], center_code: currentCenter, header_text: headerText, field_defs: fieldDefs })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'AI 분석 실패');
    renderXlsxMappingReview(data.diagnosis || '', data.suggested_mapping || []);
  } catch (e) {
    statusEl.className = 'status-msg';
    statusEl.innerHTML = renderAiUnavailableNotice(e.message, '엑셀 파일을 직접 열어 날짜·데이터가 있는 열을 확인하신 뒤, "직접입력" 방식으로 표에 붙여넣어 저장해 주세요. 자동추출·저장 기능 자체는 AI와 무관하게 그대로 사용하실 수 있습니다.');
  }
}

function renderXlsxMappingReview(diagnosis, mapping) {
  const statusEl = document.getElementById('xlsxStatus');
  const rows = mapping.map(function(m) {
    return '<tr><td style="padding:4px 8px;">' + escapeHtml(m.field_key) + '</td>'
      + '<td style="padding:4px 8px;"><input type="text" class="xlsx-map-input" data-key="' + escapeHtml(m.field_key) + '" value="' + escapeHtml((m.suggested_tokens || []).join(', ')) + '" style="width:100%;padding:4px 6px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;background:#111113;color:#f5f5f7;box-sizing:border-box;"></td></tr>';
  }).join('');
  statusEl.className = 'status-msg';
  statusEl.innerHTML = '<div class="panel" style="background:rgba(0,165,255,.08);border:1px solid rgba(0,165,255,.3);padding:14px 16px;margin-top:10px;">'
    + '<div style="font-size:12px;color:#5ac8fa;font-weight:700;margin-bottom:6px;">🤖 AI 양식 분석 결과</div>'
    + '<div style="font-size:13px;line-height:1.6;white-space:pre-wrap;margin-bottom:10px;">' + escapeHtml(diagnosis) + '</div>'
    + (rows ? '<div class="table-scroll"><table style="width:100%;font-size:12px;margin-bottom:10px;"><thead><tr><th style="text-align:left;padding:4px 8px;">필드</th><th style="text-align:left;padding:4px 8px;">이 파일에서 찾은 헤더 키워드(쉼표로 구분 · 필요하면 직접 수정)</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '')
    + (rows ? '<button class="btn-primary" onclick="applyXlsxMapping()">이 매핑 저장하고 다시 추출</button>' : '')
    + '</div>';
}

async function applyXlsxMapping() {
  const statusEl = document.getElementById('xlsxStatus');
  const inputs = document.querySelectorAll('.xlsx-map-input');
  const override = {};
  inputs.forEach(function(inp) {
    const tokens = inp.value.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    if (tokens.length) override[inp.dataset.key] = tokens;
  });
  statusEl.className = 'status-msg';
  statusEl.textContent = '매핑 저장 중...';
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=save-xlsx-field-override', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_password: workspacePasswordCache, token: centerTokenMap[currentCenter], center_code: currentCenter, override: override })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '저장 실패');
    xlsxFieldOverrideCache[currentCenter] = override;
    statusEl.className = 'status-msg ok';
    statusEl.textContent = '매핑을 저장했습니다. 다음부터는 이 키워드로 자동 인식됩니다. 다시 추출합니다...';
    await extractXlsxAndFill();
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '매핑 저장 실패: ' + e.message;
  }
}

async function extractXlsxAndFill() {
  const statusEl = document.getElementById('xlsxStatus');
  const fileInput = document.getElementById('xlsxFile');
  const f = fileInput.files[0];
  if (!f) { statusEl.className = 'status-msg err'; statusEl.textContent = '먼저 .xlsx 파일을 선택해 주세요.'; return; }
  pendingPerfArchiveFile = f; // 실제 저장 성공 시 업로드

  const fields = getEffectiveXlsxFields(currentCenter);
  statusEl.className = 'status-msg';
  statusEl.textContent = '엑셀 파일을 읽는 중...';
  try {
    const workbook = await xlsxParseWorkbook(await f.arrayBuffer());
    let daily = xlsxExtractDaily(workbook, fields);
    if (daily.length === 0) {
      statusEl.className = 'status-msg err';
      statusEl.innerHTML = '일자별 데이터를 찾지 못했습니다. 문서 양식이 바뀌었을 수 있습니다.'
        + ' <button class="btn-secondary" style="padding:4px 10px;font-size:12px;margin-left:6px;" onclick="aiAnalyzeXlsxFormat()">🤖 AI로 양식 분석하기</button>';
      return;
    }

    const year = document.getElementById('entryYear').value;
    const rangeStartVal = document.getElementById('xlsxStart').value;
    const rangeEndVal = document.getElementById('xlsxEnd').value;
    if (rangeStartVal && rangeEndVal && rangeStartVal > rangeEndVal) throw new Error('추출 시작일이 종료일보다 늦을 수 없습니다.');
    if (rangeStartVal || rangeEndVal) {
      daily = daily.filter(function(row) {
        const iso = toIsoDate(row.date, year);
        if (!iso) return true; // 날짜 변환 실패시 안전하게 포함(누락 방지)
        return (!rangeStartVal || iso >= rangeStartVal) && (!rangeEndVal || iso <= rangeEndVal);
      });
      if (daily.length === 0) throw new Error('지정한 기간에 해당하는 데이터가 없습니다.');
    }

    const lines = daily.map(function(row) {
      const values = fields.map(function(f) { return xlsxFmtValue(row[f[0]], f[1]); });
      return row.date + '\t' + values.join('\t');
    });
    document.getElementById('pasteBox').value = lines.join('\n');
    statusEl.className = 'status-msg ok';
    statusEl.textContent = daily.length + '일치 추출 완료' + ((rangeStartVal || rangeEndVal) ? ' · 지정 기간만 반영' : '') + '. 직접입력 화면으로 이동해 표를 채웠습니다. 확인 후 "전체 저장"을 눌러주세요.';
    selectEntryMethod('paste');
    parseMultiPaste();
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '추출 실패: ' + e.message;
  }
}

async function extractHwpxAndFill() {
  const statusEl = document.getElementById('hwpxStatus');
  const fileInput = document.getElementById('hwpxFile');
  const f = fileInput.files[0];
  if (!f) { statusEl.className = 'status-msg err'; statusEl.textContent = '먼저 .hwpx 파일을 선택해 주세요.'; return; }
  pendingPerfArchiveFile = f; // 실제 저장 성공 시 업로드

  const fieldOrder = HWPX_FIELD_ORDER[currentCenter];
  statusEl.className = 'status-msg';
  statusEl.textContent = 'HWPX 파일을 읽는 중...';
  try {
    const xml = await hwpxUnzipOne(await f.arrayBuffer(), 'Contents/section0.xml');
    const tables = hwpxExtractTables(xml);
    const daily = hwpxParseDaily(tables);
    if (daily.length === 0) throw new Error('일자별 데이터를 찾지 못했습니다. 문서 양식이 다를 수 있습니다.');

    const lines = daily.map(function(row) {
      const values = fieldOrder.map(function(f) { return row[f] !== undefined ? row[f] : ''; });
      return row.date + '\t' + values.join('\t');
    });
    document.getElementById('pasteBox').value = lines.join('\n');
    statusEl.className = 'status-msg ok';
    statusEl.textContent = daily.length + '일치 추출 완료. 직접입력 화면으로 이동해 표를 채웠습니다. 확인 후 "전체 저장"을 눌러주세요.';
    selectEntryMethod('paste');
    parseMultiPaste();
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '추출 실패: ' + e.message;
  }
}

// 데이터입력 화면의 선택카드(엑셀추출/직접입력/근태/업무유형별) 중 하나만 펼쳐서 보여준다
function selectEntryMethod(id) {
  document.querySelectorAll('.entry-pill').forEach(function(p) { p.classList.toggle('sel', p.dataset.mid === id); });
  document.querySelectorAll('.entry-method-body').forEach(function(b) { b.style.display = (b.dataset.mid === id) ? '' : 'none'; });
}

// 실적 자동추출이 끝난 뒤, 이 센터에 "재직 및 투입현황" 입력이 있으면 이어서 바로 작업하도록 안내하고 이동시킨다.
// KB손보정비는 실적/근태를 완전히 분리하는 센터라서 자동으로 이동시키지 않는다 —
// 사용자가 "일자별 실적 직접입력"에서 실적을 먼저 확인·저장한 뒤, 필요할 때 직접 "재직 및 투입현황" 탭을 눌러 이동한다.
// 다만 기간은 미리 기억해뒀다가(pendingAttRange) 나중에 그 탭을 열면 자동으로 채워지도록 편의는 유지한다.
function promptGoToAttendance(rangeStart, rangeEnd) {
  if (!ATTENDANCE_SEMI_AUTO[currentCenter]) return;
  if (currentCenter === 'kbjeongbi') {
    if (rangeStart && rangeEnd) pendingAttRange = { start: rangeStart, end: rangeEnd };
    return;
  }
  if (confirm('채우기 완료되었습니다. 재직 및 투입현황 입력 후 저장 눌러주세요.\n\n확인을 누르면 재직 및 투입현황 화면으로 이동합니다.')) {
    // 엑셀 자동추출에서 사용한 기간(시작일~종료일)을 재직 및 투입현황에도 그대로 가져와 바로 이어서 작업할 수 있게 한다.
    // pendingAttRange는 패널이 다시 그려지는 경우에도 기본값으로 사용되는 안전장치, 아래 직접 DOM 값 설정은 즉시 반영용.
    if (rangeStart && rangeEnd) pendingAttRange = { start: rangeStart, end: rangeEnd };
    selectEntryMethod('att');
    if (rangeStart && rangeEnd) {
      const startEl = document.getElementById('attStart');
      const endEl = document.getElementById('attEnd');
      if (startEl && endEl) {
        startEl.value = rangeStart;
        endEl.value = rangeEnd;
        generateAttRangeRows();
      }
    }
    const el = document.querySelector('.entry-method-body[data-mid="att"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ============================================
// LG전자통합: 파일첨부 없이 항목별 숫자 입력 전용 폼
// ============================================
let lgeTotalDates = []; // 현재 화면에 생성된 날짜 목록(YYYY-MM-DD, 오름차순)

// 통화시간처럼 duration:true인 실적 입력칸: 숫자만 입력하고 포커스를 벗어나면(blur) 오른쪽부터 초/분/시로 나눠
// H:MM:SS로 자동 변환한다. 예: 40000 -> 4:00:00, 400 -> 0:04:00. 이미 콜론이 들어간 값은 건드리지 않는다.
function formatDurationOnBlur(el) {
  const raw = el.value.trim();
  if (!raw || raw.indexOf(':') !== -1) return;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return;
  const ss = digits.slice(-2).padStart(2, '0');
  const mm = digits.slice(-4, -2).padStart(2, '0');
  const hh = digits.slice(0, -4);
  el.value = (hh === '' ? '0' : String(Number(hh))) + ':' + mm + ':' + ss;
}

function renderIntegratedFormEntry() {
  const today = localDateStr(new Date());
  const monthlyAvgFields = LGE_TOTAL_PERF_METRICS.map(function(m) {
    return '<div><label style="font-size:11px;color:#a1a1a6;display:block;margin-bottom:3px;">' + m.label + '</label>'
      + '<input type="text" class="lge-total-monthly-avg" data-metric="' + m.key + '" placeholder="' + (m.duration ? '4:00:00' : '') + '"' + (m.duration ? ' onblur="formatDurationOnBlur(this)"' : '') + ' style="width:80px;padding:5px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;background:#111113;color:#f5f5f7;">'
      + '</div>';
  }).join('');
  return '<div class="entry-wrap panel">'
    + '<h3>LG전자통합 일자별 입력</h3>'
    + '<p style="font-size:13px;color:#a1a1a6;margin:10px 0 6px;">TO·AS재직인원·성수기재직인원·상담사투입인원은 직전 저장된 날짜의 값을 기본으로 채워줍니다(인원변동이 있을 때만 수정하면 됩니다). 총재직인원·각 항목의 합계는 화면에 따로 표시하지 않고 저장할 때 자동으로 계산되어 반영됩니다. T-NPS·생산성·통화시간은 매일 새로 입력합니다. 날짜별 체크박스를 체크하면 저장할 때 그 날짜만 제외됩니다.</p>'
    + '<div style="max-width:640px;margin-bottom:14px;padding:12px;border:1px solid #2c2c2e;border-radius:10px;background:rgba(90,200,250,.05);">'
    + '<div style="font-size:12px;font-weight:600;color:#5ac8fa;margin-bottom:8px;">이번 달 월평균 실적 입력 (선택 — 값을 넣으면 선택한 달의 1일 데이터에 별도 항목으로 저장됩니다)</div>'
    + '<div class="entry-row"><label>대상 월</label><input type="month" id="lgeTotalAvgMonth" value="' + today.slice(0, 7) + '" onchange="refreshLgeTotalMonthlyAvgInputs()"></div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + monthlyAvgFields + '</div>'
    + '</div>'
    + '<div class="entry-row"><label>시작일</label><input type="date" id="lgeTotalStart" value="' + today + '"></div>'
    + '<div class="entry-row"><label>종료일</label><input type="date" id="lgeTotalEnd" value="' + today + '"></div>'
    + '<button class="btn-secondary" onclick="generateLgeTotalRows()">기간 적용</button>'
    + '<button class="btn-primary" id="lgeTotalSaveBtn" style="display:none;" onclick="saveLgeTotalRows()">전체 저장</button>'
    + '<div class="status-msg" id="lgeTotalStatus"></div>'
    + '<div id="lgeTotalTemplateArea" style="margin-top:16px;"></div>'
    + '</div>';
}

// 월평균 입력칸의 "대상 월"이 참조하는 report_date(그 달 1일)
function lgeTotalAvgMonthDate() {
  const v = document.getElementById('lgeTotalAvgMonth') ? document.getElementById('lgeTotalAvgMonth').value : '';
  return v ? v + '-01' : '';
}

// "대상 월"을 고르거나 화면이 처음 열릴 때, 그 달 1일에 이미 저장된 월평균 값이 있으면 불러와서 채운다.
async function refreshLgeTotalMonthlyAvgInputs() {
  const monthDate = lgeTotalAvgMonthDate();
  if (!monthDate) return;
  const rows = await lgeTotalFetchHistory();
  const row = rows.find(function(r) { return r.report_date === monthDate; }) || null;
  const perf = (row && row.performance_data) || {};
  LGE_TOTAL_PERF_METRICS.forEach(function(m) {
    const inp = document.querySelector('.lge-total-monthly-avg[data-metric="' + m.key + '"]');
    if (!inp) return;
    const raw = perf[m.key + '_월평균'];
    inp.value = (raw === undefined || raw === null) ? '' : (m.duration ? formatSecondsHMS(raw) : raw);
  });
}

function lgeTotalDateRange(start, end) {
  const dates = [];
  let d = new Date(start + 'T00:00:00');
  const endD = new Date(end + 'T00:00:00');
  while (d <= endD) {
    dates.push(localDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// 최근 30일 이력 전체를 가져온다(이월 시작값 조회 + 월평균 기존값 조회에 함께 사용)
async function lgeTotalFetchHistory() {
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=history&token=' + encodeURIComponent(centerTokenMap['lge_total']) + '&_ts=' + Date.now(), {
      headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store'
    });
    const data = await res.json();
    return (data.success && data.rows) ? data.rows : [];
  } catch (e) { return []; }
}

// 총재직인원처럼 다른 항목의 합계를 그대로 가져오는 파생 항목은 표에 표시하지 않는다(저장 시에만 자동 계산).
const LGE_TOTAL_VISIBLE_ATT_METRICS = LGE_TOTAL_ATT_METRICS.filter(function(m) { return !m.derivedFrom; });

async function generateLgeTotalRows() {
  const statusEl = document.getElementById('lgeTotalStatus');
  const start = document.getElementById('lgeTotalStart').value;
  const end = document.getElementById('lgeTotalEnd').value;
  if (!start || !end) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일과 종료일을 입력해 주세요.'; return; }
  if (start > end) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일이 종료일보다 늦을 수 없습니다.'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = '직전 저장 데이터를 확인하는 중...';

  lgeTotalDates = lgeTotalDateRange(start, end);
  const historyRows = await lgeTotalFetchHistory();
  const seed = historyRows.filter(function(r) { return r.report_date < start; })
    .sort(function(a, b) { return a.report_date < b.report_date ? 1 : -1; })[0] || null;

  // 이월 시작값(carry): 화면에 보이는 직접입력 항목(TO/AS재직인원/성수기재직인원/상담사투입인원)만 채운다.
  const att = (seed && seed.attendance_data) || {};
  let carry = {};
  LGE_TOTAL_VISIBLE_ATT_METRICS.forEach(function(m) {
    carry[m.key] = {};
    m.parts.forEach(function(p) { carry[m.key][p] = att[m.key + '_' + p] !== undefined ? att[m.key + '_' + p] : ''; });
  });

  const area = document.getElementById('lgeTotalTemplateArea');
  const attHeaderCells = LGE_TOTAL_VISIBLE_ATT_METRICS.map(function(m) {
    return '<th colspan="2" style="text-align:center;background:rgba(90,200,250,.12);">' + m.label + '</th>';
  }).join('');
  const attSubHeaderCells = LGE_TOTAL_VISIBLE_ATT_METRICS.map(function(m) {
    return '<th style="font-size:11px;">' + m.parts[0] + '</th><th style="font-size:11px;">' + m.parts[1] + '</th>';
  }).join('');
  const perfHeaderCells = LGE_TOTAL_PERF_METRICS.map(function(m) { return '<th rowspan="2">' + m.label + '</th>'; }).join('');

  const bodyRows = lgeTotalDates.map(function(date, ri) {
    const attCells = LGE_TOTAL_VISIBLE_ATT_METRICS.map(function(m) {
      const v0 = carry[m.key][m.parts[0]];
      const v1 = carry[m.key][m.parts[1]];
      const style = 'width:56px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;';
      return '<td><input type="number" class="lge-total-input" data-row="' + ri + '" data-metric="' + m.key + '" data-part="' + m.parts[0] + '" value="' + v0 + '" style="' + style + '"></td>'
        + '<td><input type="number" class="lge-total-input" data-row="' + ri + '" data-metric="' + m.key + '" data-part="' + m.parts[1] + '" value="' + v1 + '" style="' + style + '"></td>';
    }).join('');
    const perfCells = LGE_TOTAL_PERF_METRICS.map(function(m) {
      return '<td><input type="text" class="lge-total-perf" data-row="' + ri + '" data-metric="' + m.key + '" placeholder="' + (m.duration ? '4:00:00' : '') + '"' + (m.duration ? ' onblur="formatDurationOnBlur(this)"' : '') + ' style="width:64px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>';
    }).join('');
    return '<tr><td style="position:sticky;left:0;background:#1d1d1f;text-align:center;"><input type="checkbox" class="lge-total-exclude" data-row="' + ri + '" title="체크하면 저장 시 이 날짜를 제외합니다" onchange="lgeTotalToggleRowExclude(this)"></td>'
      + '<td style="position:sticky;left:30px;background:#1d1d1f;font-weight:600;">' + date + '</td>' + attCells + perfCells + '</tr>';
  }).join('');

  // 표 맨 위 "일괄입력" 행: 항목별로 값을 입력하고 항목별/전체 "전체반영" 버튼으로 모든 날짜에 한 번에 채운다.
  const attBulkCells = LGE_TOTAL_VISIBLE_ATT_METRICS.map(function(m) {
    const inpStyle = 'width:52px;padding:3px;border:1px solid #2c2c2e;border-radius:4px;font-size:11px;text-align:center;background:#111113;color:#f5f5f7;';
    const btnStyle = 'display:block;width:100%;margin-top:3px;padding:2px 0;font-size:9px;';
    return '<td><input type="number" class="lge-total-bulk-input" data-metric="' + m.key + '" data-part="' + m.parts[0] + '" placeholder="값" style="' + inpStyle + '">'
      + '<button class="btn-outline" style="' + btnStyle + '" onclick="applyLgeTotalColumn(\'att\',\'' + m.key + '\',\'' + m.parts[0] + '\')">전체반영</button></td>'
      + '<td><input type="number" class="lge-total-bulk-input" data-metric="' + m.key + '" data-part="' + m.parts[1] + '" placeholder="값" style="' + inpStyle + '">'
      + '<button class="btn-outline" style="' + btnStyle + '" onclick="applyLgeTotalColumn(\'att\',\'' + m.key + '\',\'' + m.parts[1] + '\')">전체반영</button></td>';
  }).join('');
  const perfBulkCells = LGE_TOTAL_PERF_METRICS.map(function(m) {
    return '<td><input type="text" class="lge-total-bulk-perf" data-metric="' + m.key + '" placeholder="' + (m.duration ? '4:00:00' : '값') + '"' + (m.duration ? ' onblur="formatDurationOnBlur(this)"' : '') + ' style="width:60px;padding:3px;border:1px solid #2c2c2e;border-radius:4px;font-size:11px;text-align:center;background:#111113;color:#f5f5f7;">'
      + '<button class="btn-outline" style="display:block;width:100%;margin-top:3px;padding:2px 0;font-size:9px;" onclick="applyLgeTotalColumn(\'perf\',\'' + m.key + '\')">전체반영</button></td>';
  }).join('');
  const bulkRow = '<tr class="lge-total-bulk-row" style="background:rgba(90,200,250,.08);">'
    + '<td style="position:sticky;left:0;background:#17313f;"></td>'
    + '<td style="position:sticky;left:30px;background:#17313f;font-weight:600;font-size:11px;color:#5ac8fa;">일괄입력</td>'
    + attBulkCells + perfBulkCells + '</tr>';

  area.innerHTML = '<div class="table-scroll"><table><thead>'
    + '<tr><th rowspan="2" style="position:sticky;left:0;background:#111113;font-size:11px;">제외</th><th rowspan="2" style="position:sticky;left:30px;background:#111113;">날짜</th>' + attHeaderCells + perfHeaderCells + '</tr>'
    + '<tr>' + attSubHeaderCells + '</tr>'
    + '</thead><tbody>' + bulkRow + bodyRows + '</tbody></table></div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:6px;">' + lgeTotalDates.length + '개 날짜 · 총재직인원과 각 항목의 합계는 화면에 표시되지 않고 저장 시 자동 계산됩니다 · 맨 위 "일괄입력" 행에 값을 넣고 항목별 전체반영 버튼(또는 아래 전체 항목 전체반영)을 누르면 채워집니다(AS는 월·화·토·일, 성수기는 월~금이 기본 적용 대상, 실적 항목은 전체 날짜 · 빠진 날짜도 직접 입력 가능) · "제외" 열을 체크하면 그 날짜는 저장에서 빠집니다</p>'
    + '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
    + '<button class="btn-primary" style="padding:6px 14px;font-size:12px;" onclick="applyLgeTotalAllColumns()">⚡ 전체 항목 전체반영</button>'
    + '<span style="font-size:12px;color:#5b6472;">일괄입력 행에 입력된 항목을 전부 모든 날짜에 한 번에 반영합니다.</span>'
    + '</div>';

  document.getElementById('lgeTotalSaveBtn').style.display = 'inline-block';
  statusEl.className = 'status-msg ok';
  statusEl.textContent = seed ? (seed.report_date + ' 저장값을 기본으로 채웠습니다. 필요한 곳만 수정해 주세요.') : '직전 저장 데이터가 없어 빈 값으로 시작합니다.';
}

// "제외" 체크박스를 토글하면 해당 날짜 행을 시각적으로 흐리게 표시(실제 제외 여부는 저장 시 checkbox.checked로 판단)
function lgeTotalToggleRowExclude(checkbox) {
  const tr = checkbox.closest('tr');
  if (!tr) return;
  tr.style.opacity = checkbox.checked ? '0.35' : '1';
  tr.style.textDecoration = checkbox.checked ? 'line-through' : 'none';
}

// 일괄입력 행의 특정 항목(칸) 값을 표의 모든 날짜 행에 채운다. att면 AS/성수기 지정, perf면 metricKey만.
// AS/성수기 계열 근태 항목의 "전체반영" 기본 적용 요일: AS는 월·화·토·일요일만, 성수기는 월~금(평일)만 기본으로 채운다.
// 실적 항목(T-NPS/생산성/통화시간)은 이 규칙과 무관하게 항상 표에 보이는 전체 날짜에 적용된다.
// 규칙에서 빠진 날짜도 표에서 직접 입력하는 건 언제나 가능 — "전체반영" 자동채움 대상만 좁히는 용도.
const LGE_TOTAL_DAY_GROUP_ALLOWED_DAYS = {
  'AS': [1, 2, 6, 0],       // 월, 화, 토, 일
  '성수기': [1, 2, 3, 4, 5]  // 월~금
};

// 이 항목(metricKey)/세부값(part)이 AS 계열인지 성수기 계열인지 판정. 해당 없으면 null.
function lgeTotalColumnGroup(metricKey, part) {
  if (metricKey === 'AS재직인원') return 'AS';
  if (metricKey === '성수기재직인원') return '성수기';
  if (part === 'AS' || part === '성수기') return part; // TO, 상담사투입인원
  return null;
}

// 이 항목/세부값에 "전체반영"을 눌렀을 때 기본으로 채울 날짜의 행 인덱스 목록.
function lgeTotalAllowedRowIndexes(metricKey, part) {
  const group = lgeTotalColumnGroup(metricKey, part);
  const allowedDays = group ? LGE_TOTAL_DAY_GROUP_ALLOWED_DAYS[group] : null;
  const indexes = [];
  for (let ri = 0; ri < lgeTotalDates.length; ri++) {
    if (!allowedDays) { indexes.push(ri); continue; }
    const day = new Date(lgeTotalDates[ri] + 'T00:00:00').getDay();
    if (allowedDays.indexOf(day) !== -1) indexes.push(ri);
  }
  return indexes;
}

function applyLgeTotalColumn(type, metricKey, part) {
  const statusEl = document.getElementById('lgeTotalStatus');
  const bulkInp = type === 'att'
    ? document.querySelector('.lge-total-bulk-input[data-metric="' + metricKey + '"][data-part="' + part + '"]')
    : document.querySelector('.lge-total-bulk-perf[data-metric="' + metricKey + '"]');
  const value = bulkInp ? bulkInp.value : '';
  if (value === '') { statusEl.className = 'status-msg err'; statusEl.textContent = '일괄입력 행에 적용할 값을 먼저 입력해 주세요.'; return 0; }

  const targetIdx = type === 'att' ? lgeTotalAllowedRowIndexes(metricKey, part) : lgeTotalDates.map(function(x, i) { return i; });
  targetIdx.forEach(function(ri) {
    if (type === 'att') {
      const inp = document.querySelector('.lge-total-input[data-row="' + ri + '"][data-metric="' + metricKey + '"][data-part="' + part + '"]');
      if (inp) inp.value = value;
    } else {
      const inp = document.querySelector('.lge-total-perf[data-row="' + ri + '"][data-metric="' + metricKey + '"]');
      if (inp) inp.value = value;
    }
  });

  const group = type === 'att' ? lgeTotalColumnGroup(metricKey, part) : null;
  const skipNote = (group && targetIdx.length < lgeTotalDates.length)
    ? (' (' + (group === 'AS' ? 'AS 기본요일: 월·화·토·일' : '성수기 기본요일: 월~금') + ' · 나머지 날짜는 표에서 직접 입력 가능)')
    : '';
  statusEl.className = 'status-msg ok';
  statusEl.textContent = targetIdx.length + '개 날짜에 값을 적용했습니다.' + skipNote + ' 저장 전에 다시 한 번 확인해 주세요.';
  return targetIdx.length;
}

// 일괄입력 행에서 값이 채워진 항목을 전부 반영한다. AS/성수기 항목은 기본 요일 규칙이, 실적 항목은 전체 날짜가 적용된다.
function applyLgeTotalAllColumns() {
  const statusEl = document.getElementById('lgeTotalStatus');
  let fieldCount = 0;

  LGE_TOTAL_VISIBLE_ATT_METRICS.forEach(function(m) {
    m.parts.forEach(function(part) {
      const inp = document.querySelector('.lge-total-bulk-input[data-metric="' + m.key + '"][data-part="' + part + '"]');
      if (inp && inp.value !== '') { applyLgeTotalColumn('att', m.key, part); fieldCount++; }
    });
  });
  LGE_TOTAL_PERF_METRICS.forEach(function(m) {
    const inp = document.querySelector('.lge-total-bulk-perf[data-metric="' + m.key + '"]');
    if (inp && inp.value !== '') { applyLgeTotalColumn('perf', m.key); fieldCount++; }
  });

  if (fieldCount === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '일괄입력 행에 적용할 값을 하나 이상 입력해 주세요.'; return; }
  statusEl.className = 'status-msg ok';
  statusEl.textContent = fieldCount + '개 항목을 반영했습니다(AS는 월·화·토·일, 성수기는 월~금이 기본 적용 대상이고 실적 항목은 전체 날짜에 적용됨). 저장 전에 다시 한 번 확인해 주세요.';
}

async function saveLgeTotalRows() {
  const statusEl = document.getElementById('lgeTotalStatus');
  const token = centerTokenMap['lge_total'];

  const invalidDur = [];
  const entries = [];
  lgeTotalDates.forEach(function(date, ri) {
    const excludeCb = document.querySelector('.lge-total-exclude[data-row="' + ri + '"]');
    if (excludeCb && excludeCb.checked) return; // "제외" 체크된 날짜는 이번 저장에서 뺀다

    const values = {};
    // 화면에 보이는 항목(TO/AS재직인원/성수기재직인원/상담사투입인원): 입력값 + 그 합계를 계산해서 함께 저장
    LGE_TOTAL_VISIBLE_ATT_METRICS.forEach(function(m) {
      const v0 = document.querySelector('.lge-total-input[data-row="' + ri + '"][data-metric="' + m.key + '"][data-part="' + m.parts[0] + '"]').value;
      const v1 = document.querySelector('.lge-total-input[data-row="' + ri + '"][data-metric="' + m.key + '"][data-part="' + m.parts[1] + '"]').value;
      if (v0 !== '') values[m.key + '_' + m.parts[0]] = { value: v0, group: 'attendance' };
      if (v1 !== '') values[m.key + '_' + m.parts[1]] = { value: v1, group: 'attendance' };
      // 두 부분(AS/성수기 등) 중 한쪽만 입력돼도 합계는 저장한다(입력 안 된 쪽은 0으로 취급) —
      // 예전엔 둘 다 입력해야만 합계가 계산돼서, 한쪽만 입력된 날은 합계 칸이 통째로 비어 보였음.
      if (v0 !== '' || v1 !== '') values[m.key + '_합계'] = { value: String((v0 !== '' ? Number(v0) : 0) + (v1 !== '' ? Number(v1) : 0)), group: 'attendance' };
    });
    // 화면에 없는 파생 항목(총재직인원): 참조 항목의 합계를 그대로 가져와 계산해서 저장
    LGE_TOTAL_ATT_METRICS.forEach(function(m) {
      if (!m.derivedFrom) return;
      const p0 = m.parts[0], p1 = m.parts[1];
      const src0 = values[m.derivedFrom[p0] + '_합계'];
      const src1 = values[m.derivedFrom[p1] + '_합계'];
      if (src0) values[m.key + '_' + p0] = { value: src0.value, group: 'attendance' };
      if (src1) values[m.key + '_' + p1] = { value: src1.value, group: 'attendance' };
      if (src0 || src1) values[m.key + '_합계'] = { value: String((src0 ? Number(src0.value) : 0) + (src1 ? Number(src1.value) : 0)), group: 'attendance' };
    });
    LGE_TOTAL_PERF_METRICS.forEach(function(m) {
      const inp = document.querySelector('.lge-total-perf[data-row="' + ri + '"][data-metric="' + m.key + '"]');
      if (!inp || inp.value === '') return;
      if (m.duration) {
        const sec = parseHMSToSeconds(inp.value);
        if (sec === null) { invalidDur.push(date + ' ' + m.label); return; }
        values[m.key] = { value: sec, group: 'performance' };
      } else {
        values[m.key] = { value: inp.value, group: 'performance' };
      }
    });
    entries.push({ report_date: date, values: values });
  });

  // 월평균(선택 입력) — 날짜별 데이터와 별개로 "대상 월"로 고른 달의 1일 데이터에 "_월평균" 키로 붙여서 저장
  const monthlyAvgValues = {};
  let hasMonthlyAvg = false;
  LGE_TOTAL_PERF_METRICS.forEach(function(m) {
    const inp = document.querySelector('.lge-total-monthly-avg[data-metric="' + m.key + '"]');
    if (!inp || inp.value === '') return;
    hasMonthlyAvg = true;
    if (m.duration) {
      const sec = parseHMSToSeconds(inp.value);
      if (sec === null) { invalidDur.push('월평균 ' + m.label); return; }
      monthlyAvgValues[m.key + '_월평균'] = { value: sec, group: 'performance' };
    } else {
      monthlyAvgValues[m.key + '_월평균'] = { value: inp.value, group: 'performance' };
    }
  });

  if (invalidDur.length) { statusEl.className = 'status-msg err'; statusEl.textContent = '통화시간 형식을 확인해 주세요(예: 4:00:00): ' + invalidDur.join(', '); return; }

  const monthlyAvgDate = lgeTotalAvgMonthDate();
  if (hasMonthlyAvg && monthlyAvgDate) {
    const existing = entries.find(function(e) { return e.report_date === monthlyAvgDate; });
    if (existing) { Object.assign(existing.values, monthlyAvgValues); }
    else { entries.push({ report_date: monthlyAvgDate, values: monthlyAvgValues }); }
  }

  if (entries.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '저장할 데이터가 없습니다(모든 날짜가 제외되어 있는지 확인해 주세요).'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = '저장 중... (' + entries.length + '건)';

  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=manual-entry-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, entries: entries })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '저장 실패');
    statusEl.className = 'status-msg ok';
    statusEl.textContent = (data.count || entries.length) + '건 저장 완료되었습니다.';
    await loadOverviewForCurrent();
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '저장 실패: ' + e.message;
  }
}

async function renderEntry() {
  const main = document.getElementById('main');
  if (!currentCenter) { main.innerHTML = '<div class="empty">센터를 선택해 주세요.</div>'; return; }
  const token = centerTokenMap[currentCenter];
  if (!token) { main.innerHTML = '<div class="empty">이 센터는 아직 데이터입력 토큰이 등록되지 않았습니다.</div>'; return; }

  // LG전자통합: 파일첨부/붙여넣기 없이 항목별 숫자 입력 폼만 사용 (기존 LG전자AS/성수기와 완전히 별개)
  if (INTEGRATED_FORM_CENTERS[currentCenter]) {
    main.innerHTML = renderIntegratedFormEntry() + '<div id="dataManageArea"></div>';
    const dmArea = document.getElementById('dataManageArea');
    if (dmArea) dmArea.innerHTML = renderDataManagePanel();
    refreshLgeTotalMonthlyAvgInputs();
    return;
  }

  const thisYear = new Date().getFullYear();
  const lcBox = LONG_CONTRACT_CENTERS[currentCenter]
    ? '<div class="panel" style="max-width:720px;margin-bottom:16px;">'
      + '<h3>엑셀 자동추출</h3>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">처리구분·의무위반사항·요청일·완료일·변경기한일 컬럼이 있는 RAW 엑셀(.xlsx)을 첨부하면 일별현황을 자동 계산해 아래 붙여넣기 칸에 채워줍니다. 추출 기간을 지정하면 그 기간에 해당하는 날짜만 가져옵니다(비워두면 파일 내 전체 기간).</p>'
      + '<input type="file" id="lcFile" accept=".xlsx">'
      + '<div class="entry-row"><label>추출 시작일</label><input type="date" id="lcStart"></div>'
      + '<div class="entry-row"><label>추출 종료일</label><input type="date" id="lcEnd"></div>'
      + '<button class="btn-secondary" onclick="extractLongContractAndFill()">추출해서 채우기</button>'
      + '<div class="status-msg" id="lcStatus"></div>'
      + '</div>'
    : '';

  const xlsxBox = XLSX_EXTRACTOR_FIELDS[currentCenter]
    ? '<div class="panel" style="max-width:720px;margin-bottom:16px;">'
      + '<h3>엑셀 파일에서 자동 추출</h3>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">월별 운영보고서(.xlsx)를 첨부하면 일자별 데이터를 읽어 아래 붙여넣기 칸에 자동으로 채워줍니다. 추출 기간을 지정하면 그 기간에 해당하는 날짜만 가져옵니다(비워두면 파일 내 전체 기간). 채워진 내용을 확인한 뒤 "양식에 반영"을 눌러주세요.</p>'
      + '<input type="file" id="xlsxFile" accept=".xlsx">'
      + '<div class="entry-row"><label>추출 시작일</label><input type="date" id="xlsxStart"></div>'
      + '<div class="entry-row"><label>추출 종료일</label><input type="date" id="xlsxEnd"></div>'
      + '<button class="btn-secondary" onclick="extractXlsxAndFill()">추출해서 채우기</button>'
      + '<div class="status-msg" id="xlsxStatus"></div>'
      + '</div>'
    : '';

  const hwpxBox = HWPX_FIELD_ORDER[currentCenter]
    ? '<div class="panel" style="max-width:720px;margin-bottom:16px;">'
      + '<h3>월별 운영보고서 한글파일(HWPX)에서 자동 추출</h3>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">월별 운영보고서(.hwpx)를 첨부하면 일자별 데이터를 읽어 아래 붙여넣기 칸에 자동으로 채워줍니다. 채워진 내용을 확인한 뒤 "양식에 반영"을 눌러주세요.</p>'
      + '<input type="file" id="hwpxFile" accept=".hwpx">'
      + '<button class="btn-secondary" onclick="extractHwpxAndFill()">추출해서 채우기</button>'
      + '<div class="status-msg" id="hwpxStatus"></div>'
      + '</div>'
    : '';

  const lgeExcelBox = LGEX_CENTER_CONFIG[currentCenter]
    ? '<div class="panel" style="max-width:720px;margin-bottom:16px;">'
      + '<h3>엑셀 자동추출 (' + LGEX_CENTER_CONFIG[currentCenter].targetGroup + ' Total)</h3>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">summary 시트가 있는 엑셀(.xlsx)을 첨부하면 날짜별 T-NPS·생산성(IN+OUT)·생산성(IN)·통화시간(IN+OUT) ' + LGEX_CENTER_CONFIG[currentCenter].targetGroup + ' Total 값을 자동으로 찾아 아래 "일자별 실적 직접입력" 표에 채워줍니다. 추출 기간을 지정하면 그 기간에 해당하는 날짜만 가져옵니다(비워두면 파일 내 전체 기간).</p>'
      + '<input type="file" id="lgeExcelFile" accept=".xlsx,.xlsm,.xls">'
      + '<div class="entry-row"><label>추출 시작일</label><input type="date" id="lgeExcelStart"></div>'
      + '<div class="entry-row"><label>추출 종료일</label><input type="date" id="lgeExcelEnd"></div>'
      + '<button class="btn-secondary" onclick="extractLgeExcelAndFill()">추출해서 채우기</button>'
      + '<div class="status-msg" id="lgeExcelStatus"></div>'
      + '</div>'
    : '';

  const dayReportBox = DAY_REPORT_CENTERS[currentCenter]
    ? '<div class="panel" style="max-width:720px;margin-bottom:16px;">'
      + '<h3>일일업무보고 한글파일(HWPX)에서 자동 추출</h3>'
      + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;">하루치 일일업무보고(.hwpx)를 첨부하면 "일별실적"과 "상담유형별 인입호"를 함께 읽어 각각의 붙여넣기 칸에 자동으로 채워줍니다.</p>'
      + '<input type="file" id="dayReportFile" accept=".hwpx">'
      + '<button class="btn-secondary" onclick="extractDailyReportAndFill()">추출해서 채우기</button>'
      + '<button class="btn-primary" onclick="applyBothForms()">전체 양식에 반영</button>'
      + '<button class="btn-primary" onclick="saveEverything()" style="background:#34c759;">전체저장</button>'
      + '<div class="status-msg" id="dayReportStatus"></div>'
      + '</div>'
    : '';

  // 어떤 파일 자동추출 방식이 적용되는 센터인지 판별 (센터당 최대 1개만 해당)
  let extraction = null;
  if (DAY_REPORT_CENTERS[currentCenter]) {
    extraction = { label: '일일업무보고(HWPX) 자동추출', html: dayReportBox };
  } else if (LONG_CONTRACT_CENTERS[currentCenter]) {
    extraction = { label: '엑셀 자동추출', html: lcBox };
  } else if (XLSX_EXTRACTOR_FIELDS[currentCenter]) {
    extraction = { label: '엑셀 자동추출', html: xlsxBox };
  } else if (HWPX_FIELD_ORDER[currentCenter]) {
    extraction = { label: '운영보고서(HWPX) 자동추출', html: hwpxBox };
  } else if (LGEX_CENTER_CONFIG[currentCenter]) {
    extraction = { label: '엑셀 자동추출 (' + LGEX_CENTER_CONFIG[currentCenter].targetGroup + ' Total)', html: lgeExcelBox };
  }

  const pasteHtml = '<div class="entry-wrap panel">'
    + '<h3>일자별 실적 직접입력 (여러 날짜 한번에 가능)</h3>'
    + '<p style="font-size:13px;color:#a1a1a6;margin:10px 0 6px;">엑셀에서 날짜 칸부터 마지막 칸까지, 여러 날짜 행을 한 번에 드래그해 복사한 뒤 붙여넣으세요 (한 줄 = 하루치)</p>'
    + '<textarea class="paste-box" id="pasteBox" placeholder="6/1	165.5	34	90.5	...&#10;6/2	164.5	34	89.5	..."></textarea>'
    + '<button class="btn-secondary" onclick="parseMultiPaste()">양식에 반영</button>'
    + '<button class="btn-primary" id="manualSaveBtn" style="display:none;" onclick="saveAllRows()">전체 저장</button>'
    + '<button class="btn-primary" id="manualSaveAttBtn" style="display:none;background:#5ac8fa;" onclick="saveAllRows(\'attendance\')">근태만 저장</button>'
    + '<button class="btn-primary" id="manualSavePerfBtn" style="display:none;background:#34c759;" onclick="saveAllRows(\'performance\')">실적만 저장</button>'
    + '<div class="status-msg" id="manualStatus"></div>'
    + '<div id="templateArea" style="margin-top:16px;"></div>'
    + '</div>'
    + (currentCenter === 'pyeongtaek' ? renderPtDailyItemShell() : '');

  // 입력 방법을 "선택카드 + 접이식"으로 정리 — 파일업로드가 있는 센터는 그것을 기본 선택으로, 없으면 직접입력이 기본
  const methods = [];
  if (extraction) methods.push({ id: 'extract', icon: '📊', label: extraction.label, html: extraction.html });
  methods.push({ id: 'paste', icon: '⌨️', label: '직접 붙여넣기', html: pasteHtml });
  if (ATTENDANCE_SEMI_AUTO[currentCenter]) methods.push({ id: 'att', icon: '🧑\u200d🤝\u200d🧑', label: '재직 및 투입현황', html: '<div id="attendanceEntryArea"></div>' });
  if (currentCenter === 'pyeongtaek') methods.push({ id: 'cat', icon: '🗂', label: '업무유형별 현황', html: '<div id="categoryEntryArea"></div>' });

  const pillsHtml = methods.map(function(m, i) {
    return '<div class="entry-pill' + (i === 0 ? ' sel' : '') + '" data-mid="' + m.id + '" onclick="selectEntryMethod(\'' + m.id + '\')"><span class="ico">' + m.icon + '</span>' + m.label + '</div>';
  }).join('');
  const bodiesHtml = methods.map(function(m, i) {
    return '<div class="entry-method-body" data-mid="' + m.id + '"' + (i === 0 ? '' : ' style="display:none;"') + '>' + m.html + '</div>';
  }).join('');

  // 기준 연도는 파일업로드/직접입력/근태 등 어떤 방식을 쓰든 공통으로 필요하므로, 선택카드 위에 항상 보이게 고정 배치
  const yearBoxHtml = '<div class="entry-year-box"><label>📅 기준 연도</label><input type="number" id="entryYear" value="' + thisYear + '"><span class="hint">날짜가 "6/1"처럼 연도 없이 있을 때 이 연도를 사용합니다 — 붙여넣기/파일업로드 전에 꼭 확인하세요</span></div>';

  main.innerHTML = '<div class="entry-split">'
    + '<div class="entry-split-left"><div id="inputGuideArea"></div></div>'
    + '<div class="entry-split-right">'
    + yearBoxHtml
    + '<div class="entry-pillrow">' + pillsHtml + '</div>'
    + bodiesHtml
    + '</div>'
    + '</div>'
    + '<div id="dataManageArea"></div>';

  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=schema&token=' + encodeURIComponent(token) + '&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
    const data = await res.json();
    rowSchema = data.success ? (data.row_schema || []) : [];
    categorySchema = data.success ? (data.category_schema || []) : [];
    if (rowSchema.length === 0) document.getElementById('templateArea').innerHTML = '<p style="color:#FF6B70;font-size:13px;">이 센터는 아직 입력양식(row_schema)이 등록되지 않았습니다.</p>';
    const guideArea = document.getElementById('inputGuideArea');
    if (guideArea) guideArea.innerHTML = renderInputGuide();
    const attArea = document.getElementById('attendanceEntryArea');
    if (attArea) attArea.innerHTML = renderAttendanceSemiAutoPanel();
    const catArea = document.getElementById('categoryEntryArea');
    if (catArea) catArea.innerHTML = renderCategoryEntryPanel();
    const dmArea = document.getElementById('dataManageArea');
    if (dmArea) dmArea.innerHTML = renderDataManagePanel();
    if (XLSX_EXTRACTOR_FIELDS[currentCenter]) await loadXlsxFieldOverride(currentCenter);
  } catch (e) { document.getElementById('templateArea').innerHTML = '<p class="empty">양식을 불러오지 못했습니다.</p>'; }
}

// ============================================
// 저장된 데이터 일괄 조회 · 삭제 · 수정
// ============================================
let dmQueryResults = [];

function renderDataManagePanel() {
  const today = localDateStr(new Date());
  return '<div class="entry-wrap panel" style="margin-top:16px;">'
    + '<h3>저장된 데이터 조회 · 일괄 삭제 · 수정</h3>'
    + '<p style="font-size:13px;color:#a1a1a6;margin:10px 0 6px;">기간을 지정해 저장된 데이터를 조회한 뒤, 잘못 입력된 날짜를 선택해 삭제하거나 위쪽 입력칸으로 불러와 수정할 수 있습니다.</p>'
    + '<div class="entry-row"><label>시작일</label><input type="date" id="dmStart" value="' + today + '"></div>'
    + '<div class="entry-row"><label>종료일</label><input type="date" id="dmEnd" value="' + today + '"></div>'
    + '<button class="btn-secondary" onclick="queryDataManage()">조회</button>'
    + '<div class="status-msg" id="dmStatus"></div>'
    + '<div id="dmResultArea" style="margin-top:14px;"></div>'
    + '</div>';
}

// 이전엔 이미 화면에 로드된 전역 allRows를 그대로 필터링했는데, 관리자(workspaceUnlocked)로 접속하면
// loadOverviewForCurrent()가 "이 센터"가 아니라 "전체 센터 통틀어 최근 300건"을 allRows에 채운다
// (센터 전환 시 다시 불러오지 않기 위한 캐시 재사용 최적화). 그래서 다른 센터들의 최근 데이터가
// 300건을 다 채우면, 지금 보고 있는 센터의 예전 데이터(예: 반년 전 날짜)는 애초에 allRows에 없어서
// 실제로는 저장이 잘 됐는데도 "조회"에서 0건으로 나오는 문제가 있었다. 이제 "조회"를 누르면
// 전역 캐시를 쓰지 않고 이 센터로만 한정해서(action=admin-overview&center=...) 서버에 새로 요청한다.
async function queryDataManage() {
  const start = document.getElementById('dmStart').value;
  const end = document.getElementById('dmEnd').value;
  const statusEl = document.getElementById('dmStatus');
  if (!start || !end) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일과 종료일을 모두 선택해 주세요.'; return; }
  if (start > end) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일이 종료일보다 늦을 수 없습니다.'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = '조회 중...';
  let rows;
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=admin-overview&center=' + encodeURIComponent(currentCenter) + '&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
    const data = await res.json();
    rows = data.success ? (data.rows || []) : [];
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '조회 실패: ' + e.message;
    return;
  }

  dmQueryResults = rows.filter(function(r) { return r.report_date >= start && r.report_date <= end; })
    .sort(function(a, b) { return a.report_date.localeCompare(b.report_date); });

  statusEl.className = 'status-msg';
  statusEl.textContent = dmQueryResults.length + '건 조회되었습니다.';
  renderDataManageResult();
}

function renderDataManageResult() {
  const area = document.getElementById('dmResultArea');
  if (dmQueryResults.length === 0) { area.innerHTML = '<p class="empty">해당 기간에 저장된 데이터가 없습니다.</p>'; return; }

  const rows = dmQueryResults.map(function(r, i) {
    const perfCount = r.performance_data ? Object.keys(r.performance_data).length : 0;
    const attCount = r.attendance_data ? Object.keys(r.attendance_data).length : 0;
    return '<tr>'
      + '<td><input type="checkbox" class="dm-check" data-idx="' + i + '"></td>'
      + '<td>' + r.report_date + '</td>'
      + '<td>근태 ' + attCount + '개 · 실적 ' + perfCount + '개 항목</td>'
      + '<td>' + (r.parsed_note || '-') + '</td>'
      + '<td><button style="border:none;background:none;color:#5ac8fa;font-size:12px;cursor:pointer;" onclick="loadRowForEdit(' + i + ')">수정하기</button></td>'
      + '</tr>';
  }).join('');

  area.innerHTML = '<div style="margin-bottom:8px;">'
    + '<button class="btn-outline" style="padding:5px 10px;font-size:11px;" onclick="dmToggleAll(true)">전체 선택</button> '
    + '<button class="btn-outline" style="padding:5px 10px;font-size:11px;" onclick="dmToggleAll(false)">전체 해제</button> '
    + '<button class="btn-primary" style="background:#FF6B70;padding:6px 12px;font-size:12px;" onclick="deleteSelectedDates()">선택 삭제</button>'
    + '</div>'
    + '<div class="table-scroll"><table><thead><tr><th></th><th>날짜</th><th>저장된 데이터</th><th>비고</th><th>수정</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function dmToggleAll(checked) {
  document.querySelectorAll('.dm-check').forEach(function(cb) { cb.checked = checked; });
}

async function deleteSelectedDates() {
  const checked = Array.from(document.querySelectorAll('.dm-check:checked'));
  if (checked.length === 0) { alert('삭제할 날짜를 선택해 주세요.'); return; }
  const dates = checked.map(function(cb) { return dmQueryResults[Number(cb.dataset.idx)].report_date; });
  if (!confirm(dates.length + '개 날짜(' + dates.join(', ') + ')의 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;

  const statusEl = document.getElementById('dmStatus');
  statusEl.className = 'status-msg';
  statusEl.textContent = '삭제 중...';
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=delete-dates', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: centerTokenMap[currentCenter], dates: dates })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '삭제 실패');

    // 삭제 직후 서버에서 다시 조회하면 DB 반영 지연(전파 지연)으로 방금 지운 날짜가 잠깐 다시 보일 수 있어,
    // 화면에서는 우선 즉시 제거(낙관적 업데이트)하고, 이후 서버 재조회 결과에도 동일하게 제외 필터를 한 번 더 적용한다.
    dmQueryResults = dmQueryResults.filter(function(r) { return dates.indexOf(r.report_date) === -1; });
    allRows = allRows.filter(function(r) { return dates.indexOf(r.report_date) === -1; });
    renderDataManageResult();

    statusEl.className = 'status-msg ok';
    statusEl.textContent = dates.length + '개 날짜가 삭제되었습니다.';

    await loadOverviewForCurrent();
    allRows = allRows.filter(function(r) { return dates.indexOf(r.report_date) === -1; }); // 재조회 결과에 지연 반영된 항목이 섞여 있어도 다시 제외
    queryDataManage();
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '삭제 실패: ' + e.message;
  }
}

function loadRowForEdit(idx) {
  const row = dmQueryResults[idx];
  if (!row) return;
  if (currentCenter === 'lge_total') { loadLgeTotalRowForEdit(row); return; }
  if (!rowSchema || rowSchema.length === 0) return;
  const values = rowSchema.map(function(col) {
    const src = col.group === 'attendance' ? row.attendance_data : row.performance_data;
    return (src && src[col.key] !== undefined) ? src[col.key] : '';
  });
  const md = row.report_date.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const dateLabel = md ? (Number(md[1]) + '/' + Number(md[2])) : row.report_date;
  document.getElementById('pasteBox').value = dateLabel + '\t' + values.join('\t');
  document.getElementById('pasteBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  alert(row.report_date + ' 데이터를 위쪽 붙여넣기 칸에 불러왔습니다. 값을 수정한 뒤 "양식에 반영" → "전체 저장"을 눌러주세요.');
}

// LG전자통합의 "수정하기": 해당 날짜 하나만 대상으로 폼을 생성하고, 이월값 대신 그 날짜에 실제 저장된 값을 채운다.
async function loadLgeTotalRowForEdit(row) {
  document.getElementById('lgeTotalStart').value = row.report_date;
  document.getElementById('lgeTotalEnd').value = row.report_date;
  lgeTotalDates = [row.report_date];
  // 월평균 "대상 월"도 이 날짜가 속한 달로 맞춰주고, 그 달 저장값을 다시 불러온다.
  const avgMonthEl = document.getElementById('lgeTotalAvgMonth');
  if (avgMonthEl) { avgMonthEl.value = row.report_date.slice(0, 7); refreshLgeTotalMonthlyAvgInputs(); }

  const area = document.getElementById('lgeTotalTemplateArea');
  const statusEl = document.getElementById('lgeTotalStatus');
  const att = row.attendance_data || {};
  const perf = row.performance_data || {};

  const attHeaderCells = LGE_TOTAL_VISIBLE_ATT_METRICS.map(function(m) { return '<th colspan="2" style="text-align:center;background:rgba(90,200,250,.12);">' + m.label + '</th>'; }).join('');
  const attSubHeaderCells = LGE_TOTAL_VISIBLE_ATT_METRICS.map(function(m) {
    return '<th style="font-size:11px;">' + m.parts[0] + '</th><th style="font-size:11px;">' + m.parts[1] + '</th>';
  }).join('');
  const perfHeaderCells = LGE_TOTAL_PERF_METRICS.map(function(m) { return '<th rowspan="2">' + m.label + '</th>'; }).join('');

  const attCells = LGE_TOTAL_VISIBLE_ATT_METRICS.map(function(m) {
    const v0 = att[m.key + '_' + m.parts[0]] !== undefined ? att[m.key + '_' + m.parts[0]] : '';
    const v1 = att[m.key + '_' + m.parts[1]] !== undefined ? att[m.key + '_' + m.parts[1]] : '';
    const style = 'width:56px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;';
    return '<td><input type="number" class="lge-total-input" data-row="0" data-metric="' + m.key + '" data-part="' + m.parts[0] + '" value="' + v0 + '" style="' + style + '"></td>'
      + '<td><input type="number" class="lge-total-input" data-row="0" data-metric="' + m.key + '" data-part="' + m.parts[1] + '" value="' + v1 + '" style="' + style + '"></td>';
  }).join('');
  const perfCells = LGE_TOTAL_PERF_METRICS.map(function(m) {
    const raw = perf[m.key];
    const display = (raw === undefined || raw === null) ? '' : (m.duration ? formatSecondsHMS(raw) : raw);
    return '<td><input type="text" class="lge-total-perf" data-row="0" data-metric="' + m.key + '" value="' + display + '"' + (m.duration ? ' onblur="formatDurationOnBlur(this)"' : '') + ' style="width:64px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>';
  }).join('');

  area.innerHTML = '<div class="table-scroll"><table><thead>'
    + '<tr><th rowspan="2" style="position:sticky;left:0;background:#111113;">날짜</th>' + attHeaderCells + perfHeaderCells + '</tr>'
    + '<tr>' + attSubHeaderCells + '</tr>'
    + '</thead><tbody><tr><td style="position:sticky;left:0;background:#1d1d1f;font-weight:600;">' + row.report_date + '</td>' + attCells + perfCells + '</tr></tbody></table></div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:6px;">기존 저장값을 불러왔습니다(총재직인원·합계는 표시하지 않고 저장 시 자동 계산) · 수정 후 "전체 저장"을 눌러주세요</p>';

  document.getElementById('lgeTotalSaveBtn').style.display = 'inline-block';
  statusEl.className = 'status-msg ok';
  statusEl.textContent = row.report_date + ' 데이터를 불러왔습니다.';
  area.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ============================================
// 평택시청: "일자별 실적 직접입력"/"업무유형별 현황" 텍스트 붙여넣기는 그대로 두고,
// 그 아래에 LG전자통합과 동일한 형태(날짜범위 표 + 일괄입력행 + 항목별/전체 전체반영 + 날짜별 제외체크박스)로
// 항목별 직접 입력하는 기능을 추가한다. 완전히 별도의 입력 경로이며 저장 버튼도 따로 있다.
// 컬럼 목록은 하드코딩하지 않고 서버가 내려준 rowSchema(일자별 실적)/categorySchema(업무유형별)를 그대로 사용한다.
// 날짜 범위 생성은 LG전자통합의 lgeTotalDateRange(), 제외 체크박스 시각효과는 lgeTotalToggleRowExclude()를 그대로 재사용한다.
// ============================================
let ptDailyItemDates = [];
let ptCategoryItemDates = [];

function renderPtDailyItemShell() {
  const today = localDateStr(new Date());
  return '<div class="entry-wrap panel" style="margin-top:16px;">'
    + '<h3>일자별 실적 항목별 직접 입력</h3>'
    + '<p style="font-size:13px;color:#a1a1a6;margin:10px 0 6px;">위 텍스트 붙여넣기 대신, 날짜별로 항목마다 값을 직접 입력할 수 있습니다. 근태(투입인원)는 직전 저장된 날짜 값을 기본으로 채워줍니다(인원변동이 있을 때만 수정). 나머지 실적 항목은 매일 새로 입력합니다.</p>'
    + '<div class="entry-row"><label>시작일</label><input type="date" id="ptDailyItemStart" value="' + today + '"></div>'
    + '<div class="entry-row"><label>종료일</label><input type="date" id="ptDailyItemEnd" value="' + today + '"></div>'
    + '<button class="btn-secondary" onclick="generatePtDailyItemRows()">기간 적용</button>'
    + '<button class="btn-primary" id="ptDailyItemSaveBtn" style="display:none;" onclick="savePtDailyItemRows()">전체 저장</button>'
    + '<div class="status-msg" id="ptDailyItemStatus"></div>'
    + '<div id="ptDailyItemTemplateArea" style="margin-top:16px;"></div>'
    + '</div>';
}

async function generatePtDailyItemRows() {
  const statusEl = document.getElementById('ptDailyItemStatus');
  const start = document.getElementById('ptDailyItemStart').value;
  const end = document.getElementById('ptDailyItemEnd').value;
  if (!start || !end) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일과 종료일을 입력해 주세요.'; return; }
  if (start > end) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일이 종료일보다 늦을 수 없습니다.'; return; }
  if (!rowSchema || rowSchema.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '입력양식이 아직 로드되지 않았습니다. 새로고침 후 다시 시도해 주세요.'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = '직전 저장 데이터를 확인하는 중...';

  ptDailyItemDates = lgeTotalDateRange(start, end);
  const token = centerTokenMap[currentCenter];
  let seed = null;
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=history&token=' + encodeURIComponent(token) + '&_ts=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY }, cache: 'no-store' });
    const data = await res.json();
    const rows = (data.success && data.rows) ? data.rows : [];
    seed = rows.filter(function(r) { return r.report_date < start; }).sort(function(a, b) { return a.report_date < b.report_date ? 1 : -1; })[0] || null;
  } catch (e) { /* 이월값 조회 실패해도 빈 값으로 계속 진행 */ }

  const attSeed = (seed && seed.attendance_data) || {};
  const carry = {};
  rowSchema.forEach(function(c) { carry[c.key] = (c.group === 'attendance' && attSeed[c.key] !== undefined) ? attSeed[c.key] : ''; });

  const area = document.getElementById('ptDailyItemTemplateArea');
  const headCells = rowSchema.map(function(c) { return '<th style="text-align:center;">' + c.key + (c.group === 'attendance' ? ' <span style="font-weight:400;color:#5b6472;">(이월)</span>' : '') + '</th>'; }).join('');

  const bodyRows = ptDailyItemDates.map(function(date, ri) {
    const cells = rowSchema.map(function(c) {
      return '<td><input type="text" class="pt-daily-input" data-row="' + ri + '" data-key="' + c.key + '" data-group="' + c.group + '" value="' + carry[c.key] + '" style="width:64px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>';
    }).join('');
    return '<tr><td style="position:sticky;left:0;background:#1d1d1f;text-align:center;"><input type="checkbox" class="pt-daily-exclude" data-row="' + ri + '" title="체크하면 저장 시 이 날짜를 제외합니다" onchange="lgeTotalToggleRowExclude(this)"></td>'
      + '<td style="position:sticky;left:30px;background:#1d1d1f;font-weight:600;">' + date + '</td>' + cells + '</tr>';
  }).join('');

  const bulkCells = rowSchema.map(function(c) {
    return '<td><input type="text" class="pt-daily-bulk-input" data-key="' + c.key + '" placeholder="값" style="width:60px;padding:3px;border:1px solid #2c2c2e;border-radius:4px;font-size:11px;text-align:center;background:#111113;color:#f5f5f7;">'
      + '<button class="btn-outline" style="display:block;width:100%;margin-top:3px;padding:2px 0;font-size:9px;" onclick="applyPtDailyItemColumn(\'' + c.key + '\')">전체반영</button></td>';
  }).join('');
  const bulkRow = '<tr style="background:rgba(90,200,250,.08);"><td style="position:sticky;left:0;background:#17313f;"></td><td style="position:sticky;left:30px;background:#17313f;font-weight:600;font-size:11px;color:#5ac8fa;">일괄입력</td>' + bulkCells + '</tr>';

  area.innerHTML = '<div class="table-scroll"><table><thead><tr><th style="position:sticky;left:0;background:#111113;font-size:11px;">제외</th><th style="position:sticky;left:30px;background:#111113;">날짜</th>' + headCells + '</tr></thead>'
    + '<tbody>' + bulkRow + bodyRows + '</tbody></table></div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:6px;">' + ptDailyItemDates.length + '개 날짜 · 일괄입력 행에 값을 넣고 항목별 전체반영을 누르면 모든 날짜에 채워집니다 · "제외" 열을 체크하면 그 날짜는 저장에서 빠집니다</p>'
    + '<div style="margin-top:10px;"><button class="btn-primary" style="padding:6px 14px;font-size:12px;" onclick="applyPtDailyItemAllColumns()">⚡ 전체 항목 전체반영</button></div>';

  document.getElementById('ptDailyItemSaveBtn').style.display = 'inline-block';
  statusEl.className = 'status-msg ok';
  statusEl.textContent = seed ? (seed.report_date + ' 저장값을 기본으로 근태(투입인원)를 채웠습니다.') : '직전 저장 데이터가 없어 빈 값으로 시작합니다.';
}

function applyPtDailyItemColumn(key) {
  const statusEl = document.getElementById('ptDailyItemStatus');
  const bulkInp = document.querySelector('.pt-daily-bulk-input[data-key="' + key + '"]');
  const value = bulkInp ? bulkInp.value : '';
  if (value === '') { statusEl.className = 'status-msg err'; statusEl.textContent = '일괄입력 행에 적용할 값을 먼저 입력해 주세요.'; return; }
  for (let ri = 0; ri < ptDailyItemDates.length; ri++) {
    const inp = document.querySelector('.pt-daily-input[data-row="' + ri + '"][data-key="' + key + '"]');
    if (inp) inp.value = value;
  }
  statusEl.className = 'status-msg ok';
  statusEl.textContent = ptDailyItemDates.length + '개 날짜에 값을 적용했습니다.';
}

function applyPtDailyItemAllColumns() {
  const statusEl = document.getElementById('ptDailyItemStatus');
  let count = 0;
  rowSchema.forEach(function(c) {
    const inp = document.querySelector('.pt-daily-bulk-input[data-key="' + c.key + '"]');
    if (inp && inp.value !== '') { applyPtDailyItemColumn(c.key); count++; }
  });
  if (count === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '일괄입력 행에 적용할 값을 하나 이상 입력해 주세요.'; return; }
  statusEl.className = 'status-msg ok';
  statusEl.textContent = count + '개 항목을 ' + ptDailyItemDates.length + '개 날짜 전체에 반영했습니다.';
}

async function savePtDailyItemRows() {
  const statusEl = document.getElementById('ptDailyItemStatus');
  const token = centerTokenMap[currentCenter];
  const entries = [];
  ptDailyItemDates.forEach(function(date, ri) {
    const excludeCb = document.querySelector('.pt-daily-exclude[data-row="' + ri + '"]');
    if (excludeCb && excludeCb.checked) return;
    const values = {};
    rowSchema.forEach(function(c) {
      const inp = document.querySelector('.pt-daily-input[data-row="' + ri + '"][data-key="' + c.key + '"]');
      if (inp && inp.value !== '') values[c.key] = { value: inp.value, group: c.group };
    });
    entries.push({ report_date: date, values: values });
  });
  if (entries.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '저장할 데이터가 없습니다(모든 날짜가 제외되어 있는지 확인해 주세요).'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = '저장 중... (' + entries.length + '건)';
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=manual-entry-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, entries: entries })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '저장 실패');
    statusEl.className = 'status-msg ok';
    statusEl.textContent = (data.count || entries.length) + '건 저장 완료되었습니다.';
    await loadOverviewForCurrent();
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '저장 실패: ' + e.message;
  }
}

function renderPtCategoryItemShell() {
  const today = localDateStr(new Date());
  return '<div class="entry-wrap panel" style="margin-top:16px;">'
    + '<h3>업무유형별 현황 항목별 직접 입력</h3>'
    + '<p style="font-size:13px;color:#a1a1a6;margin:10px 0 6px;">위 텍스트 붙여넣기 대신, 날짜별로 항목(카테고리)마다 건수를 직접 입력할 수 있습니다. 비중(%)은 "' + (categorySchema[0] ? categorySchema[0].key : '합계') + '" 대비 저장 시 자동 계산되어 함께 저장됩니다.</p>'
    + '<div class="entry-row"><label>시작일</label><input type="date" id="ptCategoryItemStart" value="' + today + '"></div>'
    + '<div class="entry-row"><label>종료일</label><input type="date" id="ptCategoryItemEnd" value="' + today + '"></div>'
    + '<button class="btn-secondary" onclick="generatePtCategoryItemRows()">기간 적용</button>'
    + '<button class="btn-primary" id="ptCategoryItemSaveBtn" style="display:none;" onclick="savePtCategoryItemRows()">전체 저장</button>'
    + '<div class="status-msg" id="ptCategoryItemStatus"></div>'
    + '<div id="ptCategoryItemTemplateArea" style="margin-top:16px;"></div>'
    + '</div>';
}

function generatePtCategoryItemRows() {
  const statusEl = document.getElementById('ptCategoryItemStatus');
  const start = document.getElementById('ptCategoryItemStart').value;
  const end = document.getElementById('ptCategoryItemEnd').value;
  if (!start || !end) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일과 종료일을 입력해 주세요.'; return; }
  if (start > end) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일이 종료일보다 늦을 수 없습니다.'; return; }
  if (!categorySchema || categorySchema.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '업무유형별 입력양식이 아직 로드되지 않았습니다.'; return; }

  ptCategoryItemDates = lgeTotalDateRange(start, end);
  const area = document.getElementById('ptCategoryItemTemplateArea');
  const headCells = categorySchema.map(function(c) { return '<th style="text-align:center;">' + c.key + '</th>'; }).join('');

  const bodyRows = ptCategoryItemDates.map(function(date, ri) {
    const cells = categorySchema.map(function(c) {
      return '<td><input type="text" class="pt-category-input" data-row="' + ri + '" data-key="' + c.key + '" value="" style="width:60px;padding:4px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>';
    }).join('');
    return '<tr><td style="position:sticky;left:0;background:#1d1d1f;text-align:center;"><input type="checkbox" class="pt-category-exclude" data-row="' + ri + '" title="체크하면 저장 시 이 날짜를 제외합니다" onchange="lgeTotalToggleRowExclude(this)"></td>'
      + '<td style="position:sticky;left:30px;background:#1d1d1f;font-weight:600;">' + date + '</td>' + cells + '</tr>';
  }).join('');

  const bulkCells = categorySchema.map(function(c) {
    return '<td><input type="text" class="pt-category-bulk-input" data-key="' + c.key + '" placeholder="값" style="width:56px;padding:3px;border:1px solid #2c2c2e;border-radius:4px;font-size:11px;text-align:center;background:#111113;color:#f5f5f7;">'
      + '<button class="btn-outline" style="display:block;width:100%;margin-top:3px;padding:2px 0;font-size:9px;" onclick="applyPtCategoryItemColumn(\'' + c.key + '\')">전체반영</button></td>';
  }).join('');
  const bulkRow = '<tr style="background:rgba(90,200,250,.08);"><td style="position:sticky;left:0;background:#17313f;"></td><td style="position:sticky;left:30px;background:#17313f;font-weight:600;font-size:11px;color:#5ac8fa;">일괄입력</td>' + bulkCells + '</tr>';

  area.innerHTML = '<div class="table-scroll"><table><thead><tr><th style="position:sticky;left:0;background:#111113;font-size:11px;">제외</th><th style="position:sticky;left:30px;background:#111113;">날짜</th>' + headCells + '</tr></thead>'
    + '<tbody>' + bulkRow + bodyRows + '</tbody></table></div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:6px;">' + ptCategoryItemDates.length + '개 날짜 · 일괄입력 행에 값을 넣고 항목별 전체반영을 누르면 모든 날짜에 채워집니다 · "제외" 열을 체크하면 그 날짜는 저장에서 빠집니다</p>'
    + '<div style="margin-top:10px;"><button class="btn-primary" style="padding:6px 14px;font-size:12px;" onclick="applyPtCategoryItemAllColumns()">⚡ 전체 항목 전체반영</button></div>';

  document.getElementById('ptCategoryItemSaveBtn').style.display = 'inline-block';
  statusEl.className = 'status-msg ok';
  statusEl.textContent = ptCategoryItemDates.length + '개 날짜의 표를 만들었습니다.';
}

function applyPtCategoryItemColumn(key) {
  const statusEl = document.getElementById('ptCategoryItemStatus');
  const bulkInp = document.querySelector('.pt-category-bulk-input[data-key="' + key + '"]');
  const value = bulkInp ? bulkInp.value : '';
  if (value === '') { statusEl.className = 'status-msg err'; statusEl.textContent = '일괄입력 행에 적용할 값을 먼저 입력해 주세요.'; return; }
  for (let ri = 0; ri < ptCategoryItemDates.length; ri++) {
    const inp = document.querySelector('.pt-category-input[data-row="' + ri + '"][data-key="' + key + '"]');
    if (inp) inp.value = value;
  }
  statusEl.className = 'status-msg ok';
  statusEl.textContent = ptCategoryItemDates.length + '개 날짜에 값을 적용했습니다.';
}

function applyPtCategoryItemAllColumns() {
  const statusEl = document.getElementById('ptCategoryItemStatus');
  let count = 0;
  categorySchema.forEach(function(c) {
    const inp = document.querySelector('.pt-category-bulk-input[data-key="' + c.key + '"]');
    if (inp && inp.value !== '') { applyPtCategoryItemColumn(c.key); count++; }
  });
  if (count === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '일괄입력 행에 적용할 값을 하나 이상 입력해 주세요.'; return; }
  statusEl.className = 'status-msg ok';
  statusEl.textContent = count + '개 항목을 ' + ptCategoryItemDates.length + '개 날짜 전체에 반영했습니다.';
}

// 카테고리 저장: 기존 saveCategoryRows()와 동일하게 "합계"(첫 항목) 대비 비중(%)을 계산해 "{key}_비중" 키로 함께 저장한다.
async function savePtCategoryItemRows() {
  const statusEl = document.getElementById('ptCategoryItemStatus');
  const token = centerTokenMap[currentCenter];
  const entries = [];
  ptCategoryItemDates.forEach(function(date, ri) {
    const excludeCb = document.querySelector('.pt-category-exclude[data-row="' + ri + '"]');
    if (excludeCb && excludeCb.checked) return;
    const totalInp = document.querySelector('.pt-category-input[data-row="' + ri + '"][data-key="' + categorySchema[0].key + '"]');
    const total = parseFloat((totalInp && totalInp.value) || '0') || 0;
    const values = {};
    categorySchema.forEach(function(c, ci) {
      const inp = document.querySelector('.pt-category-input[data-row="' + ri + '"][data-key="' + c.key + '"]');
      if (!inp || inp.value === '') return;
      values[c.key] = { value: inp.value, group: 'performance' };
      if (ci !== 0) {
        const n = parseFloat(inp.value || '0') || 0;
        values[c.key + '_비중'] = { value: total ? (n / total * 100).toFixed(1) : '0', group: 'performance' };
      }
    });
    entries.push({ report_date: date, values: values });
  });
  if (entries.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '저장할 데이터가 없습니다(모든 날짜가 제외되어 있는지 확인해 주세요).'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = '저장 중... (' + entries.length + '건)';
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=manual-entry-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, entries: entries })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '저장 실패');
    statusEl.className = 'status-msg ok';
    statusEl.textContent = (data.count || entries.length) + '건 저장 완료되었습니다.';
    await loadOverviewForCurrent();
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '저장 실패: ' + e.message;
  }
}

let attRangeRows = [];
let attExtractedByDate = {}; // 근태 파일 업로드 후 추출된 날짜별 {상담사,관리자,전체} 실제 근무 인원

// ============================================
// 근태 자동추출 엔진 (LG전자AS/성수기/KB손보정비 "근태 일자별 인원 자동추출기" 로직 이식)
// 원본은 자체 ZIP/XML 파서를 쓰지만, admin.html에는 이미 SheetJS(XLSX)가 로드돼 있어 이를 재사용한다.
// 시트명이 "2607" 같은 4자리(YYMM)인 월별 근태표를 찾아, 성명/업무(또는 팀)/입사일/퇴사일/날짜 열을
// 자동 인식하고, 날짜별로 출근(○/ㅇ/O/o/◯/●) 표시된 인원을 상담사/관리자로 나눠 집계한다.
// ============================================
const ATTX_WORK_MARKS = new Set(['○', 'ㅇ', 'O', 'o', '◯', '●']);

function attxNormalizeText(value) { return String(value ?? '').replace(/\u00a0/g, ' ').trim(); }
function attxIsWorkStatus(value) {
  const txt = attxNormalizeText(value);
  return txt !== '' && ATTX_WORK_MARKS.has(txt);
}
function attxClassifyRole(rawRole, hasWorkColumn) {
  const role = attxNormalizeText(rawRole);
  if (hasWorkColumn) return role.includes('상담사') ? '상담사' : '관리자';
  // 업무 열이 없는 자료는 팀/조직명 기준으로 보완 분류
  if (['관리자', '팀장', '센터장', '총괄', 'QA', '강사', 'SV', '매니저', '파트장'].some(function(k) { return role.includes(k); })) return '관리자';
  return '상담사';
}
function attxExcelSerialToDate(serial) {
  const n = Number(serial);
  if (!isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function attxParseDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  if (typeof value === 'number' && value > 20000 && value < 60000) {
    const d = attxExcelSerialToDate(value);
    if (d && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2099) return d;
  }
  const txt = attxNormalizeText(value);
  if (!txt) return null;
  let m = txt.match(/(20\d{2})[-.\/년\s]+(\d{1,2})[-.\/월\s]+(\d{1,2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = txt.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}
function attxDateKey(date) {
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
}
function attxIsValidMonthSheetName(name) { return /^\d{4}$/.test(String(name || '').trim()); }

function attxFindHeaderRow(aoa) {
  let best = { row: -1, score: -1 };
  const maxRows = Math.min(12, aoa.length);
  const knownHeaders = ['성명', '이름', '업무', '팀', '퇴사일', '입사일', '전보일', '근무시간', '사번', 'No'];
  for (let r = 0; r < maxRows; r++) {
    const row = aoa[r] || [];
    let known = 0, dates = 0;
    row.forEach(function(v) {
      const t = attxNormalizeText(v).replace(/\s/g, '');
      if (knownHeaders.indexOf(t) >= 0) known++;
      const d = attxParseDate(v);
      if (d && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2099) dates++;
    });
    const score = known * 5 + dates;
    if (score > best.score) best = { row: r, score: score };
  }
  if (best.row < 0 || best.score < 10) throw new Error('헤더 행을 자동으로 찾지 못했습니다. 성명/업무/퇴사일/날짜 열이 있는지 확인해 주세요.');
  return best.row;
}
function attxFindColumn(headers, candidates) {
  const nc = candidates.map(function(x) { return x.replace(/\s/g, ''); });
  for (let i = 0; i < headers.length; i++) { const t = attxNormalizeText(headers[i]).replace(/\s/g, ''); if (nc.indexOf(t) >= 0) return i; }
  for (let i = 0; i < headers.length; i++) { const t = attxNormalizeText(headers[i]).replace(/\s/g, ''); if (nc.some(function(c) { return t.includes(c); })) return i; }
  return -1;
}

function attxAnalyzeSheet(sheetName, aoa) {
  const headerRow = attxFindHeaderRow(aoa);
  const headers = aoa[headerRow] || [];
  const nameCol = attxFindColumn(headers, ['성명', '이름']);
  const workCol = attxFindColumn(headers, ['업무']);
  const teamCol = attxFindColumn(headers, ['팀']);
  const roleCol = workCol >= 0 ? workCol : teamCol;
  const retireCol = attxFindColumn(headers, ['퇴사일']);
  const joinCol = attxFindColumn(headers, ['입사일']);
  if (nameCol < 0) throw new Error(sheetName + ': 성명/이름 열을 찾지 못했습니다.');
  if (roleCol < 0) throw new Error(sheetName + ': 업무 또는 팀 열을 찾지 못했습니다.');

  const dateCols = [];
  headers.forEach(function(value, col) {
    const d = attxParseDate(value);
    if (d && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2099) dateCols.push({ col: col, date: d, key: attxDateKey(d) });
  });
  if (!dateCols.length) throw new Error(sheetName + ': 날짜 열을 찾지 못했습니다.');

  const byDate = new Map();
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const name = attxNormalizeText(row[nameCol]);
    if (!name || name === '성명' || name === '이름') continue;
    const roleRaw = roleCol >= 0 ? row[roleCol] : '';
    const roleType = attxClassifyRole(roleRaw, workCol >= 0);
    const joinDate = joinCol >= 0 ? attxParseDate(row[joinCol]) : null;
    const retireDate = retireCol >= 0 ? attxParseDate(row[retireCol]) : null;

    dateCols.forEach(function(dc) {
      if (!attxIsWorkStatus(row[dc.col])) return;
      if (joinDate && dc.date < joinDate) return;
      if (retireDate && dc.date > retireDate) return;
      if (!byDate.has(dc.key)) byDate.set(dc.key, { date: dc.date, 상담사: 0, 관리자: 0, 전체: 0 });
      const rec = byDate.get(dc.key);
      rec[roleType] += 1;
      rec.전체 += 1;
    });
  }
  dateCols.forEach(function(dc) { if (!byDate.has(dc.key)) byDate.set(dc.key, { date: dc.date, 상담사: 0, 관리자: 0, 전체: 0 }); });
  return Array.from(byDate.values());
}

function attxExtractWorkbook(workbook) {
  const monthSheetNames = workbook.SheetNames.filter(attxIsValidMonthSheetName).sort();
  if (!monthSheetNames.length) throw new Error('2607, 2606 같은 4자리 월별 시트를 찾지 못했습니다.');
  const byDate = {};
  const errors = [];
  monthSheetNames.forEach(function(name) {
    try {
      const sheet = workbook.Sheets[name];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
      attxAnalyzeSheet(name, aoa).forEach(function(rec) { byDate[attxDateKey(rec.date)] = rec; });
    } catch (err) {
      errors.push(name + ': ' + (err.message || err));
    }
  });
  const keys = Object.keys(byDate);
  if (keys.length === 0) throw new Error('분석 가능한 월별 시트가 없습니다. ' + errors.join(' / '));
  return { byDate: byDate, dateKeys: keys.sort(), sheetCount: monthSheetNames.length, errors: errors };
}

async function extractAttFile() {
  const statusEl = document.getElementById('attStatus');
  const fileInput = document.getElementById('attFile');
  const file = fileInput && fileInput.files[0];
  if (!file) { statusEl.className = 'status-msg err'; statusEl.textContent = '근태 파일을 선택해 주세요.'; return; }
  if (!window.XLSX) { statusEl.className = 'status-msg err'; statusEl.textContent = '엑셀 해석 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'; return; }
  pendingAttArchiveFile = file; // 실제 저장(근태만 저장/실적+근태 일괄반영) 성공 시 업로드

  statusEl.className = 'status-msg';
  statusEl.textContent = file.name + ' 파일에서 근태를 추출하는 중입니다.';
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: true });
    const result = attxExtractWorkbook(workbook);
    attExtractedByDate = result.byDate;

    // 이미 시작일/종료일이 지정돼 있으면(예: 엑셀 자동추출에서 넘어온 기간) 그 기간을 그대로 존중하고,
    // 비어있을 때만 파일에서 찾은 전체 날짜 범위로 자동 채운다.
    const startEl = document.getElementById('attStart');
    const endEl = document.getElementById('attEnd');
    if (!startEl.value) startEl.value = result.dateKeys[0];
    if (!endEl.value) endEl.value = result.dateKeys[result.dateKeys.length - 1];
    generateAttRangeRows(); // 기간 적용을 자동 실행해 추출된 값으로 표를 바로 채움

    // 지정한 기간(영업일) 중 실제로 파일에서 매칭된 날짜와, 매칭되지 않아 기본값이 적용된 날짜를 구분해 보여준다.
    const matched = attRangeRows.filter(function(d) { return !!attExtractedByDate[d]; });
    const unmatched = attRangeRows.filter(function(d) { return !attExtractedByDate[d]; });
    let matchNote = ' · 지정기간 영업일 ' + attRangeRows.length + '일 중 파일 매칭 ' + matched.length + '일';
    if (unmatched.length) matchNote += ', 매칭 실패(기본값 적용) ' + unmatched.length + '일: ' + unmatched.slice(0, 10).join(', ') + (unmatched.length > 10 ? ' 외 ' + (unmatched.length - 10) + '일' : '');

    statusEl.className = unmatched.length ? 'status-msg err' : 'status-msg ok';
    statusEl.textContent = result.sheetCount + '개 월별시트에서 ' + result.dateKeys.length + '일치 근태를 추출했습니다(파일 내 전체 기간 ' + result.dateKeys[0] + ' ~ ' + result.dateKeys[result.dateKeys.length - 1] + ')' + matchNote + '.'
      + (result.errors.length ? ' (일부 시트 인식 실패: ' + result.errors.join(' / ') + ')' : '');
  } catch (err) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '추출 실패: ' + (err.message || err);
  }
}

// ============================================
// 재직 및 투입현황 반자동 입력 (TO/재직인원 자동값 + 상담사 투입인원만 수동 입력)
// ============================================
const ATTENDANCE_SEMI_AUTO = {
  'kbjeongbi': { defaultTO: 15, defaultStaff: 15, defaultManual: 14, manualKey: '상담사_투입인원', manualLabel: '상담사 투입인원', toKey: 'TO', staffKey: '재직인원' },
  // LG전자: TO 19명(관리자4+상담사15) · 재직 19명(관리자1+상담사15)은 고정값으로 자동 채움, 상담사 투입인원(기본 14명)만 실제로 매일 달라지는 값
  'lge': { defaultTO: 19, defaultStaff: 19, defaultManual: 14, manualKey: '상담사_투입인원', manualLabel: '상담사 투입인원', toKey: 'TO', staffKey: '재직인원' },
  // 성수기: 공식 TO는 상담사 35명(관리자 0명)이나, 실제 운영기준(재직인원 기본값)은 관리자6+상담사35=41명
  'lge_seongsu': { defaultTO: 35, defaultStaff: 41, defaultManual: 35, manualKey: '상담사_투입인원', manualLabel: '상담사 투입인원', toKey: 'TO', staffKey: '재직인원' }
};

let pendingAttRange = null; // 엑셀 자동추출에서 넘어온 "적용할 기간" 대기값 - 재직현황 패널을 그릴 때 최우선으로 사용

// 업로드 자료함(archive-upload-file)은 파일을 "추출"만 했을 때가 아니라 실제로 저장(반영)이 성공했을 때만 올라가야 한다.
// 추출 함수에서는 이 변수에 File 객체만 잠깐 보관해두고, 각 저장 함수가 성공한 시점에 실제로 업로드한다.
let pendingPerfArchiveFile = null; // 일자별 실적 직접입력(pasteBox)을 채운 원본 파일 - "전체/근태만/실적만 저장" 성공 시 업로드
let pendingAttArchiveFile = null;  // 재직및투입현황의 근태파일 - "근태만/실적+근태 저장" 성공 시 업로드

function renderAttendanceSemiAutoPanel() {
  const cfg = ATTENDANCE_SEMI_AUTO[currentCenter];
  if (!cfg) return '';
  const today = localDateStr(new Date());
  const startVal = (pendingAttRange && pendingAttRange.start) ? pendingAttRange.start : today;
  const endVal = (pendingAttRange && pendingAttRange.end) ? pendingAttRange.end : today;
  pendingAttRange = null; // 1회성 - 사용 후 즉시 초기화
  const isSeparatedCenter = currentCenter === 'kbjeongbi';
  const descText = isSeparatedCenter
    ? '근태 파일을 업로드하면 날짜별 실제 근무 인원(상담사/관리자)이 자동으로 채워집니다. 파일이 없으면 기간만 지정해도 주말·공휴일을 제외한 영업일마다 기본값(TO·재직인원·' + cfg.manualLabel + ')이 채워지며, 개별 수정이나 체크박스 일괄수정이 가능합니다. 이 화면은 근태 전용입니다 — 실적은 위쪽 "일자별 실적 직접입력"에서 별도로 저장해 주세요. "근태만 저장"을 눌러도 이미 저장된 실적 값은 전혀 건드리지 않고, 실적을 먼저 저장했든 나중에 저장했든 순서와 무관하게 서로의 값이 사라지지 않습니다.'
    : '근태 파일을 업로드하면 날짜별 실제 근무 인원(상담사/관리자)이 자동으로 채워집니다. 파일이 없으면 기간만 지정해도 주말·공휴일을 제외한 영업일마다 기본값(TO·재직인원·' + cfg.manualLabel + ')이 채워지며, 어느 쪽이든 개별 수정이나 체크박스 일괄수정이 가능합니다. "근태만 저장"은 이 표의 근태 값만, "실적만 저장"은 위쪽 "일자별 실적 직접입력"에 붙여넣은 실적만(겹치는 날짜 한정) 반영하고 나머지는 건드리지 않습니다.';
  return '<div class="entry-wrap panel" style="margin-top:16px;">'
    + '<h3>일자별 재직 및 투입현황 입력</h3>'
    + '<p style="font-size:13px;color:#a1a1a6;margin:10px 0 6px;">' + descText + '</p>'
    + '<div class="entry-row"><label>근태파일 업로드</label><input type="file" id="attFile" accept=".xlsx,.xlsm,.xls" onchange="extractAttFile()"><button class="btn-secondary" onclick="extractAttFile()">다시 추출</button></div>'
    + '<div class="entry-row"><label>시작일</label><input type="date" id="attStart" value="' + startVal + '"></div>'
    + '<div class="entry-row"><label>종료일</label><input type="date" id="attEnd" value="' + endVal + '"></div>'
    + '<button class="btn-secondary" onclick="generateAttRangeRows()">기간 적용</button>'
    + '<button class="btn-primary" id="attSaveBtn" style="display:none;" onclick="saveAttRangeRows()">근태만 저장</button>'
    + '<button class="btn-primary" id="attCombinedSaveBtn" style="display:none;background:#34c759;" onclick="saveAttAndPerfCombined()">실적+근태 일괄 반영</button>'
    + '<button class="btn-primary" id="attPerfOnlySaveBtn" style="display:none;background:#5ac8fa;" onclick="saveAttPerfOnly()">실적만 저장</button>'
    + '<div class="status-msg" id="attStatus"></div>'
    + '<div id="attBulkEditBar" style="display:none;margin-top:12px;padding:10px 12px;background:#111113;border:1px solid #2c2c2e;border-radius:8px;">'
    + '<div style="font-size:12px;font-weight:700;margin-bottom:8px;color:#f5f5f7;">선택한 날짜 일괄수정 (<span id="attCheckedCount">0</span>건 선택됨 · 값을 채운 항목만 적용)</div>'
    + '<div class="entry-row"><label>TO</label><input type="number" id="attBulkTO" placeholder="변경없음" style="width:80px;"></div>'
    + '<div class="entry-row"><label>재직인원</label><input type="number" id="attBulkStaff" placeholder="변경없음" style="width:80px;"></div>'
    + '<div class="entry-row"><label>' + cfg.manualLabel + '</label><input type="number" id="attBulkManual" placeholder="변경없음" style="width:80px;"></div>'
    + '<button class="btn-secondary" onclick="applyAttBulkEdit()">선택 항목에 적용</button>'
    + '</div>'
    + '<div id="attTemplateArea" style="margin-top:14px;"></div>'
    + '<div id="attCombinedPreview" style="margin-top:14px;"></div>'
    + '</div>';
}

function generateAttRangeRows() {
  const cfg = ATTENDANCE_SEMI_AUTO[currentCenter];
  const statusEl = document.getElementById('attStatus');
  const startVal = document.getElementById('attStart').value;
  const endVal = document.getElementById('attEnd').value;
  if (!startVal || !endVal) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일과 종료일을 모두 선택해 주세요.'; return; }
  if (startVal > endVal) { statusEl.className = 'status-msg err'; statusEl.textContent = '시작일이 종료일보다 늦을 수 없습니다.'; return; }

  attRangeRows = [];
  let cur = new Date(startVal + 'T00:00:00');
  const end = new Date(endVal + 'T00:00:00');
  while (cur <= end) {
    const dateStr = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
    if (!isWeekendOrHoliday(dateStr)) attRangeRows.push(dateStr);
    cur.setDate(cur.getDate() + 1);
  }

  statusEl.className = 'status-msg';
  statusEl.textContent = attRangeRows.length + '일(주말·공휴일 제외)이 대상으로 지정되었습니다.';
  renderAttRangeTemplate();
  // KB손보정비는 실적/근태를 완전히 분리하는 센터라서 이 화면에서는 "근태만 저장"만 노출한다
  // (실적은 반드시 "일자별 실적 직접입력" 쪽 "전체 저장"으로만 저장되도록 강제 — 순서와 무관하게 서로의 값을 건드리지 않기 위함).
  const showCombinedAndPerfOnly = currentCenter !== 'kbjeongbi';
  document.getElementById('attSaveBtn').style.display = attRangeRows.length ? 'inline-block' : 'none';
  document.getElementById('attCombinedSaveBtn').style.display = (attRangeRows.length && showCombinedAndPerfOnly) ? 'inline-block' : 'none';
  document.getElementById('attPerfOnlySaveBtn').style.display = (attRangeRows.length && showCombinedAndPerfOnly) ? 'inline-block' : 'none';
  document.getElementById('attCombinedPreview').innerHTML = '';
}

function renderAttRangeTemplate() {
  const cfg = ATTENDANCE_SEMI_AUTO[currentCenter];
  const area = document.getElementById('attTemplateArea');
  const bulkBar = document.getElementById('attBulkEditBar');
  if (attRangeRows.length === 0) { area.innerHTML = '<p class="empty">지정된 영업일이 없습니다.</p>'; if (bulkBar) bulkBar.style.display = 'none'; return; }
  if (bulkBar) bulkBar.style.display = 'block';

  // KB손보정비에 한해 날짜별 "제외" 체크박스 제공: 체크하면 그 날짜는 저장(근태만 저장)에서 빠진다.
  // (LG전자AS/성수기는 동일한 표를 공유하지만 이 기능은 KB손보정비 전용으로 한정 — 사용자 확인 완료)
  const showExcludeCol = currentCenter === 'kbjeongbi';
  const rows = attRangeRows.map(function(date, idx) {
    const ext = attExtractedByDate[date]; // 근태파일에서 추출된 실제 값이 있으면 기본값 대신 이 값을 사용
    const staffVal = ext ? ext.전체 : cfg.defaultStaff;
    const manualVal = ext ? ext.상담사 : cfg.defaultManual;
    const extMark = ext ? ' style="background:rgba(52,199,89,.16);font-weight:600;"' : '';
    const excludeCell = showExcludeCol
      ? '<td style="text-align:center;"><input type="checkbox" class="att-exclude" data-row="' + idx + '" title="체크하면 저장 시 이 날짜를 제외합니다" onchange="lgeTotalToggleRowExclude(this)"></td>'
      : '';
    return '<tr>'
      + '<td style="position:sticky;left:0;background:#1d1d1f;"><input type="checkbox" class="att-check" data-row="' + idx + '" onchange="updateAttCheckedCount()"></td>'
      + '<td style="font-weight:600;">' + date + (ext ? ' <span style="color:#34c759;font-size:11px;font-weight:400;">(추출됨)</span>' : '') + '</td>'
      + '<td><input type="number" class="att-input" data-row="' + idx + '" data-field="to" value="' + cfg.defaultTO + '" style="width:70px;padding:5px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>'
      + '<td><input type="number" class="att-input" data-row="' + idx + '" data-field="staff" value="' + staffVal + '"' + extMark + ' style="width:70px;padding:5px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>'
      + '<td><input type="number" class="att-input" data-row="' + idx + '" data-field="manual" value="' + manualVal + '"' + extMark + ' style="width:70px;padding:5px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>'
      + excludeCell
      + '</tr>';
  }).join('');

  const excludeHeader = showExcludeCol ? '<th style="font-size:11px;">제외</th>' : '';
  area.innerHTML = '<div class="table-scroll"><table>'
    + '<thead><tr><th style="position:sticky;left:0;background:#111113;"><input type="checkbox" id="attCheckAll" onchange="toggleAttCheckAll(this)"></th><th>날짜</th><th>TO</th><th>재직인원</th><th>' + cfg.manualLabel + '</th>' + excludeHeader + '</tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:6px;">' + attRangeRows.length + '개 영업일 · 초록색 배경은 근태파일에서 자동 추출된 값입니다. 값은 직접 클릭해 수정하거나, 체크박스로 여러 날짜를 선택해 일괄수정할 수 있습니다' + (showExcludeCol ? ' · "제외" 열을 체크하면 그 날짜는 저장에서 빠집니다' : '') + '</p>';
  updateAttCheckedCount();
}

function toggleAttCheckAll(el) {
  document.querySelectorAll('.att-check').forEach(function(c) { c.checked = el.checked; });
  updateAttCheckedCount();
}

function updateAttCheckedCount() {
  const count = document.querySelectorAll('.att-check:checked').length;
  const countEl = document.getElementById('attCheckedCount');
  if (countEl) countEl.textContent = String(count);
}

// 체크된 날짜(들)에 한해, 값이 입력된 필드만 골라 일괄 반영 (TO/재직인원/투입인원 중 원하는 것만 선택 가능)
function applyAttBulkEdit() {
  const checked = Array.from(document.querySelectorAll('.att-check:checked')).map(function(c) { return c.dataset.row; });
  if (checked.length === 0) { alert('먼저 일괄수정할 날짜를 체크해 주세요.'); return; }

  const toVal = document.getElementById('attBulkTO').value;
  const staffVal = document.getElementById('attBulkStaff').value;
  const manualVal = document.getElementById('attBulkManual').value;
  if (toVal === '' && staffVal === '' && manualVal === '') { alert('TO·재직인원·투입인원 중 최소 하나는 값을 입력해 주세요.'); return; }

  checked.forEach(function(idx) {
    if (toVal !== '') document.querySelector('.att-input[data-row="' + idx + '"][data-field="to"]').value = toVal;
    if (staffVal !== '') document.querySelector('.att-input[data-row="' + idx + '"][data-field="staff"]').value = staffVal;
    if (manualVal !== '') document.querySelector('.att-input[data-row="' + idx + '"][data-field="manual"]').value = manualVal;
  });

  document.getElementById('attBulkTO').value = '';
  document.getElementById('attBulkStaff').value = '';
  document.getElementById('attBulkManual').value = '';

  const statusEl = document.getElementById('attStatus');
  statusEl.className = 'status-msg ok';
  statusEl.textContent = checked.length + '개 날짜에 값을 적용했습니다. (아래 "저장" 버튼을 눌러야 실제 저장됩니다)';
}

// 근태 날짜범위를 기준으로, 그 범위 안에 있는 날짜의 실적(위쪽 붙여넣기)까지 함께 저장.
// 근태 범위에 없는 날짜의 실적 데이터는 자동으로 제외한다.
async function saveAttAndPerfCombined() {
  const cfg = ATTENDANCE_SEMI_AUTO[currentCenter];
  const statusEl = document.getElementById('attStatus');
  const token = centerTokenMap[currentCenter];
  if (attRangeRows.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '먼저 기간을 적용해 주세요.'; return; }

  parseMultiPaste(); // 위쪽 실적 붙여넣기 내용을 최신 상태로 반영

  const perfByDate = {};
  parsedRows.forEach(function(r, idx) { perfByDate[r.date] = idx; });
  const excludedPerfOnly = parsedRows.filter(function(r) { return attRangeRows.indexOf(r.date) === -1; }).map(function(r) { return r.date; });

  // LG전자AS/성수기·KB손보정비는 투입인원이 0명인 날짜는 공휴일 여부와 무관하게 저장 대상에서 제외한다.
  const skipZeroManual = (currentCenter === 'lge' || currentCenter === 'lge_seongsu' || currentCenter === 'kbjeongbi');
  const skippedDates = [];
  const saveIdx = [];
  attRangeRows.forEach(function(date, idx) {
    const manualInput = document.querySelector('.att-input[data-row="' + idx + '"][data-field="manual"]');
    const manualVal = Number(manualInput ? manualInput.value : 0);
    if (skipZeroManual && manualVal === 0) { skippedDates.push(date); return; }
    saveIdx.push(idx);
  });

  statusEl.className = 'status-msg';
  statusEl.textContent = '저장 중... (' + saveIdx.length + '건 한번에 반영)';

  const entries = saveIdx.map(function(idx) {
    const date = attRangeRows[idx];
    const toVal = document.querySelector('.att-input[data-row="' + idx + '"][data-field="to"]').value;
    const staffVal = document.querySelector('.att-input[data-row="' + idx + '"][data-field="staff"]').value;
    const manualVal = document.querySelector('.att-input[data-row="' + idx + '"][data-field="manual"]').value;

    const values = {};
    values[cfg.toKey] = { value: toVal, group: 'attendance' };
    values[cfg.staffKey] = { value: staffVal, group: 'attendance' };
    values[cfg.manualKey] = { value: manualVal, group: 'attendance' };

    const perfIdx = perfByDate[date];
    if (perfIdx !== undefined) {
      const inputs = document.querySelectorAll('.template-input[data-row="' + perfIdx + '"]');
      inputs.forEach(function(inp) { values[inp.dataset.key] = { value: inp.value, group: inp.dataset.group }; });
    }
    return { report_date: date, values: values };
  });

  let success = 0, fail = entries.length;
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=manual-entry-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, entries: entries })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '저장 실패');
    success = data.count || entries.length;
    fail = 0;
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '저장 실패: ' + e.message;
    return;
  }

  // 저장이 실제로 성공했을 때만 업로드 자료함에 원본 파일을 반영한다.
  if (pendingAttArchiveFile) { uploadFileToArchive(pendingAttArchiveFile, '근태파일'); pendingAttArchiveFile = null; }
  if (pendingPerfArchiveFile) { uploadFileToArchive(pendingPerfArchiveFile, '실적파일'); pendingPerfArchiveFile = null; }

  const perfMatchedCount = attRangeRows.filter(function(d) { return perfByDate[d] !== undefined; }).length;
  let msg = success + '건 한번에 저장 완료 (근태 ' + attRangeRows.length + '일 중 실적 동반 반영 ' + perfMatchedCount + '일)';
  if (excludedPerfOnly.length) msg += '. 근태 범위에 없어 제외된 실적 날짜: ' + excludedPerfOnly.join(', ');
  if (skippedDates.length) msg += '. 투입인원 0명이라 제외된 날짜 ' + skippedDates.length + '건: ' + skippedDates.join(', ');

  statusEl.className = 'status-msg ok';
  statusEl.textContent = msg;

  attRangeRows = [];
  attExtractedByDate = {};
  document.getElementById('attTemplateArea').innerHTML = '';
  document.getElementById('attSaveBtn').style.display = 'none';
  document.getElementById('attCombinedSaveBtn').style.display = 'none';
  document.getElementById('attPerfOnlySaveBtn').style.display = 'none';
  document.getElementById('pasteBox').value = '';
  document.getElementById('manualSaveBtn').style.display = 'none';
  document.getElementById('manualSaveAttBtn').style.display = 'none';
  document.getElementById('manualSavePerfBtn').style.display = 'none';
  parsedRows = [];
  document.getElementById('templateArea').innerHTML = '';
  await loadOverviewForCurrent();
}

async function saveAttRangeRows() {
  const cfg = ATTENDANCE_SEMI_AUTO[currentCenter];
  const statusEl = document.getElementById('attStatus');
  const token = centerTokenMap[currentCenter];

  // LG전자AS/성수기·KB손보정비는 투입인원이 0명인 날짜(휴무·임시휴점 등)는 공휴일 여부와 무관하게 저장 대상에서 제외한다.
  const skipZeroManual = (currentCenter === 'lge' || currentCenter === 'lge_seongsu' || currentCenter === 'kbjeongbi');
  const skippedDates = [];
  const excludedDates = [];
  const saveIdx = [];
  attRangeRows.forEach(function(date, idx) {
    const excludeCb = document.querySelector('.att-exclude[data-row="' + idx + '"]');
    if (excludeCb && excludeCb.checked) { excludedDates.push(date); return; }
    const manualInput = document.querySelector('.att-input[data-row="' + idx + '"][data-field="manual"]');
    const manualVal = Number(manualInput ? manualInput.value : 0);
    if (skipZeroManual && manualVal === 0) { skippedDates.push(date); return; }
    saveIdx.push(idx);
  });

  statusEl.className = 'status-msg';
  statusEl.textContent = '저장 중... (' + saveIdx.length + '건 한번에 반영)';

  const entries = saveIdx.map(function(idx) {
    const date = attRangeRows[idx];
    const toVal = document.querySelector('.att-input[data-row="' + idx + '"][data-field="to"]').value;
    const staffVal = document.querySelector('.att-input[data-row="' + idx + '"][data-field="staff"]').value;
    const manualVal = document.querySelector('.att-input[data-row="' + idx + '"][data-field="manual"]').value;
    const values = {};
    values[cfg.toKey] = { value: toVal, group: 'attendance' };
    values[cfg.staffKey] = { value: staffVal, group: 'attendance' };
    values[cfg.manualKey] = { value: manualVal, group: 'attendance' };
    return { report_date: date, values: values };
  });

  let success = 0, fail = entries.length;
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=manual-entry-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, entries: entries })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '저장 실패');
    success = data.count || entries.length;
    fail = 0;
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '저장 실패: ' + e.message;
    return;
  }

  // 저장이 실제로 성공했을 때만 업로드 자료함에 근태파일을 반영한다.
  if (pendingAttArchiveFile) { uploadFileToArchive(pendingAttArchiveFile, '근태파일'); pendingAttArchiveFile = null; }

  let msg = success + '건 모두 한번에 저장 완료되었습니다.';
  if (excludedDates.length) msg += ' · "제외" 체크로 뺀 날짜 ' + excludedDates.length + '건: ' + excludedDates.join(', ');
  if (skippedDates.length) msg += ' · 투입인원 0명이라 제외된 날짜 ' + skippedDates.length + '건: ' + skippedDates.join(', ');
  statusEl.className = fail ? 'status-msg err' : 'status-msg ok';
  statusEl.textContent = msg;
  attRangeRows = [];
  attExtractedByDate = {};
  document.getElementById('attSaveBtn').style.display = 'none';
  document.getElementById('attCombinedSaveBtn').style.display = 'none';
  document.getElementById('attPerfOnlySaveBtn').style.display = 'none';
  document.getElementById('attTemplateArea').innerHTML = '';
  await loadOverviewForCurrent();
}

// 재직 및 투입현황 화면에서 "실적만 저장": 근태(TO/재직인원/투입인원)는 전혀 건드리지 않고,
// 위쪽 "일자별 실적 직접입력"에 붙여넣어둔 실적 데이터만 근태 기간(attRangeRows)과 겹치는 날짜에 반영한다.
async function saveAttPerfOnly() {
  const statusEl = document.getElementById('attStatus');
  const token = centerTokenMap[currentCenter];
  if (attRangeRows.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '먼저 기간을 적용해 주세요.'; return; }

  parseMultiPaste(); // 위쪽 실적 붙여넣기 내용을 최신 상태로 반영

  const perfByDate = {};
  parsedRows.forEach(function(r, idx) { perfByDate[r.date] = idx; });
  const matchedDates = attRangeRows.filter(function(d) { return perfByDate[d] !== undefined; });
  if (matchedDates.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '근태 기간과 겹치는 실적 데이터가 없습니다. 위쪽 "일자별 실적 직접입력"에 실적을 붙여넣어 주세요.'; return; }

  statusEl.className = 'status-msg';
  statusEl.textContent = '저장 중... (실적만 ' + matchedDates.length + '건 반영, 근태는 변경하지 않습니다)';

  const entries = matchedDates.map(function(date) {
    const perfIdx = perfByDate[date];
    const values = {};
    const inputs = document.querySelectorAll('.template-input[data-row="' + perfIdx + '"]');
    inputs.forEach(function(inp) { values[inp.dataset.key] = { value: inp.value, group: inp.dataset.group }; });
    return { report_date: date, values: values };
  });

  let success = 0;
  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=manual-entry-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, entries: entries })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '저장 실패');
    success = data.count || entries.length;
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '저장 실패: ' + e.message;
    return;
  }

  // 저장이 실제로 성공했을 때만 업로드 자료함에 실적파일을 반영한다.
  if (pendingPerfArchiveFile) { uploadFileToArchive(pendingPerfArchiveFile, '실적파일'); pendingPerfArchiveFile = null; }

  const notMatched = attRangeRows.filter(function(d) { return perfByDate[d] === undefined; });
  let msg = success + '건 실적만 저장 완료(근태 값은 변경하지 않았습니다).';
  if (notMatched.length) msg += ' 실적 데이터가 없어 제외된 날짜 ' + notMatched.length + '건: ' + notMatched.join(', ');
  statusEl.className = 'status-msg ok';
  statusEl.textContent = msg;

  // 근태 표는 아직 저장 전일 수 있으므로 그대로 유지하고, 실적 붙여넣기 칸만 정리한다.
  document.getElementById('pasteBox').value = '';
  document.getElementById('manualSaveBtn').style.display = 'none';
  document.getElementById('manualSaveAttBtn').style.display = 'none';
  document.getElementById('manualSavePerfBtn').style.display = 'none';
  parsedRows = [];
  document.getElementById('templateArea').innerHTML = '';
  await loadOverviewForCurrent();
}

let categorySchema = [];
let categoryParsedRows = [];

const CATEGORY_GUIDES = {
  'pyeongtaek': { image: 'data:image/png;base64,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', sample: ['1,493','99','235','261','240','184','45','75','80','16','11','219','28'], date: '6/1' }
};

function renderCategoryInputGuide() {
  const guide = CATEGORY_GUIDES[currentCenter];
  if (!guide || !categorySchema || categorySchema.length === 0) return '';

  const rows = categorySchema.map(function(col, i) {
    const sample = guide.sample[i] !== undefined ? guide.sample[i] : '-';
    return '<tr><td style="padding:5px 8px;color:#86868b;">' + (i + 1) + '</td>'
      + '<td style="padding:5px 8px;">' + col.key + '</td>'
      + '<td style="padding:5px 8px;font-family:monospace;">' + sample + '</td></tr>';
  }).join('');

  return '<details class="panel" style="max-width:100%;margin-top:16px;">'
    + '<summary style="cursor:pointer;font-weight:700;font-size:14px;line-height:1.5;">사용설명보기<br><span style="font-size:12px;font-weight:400;color:#86868b;">(원본 양식 예시 · 항목 대응표)</span></summary>'
    + '<div style="margin-top:14px;">'
    + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;"><b>1) 원본 양식 예시</b> (<span style="color:#FE2E36;font-weight:700;">' + guide.date + '</span> 데이터 기준) — "건수" 행의 합계부터 기타까지를 순서대로 복사하시면 됩니다. "응대율(%)" 행은 입력하지 않아도 자동 계산됩니다.</p>'
    + '<img src="' + guide.image + '" onclick="openImageLightbox(this.src)" title="클릭하면 크게 보기" style="max-width:100%;border:1px solid #2c2c2e;border-radius:8px;margin-bottom:16px;cursor:zoom-in;">'
    + '<p style="font-size:13px;color:#a1a1a6;margin-bottom:8px;"><b>2) 항목 대응표</b> (총 ' + categorySchema.length + '개 항목, 예시는 <span style="color:#FE2E36;font-weight:700;">' + guide.date + '</span> 데이터 기준)</p>'
    + '<div class="table-scroll" style="max-height:320px;overflow-y:auto;">'
    + '<table><thead><tr><th>순서</th><th>표준 항목명</th><th>예시값(건수)</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '</div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:10px;">※ "합계"는 반드시 첫 번째 항목이어야 하며, 나머지 항목의 비중(%)은 합계 대비 자동 계산됩니다.</p>'
    + '</div></details>';
}

function renderCategoryEntryPanel() {
  if (!categorySchema || categorySchema.length === 0) return '';
  const thisYear = new Date().getFullYear();
  const guideHtml = currentCenter === 'pyeongtaek' ? '' : renderCategoryInputGuide(); // 평택시청은 상단 통합 가이드로 대체
  return guideHtml
    + '<div class="entry-wrap panel" style="margin-top:16px;">'
    + '<h3>업무유형별 인입현황 입력</h3>'
    + '<div class="entry-row"><label>기준 연도</label><input type="number" id="categoryEntryYear" value="' + thisYear + '" style="width:90px;"></div>'
    + '<p style="font-size:13px;color:#a1a1a6;margin:10px 0 6px;">날짜 다음에 "합계"부터 "기타"까지 건수만 순서대로 붙여넣으세요 (응대율/비중은 자동 계산됩니다)</p>'
    + '<textarea class="paste-box" id="categoryPasteBox" style="min-height:70px;" placeholder="6/1	1493	99	235	261	240	184	45	75	80	16	11	219	28"></textarea>'
    + '<button class="btn-secondary" onclick="parseCategoryPaste()">양식에 반영</button>'
    + '<button class="btn-primary" id="categorySaveBtn" style="display:none;" onclick="saveCategoryRows()">전체 저장</button>'
    + '<div class="status-msg" id="categoryStatus"></div>'
    + '<div id="categoryTemplateArea" style="margin-top:16px;"></div>'
    + '</div>'
    + renderPtCategoryItemShell();
}

// 엑셀에서 복사하면 탭(Tab)으로 구분되지만, 직접 타이핑하거나 채팅에서 붙여넣으면
// 공백으로 구분되는 경우가 많아 둘 다 지원한다.
function splitLineTokens(line) {
  return line.includes('\t')
    ? line.split('\t').map(function(t) { return t.trim(); })
    : line.trim().split(/\s+/);
}

function parseCategoryPaste() {
  const raw = document.getElementById('categoryPasteBox').value;
  const statusEl = document.getElementById('categoryStatus');
  const year = document.getElementById('categoryEntryYear').value;
  const lines = raw.split('\n').map(function(l) { return l.replace(/\r$/, ''); }).filter(function(l) { return l.trim() !== ''; });
  if (lines.length === 0) return;

  const errors = [];
  categoryParsedRows = [];
  lines.forEach(function(line, li) {
    const tokens = splitLineTokens(line);
    const dateToken = tokens[0];
    const values = tokens.slice(1);
    if (values.length !== categorySchema.length) { errors.push('줄 ' + (li + 1) + ' (' + (dateToken || '날짜없음') + '): 항목 수 ' + values.length + '개 / 필요 ' + categorySchema.length + '개 — 제외됩니다.'); return; }
    const isoDate = toIsoDate(dateToken, year);
    if (!isoDate) { errors.push('줄 ' + (li + 1) + ': 날짜 인식 실패("' + dateToken + '") — 제외됩니다.'); return; }
    categoryParsedRows.push({ date: isoDate, values: values });
  });

  statusEl.className = errors.length ? 'status-msg err' : 'status-msg';
  statusEl.innerHTML = errors.length ? errors.join('<br>') : '';
  renderCategoryPreview();
  document.getElementById('categorySaveBtn').style.display = categoryParsedRows.length ? 'inline-block' : 'none';
}

function renderCategoryPreview() {
  const area = document.getElementById('categoryTemplateArea');
  if (categoryParsedRows.length === 0) { area.innerHTML = '<p class="empty">반영할 데이터가 없습니다.</p>'; return; }

  const totalIdx = 0; // "합계"는 항상 첫 항목
  const headCells = categorySchema.map(function(c) { return '<th style="text-align:center;">' + c.key + '</th>'; }).join('');
  const bodyRows = categoryParsedRows.map(function(row, ri) {
    const total = parseFloat(String(row.values[totalIdx]).replace(/,/g, '')) || 0;
    const cells = row.values.map(function(v, ci) {
      return '<td><input type="text" class="category-input" data-row="' + ri + '" data-idx="' + ci + '" data-key="' + categorySchema[ci].key + '" value="' + v + '" style="width:64px;padding:5px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;" oninput="renderCategoryShareRow(' + ri + ')"></td>';
    }).join('');
    const shares = row.values.map(function(v, ci) {
      if (ci === totalIdx || total === 0) return '<td style="color:#86868b;">-</td>';
      const n = parseFloat(String(v).replace(/,/g, '')) || 0;
      return '<td style="color:#86868b;" id="catShare_' + ri + '_' + ci + '">' + (n / total * 100).toFixed(1) + '%</td>';
    }).join('');
    return '<tr><td style="position:sticky;left:0;background:#1d1d1f;font-weight:600;">' + row.date + ' (건수)</td>' + cells + '</tr>'
      + '<tr><td style="position:sticky;left:0;background:#1d1d1f;color:#86868b;">비중(%)</td>' + shares + '</tr>';
  }).join('');

  area.innerHTML = '<div class="table-scroll"><table>'
    + '<thead><tr><th style="position:sticky;left:0;background:#111113;">날짜</th>' + headCells + '</tr></thead>'
    + '<tbody>' + bodyRows + '</tbody></table></div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:6px;">' + categoryParsedRows.length + '개 날짜 · 비중(%)은 합계 대비 자동 계산되며 저장 시 함께 기록됩니다</p>';
}

function renderCategoryShareRow(ri) {
  const total = parseFloat((document.querySelector('.category-input[data-row="' + ri + '"][data-idx="0"]') || {}).value || '0') || 0;
  categorySchema.forEach(function(c, ci) {
    if (ci === 0) return;
    const el = document.getElementById('catShare_' + ri + '_' + ci);
    if (!el) return;
    const inp = document.querySelector('.category-input[data-row="' + ri + '"][data-idx="' + ci + '"]');
    const n = parseFloat((inp && inp.value) || '0') || 0;
    el.textContent = total ? (n / total * 100).toFixed(1) + '%' : '-';
  });
}

async function saveCategoryRows() {
  const statusEl = document.getElementById('categoryStatus');
  const token = centerTokenMap[currentCenter];
  let success = 0, fail = 0;
  const failDates = [];
  const BATCH_SIZE = 5;
  statusEl.className = 'status-msg';

  for (let start = 0; start < categoryParsedRows.length; start += BATCH_SIZE) {
    const batchIdx = [];
    for (let i = start; i < Math.min(start + BATCH_SIZE, categoryParsedRows.length); i++) batchIdx.push(i);

    statusEl.textContent = '저장 중... (' + Math.min(start + BATCH_SIZE, categoryParsedRows.length) + '/' + categoryParsedRows.length + ')';

    const results = await Promise.all(batchIdx.map(function(idx) {
      const row = categoryParsedRows[idx];
      const inputs = document.querySelectorAll('.category-input[data-row="' + idx + '"]');
      const values = {};
      const total = parseFloat((document.querySelector('.category-input[data-row="' + idx + '"][data-idx="0"]') || {}).value || '0') || 0;
      inputs.forEach(function(inp) {
        values[inp.dataset.key] = { value: inp.value, group: 'performance' };
        if (inp.dataset.idx !== '0') {
          const n = parseFloat(inp.value || '0') || 0;
          values[inp.dataset.key + '_비중'] = { value: total ? (n / total * 100).toFixed(1) : '0', group: 'performance' };
        }
      });
      return fetch(SB_FUNCTION_URL + '?action=manual-entry', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, report_date: row.date, values: values })
      }).then(function(res) { return res.json(); })
        .then(function(data) { return { date: row.date, ok: !!data.success }; })
        .catch(function() { return { date: row.date, ok: false }; });
    }));

    results.forEach(function(r) { if (r.ok) success++; else { fail++; failDates.push(r.date); } });
  }

  statusEl.className = fail ? 'status-msg err' : 'status-msg ok';
  statusEl.textContent = fail ? (success + '건 저장 완료, ' + fail + '건 실패 (' + failDates.join(', ') + ')') : (success + '건 모두 저장 완료되었습니다.');
  document.getElementById('categoryPasteBox').value = '';
  document.getElementById('categorySaveBtn').style.display = 'none';
  categoryParsedRows = [];
  document.getElementById('categoryTemplateArea').innerHTML = '';
  await loadOverviewForCurrent();
  return success > 0;
}

function parseMultiPaste() {
  const raw = document.getElementById('pasteBox').value;
  const statusEl = document.getElementById('manualStatus');
  const year = document.getElementById('entryYear').value;
  const lines = raw.split('\n').map(function(l) { return l.replace(/\r$/, ''); }).filter(function(l) { return l.trim() !== ''; });
  if (lines.length === 0) return;
  if (!rowSchema || rowSchema.length === 0) { statusEl.className = 'status-msg err'; statusEl.textContent = '입력양식이 아직 로드되지 않았습니다.'; return; }

  const errors = [];
  parsedRows = [];
  lines.forEach(function(line, li) {
    const tokens = splitLineTokens(line);
    const dateToken = tokens[0];
    const values = tokens.slice(1);
    if (values.length !== rowSchema.length) { errors.push('줄 ' + (li + 1) + ' (' + (dateToken || '날짜없음') + '): 항목 수 ' + values.length + '개 / 필요 ' + rowSchema.length + '개 — 제외됩니다.'); return; }
    const isoDate = toIsoDate(dateToken, year);
    if (!isoDate) { errors.push('줄 ' + (li + 1) + ': 날짜 인식 실패("' + dateToken + '") — 제외됩니다.'); return; }
    parsedRows.push({ date: isoDate, dateLabel: dateToken, values: values });
  });

  statusEl.className = errors.length ? 'status-msg err' : 'status-msg';
  statusEl.innerHTML = errors.length ? errors.join('<br>') : '';
  renderPreviewTable();
  document.getElementById('manualSaveBtn').style.display = parsedRows.length ? 'inline-block' : 'none';
}

function toIsoDate(token, fallbackYear) {
  if (!token) return null;
  token = token.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const m = token.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (m) { return fallbackYear + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); }
  return null;
}

function renderPreviewTable() {
  const area = document.getElementById('templateArea');
  const attBtnEl = document.getElementById('manualSaveAttBtn');
  const perfBtnEl = document.getElementById('manualSavePerfBtn');
  if (parsedRows.length === 0) { area.innerHTML = '<p class="empty">반영할 데이터가 없습니다.</p>'; if (attBtnEl) attBtnEl.style.display = 'none'; if (perfBtnEl) perfBtnEl.style.display = 'none'; return; }
  const cols = parseGroups();
  if (cols.length === 0) { area.innerHTML = '<p style="color:#FF6B70;font-size:13px;">입력양식(row_schema)이 없어 표를 표시할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.</p>'; if (attBtnEl) attBtnEl.style.display = 'none'; if (perfBtnEl) perfBtnEl.style.display = 'none'; return; }
  if (cols.length !== parsedRows[0].values.length) { area.innerHTML = '<p style="color:#FF6B70;font-size:13px;">입력양식 항목 수(' + cols.length + '개)와 추출된 값 개수(' + parsedRows[0].values.length + '개)가 일치하지 않습니다.</p>'; if (attBtnEl) attBtnEl.style.display = 'none'; if (perfBtnEl) perfBtnEl.style.display = 'none'; return; }
  const groupCells = [];
  let i = 0;
  while (i < cols.length) {
    let span = 1;
    while (i + span < cols.length && cols[i + span].dispGroup === cols[i].dispGroup) span++;
    groupCells.push('<th colspan="' + span + '" style="text-align:center;background:#FFF6DC;color:#60584C;">' + cols[i].dispGroup + '</th>');
    i += span;
  }
  const labelCells = cols.map(function(c) { return '<th style="text-align:center;">' + c.label + '</th>'; }).join('');
  const bodyRows = parsedRows.map(function(row, ri) {
    const cells = row.values.map(function(v, ci) {
      return '<td><input type="text" class="template-input" data-row="' + ri + '" data-idx="' + ci + '" data-key="' + cols[ci].key + '" data-group="' + cols[ci].origGroup + '" value="' + v + '" style="width:64px;padding:5px;border:1px solid #2c2c2e;border-radius:4px;font-size:12px;text-align:center;"></td>';
    }).join('');
    return '<tr><td style="position:sticky;left:0;background:#1d1d1f;font-weight:600;">' + row.date + '</td>' + cells + '</tr>';
  }).join('');

  // 근태 컬럼과 실적 컬럼이 한 양식에 함께 있는 센터(예: KB손보부천)는 "전체 저장" 옆의
  // "근태만 저장"/"실적만 저장" 버튼을 보여준다 (기존 데이터 중 한쪽만 새로 반영하고 싶은 경우 등)
  const hasAttGroup = cols.some(function(c) { return c.origGroup === 'attendance'; });
  const hasPerfGroup = cols.some(function(c) { return c.origGroup !== 'attendance'; });
  const showGroupBtns = hasAttGroup && hasPerfGroup;
  if (attBtnEl) attBtnEl.style.display = showGroupBtns ? 'inline-block' : 'none';
  if (perfBtnEl) perfBtnEl.style.display = showGroupBtns ? 'inline-block' : 'none';

  area.innerHTML = '<div class="table-scroll"><table><thead><tr><th style="position:sticky;left:0;background:#111113;">날짜</th>' + groupCells.join('') + '</tr><tr><th style="position:sticky;left:0;background:#111113;"></th>' + labelCells + '</tr></thead><tbody>' + bodyRows + '</tbody></table></div>'
    + '<p style="font-size:12px;color:#86868b;margin-top:6px;">' + parsedRows.length + '개 날짜 · 값은 직접 클릭해 수정할 수 있습니다' + (showGroupBtns ? ' · "근태만 저장"/"실적만 저장"은 한쪽만 이 표 내용으로 덮어쓰고 나머지 한쪽은 그대로 둡니다' : '') + '</p>';
}

function parseGroups() {
  return rowSchema.map(function(col) {
    const idx = col.key.indexOf('_');
    const dispGroup = idx > -1 ? col.key.slice(0, idx) : (col.group === 'attendance' ? '근태' : '실적');
    const label = idx > -1 ? col.key.slice(idx + 1) : col.key;
    return { key: col.key, origGroup: col.group, dispGroup: dispGroup, label: label };
  });
}

async function saveAllRows(groupFilter) {
  const statusEl = document.getElementById('manualStatus');
  const token = centerTokenMap[currentCenter];
  const groupLabel = groupFilter === 'attendance' ? '근태만' : groupFilter === 'performance' ? '실적만' : '전체';
  statusEl.className = 'status-msg';
  statusEl.textContent = '저장 중... (' + parsedRows.length + '건, ' + groupLabel + ' 반영)';

  const entries = parsedRows.map(function(row, idx) {
    const inputs = document.querySelectorAll('.template-input[data-row="' + idx + '"]');
    const values = {};
    inputs.forEach(function(inp) {
      // groupFilter가 지정된 경우, 다른 그룹(예: 실적만 저장인데 근태 컬럼)은 아예 전송하지 않아
      // 서버에 이미 저장돼 있던 값이 덮어써지지 않도록 한다.
      if (groupFilter === 'attendance' && inp.dataset.group !== 'attendance') return;
      if (groupFilter === 'performance' && inp.dataset.group === 'attendance') return;
      values[inp.dataset.key] = { value: inp.value, group: inp.dataset.group };
    });
    return { report_date: row.date, values: values };
  });

  try {
    const res = await fetch(SB_FUNCTION_URL + '?action=manual-entry-bulk', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, entries: entries })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '저장 실패');
    statusEl.className = 'status-msg ok';
    statusEl.textContent = (data.count || entries.length) + '건 (' + groupLabel + ') 저장 완료되었습니다.';
  } catch (e) {
    statusEl.className = 'status-msg err';
    statusEl.textContent = '저장 실패: ' + e.message;
    return false;
  }

  // 저장이 실제로 성공했을 때만 업로드 자료함에 원본 파일을 반영한다.
  if (pendingPerfArchiveFile) { uploadFileToArchive(pendingPerfArchiveFile, '실적파일'); pendingPerfArchiveFile = null; }

  document.getElementById('pasteBox').value = '';
  document.getElementById('manualSaveBtn').style.display = 'none';
  document.getElementById('manualSaveAttBtn').style.display = 'none';
  document.getElementById('manualSavePerfBtn').style.display = 'none';
  parsedRows = [];
  document.getElementById('templateArea').innerHTML = '';
  await loadOverviewForCurrent();
  return true;
}

function exportData() { return JSON.stringify(allRows, null, 2); }

async function copyToClipboard() {
  const msg = document.getElementById('backupMsg');
  try {
    await navigator.clipboard.writeText(exportData());
    msg.textContent = '전체 ' + allRows.length + '건이 클립보드에 복사되었습니다.';
  } catch (e) { msg.textContent = '클립보드 복사 실패: ' + e.message; }
}

function downloadFile() {
  const blob = new Blob([exportData()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = localDateStr(new Date());
  a.href = url; a.download = 'kkangbi_report_backup_' + today + '.json';
  a.click();
  URL.revokeObjectURL(url);
  document.getElementById('backupMsg').textContent = '파일 다운로드가 시작되었습니다.';
}

async function pasteFromClipboard() {
  const msg = document.getElementById('backupMsg');
  try {
    const text = await navigator.clipboard.readText();
    await restoreData(text);
  } catch (e) { msg.textContent = '클립보드 읽기 실패: ' + e.message; }
}

function uploadFile(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function() { restoreData(reader.result); };
  reader.readAsText(file);
}

async function restoreData(jsonText) {
  const msg = document.getElementById('backupMsg');
  let records;
  try { records = JSON.parse(jsonText); } catch (e) { msg.textContent = 'JSON 형식이 올바르지 않습니다.'; return; }
  if (!Array.isArray(records)) { msg.textContent = '배열 형태의 백업 데이터가 아닙니다.'; return; }

  let success = 0, skipped = 0;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const token = centerTokenMap[rec.center_code];
    if (!token || !rec.report_date) { skipped++; continue; }
    const values = {};
    Object.entries(rec.attendance_data || {}).forEach(function(entry) { values[entry[0]] = { value: entry[1], group: 'attendance' }; });
    Object.entries(rec.performance_data || {}).forEach(function(entry) { values[entry[0]] = { value: entry[1], group: 'performance' }; });

    msg.textContent = '복원 중... (' + (success + skipped + 1) + '/' + records.length + ')';
    try {
      const res = await fetch(SB_FUNCTION_URL + '?action=manual-entry', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + SB_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, report_date: rec.report_date, values: values })
      });
      const data = await res.json();
      if (data.success) success++; else skipped++;
    } catch (e) { skipped++; }
  }
  msg.textContent = '복원 완료: ' + success + '건 성공, ' + skipped + '건 제외(토큰 미등록 센터 포함)';
  await loadOverviewForCurrent();
  renderMain();
}

init();
