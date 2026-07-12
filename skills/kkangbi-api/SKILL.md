# /kkangbi-api — Edge Function API 작업용 스킬

## 언제 쓰나
- 새 액션(endpoint) 추가/수정
- 인증 로직 변경
- 외부 API 연동 (SendGrid, Google Drive API 등)

## 필수 선행 작업
1. `docs/API.md` 전체 표를 읽고 기존 액션 네이밍 규칙을 파악한다 (`list-*`=조회, `save-*`=추가/수정, `delete-*`=삭제, `*-bulk`=일괄).
2. 새 액션이 들어갈 자리를 `index.ts`에서 찾는다 — 관련 있는 기존 액션 블록 바로 아래에 추가한다 (파일 끝에 아무렇게나 추가하지 않는다).

## 작업 패턴
### 새 액션 추가 체크리스트
1. `if (action === 'xxx' && req.method === 'GET'|'POST')` 블록 작성
2. 인증: `isWorkspaceAuthorized` / `isCenterOrWorkspaceAuthorized` 중 맞는 것 사용 (크론 전용 액션이 아닌 이상 반드시 인증 넣을 것)
3. 에러는 항상 `json({ success: false, error: '...' }, <상태코드>)` 형태로 반환 (프론트에서 `data.success` 체크하는 패턴과 일치시킴)
4. 성공은 `json({ success: true, ...데이터 }, 200)`
5. 작업 완료 후 `docs/API.md` 표에 한 줄 추가

### 외부 API 연동 시
- 새 시크릿이 필요하면 **반드시 사용자에게 먼저 알리고** `Deno.env.get('KEY_NAME')`으로 안전하게 참조 (하드코딩 금지)
- 시크릿이 없을 때 500 에러로 죽지 않고, 명확한 한국어 에러 메시지로 "무엇이 없어서 안 되는지" 반환하도록 작성 (`getGoogleAccessToken()`이 `null` 반환 시 처리 패턴 참고)
- 외부 API 실패가 메인 기능(데이터 저장 등)을 막지 않도록 try/catch로 격리 (예: 이메일 발송 실패해도 데이터 저장 자체는 성공 처리)

### 파일 파싱 로직을 서버(Edge Function)에도 넣어야 할 때
- `admin.html`의 브라우저 로직을 그대로 복사하지 말고, Deno 환경(`npm:xlsx` import, Web Crypto API)에 맞게 이식한다.
- 이식한 로직은 반드시 **실제 파일로 검증 후** 배포한다 — 검증 안 된 채로 자동화 파이프라인에 연결하면 잘못된 데이터가 조용히 DB에 쌓일 수 있다 (`docs/FEATURE.md` "Google Drive 완전자동" 섹션의 🟡/⛔ 구분 이유).

## 타입 검증
- 이 환경엔 Deno가 없어 완전한 타입체크가 불가능하다. 최소한 중괄호/괄호 개수 대조(`python3 -c "print(content.count('{'), content.count('}'))"`)로 구조적 오류는 잡고, 최종 검증은 실제 Supabase 배포 후 로그로 한다는 것을 사용자에게 명시한다.
