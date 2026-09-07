-- schema_addendum_15_center_documents.sql
-- 문서결재 요청 — 결재 문서 양식과 회차별 저장
-- 실행 순서: schema.sql → addendum_1 ~ 14 → **이 파일**
-- 관련: docs/FEATURE.md 20장, docs/CHANGELOG.md 2026-09-07
--
-- 담당자(center_contacts)는 이미 있는 것을 그대로 쓴다. 새로 만들지 않는다.

-- ─────────────────────────────────────────────────────────────
-- 1. 문서 양식 (센터별)
-- ─────────────────────────────────────────────────────────────
create table if not exists center_documents (
  id            uuid primary key default gen_random_uuid(),
  center_code   text not null,
  name          text not null,
  kind          text not null default 'etc',   -- rep 운영보고 · bil 청구·정산 · gon 공문·점검 · etc 기타
  body          text not null default '',      -- 결재 본문 HTML. 값 자리는 {{키}}
  fields        jsonb not null default '[]'::jsonb,   -- 담당자·파일이 채우는 칸(당월값)
  auto_fields   jsonb not null default '[]'::jsonb,   -- 아무에게도 묻지 않는 칸(전월값·차이·부가세·합계)
  slot          jsonb,                                -- 엑셀 추출 규칙 (없으면 null)
  opts          jsonb not null default '{}'::jsonb,   -- 항목설정 { 키: {list,removed,mine} }
  contact_ids   jsonb not null default '[]'::jsonb,   -- 받는 담당자 (center_contacts.id 참조)
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_center_documents_center
  on center_documents (center_code, sort_order, created_at);

-- ─────────────────────────────────────────────────────────────
-- 2. 회차별 저장 — **덮어쓰지 않고 쌓는다**
--    같은 달을 고쳐 저장하면 위에 얹힌다. 앞의 것을 지우지 않는다.
--    "7월에 뭘 받아서 뭘 만들었나" 를 나중에 되돌아볼 수 있어야 한다.
-- ─────────────────────────────────────────────────────────────
create table if not exists center_document_saves (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references center_documents(id) on delete cascade,
  center_code   text not null,
  ym            text not null,                        -- 'YYYY-MM'
  vals          jsonb not null default '{}'::jsonb,   -- 그때 넣은 값 전부
  srcs          jsonb not null default '{}'::jsonb,   -- 어느 파일 어느 열에서 읽었는지(증거)
  contact_ids   jsonb not null default '[]'::jsonb,   -- 그때 고른 담당자
  miss          int  not null default 0,              -- 빈 칸 수
  saved_by      text,                                 -- '내가 넣음' · '담당자 제출'
  created_at    timestamptz not null default now()
);

-- 전월값은 여기서 온다 — ym 이 이번 회차보다 앞인 것 중 가장 최근
create index if not exists idx_center_document_saves_lookup
  on center_document_saves (document_id, ym desc, created_at desc);

create index if not exists idx_center_document_saves_center
  on center_document_saves (center_code, ym desc);

-- ─────────────────────────────────────────────────────────────
-- 3. RLS
--    Edge Function 은 service_role 로 붙어 RLS 를 우회한다(index.ts 참고).
--    브라우저가 anon 키로 이 표를 직접 읽지 못하게 막아 둔다 —
--    모든 접근은 center-report-upload 함수의 비밀번호/토큰 검사를 거쳐야 한다.
-- ─────────────────────────────────────────────────────────────
alter table center_documents      enable row level security;
alter table center_document_saves enable row level security;
-- 정책을 하나도 만들지 않는다 = anon/authenticated 는 아무것도 못 한다(service_role 만 통과).

-- ─────────────────────────────────────────────────────────────
-- 4. updated_at 자동 갱신
-- ─────────────────────────────────────────────────────────────
create or replace function touch_center_documents_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_center_documents_updated_at on center_documents;
create trigger trg_center_documents_updated_at
  before update on center_documents
  for each row execute function touch_center_documents_updated_at();

-- ⚠ on delete cascade 를 걸었으므로 **문서를 지우면 저장 회차도 같이 사라진다.**
--    화면에서 지우기 전에 "저장해 둔 회차 N개도 함께 사라집니다" 를 반드시 확인받는다.
