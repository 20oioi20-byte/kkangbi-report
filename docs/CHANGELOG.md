# CHANGELOG.md

> 최신 항목이 위로 오도록 기록합니다. SQL 실행이 필요한 항목은 관련 `schema_addendum_N_*.sql` 파일명을 함께 적습니다.

## 2026-07-17 (2차) — LG전자통합 데이터입력 일괄입력 UI 개편
- **요청 배경**: 날짜별 체크박스로 선택하고 필드 하나+값 하나를 골라 "선택 날짜에 일괄 적용"하던 기존 방식(2026-07-16 2차)을 제거하고, 표 맨 위에서 항목별로 값을 바로 입력하는 방식으로 바꿔달라는 요청.
- **변경**: `generateLgeTotalRows()`에서 날짜별 체크박스 열과 "전체선택/전체해제" 버튼, 필드 선택 드롭다운+값 입력+"선택 날짜에 일괄 적용" 버튼을 모두 제거. 대신 표(tbody) 맨 위에 "일괄입력" 행을 추가해 AS/성수기 10칸 + 실적 4칸(T-NPS/생산성 IN+OUT/생산성 IN/통화시간)에 각각 값을 입력할 수 있게 하고, 칸마다 "전체반영" 버튼을 둬서 그 항목만 표에 보이는 모든 날짜에 채워지도록 함(`applyLgeTotalColumn`). 표 아래에는 "⚡ 전체 항목 전체반영" 버튼을 추가해, 일괄입력 행에 값이 채워진 항목을 전부 한 번에 전체 날짜에 반영(`applyLgeTotalAllColumns`). 기존 `lgeTotalToggleAll`/`applyLgeTotalBulk` 함수는 삭제.
- 날짜 개별 선택 개념이 없어져 항상 "지금 표에 나와 있는 전체 날짜"가 적용 대상이 됨(기존처럼 기간을 좁혀 표를 만들면 그 기간 전체가 대상).
- 저장(`saveLgeTotalRows`) 로직은 무변경 — 일괄입력 행 값은 실제 저장 대상이 아니라 각 날짜 행의 입력칸을 채우는 용도일 뿐이라 기존 저장 흐름 그대로 재사용됨.
- SQL 변경 없음. `node --check` 문법 통과, 로컬 정적 서버로 렌더링·항목별 전체반영·전체 항목 전체반영 동작 확인함(가짜 seed 데이터로 테스트, 실제 Supabase 데이터로는 재검증 필요).
- `docs/FEATURE.md` 15번 섹션 갱신함.

## 2026-07-17 — 파일 분리: admin.html → admin.html + style.css + app.js
- **목적**: 단일 파일이 6,500줄까지 커지면서 기능 추가/버그 수정 때마다 전체 파일을 훑어야 해 토큰 소모가 컸음. 토큰 절감 3가지 제안 중 1순위(파일 분리)를 사용자가 선택해 진행.
- **변경**: 기존 `admin.html`의 `<style>...</style>` 내용을 `style.css`로, 거대한 `<script>...</script>`(6,300여 줄) 내용을 `app.js`로 각각 추출. `admin.html`은 `<link rel="stylesheet" href="style.css">` + `<script src="app.js"></script>`만 남긴 얇은 뼈대가 됨.
- **기능/화면 변경 없음**: 브라우저가 파일을 나눠서 불러오는 것뿐, 화면 구성·동작 방식·기능은 100% 동일. `app.js`는 `node --check`로 문법 검증 통과.
- **주의(배포)**: 이제 세 파일을 **같은 폴더에 함께** 두 배포처 모두에 올려야 함. `style.css`/`app.js` 없이 `admin.html`만 올리면 화면이 깨지거나 완전히 빈 화면이 됨. `DEPLOY-CHECKLIST.md`/`SYSTEM.md`/`AGENTS.md`에 이 구조 반영해 갱신함.
- Chart.js/XLSX CDN 스크립트, jsdelivr 실패시 unpkg 폴백용 부트스트랩 스크립트는 여전히 `admin.html`에 인라인으로 남아있음(순서 민감성 때문에 그대로 유지).
- **앞으로의 작업 방식**: 로직 수정은 `app.js`만, 스타일 수정은 `style.css`만 전체 교체해서 드리면 됨 — `admin.html`은 거의 안 바뀜.

