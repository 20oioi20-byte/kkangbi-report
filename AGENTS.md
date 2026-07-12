# AGENTS.md — kkangbi-report 개발 에이전트 규칙

> 이 문서는 **kkangbi-report** (실적/KPI 관리 도구, `admin.html` + Supabase Edge Function `center-report-upload`)를 다루는 모든 AI 에이전트가 작업 시작 전 반드시 읽어야 합니다.
> 자매 저장소 **kkangbi-calendar** (`index.html`, `rpt_kv`, `app_storage` 금지 규칙)와는 **완전히 다른 저장 구조**를 씁니다 — 혼동해서 규칙을 잘못 적용하지 마세요. (자세한 차이는 `SYSTEM.md` 맨 아래 "두 저장소 비교" 참고)

## 0. 읽기 순서
1. `AGENTS.md` (이 문서)
2. `SYSTEM.md` — 아키텍처, DB, 인증
3. `FEATURE.md` — 구현된/진행중 기능, 검증 체크리스트
4. `API.md` — Edge Function 액션 전체 목록
5. `CHANGELOG.md` — 최근 변경 이력
6. `DEPLOY-CHECKLIST.md` — 배포 전 검사

작업 성격에 따라 `skills/` 아래 해당 스킬도 함께 읽습니다 (섹션 2 참고).

## 1. 작업 원칙
- **추측 금지, 실물 검증 우선**: 사용자가 실제 파일(엑셀/HWPX/근태파일)을 주면 반드시 그 파일을 직접 열어서(`bash_tool`/Node로 XLSX 파싱) 검증한 뒤 코드를 고칩니다. 코드만 읽고 "이럴 것이다"로 결론 내리지 않습니다.
- **전체 교체 파일 원칙**: 패치(diff) 조각이 아니라, 수정이 끝난 `admin.html` 전체 파일과 `index.ts`(Edge Function) 전체 파일을 항상 다시 내려줍니다.
- **SQL은 addendum으로 분리**: 스키마 변경은 기존 `schema.sql`을 고치지 않고 `schema_addendum_N_주제.sql` 형태로 새로 만들어 번호 순서대로 실행하게 합니다 (`DEPLOY-CHECKLIST.md`에 순서 기록).
- **문법 검증 필수**: JS는 `node --check`, TS는 중괄호/괄호 수 대조로 최소 검증 후 전달합니다. (Deno 미설치 환경이라 완전한 타입체크는 불가 — 실제 배포 후 Supabase 로그로 최종 확인 필요함을 사용자에게 알립니다.)
- **비용 민감도**: 새 기능에 유료 API(AI 모델 호출, 유료 SaaS)가 필요하면 반드시 먼저 알리고, 가능하면 무료 티어/규칙 기반 로직으로 대체합니다. (예: 파일 자동분류는 AI 호출 없이 시트명/헤더 패턴 매칭으로 구현되어 있음 — `FEATURE.md` "스마트업로드" 참고)
- **보안 경계 유지**: 센터담당자용 배포(`kkangbi-report.vercel.app`)와 관리자용 배포(`report.xn--2l0b841ao7b.kr`, 도메인 자동인증)의 권한 분리는 어떤 기능을 추가하든 절대 깨지 않습니다. 새 메뉴는 반드시 `workspaceUnlocked` 조건으로 감쌉니다.

## 2. 문서·스킬 동기화 의무
기능/API/DB/UI를 변경했으면 **같은 턴 안에서** 아래를 모두 갱신합니다 (미루지 않음):
1. 해당 내용이 걸리는 `docs/*.md` 파일 갱신
2. `docs/CHANGELOG.md`에 한 줄 이상 추가 (날짜, 요약, 관련 SQL 파일명)
3. 관련 스킬(`skills/kkangbi-*`)에 새 패턴이 생겼으면 업데이트

이 저장소는 `npm run sync:manuals` 같은 자동 동기화 스크립트가 **없습니다** (단일 HTML 파일 구조라 빌드 파이프라인 자체가 없음). 동기화는 에이전트가 수동으로 위 3가지를 직접 갱신하는 방식으로 대신합니다. `skills/kkangbi-docs-sync/SKILL.md`에 체크리스트가 있습니다.

## 3. 절대 규칙 (kkangbi-report 기준)
- **저장 위치**: 모든 실적/근태 데이터는 `center_daily_performance` 테이블(컬럼 `attendance_data`/`performance_data`, jsonb)에 저장합니다. `rpt_kv`/`app_storage`는 이 저장소에 존재하지 않는 테이블입니다 — kkangbi-calendar 전용 규칙을 여기 적용하지 마세요.
- **비밀번호는 서버(Supabase Edge Function) 공통 검증**: `workspace_config.password_hash`(마스터, 초기값 `112233`), `center_config.password_hash`(센터별, 초기값 `000000`). 브라우저 `localStorage`에 PIN/비밀번호를 직접 저장하지 않습니다 — `sessionStorage`에 세션 동안만 캐시하는 것은 허용(기존 `workspacePasswordCache` 패턴 유지).
- **파일 구조**: 이 저장소는 `index.html` + `api/*.js` (Next.js API 라우트) 구조가 아니라, **`admin.html` 단일 정적 파일 + Supabase Edge Function 1개(`center-report-upload`, action 쿼리파라미터로 라우팅)** 구조입니다. 새 기능을 "새 API 파일"로 만들지 말고 `index.ts` 안에 `if (action === '...')` 블록으로 추가합니다.
- **배포**: `admin.html`은 **두 곳**에 각각 올려야 합니다 — `kkangbi-report.vercel.app`(센터담당자용), `report.xn--2l0b841ao7b.kr`(관리자용, 도메인 자동인증). 한쪽만 올리면 다른 쪽은 구버전이 남아 사용자가 혼란을 겪습니다(과거 실제 발생 사례 있음 — `CHANGELOG.md` 참고).
