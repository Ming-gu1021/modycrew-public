<#
.SYNOPSIS
  ModyCrew voice-tts: text -> WAV with the Windows built-in speech engine (System.Speech / SAPI).
.DESCRIPTION
  Local only: no network access, no installation, no downloads.
  Writes exactly one WAV file inside -OutputRoot (default: .\output) and prints one JSON line.
  -ListVoices prints the installed voices as JSON and exits.
  Exit code: 0 = ok, 1 = failed (see "error" in the JSON line).
  This file is ASCII only on purpose: Windows PowerShell 5.1 reads scripts without a BOM as ANSI.
#>
[CmdletBinding()]
param(
  [string]$TextFile = "",
  [string]$Text = "",
  [string]$OutFile = "",
  [string]$OutputRoot = "",
  [string]$Voice = "",
  [int]$Rate = 0,
  [int]$Volume = 100,
  [int]$SampleRate = 22050,
  [switch]$Force,
  [switch]$ListVoices
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$MaxChars = 5000
$MaxTextFileBytes = 1048576

function Stop-Mody([string]$Code, [string]$Detail) { throw ("MODY|" + $Code + "|" + $Detail) }

function Resolve-FullPath([string]$PathValue) {
  $base = (Get-Location).ProviderPath
  return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($base, $PathValue))
}

function Get-WavInfo([string]$PathValue) {
  $stream = [System.IO.File]::OpenRead($PathValue)
  try {
    $reader = New-Object System.IO.BinaryReader($stream)
    $riff = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
    [void]$reader.ReadUInt32()
    $wave = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
    if ($riff -ne "RIFF" -or $wave -ne "WAVE") { return $null }
    $info = @{ channels = 0; sampleRate = 0; byteRate = 0; bitsPerSample = 0; dataBytes = [int64]0 }
    while (($stream.Position + 8) -le $stream.Length) {
      $id = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
      $size = [int64]$reader.ReadUInt32()
      if ($id -eq "fmt ") {
        $start = $stream.Position
        [void]$reader.ReadUInt16()
        $info.channels = [int]$reader.ReadUInt16()
        $info.sampleRate = [int]$reader.ReadUInt32()
        $info.byteRate = [int]$reader.ReadUInt32()
        [void]$reader.ReadUInt16()
        $info.bitsPerSample = [int]$reader.ReadUInt16()
        [void]$stream.Seek($start + $size + ($size % 2), [System.IO.SeekOrigin]::Begin)
      } elseif ($id -eq "data") {
        $info.dataBytes = [int64][Math]::Min($size, $stream.Length - $stream.Position)
        break
      } else {
        [void]$stream.Seek($size + ($size % 2), [System.IO.SeekOrigin]::Current)
      }
    }
    return $info
  } finally { $stream.Dispose() }
}

function Get-VoiceList($Synth) {
  $list = @()
  foreach ($installed in $Synth.GetInstalledVoices()) {
    $v = $installed.VoiceInfo
    $list += [ordered]@{ name = $v.Name; culture = $v.Culture.Name; gender = $v.Gender.ToString(); age = $v.Age.ToString(); enabled = [bool]$installed.Enabled }
  }
  return ,$list
}