## 2026-07-16 (2차) — 화면 반응속도 개선 + LG전자통합 일괄입력
- **화면 반응속도**: 센터 전환/새로고침시 캐시(세션 메모리 + localStorage)가 있으면 네트워크 응답을 기다리지 않고 먼저 그 데이터로 화면을 그리고, 실제 최신 데이터가 도착하면 **캐시와 다를 때만** 조용히 재렌더링(같으면 아무 것도 안 함). `loadOverviewForCurrent()`가 "데이터가 실제로 바뀌었는지" boolean을 반환하도록 변경, `selectCenter()`/`init()`이 이를 활용. 응답이 늦게 와서 그 사이 다른 센터로 이동한 경우 옛 응답으로 화면을 덮어쓰지 않도록 가드 추가.
- **LG전자통합 일괄입력**: 날짜별 체크박스 + 전체선택/해제 + "선택 날짜에 일괄 적용"(필드 선택 + 값 입력 → 체크된 날짜 전부에 한 번에 채움, AS/성수기면 합계도 같이 재계산).
- LG전자통합 데이터입력 미반영 문의는 새로고침으로 해결됨(배포/캐시 지연이었던 것으로 추정, 코드 문제 아님).

## 2026-07-16 — LG전자통합 신규 센터
- 기존 LG전자AS/LG전자성수기는 그대로 두고, **완전히 독립된 신규 센터 "LG전자통합"(`lge_total`)** 추가. 두 원본 센터 데이터를 자동으로 끌어오지 않음(사용자 확인: "완전히 새롭게 만든다").
- 데이터입력은 파일첨부/붙여넣기가 아니라 **항목별 숫자 입력 전용 폼**으로 구성(`renderIntegratedFormEntry`, `INTEGRATED_FORM_CENTERS`). 이 센터를 선택하면 기존 추출/붙여넣기 카드는 아예 안 뜨고 이 폼만 나옴.
- 입력 항목: 날짜 / TO·총재직인원·관리자재직인원·상담사재직인원·상담사투입인원(각각 AS·성수기·합계) / T-NPS / 생산성_INOUT / 생산성_IN / 통화시간.
- TO·재직인원·투입인원 5개 항목은 **직전 저장일 값을 자동 이월**(사람이 확인한 의미: AS/성수기 값은 인원변동 있을 때만 수정하면 되도록), 합계는 AS+성수기 실시간 자동계산. T-NPS/생산성/통화시간은 이월 없이 매일 새로 입력.
- 저장/조회/수정/삭제는 기존 `manual-entry-bulk`/데이터조회 패널을 그대로 재사용(신규 백엔드 액션 없음, index.ts 변경 없음). "수정하기"만 이 센터 전용 폼으로 불러오도록 프론트엔드에서 분기.
- **SQL 신규**: `schema_addendum_11_lge_total_center.sql` — `center_config`에 `lge_total` 센터 등록(기본 비밀번호 000000).
- 알려진 제한: 대시보드 상단 "전체 재직인원(TO대비) %" 요약카드는 이 센터에 아직 없음(TO 자체가 매일 값이 바뀌는 입력 항목이라 기존 고정-TO_TARGET 구조와 안 맞음). 주요지표 리스트(일평균/누적평균)는 정상 표시됨.
- 검증 필요: SQL 실행 → 사이드바 노출 확인 → 기간 적용시 전날 값 이월 확인 → 합계 실시간 계산 확인 → 저장 후 수정 플로우 확인.

## 2026-07-15 — 🔴 장애: 사이트 전체 먹통(센터 목록 빈 화면) 원인 및 수정
- **증상**: `report.깡비서.kr`/`kkangbi-report.vercel.app` 둘 다 사이드바 센터 목록이 완전히 빈 화면으로 나옴. Supabase Table Editor에서 `center_config`/`center_daily_performance` 데이터는 그대로 있음을 확인 — **DB 데이터 유실이 아니라 Edge Function이 요청을 처리하지 못하는 상태**였음.
- **증거**: 브라우저 콘솔에 `Access to fetch ... has been blocked by CORS policy` 에러. 정상이라면 이 함수는 OPTIONS 프리플라이트에도 항상 CORS 헤더를 반환하도록 짜여 있어서, 이 에러는 **함수가 요청 처리 시작 전(모듈 로드 단계)에 죽고 있다는 신호**였음. Edge Function 로그의 "booted → 수 초 내 shutdown 반복"도 같은 크래시 루프 정황.
- **원인**: `index.ts` 최상단의 `import mammoth from 'https://esm.sh/mammoth@1.6.0';`(AI 기능 추가 이전부터 있던 기존 코드, 제가 건드리지 않은 줄)에서 `deno check`가 `TS1192: has no default export` 에러를 냄. esm.sh가 서빙하는 mammoth 타입 선언이 최근에 바뀌면서, 원래 잘 동작하던 코드가 배포 시점의 타입체크를 통과하지 못하게 된 것으로 추정.
- **수정**: `import mammoth from '...'` (default import) → `import * as mammothNs from '...'; const mammoth: any = (mammothNs as any).default ?? mammothNs;`로 변경. 런타임 동작은 동일, 타입체크만 회피.
- **검증**: 로컬에 Deno를 설치해 실제로 `deno check index.ts`를 돌려 수정 전 에러 재현 → 수정 후 에러 0건(exit code 0) 확인. `esbuild`로 순수 구문 오류도 별도 확인(이상 없음).
- **후속 조치 필요**: 재배포 후 (1) 사이드바 센터 목록 복구 확인 (2) 이번 기회에 AI 보조기능/즉시발송도 함께 재검증 (3) 혹시 백업해둔 이전 index.ts로 이미 롤백하셨다면, 이번 수정본으로 다시 교체 배포.

