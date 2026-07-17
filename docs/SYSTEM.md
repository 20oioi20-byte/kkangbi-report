# SYSTEM.md — 아키텍처

## 1. 한 줄 요약
`admin.html`(뼈대) + `style.css`(전체 스타일) + `app.js`(전체 로직) — 정적 파일 3개 세트 → Supabase Edge Function `center-report-upload`(action 기반 단일 함수) → Supabase Postgres.
(2026-07-17까지는 `admin.html` 단일 파일이었으나, 토큰/유지보수 효율을 위해 HTML/CSS/JS 3개로 분리했습니다. 화면·기능·동작은 100% 동일합니다.)

## 2. 배포처
| 용도 | URL | 인증 방식 |
|---|---|---|
| 센터담당자용 | `kkangbi-report.vercel.app/admin.html` | 센터별 비밀번호(초기 `000000`) |
| 관리자(성호님)용 | `report.xn--2l0b841ao7b.kr/admin.html` | 접속 도메인(Origin) 서버 검증 → 자동 전체열람 (비밀번호 불필요) |

두 URL은 **같은 `admin.html`+`style.css`+`app.js` 3개 파일**을 쓰지만 **별도 Vercel 배포**입니다. 하나만 업데이트하면 다른 쪽은 구버전이 남습니다. **세 파일 다 같이 올려야** 합니다 — `admin.html`만 올리고 `style.css`/`app.js`를 빠뜨리면 화면이 깨지거나 아예 안 뜹니다.

## 3. Supabase 프로젝트
- 프로젝트 ID: `zbiwyqwjehnogxkzlhxx`
- Edge Function: `center-report-upload` (경로: `/functions/v1/center-report-upload`)
- 모든 요청은 `?action=xxx` 쿼리파라미터로 분기 (REST 스타일 라우팅 아님)

## 4. 인증 구조
- `workspace_config` 테이블: 단일 행, `password_hash` (SHA-256), 초기값 `112233`
- `center_config` 테이블: 센터별 `password_hash`, 초기값 `000000`, `upload_token`(uuid, 센터별 자동추출 API 인증에 사용)
- 도메인 자동인증: Edge Function이 요청의 `Origin` 헤더를 검사해 `report.xn--2l0b841ao7b.kr`이면 비밀번호 없이 워크스페이스(관리자) 권한 부여 (`isOpenAccessOrigin`)
- 브라우저 측: `sessionStorage`에 워크스페이스 비밀번호를 세션 동안 캐시(`workspacePasswordCache`). `localStorage`에 비밀번호를 영구 저장하지 않음.
- 신규 기능(알림설정, 업로드자료함, 스마트업로드, Google Drive 연동)은 전부 `workspaceUnlocked === true`(관리자)일 때만 사이드바에 노출.

## 5. 핵심 DB 테이블
| 테이블 | 용도 |
|---|---|
| `center_config` | 센터 메타(이름, 비밀번호, row_schema, sort_order 등) |
| `center_daily_performance` | 일자별 실적/근태 (`attendance_data`, `performance_data` jsonb) |
| `center_monthly_settings` | 월별 TO(관리자/상담사 정원) |
| `center_kpi_settings` / `center_kpi_monthly_targets` | 핵심지표 기본목표/월별목표 |
| `uploaded_files_log` + Storage 버킷 `uploaded-files` | 업로드 원본 파일 보관(업로드자료함) |
| `center_contacts` / `notification_settings` / `notification_log` | 담당자 이메일, 알림 발송 설정/이력 |
| `gdrive_folder_map` / `gdrive_processed_files` | Google Drive 완전자동 연동 폴더 매핑/처리이력 |

전체 컬럼 정의는 `schema.sql` + `schema_addendum_1~8_*.sql`을 순서대로 참고 (`DEPLOY-CHECKLIST.md`에 목록).

## 6. 프론트엔드 구조 (`admin.html` + `style.css` + `app.js`)
- (2026-07-17) 원래 `admin.html` 한 파일에 CSS/JS가 전부 인라인으로 들어있었으나, 코드가 6,500줄을 넘어가면서 작업할 때마다 파일 전체를 다시 읽고 검증해야 해 비효율적이었음 — HTML(`admin.html`)/CSS(`style.css`)/JS(`app.js`) 3개로 분리. **화면·기능·동작은 100% 동일**, `<link>`/`<script src>`로 불러오는 것만 다름.
- 순수 vanilla JS, 프레임워크 없음. 상태는 전역 변수(`let currentCenter`, `let viewingWorkspaceOverview` 등)로 관리.
- `renderMain()`이 현재 상태 플래그를 보고 어느 화면을 그릴지 분기하는 단일 라우터.
- 외부 라이브러리: Chart.js(그래프), SheetJS/XLSX(엑셀 파싱), 둘 다 CDN(jsdelivr, cdnjs) 로드(`defer`) + jsdelivr 실패시 unpkg 폴백. 이 두 CDN 스크립트 태그와 폴백용 부트스트랩 스크립트만 `admin.html`에 인라인으로 남아있고, 나머지 로직은 전부 `app.js`에 있음.
- 새 기능 추가/버그 수정 시 이제 `app.js`(로직) 또는 `style.css`(스타일) 중 관련된 파일만 열어서 고치면 됨 — `admin.html`은 거의 안 건드림.

## 7. 백엔드 구조 (`index.ts`, Deno Edge Function)
- `Deno.serve(async (req) => { ... if (action === 'xxx') { ... } ... })` 하나의 거대한 분기문.
- 파일 파싱(XLSX)도 서버에서 필요할 때가 있어 `npm:xlsx`를 import해 브라우저와 거의 동일한 API로 사용 (Google Drive 완전자동 처리용).
- Google Drive 서비스계정 인증은 자체 JWT 서명(Web Crypto API, RSASSA-PKCS1-v1_5)으로 구현 — 외부 라이브러리 없음.
- 이메일 발송은 SendGrid REST API 직접 호출(`Deno.env.get('SENDGRID_API_KEY')`).

## 8. 두 저장소 비교 (혼동 방지용)
| | **kkangbi-report** (이 저장소) | kkangbi-calendar (자매 저장소) |
|---|---|---|
| 메인 파일 | `admin.html` + `style.css` + `app.js` (2026-07-17 분리) | `index.html` |
| 백엔드 | Supabase Edge Function 1개(action 라우팅) | Vercel `api/*.js` 서버리스 함수 다수 |
| 저장 테이블 | `center_daily_performance` 등 도메인별 테이블 | `rpt_kv` (키-값 저장, `app_storage` 사용 금지) |
| 비밀번호 초기값 | 마스터 `112233` / 센터 `000000` (동일) | 동일 정책 사용 |

같은 사람(성호님)이 운영하는 같은 "깡비서" 생태계라 인증 정책 숫자는 같지만, **저장 방식과 배포 구조는 서로 다릅니다.** kkangbi-calendar 작업 지시를 이 저장소에 그대로 적용하면 존재하지 않는 테이블/파일을 찾게 됩니다.
