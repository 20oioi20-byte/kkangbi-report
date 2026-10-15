# 센터리포트 → Microsoft 365 Copilot 전환 패키지

> 현행 센터리포트(admin.html + Supabase)의 기능을 **Copilot Studio 에이전트 + SharePoint + Power Automate + Power BI** 로 옮기기 위한 자료 일체.
> 현행 시스템은 **건드리지 않는다.** 이 폴더는 새 시스템을 만드는 재료이며, 병행 운영 후 전환한다.

## 한눈에 보기
| 단계 | 내용 | 이 폴더에 준비된 것 | 직접 하실 일(회사 테넌트) | 예상 기간 |
|---|---|---|---|---|
| 1 | 자료 패키지 | 지식 문서 5종(.md/.docx), 보안 정보 제거 완료 | 샘플 파일 비식별 처리(아래 1-3) | 1주 |
| 2 | SharePoint 목록 + 데이터 이관 | 목록 생성 스크립트, 이관 SQL, CSV 가져오기 스크립트 | 사이트 생성, 스크립트 실행, 건수 대조 | 1~2주 |
| 3 | Copilot 에이전트 | 지침(2,600자), 설정서, 인수 시험 10건 | Copilot Studio 에서 에이전트 생성·게시 | 1주 |
| 4 | 자동화 | Office Scripts 6종(+KPI 계산 1종), 흐름 설계서 F0~F4·T1~T7, 자체 검증 139건 | 흐름 생성, 서비스 계정 연결, 시험 7건 | 2~3주 |
| 5 | HWPX · 대시보드 | HWPX 파서(스크립트 F3), Power BI 설계서(DAX 포함) | Power BI 라이선스 확인, 보고서 작성·게시 | 1~2주 |

```
copilot/
├─ 1-knowledge/            지식 문서 K1~K5 (.md 원본 → docx/ 에 Copilot 업로드용)
│   └─ build-docx.py       .md → .docx 변환
├─ 2-sharepoint/
│   ├─ provision-lists.ps1 목록 9개 + 업로드자료함 + 센터 폴더 생성 (PnP PowerShell)
│   └─ migration/          export.sql(Supabase→CSV) · import-csv.ps1(CSV→SharePoint)
├─ 3-agent/                instructions.txt(에이전트 지침) · agent-setup.md(설정·시험)
├─ 4-automate/
│   ├─ flows.md            Power Automate 흐름 설계서
│   ├─ office-scripts/     추출·계산 스크립트 (Excel 자동화 탭에 붙여넣기)
│   └─ tests/              node copilot/4-automate/tests/run-tests.js
└─ 5-advanced/             powerbi-dashboard.md
```

---

## 1단계 — 자료 패키지
**준비 완료**
- `1-knowledge/K1~K5` : 업무정의 · 데이터사전 · 센터별 추출규칙 · KPI 계산식 · 운영규칙(신호등·알림·이슈·결재·권한)
- 현행 `app.js` 코드에서 규칙을 직접 옮겼다(문서가 아니라 코드 기준). 수치 규칙은 4단계 스크립트와 1:1이다.
- **제거한 정보**: 비밀번호 초기값, Supabase 프로젝트 ID·키, 배포 도메인, 담당자 이름·이메일, upload_token

**직접 하실 일**
1. K1~K5 를 한 번 읽고 현행 운영과 다른 부분을 표시(특히 K2 3-1 KB손보부천 지표키 — 서버 설정값이라 코드로 확정 못 함. 2단계 export.sql 0번 결과로 대조)
2. `python3 copilot/1-knowledge/build-docx.py` (규칙을 고쳤을 때만)
3. **샘플 파일 준비**: 센터별 원본 1건씩(KB부천 엑셀, KB정비 RAW, LG summary, 근태 엑셀, 평택 HWPX) — 이름·전화번호 등 개인정보를 지우고 **회사 SharePoint 에만** 둔다. ⚠ 이 저장소는 공개 저장소이므로 절대 커밋하지 않는다.

**완료 기준**: 지식 문서 5개 검토 완료, 샘플 5종 확보

## 2단계 — SharePoint 목록 + 데이터 이관
**준비 완료**
- `provision-lists.ps1` : 센터·일별실적·월별TO·KPI목표·이슈·공휴일·알림설정·알림로그·결재요청 + 업로드자료함(센터/실적·근태 폴더), 센터 6곳·알림 기본값 등록. 여러 번 실행해도 안전.
- `migration/export.sql` : 일별 jsonb → 세로 형식 변환(쉼표·%·H:MM:SS 를 숫자로), 비밀번호·토큰 제외
- `migration/import-csv.ps1` : 키 기준 덮어쓰기(upsert), 100건 배치

**직접 하실 일**
1. SharePoint 팀 사이트 생성(예: `CenterReport`) + 그룹 「센터리포트 관리자」 생성
2. PnP PowerShell 설치 → `provision-lists.ps1 -SiteUrl … -ClientId …`
3. Supabase SQL Editor 에서 `export.sql` 0·0-1번(사전 점검) → 1~6번 결과를 CSV 로 저장
4. `import-csv.ps1 -Limit 200` 으로 시험 → 문제없으면 전체
5. 센터 목록의 **담당자·조회권한자** 열에 사람 지정

