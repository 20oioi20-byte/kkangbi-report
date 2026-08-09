# DEPLOY-CHECKLIST.md — 배포 전 검사

## 1. SQL 실행 순서 (Supabase SQL Editor)
아직 실행하지 않은 것부터 순서대로 실행합니다. (이미 실행한 것은 재실행해도 `on conflict`로 안전하게 무시되도록 작성돼 있으나, `cron.schedule` 부분은 중복 등록될 수 있어 실행 전 `select cron.unschedule('이름')`으로 기존 것을 먼저 지우고 실행할 것)

1. `schema.sql` (최초 1회)
2. `schema_addendum_lge.sql` — LG전자(lge) 최초 등록
3. `schema_addendum_2.sql` — 핵심지표 기본값
4. `schema_addendum_3_lge_seongsu.sql` — LG전자성수기 신규 등록
5. `schema_addendum_4_seongsu_to.sql` — 성수기 TO 정정
6. `schema_addendum_5_talktime_kpi.sql` — 통화시간 핵심지표 추가
7. `schema_addendum_6_upload_archive.sql` — 업로드자료함 (Storage 버킷 포함)
8. `schema_addendum_7_upload_monitor.sql` — 신호등+알림 (**pg_cron 필요**)
9. `schema_addendum_8_gdrive.sql` — Google Drive 완전자동 (**pg_cron 필요**)
10. `schema_addendum_9_ai_provider.sql` — AI 보조기능(엑셀 매핑 override + 호출 로그) 테이블 신규
11. `schema_addendum_10_notification_manual.sql` — 알림 로그에 즉시발송 여부(`is_manual`) 컬럼 추가
12. `schema_addendum_11_lge_total_center.sql` — LG전자통합(`lge_total`) 신규 센터 등록 (실행 후 기본 비밀번호 000000 → 변경 필요)
13. `schema_addendum_13_issues_reviewed_and_messages.sql` — 이슈에 "관리자 확인함"(`reviewed`) 컬럼 추가 + 관리자-센터 쪽지 테이블(`center_messages`) 신규
14. `schema_addendum_14_notification_split_perf_issue.sql` — 알림 설정의 `danger_*` 컬럼을 `issue_*`로 이름 변경(이슈/히스토리 미등록 알림용으로 재사용) + `notification_log.days_since_upload`를 `days_since`로 이름 정리

## 1-1. Edge Function 배포 (2026-07-13, index.ts 전체 병합 완료)
- 이전엔 index.ts 원본이 없어 병합용 스니펫으로만 드렸지만, 이제 사용자가 제공한 실제 `index.ts`에 AI 보조기능 3개 액션 + "즉시 발송" 액션 + 캐싱 헬퍼가 전부 반영된 **완전한 파일**을 드립니다. 그대로 `supabase functions deploy center-report-upload`만 하면 됩니다(코드 수정 불필요).
- `callSogangMOT()`는 OpenAI 호환(chat/completions) 형식을 가정해 작성했습니다. 서강MOT Gateway의 실제 스펙과 다르면 이 함수만 수정하면 됩니다.
- **(2026-07-15 장애 이후 필수 절차) `index.ts`를 배포하기 전에 반드시 로컬에서 `deno check index.ts`로 타입체크 통과를 확인할 것.** 2026-07-15에 `mammoth` 라이브러리의 esm.sh 타입선언이 예고 없이 바뀌면서 배포가 통째로 막히고 사이트 전체(센터 목록 포함)가 멈춘 적이 있음 — 코드를 안 건드려도 외부 CDN 타입선언 변경만으로 배포가 실패할 수 있으므로, 매 배포 전 `deno check`를 습관화할 것. Deno가 없으면 `curl -fsSL https://deno.land/install.sh | sh`로 설치.
- 장애 시 진단 순서: (1) Supabase Table Editor로 DB 데이터 실제 존재 여부 확인(데이터 유실이 아닌지 우선 구분) → (2) 브라우저 콘솔에 CORS 에러가 뜨면 Edge Function이 요청 처리 전에 죽고 있다는 뜻 → (3) 로컬에서 `deno check index.ts`로 재현 → (4) 안전하면 이전 정상 배포본으로 즉시 롤백해 서비스부터 복구.