## 2026-07-13 (9차)
- **시크릿 통일**: AI 보조기능이 새로 만든 `SOGANG_MOT_API_URL`/`SOGANG_MOT_API_KEY` 대신, 다른 kkangbi 프로젝트에서 이미 쓰던 `MOT_GATEWAY_URL`/`MOT_GATEWAY_KEY`를 사용하도록 변경(값은 동일하다고 확인됨). 새로 등록하셨던 `SOGANG_MOT_API_URL`/`SOGANG_MOT_API_KEY`는 이제 안 쓰이니, 정리하려면 Supabase Secrets에서 삭제하셔도 됩니다(안 지워도 무해함).
- **SendGrid 관련 확인**: 시크릿 목록 확인 결과 `SENDGRID_API_KEY`는 이미 등록되어 있음. 지난 "0건 발송" 원인이 키 누락이 아니라 **`SENDGRID_FROM_EMAIL` 미등록으로 인한 발신자 미인증(SendGrid 403)일 가능성**으로 정정 — 재배포 후 즉시발송 실패 사유 컬럼에서 실제 원인 확인 필요.
- **즉시발송 센터별/전체 분리**: "⚡ 이 센터만 즉시발송"(알림설정에서 선택된 센터 1곳만) / "⚡⚡ 전체 센터 즉시발송"(활성 센터 전체) 버튼으로 분리. 백엔드 `send-notification-now`가 `center_code`를 선택적으로 받아 `runNotificationCheck(settings, forceSend, centerCodeFilter)`로 대상 범위를 좁힘 — `check-and-notify`(매시 크론)는 기존처럼 필터 없이 전체 대상 그대로 동작.

## 2026-07-13 (8차) — 즉시발송 결과 진단 개선
- **문의 배경**: 즉시발송 테스트에서 "대상 3건 중 0건 성공"이 나왔는데, "대상 건수"(주의/경고 조건에 걸린 센터 수)와 화면에 보이는 "담당자 건수"(알림설정에서 선택한 센터 1곳만의 담당자 수)가 서로 다른 스코프라 혼동이 있었음 + 발송 실패 사유가 전혀 안 보여서 원인 파악 불가.
- **개선**: `sendNotificationEmail()`이 이제 성공/실패만이 아니라 **실패 사유**(`SENDGRID_API_KEY 시크릿 없음` / `SendGrid HTTP 4xx·5xx 응답 본문` / `네트워크 오류`)까지 반환. `runNotificationCheck()`가 이를 `notification_log`(`send_ok`, `send_error` 컬럼 신규)에 기록하고, "즉시 발송" 결과 화면도 집계 숫자 한 줄이 아니라 **센터별 표**(센터명/단계/성공·실패/실패사유)로 보여주도록 변경.
- **SQL 추가**: `schema_addendum_10_notification_manual.sql`에 `send_ok boolean`, `send_error text` 컬럼 추가(기존 `is_manual`과 함께 한 파일에 정리).
- 검증: 재배포 후 즉시발송을 다시 눌러 실패 사유 컬럼에 `SENDGRID_API_KEY 시크릿이 설정되지 않았습니다.`가 뜨는지부터 확인 — 뜬다면 Supabase Secrets에 `SENDGRID_API_KEY`/`SENDGRID_FROM_EMAIL`을 등록해야 발송이 됨.

