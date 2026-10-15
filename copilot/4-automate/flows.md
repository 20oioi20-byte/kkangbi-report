# Power Automate 흐름 설계서

> 4단계(자동화)와 3단계(에이전트 도구)에서 만드는 흐름 전체. 각 흐름은 **솔루션** 안에 만든다(자식 흐름 호출·이관에 필요).
> 계산·추출 로직은 전부 Office Scripts(`office-scripts/*.ts`)에 있다. 흐름은 「파일 받기 → 스크립트 실행 → 목록 저장」만 한다.

## 0. 준비
| 항목 | 내용 |
|---|---|
| 스크립트 보관 | SharePoint 사이트에 문서 라이브러리 `Scripts` 를 만들고 `.ts` 7개를 `.osts` 로 올린다(아래 0-1) |
| 실행용 빈 통합문서 | `Scripts/runner.xlsx` (빈 엑셀 1개) — HWPX 파싱·KPI 계산 스크립트는 엑셀 내용을 안 쓰지만 실행에 통합문서가 필요하다 |
| 연결 | SharePoint · Excel Online (Business) · Office 365 Outlook · Approvals — **서비스 계정**으로 연결(개인 계정 퇴사 시 흐름이 멈추는 것을 막는다) |
| 라이선스 | 위 커넥터는 표준(Standard). Word 템플릿 채우기(결재 문서)만 프리미엄 |

### 0-1. 스크립트 올리는 방법
1. Excel 웹 → 자동화 탭 → 새 스크립트 → `.ts` 파일 내용을 그대로 붙여넣기 → 이름 저장(예: `extract-kb-sonhae`).
2. 저장된 스크립트(OneDrive `문서/Office Scripts/*.osts`)를 `Scripts` 라이브러리로 옮긴다.
3. 흐름에서는 **「SharePoint 라이브러리에서 스크립트 실행」(Run script from SharePoint library)** 동작으로 부른다.

| 스크립트 | 쓰는 흐름 | 대상 파일 |
|---|---|---|
| extract-kb-sonhae | F1 | 올라온 .xlsx |
| extract-kb-jeongbi | F1 | 올라온 .xlsx |
| extract-lge-summary | F1 | 올라온 .xlsx |
| extract-attendance | F2 | 올라온 .xlsx |
| parse-hwpx-dayreport | F3 | runner.xlsx |
| compute-kpi | T2 | runner.xlsx |

---

## F0. [자식] 일별실적 저장 (upsert)
- **트리거**: 수동 트리거(자식 흐름) — 입력 `itemsJson`(텍스트), `source`(텍스트), `sourceFile`(텍스트)
- **단계**
  1. JSON 구문 분석 `itemsJson` — 스키마: `[{CenterCode, ReportDate, MetricGroup, MetricKey, Value, RawValue}]`
  2. 각각에 적용(**동시성 20**):
     - 항목 가져오기 `Lists/DailyMetrics` · 필터 `Title eq '@{items('각각')?['CenterCode']}|@{items('각각')?['ReportDate']}|@{items('각각')?['MetricKey']}'` · 상위 1
     - 조건 `length(body('항목_가져오기')?['value'])` > 0
       - 예 → 항목 업데이트(ID = `first(body('항목_가져오기')?['value'])?['ID']`)
       - 아니요 → 항목 만들기
     - 열 값: 키(Title)=위 키, 센터코드, 일자=`ReportDate`, 구분=`MetricGroup`, 지표키, 값=`Value`(null 이면 비움), 원본값, 출처=`source`, 원본파일=`sourceFile`
  3. 응답: `saved` = 처리 건수
- **주의**: 키(Title)는 목록에서 **고유값**이다. 같은 키를 동시에 두 번 만들면 한쪽이 실패한다 → 스크립트가 같은 키를 두 번 내지 않으므로 정상 흐름에서는 생기지 않는다.

## F1. 실적 파일 자동추출 (엑셀)
- **트리거**: SharePoint 「파일이 만들어질 때(속성만)」 · 라이브러리 `업로드자료함`
  - 트리거 조건: `@and(contains(triggerBody()?['{Path}'], '/실적/'), endsWith(toLower(triggerBody()?['{FilenameWithExtension}']), '.xlsx'))`
