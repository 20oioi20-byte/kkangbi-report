# /kkangbi-system — 시스템·저장·인증 작업용 스킬

## 언제 쓰나
- 인증/비밀번호 관련 버그·요청
- DB 스키마 변경, 새 테이블 추가
- 배포처(Vercel/Supabase) 구조 관련 질문
- "왜 안 되지" 류의 원인불명 오류 조사 (저장 안 됨, 반영 안 됨 등)

## 필수 선행 작업
1. `docs/SYSTEM.md` 전체를 먼저 읽는다.
2. 현재 `admin.html`, `index.ts`, 실행된 SQL 목록(`docs/DEPLOY-CHECKLIST.md` 체크상태)을 확인한다.

## 작업 패턴
### 새 테이블 추가
1. `schema_addendum_N_주제.sql` 새 파일 생성 (기존 파일 수정 금지)
2. RLS는 `enable row level security`만 걸고 정책은 추가하지 않는 기존 관례를 따른다 (anon 직접 접근 전면 차단, Edge Function의 `service_role`만 통과)
3. `docs/SYSTEM.md`의 "핵심 DB 테이블" 표에 한 줄 추가
4. `docs/DEPLOY-CHECKLIST.md`의 SQL 실행 순서에 추가

### 인증 관련 버그
- 항상 세 가지 인증 경로를 모두 점검한다: ① `workspace_password`(관리자) ② `token`(센터별) ③ Origin 자동인증(`isOpenAccessOrigin`)
- 새 액션을 추가할 때 이 중 어떤 걸 요구할지 반드시 명시하고 `isCenterOrWorkspaceAuthorized`/`isWorkspaceAuthorized` 헬퍼를 재사용한다 (직접 구현하지 않는다)

### "저장이 안 된다" 류 버그 조사 순서
1. 사용자가 누른 버튼이 **실제 저장 액션**인지, 아니면 미리보기/추출만 하는 단계인지 먼저 확인 (`양식에 반영` ≠ `전체 저장`)
2. 브라우저 콘솔 에러 확인 요청 (전역변수 선언 누락 등 실제 사례 있었음 — `docs/CHANGELOG.md` 2026-07-09 `categorySchemaCache` 참고)
3. 실제 배포본이 최신인지 확인 (`DEPLOY-CHECKLIST.md` 5번 스모크 테스트 방식으로)
4. 위 셋 다 정상이면 그때 서버측(Edge Function) 로그/쿼리로 넘어간다

## 절대 하지 말 것
- `rpt_kv`, `app_storage` 개념을 이 저장소에 끌어오지 않는다 (자매 저장소 kkangbi-calendar 전용)
- localStorage에 비밀번호/토큰 영구 저장하지 않는다
