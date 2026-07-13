# API.md — Edge Function `center-report-upload` 액션 목록

베이스 URL: `https://zbiwyqwjehnogxkzlhxx.supabase.co/functions/v1/center-report-upload?action=<ACTION>`
모든 요청은 헤더 `Authorization: Bearer <SUPABASE_ANON_KEY>` 필요.
인증 방식: `token`(센터별 upload_token, 본인 센터만) / `workspace_password`(관리자, 전체) / Origin 자동인증(관리자 도메인).

## 실적/근태 데이터
| action | method | 인증 | 설명 |
|---|---|---|---|
| `schema` | GET | token | 센터 row_schema 조회 |
| `manual-entry` | POST | token | 단일 날짜 실적/근태 저장 |
| `manual-entry-bulk` | POST | token | **여러 날짜 한번에 저장** (5건씩 나눠 보내던 방식 대체) |
| `history` | GET | token | 최근 30일 조회(센터 자신) |
| `admin-overview` | GET | 공개 | 전체 센터 최근 300건 조회 (워크스페이스 대시보드용) |
| `delete-dates` | POST | token | 선택 날짜 일괄삭제 (낙관적 UI 갱신 필요 — `SYSTEM.md`/`CHANGELOG.md` 참고) |

## 센터/설정 관리
| action | method | 인증 | 설명 |
|---|---|---|---|
| `add-center` / `rename-center` / `delete-center` / `reorder-centers` | POST | workspace | 센터 CRUD |
| `save-row-schema` | POST | workspace | row_schema 등록 |
| `list-monthly-to` / `save-monthly-to` / `save-monthly-to-bulk` / `delete-monthly-to` | GET/POST | workspace 또는 본인센터 | TO(정원) 설정 |
| `list-kpi-settings` / `save-kpi-setting` / `delete-kpi-setting` | GET/POST | workspace 또는 본인센터 | 핵심지표 기본 목표값 |
| `list-kpi-monthly-targets` / `save-kpi-monthly-targets-bulk` | GET/POST | workspace 또는 본인센터 | 핵심지표 월별 목표값 |
| `save-workspace-password` / `save-center-password` | POST | workspace | 비밀번호 변경 |

## 업로드 자료함
| action | method | 인증 | 설명 |
|---|---|---|---|
| `archive-upload-file` | POST | token | 원본 파일 Storage 저장 + 로그 기록 |
| `archive-list-files` | GET | workspace(전체) 또는 token(본인센터) | 목록/검색 |
| `archive-file-url` | POST | workspace 또는 본인센터 | 다운로드 서명URL(120초 유효) 발급 |
| `archive-delete-file` / `archive-delete-files-bulk` | POST | workspace 또는 본인센터 | 삭제(Storage+로그 동시) |

## 업로드 모니터링 + 이메일 알림
| action | method | 인증 | 설명 |
|---|---|---|---|
| `list-last-upload` | GET | **공개**(CORS `*`, 외부 사이트 연동용) | 센터별 최근 업로드 시각 |
| `list-contacts` / `save-contact` / `delete-contact` | GET/POST | workspace 또는 본인센터 | 담당자 이메일 CRUD |
| `get-notification-settings` | GET | 공개(읽기 전용) | 발송 설정 조회 |
| `save-notification-settings` | POST | workspace | 발송 설정 저장 |
| `list-notification-log` | GET | workspace | 발송 이력 |
| `check-and-notify` | GET/POST | **크론 전용**(인증 없음, pg_cron이 매시 정각 호출) | 미업로드 감지 + 메일 발송 |

## Google Drive 완전자동
| action | method | 인증 | 설명 |
|---|---|---|---|
| `save-gdrive-folder` | POST | workspace | 센터별 Drive 폴더 등록 |
| `list-gdrive-folders` | GET | workspace | 등록된 폴더 조회 |
| `list-gdrive-log` | GET | workspace | 처리 이력 조회 |
| `gdrive-poll-and-process` | GET/POST | **크론 전용**(인증 없음, pg_cron이 15분마다 호출) | 폴더 감시 + 자동 분석·반영 |

## AI 보조기능 (2026-07-13 추가, ⛔ Edge Function 미배포 상태)
| action | method | 인증 | 설명 |
|---|---|---|---|
| `ai-suggest-xlsx-mapping` | POST | token 또는 workspace | 엑셀 헤더 텍스트+기존 필드정의를 보고 새 헤더 키워드 매핑을 AI가 제안 |
| `save-xlsx-field-override` | POST | token 또는 workspace | 승인된 매핑을 센터별로 저장 (`center_xlsx_field_override`) |
| `get-xlsx-field-override` | GET | token 또는 workspace | 저장된 매핑 조회 (데이터입력 화면 진입 시 자동 로드) |
| `ai-summarize-issues` | POST | token 또는 workspace | 이슈/히스토리 목록을 AI가 요약(반복패턴/미해결추정/특이사항) |

- 모든 AI 액션은 **서강MOT API 단일 Provider**로만 호출(모델 고정: GPT5.5, 선택 기능 없음). 크레딧 소진 등으로 실패하면 다른 Provider로 전환하지 않고, 프론트엔드가 "AI 사용 불가 · 직접 입력해달라"는 안내를 띄운다(기존 수동 붙여넣기/저장 기능은 AI와 무관하게 항상 정상 동작).
- 필요 Function Secrets: `SOGANG_MOT_API_URL`, `SOGANG_MOT_API_KEY`.
- (2026-07-13 갱신) 사용자가 실제 `index.ts`를 공유해주셔서, 이제 **전체 파일**(`index.ts`)에 병합 완료된 상태로 제공됩니다. 이전의 병합용 스니펫(`edge-function-addendum-ai-provider.ts`)은 삭제했습니다.

## 업로드 모니터링 알림 — 즉시 발송 (2026-07-13 추가)
| action | method | 인증 | 설명 |
|---|---|---|---|
| `send-notification-now` | POST | workspace | 발송시각/반복주기/중복방지 조건을 모두 무시하고, 지금 조건(며칠째 미업로드)에 맞는 센터에 바로 발송. `check-and-notify`와 핵심 로직(`runNotificationCheck`)을 공유.

## 참고사항
- `list-last-upload`, `get-notification-settings`는 **의도적으로 공개 GET**입니다(CORS `*`). 캘린더 통합사이트 등 외부 사이트에서 직접 fetch로 신호등을 그리는 용도.
- `check-and-notify`, `gdrive-poll-and-process`는 사람이 아니라 **pg_cron이 내부적으로 호출**합니다. 별도 인증이 없으므로 새 액션을 추가할 때 이 두 개처럼 "무인증 + 파괴적이지 않은 동작"만 허용하도록 설계해야 합니다.
- 새 액션 추가 시 반드시 `AGENTS.md`의 "보안 경계 유지" 규칙(workspace/token 인증 분리)을 따르고 이 표에 줄을 추가합니다.
- (2026-07-13) 응답 캐싱: 대부분의 GET은 `json()`으로 `no-store`(항상 최신) 응답하지만, `schema`/`get-notification-settings`/`list-kpi-settings`/`list-kpi-monthly-targets`/`list-monthly-to`/`centers-manage-list`/`get-xlsx-field-override`처럼 **자주 안 바뀌는 조회성 GET**만 `jsonCached()`로 짧은(`private, max-age=20`) 캐시를 둔다. 실적/근태/자료함처럼 실시간성이 중요한 응답에는 절대 쓰지 않는다. 새 조회성 액션을 추가할 때 이 기준으로 캐시 여부를 판단할 것.