- **단계**
  1. 작성 `center` = `split(triggerBody()?['{Path}'], '/')[1]`  (경로 예: `Uploads/kbsonhae/실적/`)
  2. 파일 속성 업데이트: 센터코드=`center`, 자료유형=실적, 처리상태=대기
  3. 스위치 `center`
     - `kbsonhae` → 스크립트 `extract-kb-sonhae` · year=`int(formatDateTime(utcNow(),'yyyy'))` · startDate/endDate 비움 · groupFilter=`전체`
     - `kbjeongbi` → `extract-kb-jeongbi` · year
     - `lge`, `lge_seongsu` → `extract-lge-summary` · centerCode=`center` · year
     - 기본 → 처리실패 「이 폴더는 엑셀 자동추출 대상이 아닙니다」
  4. 조건 `outputs('스크립트')?['body/result/ok']` 가 true
     - 예 → F0 호출(itemsJson=`string(outputs('스크립트')?['body/result/items'])`, source=`엑셀자동`, sourceFile=파일 경로) → 파일 속성: 처리완료 + `result/message`
     - 아니요 → 파일 속성: 처리실패 + `result/message` → 센터 담당자에게 메일 「파일을 읽지 못했습니다: {message}」
- **.xls(97-2003)** 는 Office Scripts가 못 연다 → 트리거 조건에서 걸러지므로, 별도 흐름 없이 업로드 안내(K3)에서 `.xlsx` 로 저장해 올리도록 안내한다.
- **같은 파일을 다시 올리면** 같은 키를 덮어쓴다(중복 생성 없음).

## F2. 근태 파일 자동추출
- **트리거**: F1과 같은 라이브러리 · 조건 `contains(triggerBody()?['{Path}'], '/근태/')` + `.xlsx`
- **단계**
  1. `center` 계산(F1과 같음). `kbjeongbi`·`lge`·`lge_seongsu` 가 아니면 처리실패.
  2. 공휴일: 항목 가져오기 `Lists/Holidays` → 선택(Select) `item()?['Title']` → 작성 `holidaysCsv` = `join(body('선택'), ',')`
  3. 월별TO: 항목 가져오기 `Lists/MonthlyTO` 필터 `Title eq '@{center}|@{formatDateTime(utcNow(),'yyyy-MM')}'` → `toValue` = 있으면 `add(ManagerTO, CounselorTO)`, 없으면 0(스크립트가 센터 기본 TO 사용)
  4. 스크립트 `extract-attendance` · centerCode, toValue, holidaysCsv
  5. 성공 → F0(source=`근태파일`) · 실패 → 처리실패 + 메시지
- 근태 파일이 여러 달을 담고 있으면 TO는 **이번 달 값 하나**로 들어간다. 달마다 TO가 다르면 월별로 나눠 올리거나, 관리자가 「TO 변경」 도구로 해당 날짜를 고친다.

## F3. 평택시청 일일업무보고(HWPX) 자동추출
- **트리거**: 같은 라이브러리 · 조건 `@and(contains(triggerBody()?['{Path}'], 'pyeongtaek/실적/'), endsWith(toLower(triggerBody()?['{FilenameWithExtension}']), '.hwpx'))`
- **단계**
  1. 파일 콘텐츠 가져오기(트리거 파일 ID)
  2. 파일 만들기: 폴더 `/Uploads/_tmp` · 이름 `@{guid()}.zip` · 내용 = 1의 본문  ← HWPX는 zip 이라 확장자만 바꾼다
  3. **폴더 추출**(Extract folder): 원본 = 2의 파일 경로 · 대상 = `/Uploads/_tmp/@{guid}` · 덮어쓰기 예
  4. 경로로 파일 콘텐츠 가져오기: `/Uploads/_tmp/@{guid}/Contents/section0.xml`
  5. 스크립트 `parse-hwpx-dayreport` (통합문서=`Scripts/runner.xlsx`)
     - xml = `base64ToString(body('경로로_파일_콘텐츠_가져오기')?['$content'])`
     - fileName = 트리거 파일 이름 · fallbackYear = 올해
  6. 성공 → F0(source=`HWPX자동`) → 파일 속성 처리완료 · 실패 → 처리실패 + 메시지
  7. (항상 실행) `_tmp` 아래 2·3에서 만든 파일·폴더 삭제
- 여러 파일을 한꺼번에 올리면 파일마다 흐름이 따로 돈다(날짜도 파일마다 따로 읽는다).
- 스크립트 매개변수 크기 한도(수 MB) 안이다. section0.xml이 이보다 크면 「확인필요」로 표시하고 담당자에게 알린다.

