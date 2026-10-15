<#
  import-csv.ps1 — export.sql 로 받은 CSV 를 SharePoint 목록에 넣는다
  같은 키(Title)가 이미 있으면 값을 고치고, 없으면 새로 만든다(여러 번 돌려도 안전).

  실행
    ./import-csv.ps1 -SiteUrl "https://<회사>.sharepoint.com/sites/CenterReport" -ClientId "<앱 ID>" -CsvDir "./csv"

  ※ Issues 는 고유 키가 없어 다시 돌리면 중복된다 — 한 번만 넣을 것.
  CsvDir 안에 있으면 처리하는 파일: Centers.csv, Holidays.csv, MonthlyTO.csv, KpiTargets.csv, Issues.csv, DailyMetrics.csv
  DailyMetrics 는 행이 많다(수만 건). 배치 100건씩 넣는다. 처음엔 -Limit 200 으로 시험해 볼 것.
#>
param(
  [Parameter(Mandatory = $true)][string]$SiteUrl,
  [Parameter(Mandatory = $true)][string]$ClientId,
  [Parameter(Mandatory = $true)][string]$CsvDir,
  [int]$Limit = 0
)

$ErrorActionPreference = 'Stop'
Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

# 목록별: 숫자 열 · 날짜 열 · 예/아니요 열 · 이미 있는 행을 찾을 기준(Title 고유 여부)
$specs = [ordered]@{
  'Centers'      = @{ List = 'Lists/Centers';      Numbers = @('SortOrder');                     Dates = @();             Bools = @('IsActive'); Upsert = $true }
  'Holidays'     = @{ List = 'Lists/Holidays';     Numbers = @();                                Dates = @();             Bools = @();           Upsert = $true }
  'MonthlyTO'    = @{ List = 'Lists/MonthlyTO';    Numbers = @('ManagerTO', 'CounselorTO');      Dates = @();             Bools = @();           Upsert = $true }
  'KpiTargets'   = @{ List = 'Lists/KpiTargets';   Numbers = @('TargetValue', 'SortOrder');      Dates = @();             Bools = @();           Upsert = $true }
  'Issues'       = @{ List = 'Lists/Issues';       Numbers = @();                                Dates = @('IssueDate');  Bools = @('Reviewed'); Upsert = $false }
  'DailyMetrics' = @{ List = 'Lists/DailyMetrics'; Numbers = @('Value');                         Dates = @('ReportDate'); Bools = @();           Upsert = $true }
}

function Convert-Row($row, $spec) {
  $values = @{}
  foreach ($p in $row.PSObject.Properties) {
    $name = $p.Name; $raw = [string]$p.Value
    if ($spec.Numbers -contains $name) {
      if ($raw -ne '') { $values[$name] = [double]::Parse($raw, [Globalization.CultureInfo]::InvariantCulture) }
      # 빈칸은 넣지 않는다 — 0 과 «값 없음» 을 구분한다
    } elseif ($spec.Dates -contains $name) {
      if ($raw -ne '') { $values[$name] = $raw.Substring(0, 10) }
    } elseif ($spec.Bools -contains $name) {
      $values[$name] = ($raw -eq 'true')
    } else {
      $values[$name] = $raw
    }
  }
  return $values
}

function Get-ExistingIds([string]$List) {
  # Title → 항목 ID (전체를 한 번만 읽는다. 5,000건 넘어도 PageSize 로 나눠 읽음)
  $map = @{}
  Get-PnPListItem -List $List -PageSize 2000 -Fields 'Title' | ForEach-Object { $map[[string]$_['Title']] = $_.Id }
  return $map
}

foreach ($name in $specs.Keys) {
  $path = Join-Path $CsvDir "$name.csv"
  if (-not (Test-Path $path)) { Write-Host "건너뜀(파일 없음): $name.csv"; continue }
  $spec = $specs[$name]
  $rows = Import-Csv -Path $path -Encoding UTF8
  if ($Limit -gt 0) { $rows = $rows | Select-Object -First $Limit }
  Write-Host "`n[$name] $($rows.Count)행 → $($spec.List)"

  $existing = if ($spec.Upsert) { Get-ExistingIds $spec.List } else { @{} }
  $batch = New-PnPBatch
  $n = 0; $added = 0; $updated = 0
  foreach ($row in $rows) {
    $values = Convert-Row $row $spec
    $key = [string]$values['Title']
    if ($spec.Upsert -and $existing.ContainsKey($key)) {
      Set-PnPListItem -List $spec.List -Identity $existing[$key] -Values $values -Batch $batch | Out-Null
      $updated++
    } else {
      Add-PnPListItem -List $spec.List -Values $values -Batch $batch | Out-Null
      $added++
    }
    $n++
    if ($n % 100 -eq 0) { Invoke-PnPBatch -Batch $batch; $batch = New-PnPBatch; Write-Host "  $n / $($rows.Count)" }
  }
  if ($n % 100 -ne 0) { Invoke-PnPBatch -Batch $batch }
  Write-Host "  완료: 추가 $added · 수정 $updated"
}

Write-Host "`n이관 끝. export.sql 7번(센터별 일수) 결과와 SharePoint 건수를 대조하세요."
