# 5단계 — Power BI 대시보드 (전체현황 · 센터별 대시보드 대체)

> 현행 「워크스페이스 전체현황」과 「센터별 대시보드」 화면을 Power BI 보고서 1개(페이지 2개)로 옮긴다.
> Copilot 에이전트는 표·문장까지만 보여준다. **그래프·추이 화면은 Power BI** 가 맡고, Teams 탭과 SharePoint 페이지에 붙인다.
> 필요 라이선스: 보고서를 만드는 사람과 보는 사람 모두 Power BI Pro(또는 회사가 Premium/Fabric 용량 보유). 먼저 확인할 것.

## 1. 데이터 연결
Power BI Desktop → 데이터 가져오기 → **SharePoint Online 목록**(구현 2.0) → 사이트 주소 → 아래 목록 선택
| 목록 | 쓰는 열 |
|---|---|
| 일별실적 | Title, CenterCode, MetricGroup, MetricKey, Value, Modified |
| 센터 | Title(센터코드), CenterName, SortOrder, IsActive, TotalTO |
| 공휴일 | Title(날짜) |
| KPI목표 | CenterCode, MetricKey, MetricLabel, YearMonth, TargetValue, SortOrder |
| 월별TO | CenterCode, YearMonth, ManagerTO, CounselorTO |

Power Query 정리(일별실적):
```
= Table.AddColumn(원본, "Date", each Date.FromText(Text.Split([Title], "|"){1}), type date)
```
날짜는 **키(Title)에서 읽는다** — 날짜 열은 시간대 때문에 하루 밀려 보일 수 있다.

## 2. 날짜 테이블
```DAX
Dates =
VAR _hol = SELECTCOLUMNS ( 공휴일, "d", DATEVALUE ( 공휴일[Title] ) )
RETURN
ADDCOLUMNS (
    CALENDAR ( DATE ( 2025, 1, 1 ), DATE ( 2027, 12, 31 ) ),
    "연월", FORMAT ( [Date], "yyyy-MM" ),
    "연", YEAR ( [Date] ),
    "분기", "Q" & QUARTER ( [Date] ),
    "영업일", NOT ( WEEKDAY ( [Date], 2 ) > 5 ) && NOT ( [Date] IN _hol )
)
```
관계: `Dates[Date]` 1 → * `일별실적[Date]`, `센터[Title]` 1 → * `일별실적[CenterCode]`