**완료 기준**: export.sql 7번(센터별 일수·첫날·마지막날)과 SharePoint 일별실적의 센터별 날짜 수 일치

## 3단계 — Copilot 에이전트
**준비 완료**: `3-agent/instructions.txt`(지침), `agent-setup.md`(기본 설정·지식·도구 10개·시작 질문·인수 시험 10건)

**직접 하실 일**: Copilot Studio 에서 에이전트 생성 → 지침 붙여넣기 → 지식 폴더 연결 → (4단계 T1·T2 완성 후) 도구 연결 → 인수 시험 → Teams/M365 Copilot 게시

**완료 기준**: 인수 시험 10건 통과(특히 4·5·9번 권한 시험)

## 4단계 — 자동화
**준비 완료**
| 스크립트 | 대체하는 현행 기능 | 원본 대조 |
|---|---|---|
| extract-kb-sonhae | KB손보부천 엑셀 자동추출 | ✅ 값 일치 |
| extract-kb-jeongbi | KB손보정비 RAW 집계(목적물소멸 판정·재삽입 머리글) | ✅ 16개 항목 일치 |
| extract-lge-summary | LG AS/성수기 summary(상시/한시 Total) | ✅ 일치 |
| extract-attendance | 근태 엑셀(YYMM 시트) | ✅ 일치 |
| parse-hwpx-dayreport | 평택 HWPX(브라우저 없이 동작하는 XML 파서) | 기대값 검사 |
| compute-kpi | 일평균·Σ/Σ 비율·LG통합 월평균·목표 판정·전월比 | ✅ 원본 avgMetricValue 와 일치 |

검증: `node copilot/4-automate/tests/run-tests.js` → **139건 통과**(타입 검사 + 원본 `app.js` 함수와 같은 입력으로 결과 대조). 일부러 Σ/Σ 계산을 깨면 실패하는 것도 확인했다.

**직접 하실 일**: `flows.md` 의 0장(스크립트 올리기·서비스 계정) → F0~F4 → T1~T7 순서로 생성 → 같은 문서의 「시험 순서」 7건

**완료 기준**: 시험 7건 통과 + 2주 병행 운영(현행 화면과 숫자 대조)

## 5단계 — HWPX · 대시보드
- **HWPX**: 4단계 F3 흐름 + `parse-hwpx-dayreport` 로 해결(별도 변환 서비스 불필요). 실제 HWPX로 반드시 재검증.
- **대시보드**: `5-advanced/powerbi-dashboard.md` — 전체현황·센터별 대시보드 2페이지, DAX 측정값, 행 수준 보안

**완료 기준**: Power BI 숫자 = 에이전트 KPI조회 숫자 = 현행 대시보드 숫자

---

## 현행과 달라지는 점 (결정 필요 시 표시 ☐)
| 항목 | 현행 | 새 시스템 | 비고 |
|---|---|---|---|
| 로그인 | 센터별 6자리 비밀번호 | 회사 M365 계정 + 조회권한자 열 | 비밀번호 관리 불필요 |
| 데이터 저장 | 날짜당 1행(jsonb) | 센터×날짜×지표 1행 | Power BI·Copilot 조회에 유리 |
| 업로드 | 화면에서 파일 선택 → 미리보기 → 저장 | 폴더에 올리면 자동 저장(미리보기 없음) | 처리상태 열로 결과 확인 ☐ 미리보기 필요 여부 |
| 근태 기본값 채우기 | 파일에 없는 영업일도 기본값으로 채움 | 파일에 있는 날짜만 저장 | ☐ 기본값 채우기 필요 여부 |
| TO 대비 비율 | 주요지표 리스트는 상담사 정원 기준 | 월별TO 합계(없으면 전체정원) 기준 | 전체현황 카드와 같은 기준으로 통일 |
| KB손보정비 지표 | 접수건 4종 | + 통합 처리율·준수율 2종 | 대시보드 카드에 있던 값을 리스트에도 노출 |
| 대시보드 | 자체 화면(Chart.js) | Power BI | |
| 메일 | Gmail SMTP | Outlook(회사 계정) | |
| AI 요약 | 외부 API(별도 비용) | Copilot 라이선스 안에서 처리 | |
| Google Drive 자동연동 | 15분 폴링 | SharePoint 폴더 트리거로 대체 | |

## 보안 점검표
- [x] 지식 문서·스크립트에 비밀번호·키·도메인·개인정보 없음
- [x] 에이전트 도구의 사용자 식별은 `System.User.Email` 고정(대화로 바꿀 수 없음)
- [x] 일별실적 목록은 관리자만 직접 접근, 센터담당자는 에이전트 경유
- [ ] 흐름 연결을 서비스 계정으로 설정(4단계)
- [ ] Power BI 행 수준 보안 적용(5단계)
- [ ] 샘플·원본 파일은 회사 SharePoint 에만 보관(공개 저장소 커밋 금지)