## 1-2. ✅ 센터 삭제 → "숨기기/다시 보이기"로 전환 (2026-07-21, 완료 — 백엔드 배포 불필요)
- **배경**: 센터 삭제 시 `center_config` 행을 물리 DELETE하다 하위 테이블(`center_monthly_settings` 등) 외래키 위반으로 500 에러가 났던 문제(원인은 아래 CHANGELOG 2026-07-21 항목 참고). 이를 완전한 삭제가 아니라 **숨기기/다시 보이기** 기능으로 전환.
- **핵심 발견**: 사용자가 공유한 실제 `index.ts`를 확인해보니, `center_config`에 이미 `is_active` 컬럼이 있고 `center-update` 액션이 이미 이 필드를 받아 `UPDATE`해주고 있었음 — 새 컬럼이나 새 액션을 전혀 추가할 필요 없이 **기존 `action=center-update`를 `{center_code, is_active:false}`로 호출하는 것만으로 숨기기가 완성됨**. 그래서 준비했던 `schema_addendum_12_center_soft_delete.sql`(`is_deleted` 컬럼 추가안)은 폐기 — SQL 실행도, index.ts 수정도, 재배포도 필요 없이 바로 동작함.
- **구현**(`app.js`/`admin.html`):
  - 사이드바 센터 메뉴의 "✕ 삭제" → "🙈 숨기기"로 교체(`hideCenterPrompt()`) — `action=center-update`에 `is_active:false`로 호출.
  - "⚙ 계정 ▾" 메뉴에 "🙈 숨긴 센터 관리" 추가 → 패널에서 숨긴 센터 목록과 "다시 보이기" 버튼(`unhideCenter()` — `is_active:true`로 호출).
  - 사이드바 목록·전체현황(`renderWorkspaceOverview`)·자동 센터 선택 로직 전부 `is_active===false`인 센터를 제외(`visibleCentersMeta()`). 전체현황 실적 데이터(`allRows`)도 숨긴 센터 행을 클라이언트에서 한 번 더 걸러냄(`loadAllCentersOverview()`, `admin-overview` 자체는 `is_active`로 거르지 않으므로).
- **부수 효과(의도된 동작)**: `is_active=false`는 index.ts의 `verify`/`upload`/`history`/`schema`/`manual-entry(-bulk)`/`archive-upload-file` 및 미업로드 알림(`runNotificationCheck`)에서도 공통으로 검사하는 필드라서, 센터를 숨기는 동안 그 센터의 업로드 링크(토큰)와 미업로드 알림도 함께 멈춘다 — "당분간 안 쓰는 센터를 치워둔다"는 의도와 자연스럽게 맞음. 다시 보이게 하면 전부 즉시 정상 동작으로 복귀.

## 1-3. 🟡 전체현황 핵심지표가 센터별 대시보드와 값이 다름 — 원인 확인, index.ts 패치 필요 (2026-07-21)
- **증상**: 전체현황(워크스페이스) 표의 "핵심지표(이번달/누적)" 값이 그 센터의 대시보드 화면에서 보는 "이번달/누적" 값과 다름(LG전자통합만 정확 — 월평균 수동입력값 1건만 읽는 구조라 이 문제의 영향을 안 받음).
- **원인(공유받은 실제 index.ts로 확인)**: `admin-overview` 액션의 쿼리가 `.order('report_date', desc).limit(300)`을 센터 필터보다 먼저 적용하고 있음. 센터별 대시보드는 `&center=코드`를 붙여 요청해서 "그 센터의 최근 300건"을 정확히 받지만, 전체현황은 필터 없이 요청해서 "**전체 센터를 통틀어** 최근 300건"만 받는다 — 센터가 여러 개면 데이터를 자주 저장한 센터의 최근 행이 다른 센터의(하지만 이번달·연초누적 계산에는 필요한) 오래된 행을 밀어내면서, 그 센터는 전체현황에서만 불완전한 데이터로 계산됨. `loadOverviewForCurrent()`(프론트엔드, 이전에 수정함)와 같은 유형의 버그가 백엔드 `admin-overview` 액션에 남아있던 것.
- **수정(index.ts, 이 저장소에 소스가 없어 직접 적용 못함 — 패치 코드 전달함)**: 센터 필터가 없을 때는 행 개수 캡(`.limit(300)`) 대신 "올해 1월 1일 이후"로 기간을 제한하도록 변경. 전체현황이 실제로 필요한 데이터 범위(이번달+연초누적)와 정확히 일치하고, 센터 수가 늘어나도 절대 누락되지 않음. 센터 필터가 있는 경우(대시보드 등)는 기존 `.limit(300)` 그대로 유지.
- **배포**: 위 패치를 `index.ts`의 `admin-overview` 핸들러에 반영한 뒤 `deno check index.ts` 통과 확인 → `supabase functions deploy center-report-upload`로 배포.
- **검증(배포 후)**: 전체현황의 KB손보부천/KB손보정비/평택시청 핵심지표(이번달/누적) 값이 각 센터 대시보드의 값과 정확히 일치하는지 확인.

