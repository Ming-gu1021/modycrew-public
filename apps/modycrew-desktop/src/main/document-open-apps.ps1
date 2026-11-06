param([Parameter(Mandatory=$true)][ValidatePattern('^\.[a-z0-9]{1,12}$')][string]$Extension)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$classes = [Microsoft.Win32.Registry]::ClassesRoot
$current = [Microsoft.Win32.Registry]::CurrentUser
$machine = [Microsoft.Win32.Registry]::LocalMachine
$ids = [System.Collections.Generic.List[string]]::new()
function Add-ProgId([string]$Value) { if ($Value -and !$ids.Contains($Value) -and $ids.Count -lt 128) { $ids.Add($Value) } }
function Read-Value($Root, [string]$Key, [string]$Name = '') {
  $entry = $Root.OpenSubKey($Key)
  if ($entry) { try { $entry.GetValue($Name) } finally { $entry.Dispose() } }
}
Add-ProgId (Read-Value $current "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Extension\UserChoice" 'ProgId')
Add-ProgId (Read-Value $classes $Extension)
foreach ($location in @(@($classes, "$Extension\OpenWithProgids"), @($classes, "SystemFileAssociations\$Extension\OpenWithProgids"), @($current, "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Extension\OpenWithProgids"))) {
  $entry = $location[0].OpenSubKey($location[1])
  if ($entry) { try { foreach ($id in $entry.GetValueNames()) { Add-ProgId $id } } finally { $entry.Dispose() } }
}
foreach ($root in @($current, $machine)) {
  $registered = $root.OpenSubKey('Software\RegisteredApplications')
  if ($registered) {
    try { foreach ($name in $registered.GetValueNames()) {
      $capabilities = [string]$registered.GetValue($name)
      Add-ProgId (Read-Value $root "$capabilities\FileAssociations" $Extension)
    } } finally { $registered.Dispose() }
  }
}
$history = $current.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Extension\OpenWithList")
if ($history) { try { foreach ($key in $history.GetValueNames()) {
  if ($key -ne 'MRUList') { $exeName = [string]$history.GetValue($key); if ($exeName -match '^[^\\/:]+\.exe$') { Add-ProgId "Applications\$exeName" } }
} } finally { $history.Dispose() } }
$result = [System.Collections.Generic.List[object]]::new()
foreach ($id in $ids) {
  if ($id -match '^AppX') { continue }
  $command = [string](Read-Value $classes "$id\shell\open\command")
  if (!$command -or (Read-Value $classes "$id\shell\open\command" 'DelegateExecute')) { continue }
  $command = [Environment]::ExpandEnvironmentVariables($command).Trim()
  $exe = $null
  if ($command -match '^"([^"]+\.exe)"(?:\s|$)') { $exe = $Matches[1] }
  elseif ($command -match '^([^\s"]+\.exe)(?:\s|$)') { $exe = $Matches[1] }
  if (!$exe -or ![IO.Path]::IsPathRooted($exe) -or ![IO.File]::Exists($exe)) { continue }
  $name = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).FileDescription
  if (!$name) { $name = [IO.Path]::GetFileNameWithoutExtension($exe) }
  $result.Add([pscustomobject]@{ executable=$exe; name=$name })
}
ConvertTo-Json -InputObject @($result.ToArray()) -Compress -Depth 3
