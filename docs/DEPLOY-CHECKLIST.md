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

## 2. Function Secrets 확인 (Supabase 대시보드 → Edge Functions → Secrets)
| 키 | 용도 | 없으면 |
|---|---|---|
| `SENDGRID_API_KEY` | 업로드 알림 메일 발송 — **이미 등록 확인됨(2026-07-13)** | 그래도 발송 안 되면 `SENDGRID_FROM_EMAIL` 또는 SendGrid 발신자 인증 문제일 가능성 |
| `SENDGRID_FROM_EMAIL` | 발신자 주소 — **2026-07-13 시크릿 목록 확인 시 안 보였음, 미등록 의심** | 미등록이면 기본값(`noreply@example.com`)으로 시도하다 SendGrid가 미인증 발신자로 거부(403) 가능성 |
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
