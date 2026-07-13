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

## 1-1. Edge Function 배포 (2026-07-13, index.ts 전체 병합 완료)
- 이전엔 index.ts 원본이 없어 병합용 스니펫으로만 드렸지만, 이제 사용자가 제공한 실제 `index.ts`에 AI 보조기능 3개 액션 + "즉시 발송" 액션 + 캐싱 헬퍼가 전부 반영된 **완전한 파일**을 드립니다. 그대로 `supabase functions deploy center-report-upload`만 하면 됩니다(코드 수정 불필요).
- `callSogangMOT()`는 OpenAI 호환(chat/completions) 형식을 가정해 작성했습니다. 서강MOT Gateway의 실제 스펙과 다르면 이 함수만 수정하면 됩니다.

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
