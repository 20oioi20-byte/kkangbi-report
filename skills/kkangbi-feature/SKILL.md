# /kkangbi-feature — 기능 확인·개선 작업용 스킬

## 언제 쓰나
- 새 센터 추가, 새 데이터 유형(실적/근태) 자동추출 추가
- 기존 대시보드/차트/지표 계산 로직 수정
- "이 값이 왜 이렇게 나오지" 류의 산출근거 검증 요청

## 필수 선행 작업
1. `docs/FEATURE.md`에서 해당 기능의 현재 상태(✅/🟡/⛔)를 확인한다.
2. 관련 있는 과거 버그 사례가 `docs/CHANGELOG.md`에 있는지 검색한다 — 같은 실수를 반복하지 않기 위함.

## 작업 패턴
### 새 센터 추가
1. `center_config`에 센터 등록 SQL (기존 센터 등록 addendum 참고 — `schema_addendum_lge.sql`, `schema_addendum_3_lge_seongsu.sql` 형태 모방)
2. `admin.html`에서 아래 전역 설정 객체들에 **모두** 새 센터 코드를 추가해야 함 (하나라도 빠지면 화면 일부만 깨짐):
   - `TO_TARGET`, `CENTER_TO_INFO`, `CENTER_KPI_DEFS`, `CENTER_COMPUTED_METRICS`, `CENTER_CHART_CONFIG`, `DEFAULT_HEADLINE_METRICS`, `CENTER_CARD_TREND`, `CENTER_GUIDES`, `ATTENDANCE_SEMI_AUTO`(근태 자동추출 지원 시)
3. 데이터입력 방식(엑셀/HWPX/RAW/근태)이 기존 센터와 다르면 새 추출 함수 작성, 같으면 기존 `LGEX_CENTER_CONFIG`/`XLSX_EXTRACTOR_FIELDS`/`HWPX_FIELD_ORDER`/`LONG_CONTRACT_CENTERS` 중 맞는 곳에 센터 코드만 추가
4. `docs/FEATURE.md`에 새 행 추가

### 산출근거(지표 계산) 검증 요청 대응
- **절대 추측하지 말고 코드를 실제로 추적**: `computeCenterHeadline`, `resolveMetric`, `CENTER_COMPUTED_METRICS` 순서로 값이 어디서 오는지 소스를 짚어서 설명한다.
- 값이 두 곳에서 같게/다르게 나온다는 신고를 받으면, 두 곳이 **같은 필드를 참조하는지** 먼저 확인한다 (실제 사례: `전체재직인원(TO대비)`가 `상담사_투입인원`을 잘못 참조하던 버그 — `CHANGELOG.md` 2026-07-08~09 참고)
- 단위(%, 건, duration) 표기 오류는 `METRIC_UNITS` 전역 매핑에 키를 등록하는 방식으로 고친다 (값 크기로 %인지 추측하는 로직에 의존하지 않는다)

### 그래프/차트 관련
- 워크스페이스 전체현황 추이차트(`CENTER_CARD_TREND`)와 센터별 대시보드 미니차트(`CENTER_CHART_CONFIG`)는 **서로 다른 설정 객체**다. "그래프 색 바꿔줘" 요청이 오면 어느 화면의 그래프인지 반드시 먼저 확인한다.
- "A 지표가 B 지표 안에 포함된 걸 구분해서 보여달라" 류의 요청은 단순 스택이 아니라 **파생값(subtract) 시리즈**로 만들어야 한다 (`derivedFrom: { totalKey, subKey }` 패턴, `생산성_OUT_only` 사례 참고)

## 검증 방법
실제 파일이 있으면 반드시 `bash_tool`로 Node에 SheetJS(`xlsx` npm 패키지)를 설치해 브라우저 로직과 동일한 코드를 돌려보고 결과를 사용자에게 표로 보여준다. 코드 리뷰만으로 "정상일 것"이라 결론 내지 않는다.