## F4. 미업로드 알림 (매시)
- 구조: **자식 흐름 F4-core** 를 만들고, 예약 흐름과 즉시발송 도구(T5)가 함께 부른다(로직 이중 관리 방지).
- **F4-core 입력**: `force`(예/아니요), `centerCode`(비우면 전체)
- **단계**
  1. 알림설정 2건 가져오기(실적미업로드·이슈미등록). `force` 가 아니면 `발송정지=예` 인 알림은 건너뜀.
  2. 센터 가져오기: 사용여부=예 (+ centerCode 지정 시 그 센터만)
  3. 센터별 × 알림별:
     - 기준 시각: 실적=`DailyMetrics` 필터 `CenterCode eq '…'` · 정렬 `Modified desc` · 상위 1 의 Modified / 이슈=`Issues` 같은 방식으로 Created
     - `days` = `div(sub(ticks(utcNow()), ticks(기준시각)), 864000000000)`
     - 발송 조건(`force` 면 1·3 무시):
       1. 현재 시(KST) = 발송시각 → `int(convertFromUtc(utcNow(), 'Korea Standard Time', 'HH'))`
       2. `days` ≥ 기준일수
       3. 알림로그에서 같은 센터·같은 알림의 마지막 성공 발송이 반복주기(일)보다 오래됨
     - 담당자 메일 = `join(xpath(xml(json(concat('{"r":{"e":', string(센터.Owners), '}}'))), '//Email/text()'), ';')` — 담당자가 없으면 로그만 「담당자 미등록으로 건너뜀」
     - 메일 보내기(V2): 제목·본문의 `{center_name}`·`{days}`·`{site_link}` 를 `replace()` 로 바꾼다
     - 알림로그 만들기: 센터코드, 알림종류, 경과일수, 수신자, 즉시발송여부=`force`, 성공여부, 실패사유(메일 동작 실패 시 `actions('메일')?['error']?['message']`) — 메일 동작 뒤에 「실행 후 구성: 실패 시에도 실행」을 켠다
  4. 응답: 센터별 결과 표(JSON)
- **예약 흐름**: 되풀이 매시 정각 → F4-core(force=아니요)

---

## 에이전트 도구 흐름 (Copilot Studio 에서 「도구 → 흐름」으로 연결)
- 트리거: **「에이전트가 흐름을 호출할 때」**(When an agent calls the flow) · 끝: **「에이전트에 응답」**(Respond to the agent)
- **모든 도구의 첫 입력은 `userEmail`** 이고, Copilot Studio 에서 이 입력은 **AI가 채우지 않고** 변수 `System.User.Email` 로 고정한다. (사용자가 대화에서 다른 사람 이메일을 말해도 권한이 바뀌지 않게)
- 권한 판단은 T1 을 자식 흐름으로 불러 공통으로 쓴다.

### T1. 권한확인
- 입력: userEmail
- 단계: SharePoint HTTP 요청 `GET _api/web/sitegroups/getbyname('센터리포트 관리자')/users?$filter=Email eq '@{toLower(userEmail)}'` → `isAdmin` = 결과 1건 이상
  → 센터 가져오기(사용여부=예) → 배열 필터: `contains(toLower(string(item()?['Viewers'])), toLower(userEmail))`
- 응답: `isAdmin`(예/아니요), `allowedCenters`(관리자면 전 센터 코드, 아니면 필터 결과 `센터코드,센터명;…`)

### T2. KPI조회 ★ 핵심
- 입력: userEmail, centerCode, startDate, endDate (YYYY-MM-DD)
- 단계
  1. T1 → centerCode 가 allowedCenters 에 없으면 응답 `{"ok":false,"message":"권한이 없습니다"}` 후 종료
  2. 조회 시작 = `formatDateTime(addDays(addToTime(startDate, -12, 'Month'), -1), 'yyyy-MM-dd')` (전년동월比·연초누적용)
  3. 항목 가져오기 `Lists/DailyMetrics` · 필터 `CenterCode eq '@{centerCode}' and ReportDate ge '@{조회시작}' and ReportDate le '@{endDate}T23:59:59Z'` · **페이지 매김 켬(임계값 50,000)**
  4. 선택(Select): `d` = `split(item()?['Title'], '|')[1]` ← 날짜는 키에서 읽는다(날짜 열의 시간대 밀림 방지) · `k` = `item()?['MetricKey']` · `v` = `item()?['Value']`
  5. 공휴일 csv(F2 2단계와 같음)
  6. KPI목표: 필터 `CenterCode eq '@{centerCode}'` → 선택 `k`=MetricKey, `label`=MetricLabel, `ym`=YearMonth, `t`=TargetValue, `o`=SortOrder
  7. TO: 월별TO `Title eq '@{centerCode}|@{substring(endDate,0,7)}'` 합계 → 없으면 센터 목록 전체정원 → 없으면 0
  8. 스크립트 `compute-kpi` (runner.xlsx) · rowsJson=`string(body('선택'))` · targetsJson=`string(body('선택_목표'))`
  9. 응답: `result` = `string(outputs('스크립트')?['body/result'])`
