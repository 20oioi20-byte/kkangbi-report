-- schema_addendum_16_center_documents_repeat.sql
-- 문서결재 요청 — 되풀이 줄 + 공휴일표
-- 실행 순서: … → addendum_15 → **이 파일**
-- 관련: docs/FEATURE.md 20장, docs/CHANGELOG.md 2026-09-08
--
-- 왜 필요한가:
--   실제 공문 두 달치 짝 10쌍을 견줘 보니 **4쌍이 달마다 표 줄 수가 바뀐다.**
--   「이미지 파일 모니터링 점검」 은 그 달의 월요일마다 한 줄이라 7월 4줄 · 8월 5줄이다.
--   값 자리만 갈아끼우는 방식으로는 이 문서들을 아예 만들 수 없었다.

-- 되풀이 줄 규칙
--   { by:   { kind:'weekdays'|'count'|'manual', wd, avoid, n },
--     cols: [ { key, label, from:'date'|'input', type } ] }
alter table center_documents
  add column if not exists repeat jsonb;

-- 공휴일표 — 날짜 규칙(매월 n번째 ○요일 · 쉬는 날이면 다음 평일)이 쓴다.
--   { 'YYYY-MM-DD': '이름', … }
--   없으면 주말만 보고, 화면이 «공휴일표가 없어 주말만 봤습니다» 라고 밝힌다.
--   ⚠ 조용히 틀린 날짜를 내는 것보다 «무엇을 못 봤는지» 를 말하는 편이 낫다.
alter table center_documents
  add column if not exists holidays jsonb;

comment on column center_documents.repeat is
  '되풀이 줄 규칙. 본문의 {{#키}} 가 든 <tr> 이 틀이 되고, 줄 수는 이 규칙이 정한다.';
comment on column center_documents.holidays is
  '공휴일표 {날짜:이름}. 날짜 규칙이 «쉬는 날» 을 판단할 때 쓴다. 없으면 주말만 본다.';