## 1-4. 🔴 워크스페이스 관리자 인증 우회 가능성 확인 — index.ts 패치 필요, 미배포 시 계속 노출 (2026-07-22)
- **배경**: 사용자가 외부 보안 점검 결과를 전달, 이를 계기로 `index.ts`의 action별 인증 체크를 전수 재점검함.
- **발견**: 워크스페이스 관리자 인증 함수(`isWorkspaceAuthorized`)가 비밀번호 대조 외에, HTTP 요청 헤더 하나를 신뢰해서 특정 조건이면 비밀번호 없이 통과시키는 경로를 갖고 있었음. 이 헤더는 **실제 브라우저를 거치지 않는 요청(예: curl, 스크립트)에서는 호출하는 쪽이 자유롭게 지정할 수 있어**, 사실상 인증 우회로 악용될 수 있음. 이 함수를 쓰는 모든 관리자 기능(센터 생성/수정/삭제, 목표값·핵심지표 설정, 센터 비밀번호 변경, 업로드 파일 열람/삭제, 알림 담당자·설정 등)이 영향을 받음. 상세 목록은 로컬 점검 문서에 별도 정리(민감도상 저장소에는 커밋하지 않음).
- **결정**: 해당 우회 경로(요청 헤더 기반 자동인증)를 완전히 제거하기로 확정. 이 경로에 의존하던 편의기능(특정 도메인에서 비밀번호 없이 바로 관리자 진입)은 사라지고, 그 도메인에서도 다른 접속 경로와 동일하게 비밀번호를 입력해야 함.
- **패치**: 사용자에게 index.ts 수정 코드 전달함(3곳 — 우회 판정 함수 삭제, 인증 함수에서 우회 분기 제거, 관련 action이 항상 "인증 안 됨"을 반환하도록 정리). 프론트엔드(`app.js`)는 이미 그 action이 실패를 반환하는 경우를 정상 처리하도록 짜여 있어 **수정 불필요**.
- **배포**: `deno check index.ts` 통과 확인 → `supabase functions deploy center-report-upload`. **배포 전까지는 위 우회 경로가 계속 열려 있는 상태이니 가능한 한 빨리 배포 권장.**
- **검증(배포 후)**: 그동안 비밀번호 없이 자동으로 들어가던 도메인에서도 정상적으로 비밀번호 입력창이 뜨는지, 입력 후에는 기존처럼 관리자 기능이 전부 정상 동작하는지 확인.

## 1-5. 🟡 이슈 "확인함" + 관리자-센터 쪽지(Q&A) — SQL 실행 + index.ts 배포 필요 (2026-07-27)
- **배경**: 관리자(전체 센터 총괄) 입장에서 이슈/히스토리를 더 효율적으로 관리하고 싶다는 요청 → 센터장이 작성하는 쪽(폼)은 전혀 안 건드리고, 등록 이후 관리자가 보는 쪽만 개선하기로 함. 추가로 관리자→센터 1:1 쪽지(질문/답변) 기능도 요청받음.
- **구현(app.js, 백엔드 배포 전에도 코드는 이미 반영됨 — 배포 후에만 실제로 동작)**:
  1. 전체현황에 "📋 전체 센터 이슈 피드"(전 센터 통합, 제목/내용/센터명 검색, 미확인 개수 표시) + "💬 센터별 쪽지 현황" 패널 추가.
  2. 사이드바 센터 목록에 관리자 전용 배지 추가 — 확인 안 된 이슈 건수(📝), 안 읽은 쪽지 답변 건수(💬).
  3. 이슈 목록(전체 피드 + 센터별 화면 공통)에 자동분류 태그(인원변동/실적이슈/시스템·장애/공지·안내/기타, 키워드 기반 — 작성자가 고르는 게 아니라 제목·내용을 보고 관리자 화면에서만 자동으로 붙음) + 관리자 전용 "확인함" 버튼(센터장 화면엔 안 보임).
  4. 센터별 데이터 표(대시보드)의 날짜 셀에, 그 날짜에 등록된 이슈가 있으면 마커(📝) 표시 — 클릭하면 이슈 화면으로 이동해 그 날짜로 자동 검색(관리자 전용, `workspaceIssuesCache` 기반).
  5. 신규 탭 "💬 관리자 메모" — 관리자가 센터별로 메모를 보내고 센터장이 답변하는 1:1 스레드. 양쪽 다 같은 화면을 쓰고(문구만 다름), 열면 상대방 메시지를 자동으로 읽음 처리.