- 반환 JSON 의 `metrics[].display / momText / yoyText / targetDisplay / judged`, `warnings`, `missingWorkdays` 를 에이전트가 그대로 표로 옮긴다.

### T3. 업로드현황
- 입력: userEmail
- 단계: T1 → 허용 센터마다 DailyMetrics `Modified desc` 상위 1 → days 계산 → 신호: `days<3` 🟢 / `<7` 🟠 / 그 이상 🔴 / 없음 ⚪
- 응답: `[{center, name, lastUpload, days, signal}]`

### T4. 이슈 (조회·등록·확인)
| 도구 | 입력 | 동작 | 권한 |
|---|---|---|---|
| 이슈조회 | userEmail, centerCode(비우면 허용 전체), keyword, onlyUnreviewed | Issues 필터 + 제목·내용 `contains` · 최근 50건 | 허용 센터 |
| 이슈등록 | userEmail, centerCode, issueDate, title, content | 항목 만들기(확인여부=아니요) | 허용 센터 |
| 이슈확인 | userEmail, issueId, reviewed | 확인여부 변경 | **관리자만** |

### T5. 즉시발송
- 입력: userEmail, centerCode(비우면 전체) → 관리자 아니면 거절 → F4-core(force=예) → 센터별 성공/실패/사유 표 응답

### T6. 목표·TO 변경 (관리자)
| 도구 | 입력 | 동작 |
|---|---|---|
| KPI목표저장 | userEmail, centerCode, metricKey, metricLabel, yearMonth(`YYYY-MM` 또는 `기본`), targetValue | 키 `센터\|지표\|연월` 로 upsert. 시간 지표는 `4:00:00` 을 초로 바꿔 저장 |
| TO저장 | userEmail, centerCode, yearMonth, managerTO, counselorTO | 키 `센터\|연월` 로 upsert |
- 저장 전에 에이전트가 **바뀌는 값을 보여주고 확인을 받은 뒤** 호출한다(지침에 명시).

### T7. 결재요청
- 입력: userEmail, centerCode, docName, yearMonth, valuesJson, approverEmail
- 단계: 결재요청 항목 만들기(작성중) → (선택) Word 템플릿 채우기[프리미엄] → PDF 변환 → **승인 시작 및 대기**(Approve/Reject, 첨부 PDF) → 결과로 결재상태·승인자 업데이트 → 요청자에게 결과 알림
- 결재 문서 «서식 그대로» 유지는 **Word 템플릿의 콘텐츠 컨트롤**로 한다(값 자리 = 컨트롤 이름). 계산 규칙(전월값·차이·부가세·합계)은 K5 4장대로 에이전트가 아니라 흐름(또는 compute-kpi 확장)에서 계산한다.

---

## 시험 순서 (완료 기준)
| 순서 | 할 일 | 통과 기준 |
|---|---|---|
| 1 | 각 센터 폴더에 지난달 파일 1개씩 업로드 | 파일 속성 처리완료, 메시지의 일수 = 파일 일수 |
| 2 | 같은 파일 다시 업로드 | 일별실적 건수 변화 없음(덮어쓰기) |
| 3 | 양식이 다른 엑셀 업로드 | 처리실패 + 사유, 담당자 메일 수신 |
| 4 | HWPX 3개 동시 업로드 | 3개 날짜 모두 저장, `_tmp` 비어 있음 |
| 5 | T2 를 현행 화면과 같은 기간으로 호출 | 핵심지표 값이 현행 대시보드와 일치(소수 첫째 자리) |
| 6 | 센터담당자 계정으로 다른 센터 T2 호출 | 「권한이 없습니다」 |
| 7 | T5 즉시발송(테스트 센터 1곳) | 메일 수신 + 알림로그 성공 기록 |
