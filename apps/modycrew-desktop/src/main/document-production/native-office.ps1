param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$office = $null
$document = $null
$officeKind = [string]$request.action
$processName = @{word='WINWORD';powerpoint='POWERPNT';hancom='Hwp'}[$officeKind]
$existingProcesses = @(if ($processName) { Get-Process -Name $processName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } })
function Write-OfficeResult($value) {
  # Readers must never hold the same file that PowerShell is updating.
  # Publish one immutable result after writing and closing a private file.
  $pendingPath = [string]$request.resultPath + '.partial'
  $json = $value | ConvertTo-Json -Depth 8 -Compress
  [System.IO.File]::WriteAllText($pendingPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  [System.IO.File]::Move($pendingPath, [string]$request.resultPath)
}
function Write-OfficeProcess($handle) {
  if (-not $handle) { return }
  if (-not ('ModyOfficeWindow' -as [type])) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ModyOfficeWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }'
  }
  [uint32]$officeProcessId = 0
  [void][ModyOfficeWindow]::GetWindowThreadProcessId([IntPtr]$handle, [ref]$officeProcessId)
  if ($officeProcessId -and $officeProcessId -notin $existingProcesses) { @{pid=$officeProcessId;process=$processName} | ConvertTo-Json | Set-Content -LiteralPath $request.processPath -Encoding UTF8 }
}
try {
  if ($request.action -eq 'probe') {
    $result = @{}
    foreach ($name in @('HWPFrame.HwpObject', 'Word.Application', 'PowerPoint.Application', 'Excel.Application')) {
      $result[$name] = $null -ne [type]::GetTypeFromProgID($name)
    }
  } elseif ($request.action -eq 'hancom') {
    @{stage='create'} | ConvertTo-Json | Set-Content -LiteralPath $request.progressPath -Encoding UTF8
    $office = New-Object -ComObject HWPFrame.HwpObject
    @{stage='open'} | ConvertTo-Json | Set-Content -LiteralPath $request.progressPath -Encoding UTF8
    $office.XHwpWindows.Item(0).Visible = $false
    Write-OfficeProcess $office.XHwpWindows.Item(0).WindowHandle
    # Reuse only an already installed, signed Hancom automation approval module.
    # This does not install DLLs or change the user's registry/security policy.
    foreach ($moduleName in @('FilePathCheckerModule', 'raonkhwp')) {
      $modules = Get-ItemProperty 'HKCU:\Software\HNC\HwpAutomation\Modules' -ErrorAction SilentlyContinue
      $modulePath = $modules.$moduleName
      if ($modulePath -and (Test-Path -LiteralPath $modulePath) -and (Get-AuthenticodeSignature -LiteralPath $modulePath).Status -eq 'Valid') {
        if ($office.RegisterModule('FilePathCheckDLL', $moduleName)) { break }
      }
    }
    if ($request.input) {
      if (-not $office.Open([string]$request.input, [string]$request.inputFormat, 'forceopen:true')) { throw '한글에서 원본 문서를 열지 못했습니다.' }
    } else {
      if (-not $office.SetTextFile([string]$request.text, 'UNICODE', '')) { throw '한글 문서 내용을 입력하지 못했습니다.' }
    }
    if ($request.createTable) {
      [void]$office.HAction.Run('MoveDocEnd')
      $action = $office.CreateAction('TableCreate')
      $parameters = $action.CreateSet()
      [void]$action.GetDefault($parameters)
      $parameters.SetItem('Rows', 2)
      $parameters.SetItem('Cols', 2)
      $parameters.SetItem('WidthType', 2)
      $parameters.SetItem('HeightType', 1)
      $parameters.SetItem('WidthValue', 42520)
      $parameters.SetItem('HeightValue', 5600)
      [void]$action.Execute($parameters)
    }
    $text = [string]$office.GetTextFile('UNICODE', '')
    @{stage='save'} | ConvertTo-Json | Set-Content -LiteralPath $request.progressPath -Encoding UTF8
    $pages = $office.PageCount
    if ($request.output) {
      if (-not $office.SaveAs([string]$request.output, [string]$request.outputFormat, '')) { throw '한글 파일 저장에 실패했습니다.' }
    }
    $result = @{ text = $text; pages = $pages; output = $request.output }
  } elseif ($request.action -eq 'word') {
    @{stage='word_create'} | ConvertTo-Json | Set-Content -LiteralPath $request.progressPath -Encoding UTF8
    $office = New-Object -ComObject Word.Application
    Write-OfficeProcess $office.Hwnd
    $office.Visible = $false
    $office.DisplayAlerts = 0
    $office.AutomationSecurity = 3
    @{stage='word_open'} | ConvertTo-Json | Set-Content -LiteralPath $request.progressPath -Encoding UTF8
    $document = $office.Documents.Open([string]$request.input, $false, $true)
    $text = [string]$document.Content.Text
    if ($request.output) { $document.ExportAsFixedFormat([string]$request.output, 17) }
    $result = @{ text = $text; pages = $document.ComputeStatistics(2) }
  } elseif ($request.action -eq 'powerpoint') {
    @{stage='powerpoint_create'} | ConvertTo-Json | Set-Content -LiteralPath $request.progressPath -Encoding UTF8
    $office = New-Object -ComObject PowerPoint.Application
    Write-OfficeProcess $office.HWND
    $office.AutomationSecurity = 3
    $document = $office.Presentations.Open([string]$request.input, -1, 0, 0)
    $slides = @()
    foreach ($slide in $document.Slides) {
      $text = @()
      foreach ($shape in $slide.Shapes) { if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { $text += [string]$shape.TextFrame.TextRange.Text } }
      $slides += ($text -join "`n")
    }
    if ($request.output) { $document.Export([string]$request.output, 'PNG', 1600, 900) }
    $result = @{ slides = $slides; pages = $document.Slides.Count }
  } else { throw '지원하지 않는 Office 작업입니다.' }
  Write-OfficeResult $result
} catch {
  Write-OfficeResult @{ error = $_.Exception.Message }
  exit 1
} finally {
  if ($null -ne $document) { try { if ($officeKind -eq 'word') { $document.Close(0) } else { $document.Close() } } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
  if ($null -ne $office) { try { if ($officeKind -eq 'word') { $office.Quit(0) } else { $office.Quit() } } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($office) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