- **백엔드(index.ts, 3곳 수정 — `index_수정본3_이슈확인+쪽지.ts`로 전달)**:
  - `issues-list` 응답에 `reviewed` 필드 추가.
  - 신규 액션: `list-all-issues`(워크스페이스 전용, 전체 센터 이슈 통합 조회), `issues-mark-reviewed`(워크스페이스 전용, 확인함 처리).
  - 신규 액션: `messages-list`/`messages-send`/`messages-mark-read`(토큰 또는 워크스페이스 비밀번호 중 하나로 인증 — 기존 `isCenterOrWorkspaceAuthorized` 재사용), `list-all-messages-summary`(워크스페이스 전용, 사이드바 배지·쪽지 현황 패널용 집계).
- **SQL**: `schema_addendum_13_issues_reviewed_and_messages.sql` — `center_issues`에 `reviewed boolean default false` 컬럼 추가(기존 이슈는 전부 미확인 상태로 시작) + `center_messages` 테이블 신규(`id, center_code, sender('admin'|'center'), message, created_at, read_by_admin, read_by_center`).
- **배포 순서**: SQL 먼저 실행 → `deno check index.ts` 통과 확인(이미 확인함) → `supabase functions deploy center-report-upload`. **SQL/index.ts 배포 전까지는 위 신규 기능(확인함 저장, 전체 피드의 미확인 표시, 쪽지 전체) 관련 요청이 전부 실패로 응답**하지만, 기존 이슈 등록/수정/삭제와 데이터입력·대시보드 등 나머지 전체 기능은 배포 여부와 무관하게 평소처럼 정상 동작함(자동분류 태그·이슈 마커는 프론트엔드만으로 되는 부분이라 배포 전에도 보임, 다만 "확인함"을 눌러도 저장은 안 됨).
- **검증(배포 후)**: 전체현황에서 이슈 피드가 전 센터 통합으로 보이는지, "확인함"을 누르면 사이드바 배지 숫자가 즉시 줄어드는지, 관리자→센터 쪽지를 보내고 센터장 계정(토큰 로그인)으로 확인·답변하면 관리자 쪽 "센터별 쪽지 현황"에 반영되는지, 센터장 화면에는 "확인함" 버튼이나 분류 선택 UI가 전혀 안 보이는지(입력 부담 없음) 확인.