## 2026-07-13 (7차) — index.ts 실제 병합 완료 + 즉시발송 + 로딩속도 개선
- **index.ts 전체 병합**: 사용자가 실제 Edge Function 소스(`index.ts`)를 제공해줘서, 지난번 병합용 스니펫이 아니라 **완전한 파일**로 AI 보조기능 3개 액션(`ai-suggest-xlsx-mapping`, `save/get-xlsx-field-override`, `ai-summarize-issues`)을 실제 인증 헬퍼(`isCenterOrWorkspaceAuthorized`/`isWorkspaceAuthorized`)와 응답 헬퍼(`json`)를 그대로 사용해 병합했습니다. `checkAuth(...)` 같은 임시 자리표시자는 이제 없습니다. `schema_addendum_9_ai_provider.sql` 실행 + Secrets 2개(`SOGANG_MOT_API_URL`/`KEY`) 등록 + 재배포만 하면 바로 동작합니다.
- **알림 설정에 "⚡ 즉시 발송" 버튼 추가**: 발송시각/반복주기/중복방지 조건을 모두 건너뛰고 지금 조건(며칠째 미업로드)에 맞는 센터에 바로 발송(`send-notification-now` 액션). 매시 크론이 쓰던 로직을 `runNotificationCheck()`로 공용화해서 `check-and-notify`와 코드 중복 없이 재사용. 발송 로그에 즉시발송 여부 기록(`notification_log.is_manual`, `schema_addendum_10_notification_manual.sql`).
- **초기 로딩(버퍼링) 개선**:
  - `admin.html` 상단의 Chart.js/XLSX `<script>` 태그에 `defer` 추가 — 두 라이브러리 다운로드가 첫 화면 렌더를 막지 않게 됨(두 라이브러리는 전부 함수 내부에서만 쓰여서 안전함을 확인 후 적용).
  - 자주 안 바뀌는 조회성 API 6종(`schema`, `get-notification-settings`, `list-kpi-settings`, `list-kpi-monthly-targets`, `list-monthly-to`, `centers-manage-list`, `get-xlsx-field-override`)에 짧은 캐시(`jsonCached`, `private, max-age=20`) 적용. 실적/근태/자료함 등 실시간성이 중요한 API는 기존처럼 `no-store` 유지.
- **SQL 신규**: `schema_addendum_10_notification_manual.sql` (`notification_log.is_manual` 컬럼 추가)
- 검증: 재배포 후 (1) AI 두 기능 정상 케이스, (2) 알림 즉시발송 버튼, (3) 초기 진입 체감 속도를 실제로 확인 필요.

## 2026-07-13 (6차) — AI Provider 단순화: 서강MOT 단일 Provider(GPT5.5 고정)
- **요청 반영**: Claude API 등으로의 자동 failover를 제거하고, **서강MOT API 단일 Provider**로만 AI 기능(엑셀 매핑 제안/이슈 요약)을 호출하도록 변경. 모델은 선택 기능 없이 항상 GPT5.5로 고정.
- **크레딧 소진 등 실패 시 동작 변경**: 이전엔 다른 Provider로 조용히 전환했지만, 이제는 실패하면 화면에 "⚠️ AI 기능을 지금 사용할 수 없습니다(크레딧 소진 등)" 배너를 띄우고, "기존 방식(직접 입력/붙여넣기, 자동추출·저장)은 그대로 쓸 수 있다"는 안내 문구를 함께 보여준다(`renderAiUnavailableNotice()`). 엑셀 매핑 기능과 이슈 요약 기능 양쪽에 동일하게 적용.
- **기존 기능 영향 없음 재확인**: 데이터 입력·자동추출·저장(manual-entry-bulk 등)은 애초에 AI를 거치지 않는 별도 경로라, AI 실패 여부와 무관하게 100% 그대로 동작한다.
- `edge-function-addendum-ai-provider.ts`를 v2로 갱신(Claude 관련 코드 전부 제거, `AiUnavailableError`로 실패 사유를 프론트엔드에 명확히 전달). `schema_addendum_9_ai_provider.sql`은 주석만 정정(테이블 구조는 동일).
- **미완료는 여전히 동일**: 백엔드(index.ts) 병합 + Secrets 등록(`SOGANG_MOT_API_URL`/`SOGANG_MOT_API_KEY`만 필요, `ANTHROPIC_API_KEY` 불필요해짐) + 재배포.