## 3. 측정값 (K4 공식과 1:1)
```DAX
-- 기본: 영업일 일평균 (값이 없는 날은 분모에서 빠진다)
일평균 =
CALCULATE ( AVERAGE ( 일별실적[Value] ), Dates[영업일] = TRUE () )

-- 합계: 주말·공휴일 포함
기간합계 = SUM ( 일별실적[Value] )

-- 연초누적 일평균 (주의 센터 판정 기준)
누적평균 =
CALCULATE ( [일평균], DATESYTD ( Dates[Date] ) )

-- 전월比 (%), 비율 지표는 %p 를 따로 쓴다
전월값 = CALCULATE ( [일평균], DATEADD ( Dates[Date], -1, MONTH ) )
전월比 = DIVIDE ( [일평균] - [전월값], [전월값] )
전월比_p = [일평균] - [전월값]
전년동월값 = CALCULATE ( [일평균], SAMEPERIODLASTYEAR ( Dates[Date] ) )
전년동월比 = DIVIDE ( [일평균] - [전년동월값], [전년동월값] )

-- KB손보정비 처리율: 일별 비율 평균이 아니라 영업일 Σ분자 ÷ Σ분모
통합처리율 =
VAR _num = CALCULATE ( SUM ( 일별실적[Value] ), Dates[영업일] = TRUE (),
    일별실적[MetricKey] IN { "처리_고지의무", "처리_통지의무", "처리_목적물소멸" } )
VAR _den = CALCULATE ( SUM ( 일별실적[Value] ), Dates[영업일] = TRUE (),
    일별실적[MetricKey] IN { "접수_고지의무", "접수_통지의무", "접수_목적물소멸" } )
RETURN DIVIDE ( _num, _den ) * 100

고지의무준수율 =
VAR _ok = CALCULATE ( SUM ( 일별실적[Value] ), Dates[영업일] = TRUE (), 일별실적[MetricKey] = "고지의무_변경기한일_처리건" )
VAR _ng = CALCULATE ( SUM ( 일별실적[Value] ), Dates[영업일] = TRUE (), 일별실적[MetricKey] = "고지의무_변경기한일_미처리건" )
RETURN DIVIDE ( _ok, _ok + _ng ) * 100

-- LG전자 생산성(OUT) = IN+OUT − IN
생산성OUT =
MAX ( 0,
    CALCULATE ( [일평균], 일별실적[MetricKey] = "생산성_INOUT" )
  - CALCULATE ( [일평균], 일별실적[MetricKey] = "생산성_IN" ) )

-- LG전자통합 월평균 지표: 각 달 1일에 저장된 "_월평균" 값의 평균
LG통합_TNPS =
CALCULATE ( AVERAGE ( 일별실적[Value] ), 일별실적[MetricKey] = "TNPS_월평균", DAY ( 일별실적[Date] ) = 1 )

-- 통화시간 표시 (초 → H:MM:SS)
통화시간표시 =
VAR s = ROUND ( CALCULATE ( [일평균], 일별실적[MetricKey] IN { "통화시간_INOUT", "통화시간_INOUT_초" } ), 0 )
RETURN IF ( ISBLANK ( s ), BLANK (),
    INT ( s / 3600 ) & ":" & FORMAT ( INT ( MOD ( s, 3600 ) / 60 ), "00" ) & ":" & FORMAT ( MOD ( s, 60 ), "00" ) )

-- 업로드 신호등
마지막업로드 = MAX ( 일별실적[Modified] )
경과일 = DATEDIFF ( [마지막업로드], NOW (), DAY )
신호 = SWITCH ( TRUE (), ISBLANK ( [마지막업로드] ), "⚪", [경과일] < 3, "🟢", [경과일] < 7, "🟠", "🔴" )
```
- 시각적 개체에서 `일별실적[MetricKey]` 를 필터로 걸어 지표를 고른다(예: 카드 = [일평균] + 필터 MetricKey="제휴상담_SL").
- 값이 없으면 BLANK 로 둔다. **0 으로 바꾸는 서식(“빈 값 대신 0 표시”)을 켜지 않는다.**

## 4. 페이지 구성 (현행 화면 순서 그대로)
**페이지 1 — 전체현황**
1. 🚦 센터 실적 업데이트현황: 표(센터명, 신호, 마지막업로드, 경과일)
2. 센터 핵심지표 표: 행=센터, 값=핵심지표 이번 달 [일평균] + [누적평균]
3. ⚠ 주의 센터: KPI목표 대비 누적평균 미달 행만 조건부 서식(빨강)
4. 미확인 이슈: 이슈 목록 연결 시 확인여부=아니요 상위 20건
5. 센터별 추이(최근 6개월): 꺾은선, 축=연월

**페이지 2 — 센터별 대시보드** (슬라이서: 센터, 기간 단월/분기누적/반기누적/연초누적)
1. 요약 카드: 재직인원(TO 대비 %), 센터별 핵심지표
2. 지표 추이: 막대(인입호·응대호 등) + 선(응답율·SL·T-NPS)
3. 주요지표 리스트: 지표 / 일평균 / 평균(누적) / 전월比 / 전년동월比
4. 일별 데이터 표: 행=Date, 열=MetricKey(`_비중`, `_월평균` 키는 숨김)

## 5. 게시
1. Power BI 서비스에 게시 → 작업 영역 「센터리포트」
2. 데이터 새로 고침: 하루 8회(업무 시간대) — SharePoint 목록 자격증명은 서비스 계정
3. **행 수준 보안(RLS)**: 역할 「센터담당자」 = `센터[Viewers]` 에 USERPRINCIPALNAME() 이 들어 있는 센터만
   ```DAX
   CONTAINSSTRING ( 센터[ViewersText], USERPRINCIPALNAME () )
   ```
   (Power Query 에서 Viewers 열을 이메일 문자열 `ViewersText` 로 펼쳐 둔다) — 관리자 그룹은 역할 없이 전체
4. Teams 채널 탭 + SharePoint 사이트 홈에 보고서 붙이기