## 1-6. 🟡 업로드 알림 메일 발송을 SendGrid → Gmail SMTP로 교체 — Secrets 등록 + index.ts 배포 필요 (2026-07-30)
- **배경**: SendGrid 발신자 인증 이슈(1-1/2 참고, `SENDGRID_FROM_EMAIL` 미등록 의심)로 실제 발송이 안 되고 있었음. 사용자가 이미 다른 프로젝트에서 쓰던 "Gmail SMTP + 앱 비밀번호" 방식을 그대로 재사용해 쉽게 적용하길 원함.
- **구현(index.ts, `sendNotificationEmail()` 교체 — `index_수정본4_Gmail발송.ts`로 전달)**: SendGrid REST API 호출을 [denomailer](https://deno.land/x/denomailer)(순수 Deno SMTP 클라이언트, 별도 설치 불필요) 기반 Gmail SMTP 발송으로 교체. `smtp.gmail.com:465`(TLS)에 `GMAIL_USER`/`GMAIL_APP_PASSWORD`로 인증해 발송. 실패 사유(시크릿 미설정/SMTP 오류)를 기존과 동일하게 `notification_log.send_error`에 기록. `check-and-notify`/`send-notification-now`/`runNotificationCheck` 등 호출부는 전혀 안 건드림(발송 함수 내부 구현만 교체) — 프론트엔드(app.js)도 변경 없음.
- **Secrets**: 사용자가 이미 보유한 Gmail 계정/앱 비밀번호를 그대로 재사용(신규 발급 안 함, 사용자 확인 완료) — `GMAIL_USER`(발신 Gmail 주소), `GMAIL_APP_PASSWORD`(16자리 앱 비밀번호) 2개를 Supabase Function Secrets에 등록. 기존 `SENDGRID_API_KEY`/`SENDGRID_FROM_EMAIL`은 더 이상 이 기능에서 안 쓰므로 삭제해도 무방(다른 기능이 참조하지 않음, 코드에서 검색 확인함).
- **배포 순서**: (1) Supabase 대시보드 → Edge Functions → Secrets에서 `GMAIL_USER`/`GMAIL_APP_PASSWORD` 등록 → (2) `index.ts` 코드 교체 후 `deno check`(이미 통과 확인함) → (3) `supabase functions deploy center-report-upload`.
- **검증(배포 후)**: 알림 설정 화면에서 "⚡ 즉시 발송"(이 센터만, 대상 조건에 걸리는 센터 대상)을 눌러 실제 수신함에 메일이 도착하는지, `notification_log`에 `send_ok:true`로 기록되는지 확인.

## 1-7. 🟡 알림을 "실적 미업로드"/"이슈 미등록" 2개의 독립 알림으로 재구성 — SQL + index.ts 배포 필요 (2026-08-10)
- **배경**: 기존엔 "실적 미업로드"라는 하나의 주제를 주의(4일째)/경고(8일째) 2단계로 escalation해서 보냈는데, 대신 서로 다른 주제 2개(실적 미업로드 / 이슈·히스토리 미등록)를 각각 독립된 단일 알림으로 보내도록 재구성.
- **구현(index.ts, `runNotificationCheck` 재작성 — `index_수정본5_실적이슈알림분리.ts`로 전달)**: 센터마다 실적(`center_daily_performance`)과 이슈(`center_issues`)의 최근 저장/등록일을 각각 조회해 `checkAndSendOne()` 공용 헬퍼로 독립 판정·발송. `notification_log.level`은 실적='warn'(기존과 동일), 이슈='issue'(예전 'danger' 자리 대체)로 기록.
- **SQL**: `schema_addendum_14_notification_split_perf_issue.sql` — `notification_settings.danger_*` → `issue_*` 컬럼명 변경(재사용, 데이터 손실 없음) + 새 용도에 맞는 기본 제목/본문으로 갱신, `notification_log.days_since_upload` → `days_since` 이름 정리.
- **프론트엔드(app.js)**: 알림 설정 화면 "주의/경고 메일" 2단 구성 → "📊 실적 미업로드 알림"/"📝 이슈·히스토리 미등록 알림" 독립 2섹션으로 교체(이미 커밋·배포됨). 즉시발송 결과표 배지도 심각도(주의/경고)가 아니라 종류(실적/이슈) 표기로 변경.
- **배포 순서**: (1) SQL 실행 → (2) `deno check`(이미 통과 확인함) → (3) `supabase functions deploy center-report-upload`. **SQL을 먼저 실행해야** `issue_send_on_day`/`issue_subject`/`issue_body` 컬럼이 생겨서 새 index.ts가 정상 동작함(순서 바뀌면 컬럼 없음 오류).
- **검증(배포 후)**: 알림 설정 화면에서 "📝 이슈/히스토리 미등록 알림" 섹션에 새 기본 문구가 보이는지, 최근 N일간 이슈를 등록 안 한 센터를 대상으로 "⚡ 즉시 발송"을 눌렀을 때 이슈 알림이 정상 발송되고 결과표에 "📝 이슈"로 표시되는지 확인.

## 2. Function Secrets 확인 (Supabase 대시보드 → Edge Functions → Secrets)
| 키 | 용도 | 없으면 |
|---|---|---|
| `GMAIL_USER` | (2026-07-30부터) 업로드 알림 메일 발신 Gmail 주소 — SendGrid를 대체 | 미등록이면 발송 자체가 스킵되고 `notification_log.send_error`에 "GMAIL_USER 시크릿이 설정되지 않았습니다" 기록 |
| `GMAIL_APP_PASSWORD` | 위 Gmail 계정의 앱 비밀번호(2단계 인증 켠 뒤 구글 계정 → 보안 → 앱 비밀번호에서 발급, 16자리) — 로그인 비밀번호 아님 | 미등록/틀림이면 발송 실패, `send_error`에 "Gmail SMTP 오류: ..." 기록 |
| ~~`SENDGRID_API_KEY`~~ | (2026-07-30부터 미사용) 업로드 알림 메일 발송에 더 이상 안 씀 — Gmail SMTP로 교체됨 | 삭제해도 무방(다른 기능에서 안 씀) |
| ~~`SENDGRID_FROM_EMAIL`~~ | (2026-07-30부터 미사용) 위와 동일 | 삭제해도 무방 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Drive 폴더 접근 | `gdrive-poll-and-process`가 에러 반환 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Drive 인증 서명 | 위와 동일 |
| `GEMINI_API_KEY` | (다른 기능에서 사용중, 이 기능들과 무관) | - |
| `MOT_GATEWAY_URL` | AI 보조기능 Provider 엔드포인트 — **이미 등록 확인됨**(다른 kkangbi 프로젝트와 값 공유) | - |
| `MOT_GATEWAY_KEY` | MOT Gateway 키 — **이미 등록 확인됨** | - |

## 3. Edge Function 재배포
```
supabase functions deploy center-report-upload
```
배포 후 아무 액션이나 GET으로 호출해 500 에러가 안 나는지 확인 (예: `?action=list-last-upload`).

## 4. admin.html + style.css + app.js 배포 (★ 반드시 두 곳 모두, ★★ 2026-07-17부터 파일 3개 세트)
- **(2026-07-17 변경)** `admin.html`이 HTML/CSS/JS 3개 파일로 분리되었습니다: `admin.html`(뼈대) + `style.css`(전체 스타일) + `app.js`(전체 로직). 화면·기능·동작은 이전과 100% 동일하고, 브라우저가 세 파일을 나눠서 불러올 뿐입니다.
- **세 파일을 반드시 같은 폴더(예: 프로젝트 루트)에 함께 올려야 합니다.** `admin.html`만 올리고 `style.css`/`app.js`를 빠뜨리면 스타일 없는 흰 화면이나 완전히 빈 화면이 뜹니다.
- [ ] `kkangbi-report.vercel.app`에 `admin.html` + `style.css` + `app.js` 3개 모두 재배포
- [ ] `report.xn--2l0b841ao7b.kr`에 `admin.html` + `style.css` + `app.js` 3개 모두 재배포
- 한쪽만 하면 안 됨 — 과거 이 문제로 "고친 게 반영이 안 된다"는 혼선이 실제 발생했음 (`CHANGELOG.md` 2026-07-07~09 구간 참고)
- 배포 후 브라우저 개발자도구 Network 탭에서 `style.css`/`app.js`가 200으로 로드되는지 확인 (404면 파일이 같은 경로에 안 올라간 것)

## 5. 배포 후 스모크 테스트
- [ ] 브라우저 강력 새로고침(Ctrl+Shift+R / Cmd+Shift+R)으로 캐시 우회 후 접속
- [ ] 페이지 소스 보기(Ctrl+U)에서 최근 추가한 함수명(예: `gdrive-poll-and-process`, `selectSmartUpload`) 검색 → 최신 코드 서빙 확인
- [ ] 센터담당자 계정으로 로그인해 본인 센터만 보이는지, 새 관리자 메뉴(전체현황/업로드자료함/알림설정/스마트업로드)가 **안 보이는지** 확인 (보안 경계 재확인)
- [ ] 관리자 계정으로 로그인해 새 메뉴 4개가 모두 정상 진입되는지 확인
- [ ] 실제 파일 하나로 데이터입력 → 저장 → 워크스페이스 전체현황에 반영되는지 확인
- [ ] `list-gdrive-log`, `notification_log` 등 새 테이블에 정상적으로 로그가 쌓이는지 확인 (기능을 안 써도 에러 없이 빈 배열이 와야 함)

## 6. 문서 동기화
- [ ] `docs/CHANGELOG.md`에 이번 배포 내용 추가
- [ ] `docs/FEATURE.md`의 상태(✅/🟡/⛔) 갱신
- [ ] 새 API 액션을 추가했으면 `docs/API.md` 표에 추가