## 2026-07-13 (5차) — AI 보조기능 신규 (🟡 프론트엔드만 완료, 백엔드 미배포)
- **엑셀 양식 변경 자동대응(KB손보부천)**: 자동추출이 실패("일자별 데이터를 찾지 못했습니다")하면 "🤖 AI로 양식 분석하기" 버튼 노출 → 헤더 텍스트+기존 필드정의를 AI에 보내 새 헤더 키워드 매핑 제안 → 사용자 검토 후 저장하면(`center_xlsx_field_override`) 다음부터 AI 호출 없이 자동 적용(`getEffectiveXlsxFields`, `loadXlsxFieldOverride`).
- **이슈 히스토리 AI 요약**: 이슈및히스토리 화면에 "🤖 AI 요약" 버튼 추가, 최근 이슈 최대 50건을 반복패턴/미해결추정/특이사항 관점으로 요약(`summarizeIssuesWithAI`).
- **AI Provider 정책**: 서강MOT API(1순위) 호출 → 크레딧부족/RateLimit/Timeout/장애 시 Claude API로 자동 failover(백엔드에서 처리, 사용자는 인지 못함). 비용민감도 원칙에 따라 AI는 "추출 실패 시"/"사용자가 요약 버튼을 누를 때"만 호출되고, 평소 데이터 추출·저장 흐름에는 전혀 관여하지 않음(기존 규칙기반 로직 100% 유지).
- **미완료(다음 세션 필요)**: `schema_addendum_9_ai_provider.sql` 실행, `edge-function-addendum-ai-provider.ts`를 실제 `index.ts`에 병합(인증 헬퍼 이름 교체 필요), 서강MOT 실제 API 스펙 확인 후 `callSogangMOT()` 조정, Function Secrets 4개 등록(`SOGANG_MOT_API_URL/KEY/MODEL`, `ANTHROPIC_API_KEY`). **이 저장소에 Edge Function 원본(index.ts)이 없어서 AGENTS.md의 "전체 교체 파일 원칙"을 지키지 못하고 병합용 스니펫으로만 제공함 — 다음 세션에서 index.ts를 공유해주시면 전체 파일로 정리 가능.**

## 2026-07-13 (4차)
- **평택시청 일일업무보고**: 원래 자료함 업로드 로직이 아예 없어 이 문제와 무관했으나, 요청에 따라 다른 센터와 동일하게 "최종저장"(`saveEverything`, 일자별 실적+업무유형별 인입현황을 함께 저장하는 버튼)이 실제로 성공했을 때만 원본 HWPX 파일이 자료함에 반영되도록 신규 추가. 추출만 하고 저장하지 않으면 자료함에 올라가지 않음.
- 일자별 실적 저장(`saveAllRows`)이 성공하면 그쪽에서 자료함 반영을 처리하고, 일자별 실적표 없이 업무유형별 인입현황만 추출·저장된 경우에도 `saveEverything`에서 별도로 자료함 반영을 판단해 중복 업로드 없이 처리.
- `saveAllRows`/`saveCategoryRows`가 저장 성공 여부(boolean)를 반환하도록 변경 — 다른 호출부(버튼 onclick 등)는 반환값을 쓰지 않으므로 영향 없음.

## 2026-07-13 (3차) — 업로드 자료함 저장 시점 버그수정
- **버그수정**: 업로드 자료함(`archive-upload-file`)이 파일을 "선택/추출"만 해도 즉시 업로드되던 문제. 실적파일(LG전자 엑셀추출/KB손보정비 엑셀자동추출/KB손보부천 엑셀추출/평택 HWPX추출)과 근태파일(근태파일 업로드) 모두, 이제 파일은 추출 시점엔 `pendingPerfArchiveFile`/`pendingAttArchiveFile`에만 잠깐 담아두고, **실제 저장(전체 저장/근태만 저장/실적만 저장/실적+근태 일괄반영)이 성공한 시점에만** 실제로 자료함에 업로드된다. 저장에 실패하면 자료함에도 올라가지 않는다.
- 평택시청 일일업무보고(HWPX)는 원래도 이 문제가 없었음(자료함 업로드 로직 자체가 없음) — 변경 없음.
- 검증: 파일을 선택/추출만 하고 저장 없이 다른 화면으로 이동했을 때 업로드 자료함에 안 올라가는지, 실제 저장 버튼을 눌렀을 때만 올라가는지 확인 필요.

