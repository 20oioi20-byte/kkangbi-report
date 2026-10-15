<#
  provision-lists.ps1 — 센터리포트 SharePoint 목록·라이브러리 일괄 생성
  정의서: ../1-knowledge/K2_데이터사전.md (열 이름·형식은 그 문서와 1:1)

  준비
    1) PowerShell 7 이상
    2) Install-Module PnP.PowerShell -Scope CurrentUser
    3) PnP 로그인용 Entra 앱 등록(Client ID) — 회사 IT 정책상 관리자 승인이 필요할 수 있다.
       Register-PnPEntraIDAppForInteractiveLogin 으로 만들 수 있다.
    4) 빈 SharePoint 팀 사이트 하나(예: https://<회사>.sharepoint.com/sites/CenterReport)

  실행
    ./provision-lists.ps1 -SiteUrl "https://<회사>.sharepoint.com/sites/CenterReport" -ClientId "<앱 ID>"

  여러 번 실행해도 안전하다(이미 있는 목록·열은 건너뛴다).
#>
param(
  [Parameter(Mandatory = $true)][string]$SiteUrl,
  [Parameter(Mandatory = $true)][string]$ClientId
)

$ErrorActionPreference = 'Stop'
Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

function Ensure-List([string]$Title, [string]$Url, [string]$Template = 'GenericList') {
  $list = Get-PnPList -Identity $Url -ErrorAction SilentlyContinue
  if (-not $list) {
    Write-Host "목록 생성: $Title ($Url)"
    $list = New-PnPList -Title $Title -Url $Url -Template $Template -OnQuickLaunch
  } else {
    Write-Host "이미 있음: $Title"
  }
  return $list
}

function Ensure-Field([string]$List, [string]$Display, [string]$Internal, [string]$Type, [string[]]$Choices = @(), [switch]$Indexed, [switch]$DateOnly, [switch]$Multi) {
  $existing = Get-PnPField -List $List -Identity $Internal -ErrorAction SilentlyContinue
  if ($existing) { return }
  Write-Host "  열 추가: $List.$Display ($Type)"
  if ($Type -eq 'Choice') {
    Add-PnPField -List $List -DisplayName $Display -InternalName $Internal -Type Choice -Choices $Choices -AddToDefaultView | Out-Null
  } elseif ($Type -eq 'User' -and $Multi) {
    # 여러 명을 고를 수 있는 사람 열은 XML 로 만든다
    $xml = "<Field Type='UserMulti' DisplayName='$Display' Name='$Internal' StaticName='$Internal' Mult='TRUE' UserSelectionMode='PeopleOnly' />"
    Add-PnPFieldFromXml -List $List -FieldXml $xml | Out-Null
  } else {
    Add-PnPField -List $List -DisplayName $Display -InternalName $Internal -Type $Type -AddToDefaultView | Out-Null
  }
  if ($DateOnly) { Set-PnPField -List $List -Identity $Internal -Values @{ DisplayFormat = 0 } | Out-Null }
  if ($Indexed)  { Set-PnPField -List $List -Identity $Internal -Values @{ Indexed = $true } | Out-Null }
}

function Set-TitleColumn([string]$List, [string]$Display, [switch]$Unique) {
  $values = @{ Title = $Display }
  if ($Unique) { $values.Indexed = $true; $values.EnforceUniqueValues = $true }
  Set-PnPField -List $List -Identity Title -Values $values | Out-Null
}

# ── 1. 센터 ─────────────────────────────────────────────────────
Ensure-List '센터' 'Lists/Centers' | Out-Null
Set-TitleColumn 'Lists/Centers' '센터코드' -Unique
Ensure-Field 'Lists/Centers' '센터명'       'CenterName'   'Text'
Ensure-Field 'Lists/Centers' '정렬순서'     'SortOrder'    'Number'
Ensure-Field 'Lists/Centers' '사용여부'     'IsActive'     'Boolean'
Ensure-Field 'Lists/Centers' '입력방식'     'InputType'    'Choice' -Choices @('엑셀자동', 'HWPX자동', '직접입력')
Ensure-Field 'Lists/Centers' '전체정원'     'TotalTO'      'Number'
Ensure-Field 'Lists/Centers' '상담사정원'   'CounselorTO'  'Number'
Ensure-Field 'Lists/Centers' '정원비교항목' 'StaffKey'     'Text'
Ensure-Field 'Lists/Centers' '담당자'       'Owners'       'User' -Multi
Ensure-Field 'Lists/Centers' '조회권한자'   'Viewers'      'User' -Multi

# ── 2. 일별실적 (핵심) ──────────────────────────────────────────
Ensure-List '일별실적' 'Lists/DailyMetrics' | Out-Null
Set-TitleColumn 'Lists/DailyMetrics' '키' -Unique
Ensure-Field 'Lists/DailyMetrics' '센터코드' 'CenterCode'  'Text'     -Indexed
Ensure-Field 'Lists/DailyMetrics' '일자'     'ReportDate'  'DateTime' -Indexed -DateOnly
Ensure-Field 'Lists/DailyMetrics' '구분'     'MetricGroup' 'Choice'   -Choices @('근태', '실적')
Ensure-Field 'Lists/DailyMetrics' '지표키'   'MetricKey'   'Text'     -Indexed
Ensure-Field 'Lists/DailyMetrics' '값'       'Value'       'Number'
Ensure-Field 'Lists/DailyMetrics' '원본값'   'RawValue'    'Text'
Ensure-Field 'Lists/DailyMetrics' '출처'     'Source'      'Choice'   -Choices @('엑셀자동', 'HWPX자동', '근태파일', '직접입력', '이관')
Ensure-Field 'Lists/DailyMetrics' '원본파일' 'SourceFile'  'Text'

# ── 3. 월별TO ───────────────────────────────────────────────────
Ensure-List '월별TO' 'Lists/MonthlyTO' | Out-Null
Set-TitleColumn 'Lists/MonthlyTO' '키' -Unique
Ensure-Field 'Lists/MonthlyTO' '센터코드' 'CenterCode'  'Text' -Indexed
Ensure-Field 'Lists/MonthlyTO' '연월'     'YearMonth'   'Text' -Indexed
Ensure-Field 'Lists/MonthlyTO' '관리자TO' 'ManagerTO'   'Number'
Ensure-Field 'Lists/MonthlyTO' '상담사TO' 'CounselorTO' 'Number'

# ── 4. KPI목표 ──────────────────────────────────────────────────
Ensure-List 'KPI목표' 'Lists/KpiTargets' | Out-Null
Set-TitleColumn 'Lists/KpiTargets' '키' -Unique
Ensure-Field 'Lists/KpiTargets' '센터코드' 'CenterCode'  'Text' -Indexed
Ensure-Field 'Lists/KpiTargets' '지표키'   'MetricKey'   'Text'
Ensure-Field 'Lists/KpiTargets' '지표명'   'MetricLabel' 'Text'
Ensure-Field 'Lists/KpiTargets' '연월'     'YearMonth'   'Text'
Ensure-Field 'Lists/KpiTargets' '목표값'   'TargetValue' 'Number'
Ensure-Field 'Lists/KpiTargets' '정렬순서' 'SortOrder'   'Number'

# ── 5. 이슈 ─────────────────────────────────────────────────────
Ensure-List '이슈' 'Lists/Issues' | Out-Null
Set-TitleColumn 'Lists/Issues' '제목'
Ensure-Field 'Lists/Issues' '센터코드' 'CenterCode' 'Text'     -Indexed
Ensure-Field 'Lists/Issues' '이슈일자' 'IssueDate'  'DateTime' -Indexed -DateOnly
Ensure-Field 'Lists/Issues' '내용'     'Content'    'Note'
Ensure-Field 'Lists/Issues' '확인여부' 'Reviewed'   'Boolean'

# ── 6. 공휴일 ───────────────────────────────────────────────────
Ensure-List '공휴일' 'Lists/Holidays' | Out-Null
Set-TitleColumn 'Lists/Holidays' '날짜' -Unique
Ensure-Field 'Lists/Holidays' '이름' 'HolidayName' 'Text'

# ── 7. 알림설정 / 알림로그 ──────────────────────────────────────
Ensure-List '알림설정' 'Lists/NotifySettings' | Out-Null
Set-TitleColumn 'Lists/NotifySettings' '알림종류' -Unique
Ensure-Field 'Lists/NotifySettings' '기준일수' 'ThresholdDays' 'Number'
Ensure-Field 'Lists/NotifySettings' '발송시각' 'SendHour'      'Number'
Ensure-Field 'Lists/NotifySettings' '반복주기' 'RepeatDays'    'Number'
Ensure-Field 'Lists/NotifySettings' '메일제목' 'MailSubject'   'Text'
Ensure-Field 'Lists/NotifySettings' '메일본문' 'MailBody'      'Note'
Ensure-Field 'Lists/NotifySettings' '발송정지' 'Paused'        'Boolean'

Ensure-List '알림로그' 'Lists/NotifyLog' | Out-Null
Set-TitleColumn 'Lists/NotifyLog' '센터코드'
Ensure-Field 'Lists/NotifyLog' '알림종류'     'NotifyType' 'Choice' -Choices @('실적미업로드', '이슈미등록')
Ensure-Field 'Lists/NotifyLog' '경과일수'     'DaysSince'  'Number'
Ensure-Field 'Lists/NotifyLog' '수신자'       'Recipients' 'Note'
Ensure-Field 'Lists/NotifyLog' '즉시발송여부' 'IsManual'   'Boolean'
Ensure-Field 'Lists/NotifyLog' '성공여부'     'SendOk'     'Boolean'
Ensure-Field 'Lists/NotifyLog' '실패사유'     'SendError'  'Text'

# ── 8. 결재요청 ─────────────────────────────────────────────────
Ensure-List '결재요청' 'Lists/ApprovalRequests' | Out-Null
Set-TitleColumn 'Lists/ApprovalRequests' '문서명'
Ensure-Field 'Lists/ApprovalRequests' '센터코드' 'CenterCode' 'Text' -Indexed
Ensure-Field 'Lists/ApprovalRequests' '회차'     'YearMonth'  'Text'
Ensure-Field 'Lists/ApprovalRequests' '입력값'   'ValuesJson' 'Note'
Ensure-Field 'Lists/ApprovalRequests' '결재상태' 'Status'     'Choice' -Choices @('작성중', '승인요청', '승인', '반려')
Ensure-Field 'Lists/ApprovalRequests' '승인자'   'Approver'   'Text'

# ── 9. 업로드자료함(문서 라이브러리) + 센터별 폴더 ───────────────
Ensure-List '업로드자료함' 'Uploads' 'DocumentLibrary' | Out-Null
Ensure-Field 'Uploads' '센터코드'   'CenterCode'    'Text' -Indexed
Ensure-Field 'Uploads' '처리상태'   'ProcessStatus' 'Choice' -Choices @('대기', '처리완료', '처리실패', '확인필요')
Ensure-Field 'Uploads' '처리메시지' 'ProcessMessage' 'Note'
Ensure-Field 'Uploads' '자료유형'   'FileKind'      'Choice' -Choices @('실적', '근태', '결재문서', '기타')

$centers = @(
  @{ Code = 'kbsonhae';    Name = 'KB손보부천';   Sort = 1; Input = '엑셀자동'; Total = 178; Counselor = 178; StaffKey = '총원' },
  @{ Code = 'kbjeongbi';   Name = 'KB손보정비';   Sort = 2; Input = '엑셀자동'; Total = 15;  Counselor = 14;  StaffKey = '재직인원' },
  @{ Code = 'lge';         Name = 'LG전자AS';     Sort = 3; Input = '엑셀자동'; Total = 19;  Counselor = 15;  StaffKey = '재직인원' },
  @{ Code = 'lge_seongsu'; Name = 'LG전자성수기'; Sort = 4; Input = '엑셀자동'; Total = 41;  Counselor = 35;  StaffKey = '재직인원' },
  @{ Code = 'lge_total';   Name = 'LG전자통합';   Sort = 5; Input = '직접입력'; Total = $null; Counselor = $null; StaffKey = '총재직인원_합계' },
  @{ Code = 'pyeongtaek';  Name = '평택시청';     Sort = 6; Input = 'HWPX자동'; Total = 24;  Counselor = 20;  StaffKey = '투입인원' }
)

foreach ($c in $centers) {
  foreach ($sub in @('', '/실적', '/근태')) {
    $path = "Uploads/$($c.Code)$sub"
    if (-not (Get-PnPFolder -Url $path -ErrorAction SilentlyContinue)) {
      Resolve-PnPFolder -SiteRelativePath $path | Out-Null
      Write-Host "  폴더: $path"
    }
  }
  $exists = Get-PnPListItem -List 'Lists/Centers' -Query "<View><Query><Where><Eq><FieldRef Name='Title'/><Value Type='Text'>$($c.Code)</Value></Eq></Where></Query></View>"
  if (-not $exists) {
    $values = @{ Title = $c.Code; CenterName = $c.Name; SortOrder = $c.Sort; IsActive = $true; InputType = $c.Input; StaffKey = $c.StaffKey }
    if ($null -ne $c.Total)     { $values.TotalTO = $c.Total }
    if ($null -ne $c.Counselor) { $values.CounselorTO = $c.Counselor }
    Add-PnPListItem -List 'Lists/Centers' -Values $values | Out-Null
    Write-Host "  센터 등록: $($c.Name)"
  }
}

# ── 10. 알림설정 기본값 ─────────────────────────────────────────
$notifyDefaults = @(
  @{ Title = '실적미업로드'; ThresholdDays = 4; SendHour = 9; RepeatDays = 1; Paused = $false;
     MailSubject = '[센터리포트] {center_name} 실적이 {days}일째 업로드되지 않았습니다';
     MailBody = "안녕하세요.`n{center_name}의 실적 데이터가 {days}일째 업로드되지 않았습니다.`n아래 링크에서 업로드해 주시기 바랍니다.`n{site_link}" },
  @{ Title = '이슈미등록'; ThresholdDays = 4; SendHour = 9; RepeatDays = 1; Paused = $false;
     MailSubject = '[센터리포트] {center_name} 이슈/히스토리가 {days}일째 등록되지 않았습니다';
     MailBody = "안녕하세요.`n{center_name}의 이슈/히스토리가 {days}일째 등록되지 않았습니다.`n특이사항이 없더라도 '특이사항 없음'으로 등록해 주시기 바랍니다.`n{site_link}" }
)
foreach ($n in $notifyDefaults) {
  $exists = Get-PnPListItem -List 'Lists/NotifySettings' -Query "<View><Query><Where><Eq><FieldRef Name='Title'/><Value Type='Text'>$($n.Title)</Value></Eq></Where></Query></View>"
  if (-not $exists) { Add-PnPListItem -List 'Lists/NotifySettings' -Values $n | Out-Null; Write-Host "  알림설정: $($n.Title)" }
}

# ── 11. 권한 — 일별실적·월별TO·KPI목표는 관리자만 직접 접근 ─────
#  센터담당자는 목록을 직접 열지 않고 에이전트(조회 흐름)를 통해서만 자기 센터를 본다.
#  아래는 상속을 끊고 사이트 소유자 그룹만 남기는 예시다. 실행 전 사이트 소유자 그룹 이름을 확인할 것.
#  Set-PnPList -Identity 'Lists/DailyMetrics' -BreakRoleInheritance -CopyRoleAssignments:$false
#  Set-PnPListPermission -Identity 'Lists/DailyMetrics' -Group '<사이트 소유자 그룹>' -AddRole 'Full Control'
#  센터별 업로드 폴더 — 담당자에게 자기 폴더 기여 권한만:
#  Set-PnPFolderPermission -List 'Uploads' -Identity 'Uploads/kbsonhae' -User '담당자@회사.com' -AddRole 'Contribute' -ClearExisting

Write-Host "`n완료. 다음: migration/import-csv.ps1 로 데이터 이관"
