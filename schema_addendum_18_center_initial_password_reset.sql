-- schema_addendum_18_center_initial_password_reset.sql
-- 4개 센터의 초기 비밀번호(숫자 000000)를 문자+특수문자 조합으로 교체
-- 실행 순서: … → addendum_17 → **이 파일**
-- 관련: 2026-09-21 대화 — 도메인 재공개에 앞서 남아있던 초기 비밀번호(000000) 제거
--
-- password_hash = sha256(새 비밀번호), index.ts의 hashPassword()와 동일한 방식(트림 후 UTF-8 sha256)
-- 이 UPDATE 실행 후에는 각 센터에서 000000으로는 절대 로그인할 수 없고, 아래 새 비밀번호로만 가능.
--
-- kbsonhae  (KB손보부천)   -> 새 비밀번호: KB부천**
-- kbjeongbi (KB손보정비)   -> 새 비밀번호: KB정비**
-- pyeongtaek(평택시청)     -> 새 비밀번호: 평택시청**
-- lge_total (LG전자통합)   -> 새 비밀번호: LG통합**

update center_config set password_hash = '03359f1942f3113a832e116e571d1786b9f8e5b027ded49012da088367a73dd9' where center_code = 'kbsonhae';
update center_config set password_hash = 'fbd2e7728804c2abe3ad9f887bb2658829f75d8c7035e526a206a5da718c9890' where center_code = 'kbjeongbi';
update center_config set password_hash = '4e18a0f965c4b06e2671cf1c0687c9105397fd80d8d9e7d77fdfb34e4a83cf86' where center_code = 'pyeongtaek';
update center_config set password_hash = '41d31b4050d405b639672fd7b3a950e057bcce3d179663d7112e8dbc22435cc7' where center_code = 'lge_total';