## 2026-07-13 (2차)
- **KB손보부천**: "근태만 저장"/"실적만 저장" 버튼을 표 아래 별도 위치에서 "전체 저장" 버튼 바로 옆으로 이동 (`manualSaveAttBtn`/`manualSavePerfBtn`, 정적 배치 후 `renderPreviewTable()`에서 표시/숨김만 제어). 근태+실적이 함께 있는 양식일 때만 나타나는 동작은 동일.
- 동작 재확인: "근태만 저장"을 누르면 `saveAllRows('attendance')`가 호출되어 `data-group==='attendance'`인 필드만 서버로 전송되고, 실적 필드는 요청에 아예 포함되지 않는다(반대도 동일) — 즉 한쪽만 정확히 반영되는 것이 맞음.

## 2026-07-13 데이터입력 기능 개선
- **KB손보부천**: 엑셀 자동추출에 기간 설정(추출 시작일/종료일) 추가 — 비워두면 기존처럼 파일 내 전체 기간 추출(`extractXlsxAndFill`). 지정하면 그 기간 날짜만 붙여넣기 칸에 채운다.
- **KB손보부천**: "일자별 실적 직접입력" 표에 근태(총원~제외보유계약)와 실적(인입호~) 컬럼이 함께 있는 경우, 표 미리보기 하단에 "근태만 저장"/"실적만 저장" 버튼이 추가로 나타난다(`renderPreviewTable`, `saveAllRows(groupFilter)`). 기존 "전체 저장"은 그대로 유지. 한쪽만 저장하면 다른 쪽 컬럼은 서버로 아예 전송하지 않아 기존에 저장돼 있던 값이 보존된다.
- **KB손보정비**: "RAW 엑셀 자동추출" 명칭을 "엑셀 자동추출"로 변경. KB손보부천과 동일하게 추출 시작일/종료일 필드 추가(`extractLongContractAndFill`). 추출한 기간(또는 지정한 기간)은 기존처럼 재직및투입현황 탭 이동 시 자동으로 동일 기간이 설정된다(`promptGoToAttendance`, 기존 기능 유지·재검증 완료).
- **KB손보정비/LG전자AS/LG전자성수기 공통**: 재직 및 투입현황 화면에 "실적만 저장" 버튼 신규 추가(`saveAttPerfOnly`). 기존 "근태만 저장"/"실적+근태 일괄 반영"은 그대로 유지. "실적만 저장"은 근태 기간과 겹치는 날짜의 실적만 반영하고 근태 값(TO/재직인원/투입인원)은 전혀 건드리지 않는다.
- SQL 변경 없음(모두 기존 `manual-entry-bulk` 액션의 그룹별 부분 반영 방식을 재사용).
- 검증: KB손보부천에서 근태만 이미 정확히 들어가 있는 날짜에 실적만 재추출→"실적만 저장"으로 반영해도 근태 값이 그대로인지 실제 데이터로 확인 필요.

## 2026-07-12 (4차)
- **버그수정 (진짜 원인 발견)**: 상단 핵심지표 카드의 "누적" 계열 수치가 분기누적/반기누적/연초누적 토글을 눌러도 안 바뀌던 문제. 원인은 `renderSummaryCards`/`renderKbjeongbiSummaryCards2` 호출 시 "누적" 인자로 항상 연초~현재월 고정 `cumulativeRows`를 넘기고 있었기 때문("일평균" 계열만 토글에 반응하고 있었음). 이제 분기누적/반기누적 토글일 때는 해당 분기·반기 범위(`quarterRows`/`halfRows`)로 좁혀서 누적 계산하도록 수정 (`cardCumRows`). 라벨도 "누적"→"분기누적/반기누적/연초누적"으로 동적 표기(`periodCumLabel()`).
- **KB손보정비(및 section 있는 센터 공통) 주요지표 표기 변경**: "총합계/고지의무/통지의무/목적물소멸" 등 섹션명을 별도 배지 줄로 보여주던 것을 라벨과 한 줄로 병합 (예: "총합계 접수건 166건 / 누적평균 174건 / 전월比 ▼26건, 13.8%"). `renderTrendList()` 공통 함수 수정이라 KB손보부천(제휴상담/장기손사)에도 동일 적용.
- **복사 버튼 아이콘화**: 센터별 대시보드의 모든 복사 버튼(요약카드 `sc-copy`, 지표추이 차트별 복사, 주요지표 복사, 표 복사)을 빨간 텍스트 버튼에서 중립 다크톤 아이콘 버튼(`copy-icon-btn`, hover 시 밝아짐)으로 교체. 클릭 동작(클립보드 복사 함수 호출)은 기존과 동일하게 유지, title 툴팁으로 어떤 항목을 복사하는지 안내.