$result = $null
$exitCode = 0
$synth = $null
$partial = ""
try {
  if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) { Stop-Mody "unsupported_platform" "Windows only." }
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voices = Get-VoiceList $synth
  if ($ListVoices) {
    $korean = @($voices | Where-Object { $_.culture -eq "ko-KR" -and $_.enabled })
    $result = [ordered]@{ ok = $true; mode = "list_voices"; voices = $voices; koreanVoices = $korean.Count }
  } else {
    if ($TextFile -and $Text) { Stop-Mody "text_conflict" "Use -TextFile or -Text, not both." }
    $value = $Text
    if ($TextFile) {
      $textPath = Resolve-FullPath $TextFile
      if (-not (Test-Path -LiteralPath $textPath -PathType Leaf)) { Stop-Mody "text_file_missing" $textPath }
      if ((Get-Item -LiteralPath $textPath).Length -gt $MaxTextFileBytes) { Stop-Mody "text_too_long" "Text file is larger than 1 MB." }
      $value = [System.IO.File]::ReadAllText($textPath, [System.Text.Encoding]::UTF8)
    }
    $value = ([string]$value) -replace "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", " "
    $value = $value.Trim()
    if (-not $value) { Stop-Mody "no_text" "Nothing to read." }
    if ($value.Length -gt $MaxChars) { Stop-Mody "text_too_long" ("Text has " + $value.Length + " characters; the limit is " + $MaxChars + ".") }
    if ($Rate -lt -10 -or $Rate -gt 10) { Stop-Mody "bad_rate" "Rate must be between -10 and 10." }
    if ($Volume -lt 0 -or $Volume -gt 100) { Stop-Mody "bad_volume" "Volume must be between 0 and 100." }
    if (@(8000, 11025, 16000, 22050, 24000, 44100, 48000) -notcontains $SampleRate) { Stop-Mody "bad_sample_rate" "Use 8000, 11025, 16000, 22050, 24000, 44100 or 48000." }
    if (-not $OutFile) { Stop-Mody "no_out_file" "Pass -OutFile (a .wav path inside the output folder)." }
    $root = if ($OutputRoot) { Resolve-FullPath $OutputRoot } else { Resolve-FullPath "output" }
    $root = $root.TrimEnd([char[]]@([char]92, [char]47))
    if ([System.IO.Path]::GetPathRoot($root + [System.IO.Path]::DirectorySeparatorChar).TrimEnd([char[]]@([char]92, [char]47)) -eq $root) { Stop-Mody "bad_output_root" "The output folder cannot be a drive root." }
    $target = Resolve-FullPath $OutFile
    if ([System.IO.Path]::GetExtension($target).ToLowerInvariant() -ne ".wav") { Stop-Mody "bad_extension" "OutFile must end with .wav" }
    if (-not $target.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { Stop-Mody "outside_output_root" ("OutFile must be inside " + $root) }
    if ((Test-Path -LiteralPath $target) -and -not $Force) { Stop-Mody "exists" ("File already exists: " + $target) }
    $enabled = @($voices | Where-Object { $_.enabled })
    if ($enabled.Count -eq 0) { Stop-Mody "no_voice" "No enabled Windows voice." }
    $chosen = $null
    if ($Voice) {
      $chosen = $enabled | Where-Object { $_.name -eq $Voice } | Select-Object -First 1
      if (-not $chosen) { Stop-Mody "voice_not_found" ("Voice is not installed: " + $Voice) }
    } else {
      $chosen = $enabled | Where-Object { $_.culture -eq "ko-KR" } | Select-Object -First 1
      if (-not $chosen) { Stop-Mody "no_korean_voice" "No Korean (ko-KR) voice is installed. Pass -Voice to use another voice." }
    }
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target))
    $partial = $target + ".part"
    $synth.SelectVoice($chosen.name)
    $synth.Rate = $Rate
    $synth.Volume = $Volume
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo($SampleRate, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile($partial, $format)
    $synth.Speak($value)
    $synth.SetOutputToNull()
    Move-Item -LiteralPath $partial -Destination $target -Force
    $partial = ""
    $wav = Get-WavInfo $target
    $bytes = (Get-Item -LiteralPath $target).Length
    $duration = 0
    if ($wav -and $wav.byteRate -gt 0) { $duration = [Math]::Round($wav.dataBytes / $wav.byteRate, 2) }
    if ($bytes -le 44 -or $duration -le 0) {
      Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
      Stop-Mody "empty_audio" "The speech engine produced no audio."
    }
    $result = [ordered]@{ ok = $true; mode = "speak"; file = $target; bytes = $bytes; durationSeconds = $duration; voice = $chosen.name; culture = $chosen.culture; sampleRate = $wav.sampleRate; channels = $wav.channels; bitsPerSample = $wav.bitsPerSample; chars = $value.Length; rate = $Rate; volume = $Volume }
  }
} catch {
  $message = [string]$_.Exception.Message
  if ($message.StartsWith("MODY|")) {
    $parts = $message.Split([char[]]@([char]124), 3)
    $result = [ordered]@{ ok = $false; error = $parts[1]; detail = $parts[2] }
  } else {
    $result = [ordered]@{ ok = $false; error = "speech_failed"; detail = $message }
  }
  $exitCode = 1
} finally {
  if ($synth) { try { $synth.SetOutputToNull() } catch { }; $synth.Dispose() }
  if ($partial -and (Test-Path -LiteralPath $partial)) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue }
}
Write-Output ($result | ConvertTo-Json -Compress -Depth 5)
exit $exitCode
