-- schema_addendum_17_workspace_holidays.sql
-- 문서결재 요청 — 공휴일표 (전체 공용)
-- 실행 순서: … → addendum_15 → addendum_16 → **이 파일**
-- 관련: docs/FEATURE.md 20장, docs/CHANGELOG.md 2026-09-08
--
-- 왜 workspace_config 인가:
--   공휴일은 센터마다·문서마다 다르지 않다. 문서에 따로 두면 문서를 만들 때마다
--   같은 표를 다시 넣어야 하고, 대체공휴일이 하나 생기면 문서 수만큼 고쳐야 한다.
--   그래서 **전체가 한 표를 함께 본다.**
--
--   center_documents.holidays(addendum_16)는 그대로 두되 «그 문서만의 예외» 로 쓴다.
--   실제 계산은 workspace 표 위에 문서 표를 얹어서 본다.

alter table workspace_config
  add column if not exists holidays jsonb not null default '{}'::jsonb;

comment on column workspace_config.holidays is
  '공휴일표 {"YYYY-MM-DD":"이름"}. 날짜 규칙(매월 n번째 ○요일 · 쉬는 날이면 다음 평일)이 «쉬는 날» 을 판단할 때 쓴다. 토·일은 늘 쉬는 날이라 여기 안 넣는다.';