## 2026-07-12 (3차) — DESIGN.md 기준 다크 리스킨
- **범위**: 시각(색상/배경/보더/라운드/타이포)만 변경, 기능·DOM 구조·필터·클릭 핸들러·데이터 로직은 전부 그대로 유지 (기능 불변 원칙 준수).
- 페이지 배경을 흰색/연회색(`#f4f5f7` 등) 계열에서 `#000000`(메인)/`#1d1d1f`(카드·패널 surface)/`#111113`(표 헤더·입력창 elevated) 다크 토큰으로 전면 교체.
- 텍스트/보더를 `#f5f5f7`(본문) · `#a1a1a6`/`#86868b`(보조) · `#2c2c2e`(보더) 토큰으로 통일.
- 상태색상 재매핑: 성공 `#34c759`, 경고 `#f5a623`, 위험 `#FF6B70`(danger), 하락표시 `#5ac8fa` — 다크 배경 대비 기준으로 톤 조정.
- 버튼(`.btn-primary/outline/ghost/secondary`)을 pill(`border-radius:999px`)로, 대형 카드(`.panel`,`.ws-card`,`.ws-kpi-card`,`.summary-card2` 등)는 `16~20px`, 팝오버/드롭다운은 `12px`로 라운드 확대.
- 워크스페이스 전체현황 추이차트 팔레트(`WS_BAR_COLORS`/`WS_LINE_COLORS`)와 KBJ 도넛차트 미처리 슬라이스 색을 다크 배경에서도 구분되도록 별도 조정 (기존엔 옅은 회색이라 다크 배경에서 거의 안 보였음).
- LG전자/평택시청/KB손보 등 **센터별 브랜드·차트 계열색(A50034, 303192, FFBC00, 545045 등)은 의도적으로 손대지 않음** — 그래프 시리즈 구분이라는 기능적 의미가 있는 색이라 리스킨 대상에서 제외.
- `docs/DESIGN.md`를 저장소에 신규 반영 (사용자 제공본).
- 검증: `node --check`로 JS 문법 오류 없음 확인. 실제 브라우저 렌더링(색 대비·가독성)은 배포 후 육안 확인 필요 — 특히 표 스크롤 시 sticky 첫 열 배경, 입력창(`input[type=date/number/text]`, `select`, `textarea`) 다크 배경 적용 여부를 우선 확인할 것.

## 2026-07-12 (2차)
- **사이드바 구조 개편**: 상단 고정 탭(대시보드/데이터입력/이슈및히스토리/TO및목표값설정) 제거 → 사이드바에서 선택된 센터 바로 아래에 서브메뉴로 노출 (`MAIN_TABS`, `renderCenterSubmenu()`). SQL 변경 없음.
- **버그수정**: 센터 전환 시 직전 센터에서 보던 탭·기간(월/단월 등)이 그대로 유지되던 문제 수정. 이제 센터를 바꾸면 탭=대시보드, 기간=단월, 월=이번달로 초기화됨 (`resetDashboardStateForNewCenter()`, `selectCenter()`/`promptCenterPassword()` 양쪽 적용).
- **이슈 및 히스토리**: 목록을 제목+날짜만 보이는 아코디언(`<details>`) 방식으로 변경, 클릭 시 상세내용 펼침 (전 센터 공통 함수 `renderIssueList()`라 5개 센터 모두 자동 적용).
- **KB손보정비 대시보드**: 주요지표에 "전체재직인원(TO대비)" 바로 아래 "상담사 투입현황"(`상담사_투입인원`) 지표 추가.
- **버그수정**: KB손보정비도 LG전자AS/성수기와 동일하게, 상담사 투입인원 0명인 날짜는 공휴일 여부와 무관하게 저장에서 자동 제외되도록 수정 (`skipZeroManual`에 `kbjeongbi` 추가).
- **LG전자AS/성수기 TO및목표값설정**: 통화시간(`통화시간_INOUT_초`) 등 duration 지표의 목표값을 `4:00:00`(시:분:초) 형식으로 입력 가능하도록 변경. 저장은 기존과 동일하게 초 단위 숫자, 화면 표시만 변환 (`DURATION_METRIC_KEYS`, `parseKpiTargetInput()`, `formatKpiTargetDisplay()`).
- **확인**: "다른 센터 대시보드 핵심지표 카드가 기간토글(단월/분기/반기/연초)에 반응하지 않는다"는 요청 건은 코드 재검토 결과 이미 `renderSummaryCards()`/`renderKbjeongbiSummaryCards2()`가 토글로 필터링된 데이터를 공통으로 사용하고 있어 전 센터 동일하게 동작 중임을 확인함 (별도 수정 없음 — 특정 센터에서 다르게 보이면 캐시/재접속 이슈일 가능성, 재현되면 스크린샷과 함께 재문의 필요).

