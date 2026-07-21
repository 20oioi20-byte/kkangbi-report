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
13. 🟡 `schema_addendum_12_center_soft_delete.sql` — `center_config.is_deleted` 컬럼 추가(소프트 삭제용). **SQL만으로는 버그가 완전히 고쳐지지 않음** — Edge Function의 `center-delete` 액션(현재 `center_config` 행을 물리 DELETE → 하위 테이블 외래키 위반으로 500 에러)을 `is_deleted = true`로 UPDATE하도록, 그리고 센터 목록 조회 쿼리를 `is_deleted = false`만 보이도록 index.ts를 함께 수정해야 완료됨(아래 "센터 삭제 500 에러" 참고).

## 1-1. Edge Function 배포 (2026-07-13, index.ts 전체 병합 완료)
- 이전엔 index.ts 원본이 없어 병합용 스니펫으로만 드렸지만, 이제 사용자가 제공한 실제 `index.ts`에 AI 보조기능 3개 액션 + "즉시 발송" 액션 + 캐싱 헬퍼가 전부 반영된 **완전한 파일**을 드립니다. 그대로 `supabase functions deploy center-report-upload`만 하면 됩니다(코드 수정 불필요).
- `callSogangMOT()`는 OpenAI 호환(chat/completions) 형식을 가정해 작성했습니다. 서강MOT Gateway의 실제 스펙과 다르면 이 함수만 수정하면 됩니다.
- **(2026-07-15 장애 이후 필수 절차) `index.ts`를 배포하기 전에 반드시 로컬에서 `deno check index.ts`로 타입체크 통과를 확인할 것.** 2026-07-15에 `mammoth` 라이브러리의 esm.sh 타입선언이 예고 없이 바뀌면서 배포가 통째로 막히고 사이트 전체(센터 목록 포함)가 멈춘 적이 있음 — 코드를 안 건드려도 외부 CDN 타입선언 변경만으로 배포가 실패할 수 있으므로, 매 배포 전 `deno check`를 습관화할 것. Deno가 없으면 `curl -fsSL https://deno.land/install.sh | sh`로 설치.
- 장애 시 진단 순서: (1) Supabase Table Editor로 DB 데이터 실제 존재 여부 확인(데이터 유실이 아닌지 우선 구분) → (2) 브라우저 콘솔에 CORS 에러가 뜨면 Edge Function이 요청 처리 전에 죽고 있다는 뜻 → (3) 로컬에서 `deno check index.ts`로 재현 → (4) 안전하면 이전 정상 배포본으로 즉시 롤백해 서비스부터 복구.

## 1-2. 🟡 센터 삭제 500 에러 (2026-07-21, 원인 확인됨 · 수정 대기)
- **증상**: 사이드바에서 센터 삭제 시 `Failed to load resource: ... 500`, 실제 메시지는 `삭제 실패: update or delete on table "center_config" violates foreign key constraint "center_monthly_settings_center_code_fkey" on table "center_monthly_settings"`(Supabase Edge Function 로그로 확인).
- **원인**: `center-delete` 액션이 `center_config` 행을 물리적으로 `DELETE`하는데, 그 센터를 참조하는 `center_monthly_settings`(및 다른 하위 테이블도 데이터가 있으면 마찬가지) 행이 남아있어 외래키 제약 위반. 그런데 현재 삭제 확인창 문구는 "등록된 실적 데이터는 DB에 남지만 목록에서는 사라집니다"라서, 원래 의도는 물리 삭제가 아니라 **소프트 삭제**(목록에서만 숨기기)였던 것으로 보임 — 실제 구현이 그 의도와 어긋나 있는 상태.
- **준비된 것**: `schema_addendum_12_center_soft_delete.sql` — `center_config`에 `is_deleted boolean default false` 컬럼 추가(추가 전용, 기존 데이터 무변경).
- **아직 필요한 것(index.ts 수정, 이 저장소에 소스가 없어 미완료)**:
  1. `center-delete` 액션: `DELETE FROM center_config ...` → `UPDATE center_config SET is_deleted = true WHERE center_code = ...`로 변경.
  2. 센터 목록을 내려주는 쿼리(사이드바에 뜨는 센터 목록, `centers-list` 류 액션으로 추정)에 `WHERE is_deleted = false` 조건 추가.
  3. (선택) "복구" 기능이 필요하면 `is_deleted = false`로 되돌리는 관리자 액션도 추가 가능.
- 프론트엔드(`app.js`)는 `action=center-delete` 호출부 그대로 재사용 가능 — 수정 불필요.

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
