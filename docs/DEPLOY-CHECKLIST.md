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

## 2. Function Secrets 확인 (Supabase 대시보드 → Edge Functions → Secrets)
| 키 | 용도 | 없으면 |
|---|---|---|
| `SENDGRID_API_KEY` | 업로드 알림 메일 발송 | 발송 조용히 실패(로그만 남음) |
| `SENDGRID_FROM_EMAIL` | 발신자 주소 | 위와 동일 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Drive 폴더 접근 | `gdrive-poll-and-process`가 에러 반환 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Drive 인증 서명 | 위와 동일 |
| `GEMINI_API_KEY` | (다른 기능에서 사용중, 이 기능들과 무관) | - |

## 3. Edge Function 재배포
```
supabase functions deploy center-report-upload
```
배포 후 아무 액션이나 GET으로 호출해 500 에러가 안 나는지 확인 (예: `?action=list-last-upload`).

## 4. admin.html 배포 (★ 반드시 두 곳 모두)
- [ ] `kkangbi-report.vercel.app` 재배포
- [ ] `report.xn--2l0b841ao7b.kr` 재배포
- 한쪽만 하면 안 됨 — 과거 이 문제로 "고친 게 반영이 안 된다"는 혼선이 실제 발생했음 (`CHANGELOG.md` 2026-07-07~09 구간 참고)

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
