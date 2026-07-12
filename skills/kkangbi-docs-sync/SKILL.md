# /kkangbi-docs-sync — 문서↔스킬↔코드 동기화용 스킬

## 언제 쓰나
- 새 대화창을 시작하기 전, 지금까지 작업을 문서화할 때 (지금 이 작업이 그 예시)
- 여러 기능을 한꺼번에 바꿔서 문서가 여러 군데 낡았을 때
- 새 세션 시작 시 "문서가 실제 코드와 맞는지" 먼저 검산할 때

## 이 저장소에 자동 동기화 스크립트가 없는 이유
`admin.html` 단일 정적 파일 구조라 빌드 파이프라인(`npm run ...`) 자체가 없다. 따라서 "문서 동기화"는 **에이전트가 매번 수동으로 아래 체크리스트를 도는 것**으로 대신한다.

## 동기화 체크리스트 (수동)
1. **`docs/FEATURE.md`와 실제 `admin.html`/`index.ts` 대조**
   - 새 전역 상태 플래그(`viewing*`)가 추가됐는데 FEATURE.md에 없으면 → 섹션 추가
   - ✅/🟡/⛔ 상태가 실제와 다르면 → 갱신 (특히 "검증됨"이라고 써놓고 실제로는 실사용 테스트 안 한 경우 🟡로 낮출 것)
2. **`docs/API.md`와 `index.ts`의 `if (action === ...)` 목록 대조**
   - `grep -n "action === '" index.ts`로 전체 액션 뽑아서 표에 빠진 게 없는지 확인
3. **`docs/SYSTEM.md`의 "핵심 DB 테이블" 표와 실행된 `schema_addendum_*.sql` 대조**
4. **`docs/CHANGELOG.md`가 최신 작업까지 반영됐는지 확인**
5. **`docs/DEPLOY-CHECKLIST.md`의 SQL 실행 순서 목록에 새 addendum 파일이 빠짐없이 들어있는지 확인**

## 새 대화창 시작용 인수인계 프롬프트 (템플릿)
```
kkangbi-report(admin.html) 개발 이어서 할 거야.
docs/AGENTS.md → SYSTEM.md → FEATURE.md → API.md → CHANGELOG.md → DEPLOY-CHECKLIST.md 순서로 읽고,
작업 성격에 맞는 skills/kkangbi-*/SKILL.md도 참고해서 이어서 진행해줘.

[이번에 하고 싶은 것]
(여기에 구체적 요청 작성)
```

## 첨부할 파일 (새 대화창에)
- `docs/` 폴더 전체 6개 파일
- `skills/` 폴더 전체 (또는 관련 있는 스킬 1~2개만)
- 최신 `admin.html`
- 최신 `index.ts` (edge-function-center-report-upload.ts)
- 아직 실행 안 한 `schema_addendum_*.sql`이 있다면 그것들
