-- export.sql — Supabase → SharePoint 이관용 CSV 추출 쿼리
-- 사용법: Supabase 대시보드 → SQL Editor 에서 블록을 하나씩 실행 → 결과 우측 상단 "Download CSV".
--         파일 이름은 각 블록 제목의 [ ] 안 이름으로 저장한다 (import-csv.ps1 이 그 이름을 찾는다).
-- 주의: 읽기 전용 SELECT 만 있다. 비밀번호 해시·upload_token·담당자 이메일은 일부러 뽑지 않는다.

-- ─────────────────────────────────────────────────────────────
-- 0. 사전 점검 — 지표키 목록 (K2 3장과 대조)
-- ─────────────────────────────────────────────────────────────
select center_code, '근태' as grp, kv.key, count(*) as days
from center_daily_performance p
cross join lateral jsonb_each_text(coalesce(p.attendance_data, '{}'::jsonb)) kv
group by 1, 2, 3
union all
select center_code, '실적', kv.key, count(*)
from center_daily_performance p
cross join lateral jsonb_each_text(coalesce(p.performance_data, '{}'::jsonb)) kv
group by 1, 2, 3
order by 1, 2, 3;

-- ─────────────────────────────────────────────────────────────
-- 0-1. 사전 점검 — 같은 날 근태·실적에 같은 지표키가 동시에 있는지
--      (결과가 0행이어야 한다. 행이 나오면 SharePoint 키 충돌 → 알려주면 키 규칙을 조정한다)
-- ─────────────────────────────────────────────────────────────
select p.center_code, p.report_date, a.key
from center_daily_performance p
cross join lateral jsonb_each_text(coalesce(p.attendance_data, '{}'::jsonb)) a
where coalesce(p.performance_data, '{}'::jsonb) ? a.key;

-- ─────────────────────────────────────────────────────────────
-- 1. [DailyMetrics.csv] 일별실적 — 세로(긴) 형식: 센터 × 일자 × 지표 1행
--    Value: 숫자로 읽히면 숫자, H:MM:SS 는 초, 쉼표·% 제거. 숫자가 아니면 빈칸(원본값만 보존).
-- ─────────────────────────────────────────────────────────────
with src as (
  select p.center_code, p.report_date, '근태' as grp, kv.key, kv.value as raw
  from center_daily_performance p
  cross join lateral jsonb_each_text(coalesce(p.attendance_data, '{}'::jsonb)) kv
  union all
  select p.center_code, p.report_date, '실적', kv.key, kv.value
  from center_daily_performance p
  cross join lateral jsonb_each_text(coalesce(p.performance_data, '{}'::jsonb)) kv
),
cleaned as (
  select *, regexp_replace(raw, '[,%\s]', '', 'g') as num_txt from src
  where raw is not null and btrim(raw) <> ''
)
select
  center_code || '|' || left(report_date::text, 10) || '|' || key as "Title",
  center_code                                                        as "CenterCode",
  left(report_date::text, 10)                                 as "ReportDate",
  grp                                                                as "MetricGroup",
  key                                                                as "MetricKey",
  case
    when btrim(raw) ~ '^\d{1,3}:\d{2}:\d{2}$'
      then split_part(btrim(raw), ':', 1)::int * 3600
         + split_part(btrim(raw), ':', 2)::int * 60
         + split_part(btrim(raw), ':', 3)::int
    when num_txt ~ '^-?\d+(\.\d+)?$' then num_txt::numeric
    else null
  end                                                                as "Value",
  raw                                                                as "RawValue",
  '이관'                                                             as "Source"
from cleaned
order by "CenterCode", "ReportDate", "MetricKey";

-- ─────────────────────────────────────────────────────────────
-- 2. [Centers.csv] 센터 — 비밀번호 해시 · upload_token 제외
-- ─────────────────────────────────────────────────────────────
select center_code as "Title", center_name as "CenterName", sort_order as "SortOrder",
       case when is_active is false then 'false' else 'true' end as "IsActive"
from center_config
order by sort_order;

-- ─────────────────────────────────────────────────────────────
-- 3. [MonthlyTO.csv] 월별TO
-- ─────────────────────────────────────────────────────────────
select center_code || '|' || year_month as "Title", center_code as "CenterCode", year_month as "YearMonth",
       coalesce(to_manager, 0) as "ManagerTO", coalesce(to_counselor, 0) as "CounselorTO"
from center_monthly_settings
order by 2, 3;

-- ─────────────────────────────────────────────────────────────
-- 4. [KpiTargets.csv] KPI목표 — 기본목표(연월='기본') + 월별목표
-- ─────────────────────────────────────────────────────────────
select center_code || '|' || metric_key || '|기본' as "Title", center_code as "CenterCode", metric_key as "MetricKey",
       metric_label as "MetricLabel", '기본' as "YearMonth", target_value as "TargetValue", sort_order as "SortOrder"
from center_kpi_settings
union all
select t.center_code || '|' || t.metric_key || '|' || t.year_month, t.center_code, t.metric_key,
       coalesce(s.metric_label, t.metric_key), t.year_month, t.target_value, coalesce(s.sort_order, 0)
from center_kpi_monthly_targets t
left join center_kpi_settings s on s.center_code = t.center_code and s.metric_key = t.metric_key
order by 2, 3, 5;

-- ─────────────────────────────────────────────────────────────
-- 5. [Issues.csv] 이슈·히스토리
-- ─────────────────────────────────────────────────────────────
select title as "Title", center_code as "CenterCode", left(issue_date::text, 10) as "IssueDate",
       coalesce(content, '') as "Content", case when reviewed then 'true' else 'false' end as "Reviewed"
from center_issues
order by issue_date;

-- ─────────────────────────────────────────────────────────────
-- 6. [Holidays.csv] 공휴일 {"YYYY-MM-DD":"이름"}
-- ─────────────────────────────────────────────────────────────
select h.key as "Title", h.value as "HolidayName"
from workspace_config w
cross join lateral jsonb_each_text(coalesce(w.holidays, '{}'::jsonb)) h
order by 1;

-- ─────────────────────────────────────────────────────────────
-- 7. 검증용 — 이관 후 SharePoint 건수와 맞춰 볼 숫자
-- ─────────────────────────────────────────────────────────────
select center_code, count(distinct report_date) as days, min(report_date) as first_day, max(report_date) as last_day
from center_daily_performance
group by center_code
order by center_code;