## 2026-07-10 ~ 07-12
- **Google Drive 완전자동 연동** 추가: 센터별 폴더 등록 → 15분마다 폴링 → LG전자AS/성수기 실적·근태 완전자동 분석·반영. `schema_addendum_8_gdrive.sql`
  - 버그수정: 근태 자동반영 시 TO값이 두 센터 모두 19로 고정돼 있던 것을 AS=19/성수기=35로 수정, 투입인원 0명 날짜 제외 규칙 서버측에도 반영
- **스마트업로드** 추가: 파일 하나로 센터+실적/근태 자동판별 → 해당 화면 자동 이동+추출. 파일명 힌트(성수기/AS센터/정비/부천/평택) 우선 반영
- 사이드바 UI를 KT 스타일(다크톤, 섹션 구분: 메뉴/센터/관리)로 개편, 계정메뉴 드롭다운화, "워크스페이스" 명칭 → "관리자화면"으로 전면 변경
- **센터별 업로드 신호등 + 이메일 알림** 추가: 3/7일 기준 🟢🟠🔴, 4일째/8일째 담당자 메일 발송(SendGrid, 무료). `schema_addendum_7_upload_monitor.sql`
- **업로드 자료함** 추가: 원본 파일 자동 보관, 검색/다운로드/삭제. `schema_addendum_6_upload_archive.sql`
- 데이터입력 저장을 5건씩 배치 → `manual-entry-bulk`로 한번에 저장하도록 변경 (대량 데이터 저장 속도 개선)
- 버그수정: `categorySchemaCache` 전역변수 선언 누락으로 인한 "데이터 로드 실패" 오류

## 2026-07-08 ~ 07-09
- 전체현황 대시보드 지표별 정확한 산출근거 확인 및 수정: 생산성(IN+OUT) 단위 %→건, 전체재직인원(TO대비) 산출 소스를 상담사_투입인원 → 재직인원(전체)로 정정
- 지표추이 그래프: 생산성(IN)을 생산성(IN+OUT) 안에서 구분하는 파생 누적막대로 변경(단순 합산 아님), T-NPS 선 색상 LG RED 고정 버그 수정(임계값 없는 선이 무조건 회색으로 나오던 원인)
- LG전자성수기 TO/운영기준 정정: 공식 TO 상담사 35명(관리자 0명), 실제 운영기준 41명(관리자6+상담사35). `schema_addendum_4_seongsu_to.sql`
- LG전자AS/성수기 주요지표에 통화시간(IN+OUT) 추가(duration 단위 지원). `schema_addendum_5_talktime_kpi.sql`
- 데이터입력 UI 개편: 좌측 고정 가이드 + 우측 선택카드(파일업로드/직접입력/근태/업무유형별), 기준연도 강조박스, 파일 드래그앤드롭 지원

## 2026-07-07
- **LG전자AS·LG전자성수기 신규 센터 등록** (기존엔 lge만 있었음). `schema_addendum_3_lge_seongsu.sql`
- LG전자 KPI 엑셀 자동추출기(v2, 상시/한시 Total 판별 fallback 로직 포함) 이식, CDN 로딩 실패 대비 unpkg 폴백 추가
- LG전자·KB손보정비 근태 자동추출기 이식 (성명/업무/입사일/퇴사일 헤더 + YYMM 시트 인식)
- 실적 추출 완료 시 재직/투입현황 화면으로 자동 이동 + 추출 기간 그대로 전달
- 워크스페이스 이상징후 판정 기준을 "마지막 저장일"에서 "연초~최신월 누적 일평균"으로 변경
- 전체현황 추이그래프를 표 안 미니 스파크라인 → 표 아래 별도 카드(범례/축 포함) 방식으로 개편
- `schema_addendum_2.sql`(핵심지표 기본값), `schema_addendum_lge.sql`(LG전자 최초 등록)

## 그 이전 (초기 구축, 요약)
- KB손보부천/KB손보정비/평택시청 센터별 데이터입력(엑셀/HWPX 자동추출), 워크스페이스 전체현황, TO 및 목표값설정 화면 최초 구축
- 인수인계 기준: `handover.md`(구버전, 현재는 이 `docs/` 세트로 대체)
