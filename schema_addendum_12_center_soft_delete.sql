-- schema_addendum_12_center_soft_delete.sql
--
-- 배경: 사이드바에서 센터를 삭제하면 "삭제 실패: update or delete on table "center_config" violates
-- foreign key constraint "center_monthly_settings_center_code_fkey" on table "center_monthly_settings""
-- 500 에러가 발생함. 원인은 center-delete 액션이 center_config 행을 물리적으로 DELETE하려는데,
-- 그 센터를 참조하는 하위 테이블(center_monthly_settings 등)에 데이터가 남아있어 외래키 제약에 걸리기 때문.
--
-- 그런데 현재 삭제 확인창 문구("등록된 실적 데이터는 DB에 남지만 목록에서는 사라집니다")는
-- 애초에 소프트 삭제(목록에서만 숨김, 데이터는 보존)를 전제로 하고 있음. 그래서 하위 테이블까지
-- CASCADE로 물리 삭제하는 대신, center_config에 is_deleted 플래그를 추가해서 그 문구 그대로
-- "목록에서만 사라지고 데이터는 보존"되도록 한다. 기존 컬럼/데이터는 전혀 건드리지 않는 추가 전용(non-destructive) 변경.

ALTER TABLE center_config
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN center_config.is_deleted IS
  '센터를 목록에서 숨길 때 true로 설정(소프트 삭제). 실적/TO/KPI 등 하위 데이터는 그대로 보존됨.';
