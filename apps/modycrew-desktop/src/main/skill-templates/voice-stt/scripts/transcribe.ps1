<#
.SYNOPSIS
  ModyCrew voice-stt: audio or video file -> text with a LOCAL speech-to-text engine (whisper.cpp).
.DESCRIPTION
  Local only: no network access, no installation, no model download. The input file is never modified.
  Steps: find the engine (whisper-cli + ggml model, optional Silero VAD) -> convert the input to 16 kHz mono
  WAV with ffmpeg in a temp folder -> run whisper-cli -> write <name>.txt, <name>.timed.txt, <name>.srt and
  <name>.json inside -OutputRoot (default: ./output) -> print one JSON line as the last line.
  -ListEngines prints what is installed (engine, model, VAD model, ffmpeg) and exits.
  Exit code: 0 = ok, 1 = failed (see "error" in the JSON line).
  This file is ASCII only on purpose: Windows PowerShell 5.1 reads scripts without a BOM as ANSI.
#>
[CmdletBinding()]
param(
  [string]$InputFile = "",
  [string]$OutputRoot = "",
  [string]$OutName = "",
  [string]$Language = "ko",
  [string]$Prompt = "",
  [string]$WhisperCli = "",
  [string]$Model = "",
  [string]$FfmpegPath = "",
  [int]$MaxMinutes = 180,
  [int]$Threads = 0,
  [switch]$NoGpu,
  [switch]$NoVad,
  [switch]$Force,
  [switch]$ListEngines
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Utf8Bom = New-Object System.Text.UTF8Encoding($true)
$AllowedInput = @(".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".webm", ".mp4", ".mov", ".mkv", ".avi", ".amr", ".3gp")
$DirectInput = @(".wav", ".mp3", ".flac", ".ogg")

function Stop-Mody([string]$Code, [string]$Detail) { throw ("MODY|" + $Code + "|" + $Detail) }

function Resolve-FullPath([string]$PathValue) {
  $base = (Get-Location).ProviderPath
  return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($base, $PathValue))
}

function Get-ExistingFile([string]$PathValue) {
  if (-not $PathValue) { return $null }
  try {
    $full = Resolve-FullPath $PathValue
    if (Test-Path -LiteralPath $full -PathType Leaf) { return $full }
  } catch { }
  return $null
}

function Find-WhisperCli {
  if ($WhisperCli) {
    $explicit = Get-ExistingFile $WhisperCli
    if (-not $explicit) { Stop-Mody "no_engine" ("whisper-cli was not found at " + $WhisperCli) }
    return $explicit
  }
  $candidates = @()
  if ($env:MODY_WHISPER_CLI) { $candidates += $env:MODY_WHISPER_CLI }
  $command = Get-Command "whisper-cli" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { $candidates += $command.Source }
  $bases = @()
  if ($env:LOCALAPPDATA) { $bases += (Join-Path $env:LOCALAPPDATA "Programs/whisper.cpp") }
  if ($env:ProgramFiles) { $bases += (Join-Path $env:ProgramFiles "whisper.cpp") }
  if ($env:USERPROFILE) { $bases += (Join-Path $env:USERPROFILE "whisper.cpp") }
  # ModyCrew installs whisper.cpp next to the app (resources/toolchain/whisper). Codex, Claude and Gemini CLIs can reuse it.
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Programs/ModyCrew/resources/toolchain/whisper/whisper-cli.exe") }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles "ModyCrew/resources/toolchain/whisper/whisper-cli.exe") }
  foreach ($base in $bases) {
    foreach ($relative in @("bin/Release/whisper-cli.exe", "bin/whisper-cli.exe", "whisper-cli.exe", "build/bin/Release/whisper-cli.exe")) { $candidates += (Join-Path $base $relative) }
  }
  foreach ($candidate in $candidates) {
    $found = Get-ExistingFile $candidate
    if ($found) { return $found }
  }
  return $null
}

function Get-ModelRank([string]$Name) {
  $n = $Name.ToLowerInvariant()
  if ($n -match "silero|encoder|tdrz|vad") { return -1 }
  if (($n -match "[.]en[.-]") -and $Language -ne "en") { return -1 }
  if ($n -match "large-v3-turbo") { return 80 }
  if ($n -match "large-v3") { return 90 }
  if ($n -match "large") { return 70 }
  if ($n -match "medium") { return 60 }
  if ($n -match "small") { return 50 }
  if ($n -match "base") { return 40 }
  if ($n -match "tiny") { return 30 }
  return 10
}

function Find-Model([string]$CliPath) {
  if ($Model) {
    $explicit = Get-ExistingFile $Model
    if ($explicit) { return $explicit }
  }
  $dirs = @()
  if ($env:MODY_WHISPER_MODEL_DIR) { $dirs += $env:MODY_WHISPER_MODEL_DIR }
  if ($CliPath) {
    $cliDir = Split-Path -Parent $CliPath
    $dirs += $cliDir
    $dirs += (Join-Path $cliDir "../models")
    $dirs += (Join-Path $cliDir "../../models")
  }
  if ($env:LOCALAPPDATA) { $dirs += (Join-Path $env:LOCALAPPDATA "ModyCrew/models/whisper") }
  # Models downloaded inside ModyCrew ("내려받기") live in the app data folder, one folder per model.
  if ($env:APPDATA) {
    $modyModels = Join-Path $env:APPDATA "ModyCrew/feature-modules/speech-models"
    if (Test-Path -LiteralPath $modyModels -PathType Container) {
      foreach ($sub in (Get-ChildItem -LiteralPath $modyModels -Directory -ErrorAction SilentlyContinue)) { $dirs += $sub.FullName }
    }
  }
  $best = $null
  $bestRank = -1
  foreach ($dir in $dirs) {
    if (-not $dir -or -not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
    foreach ($file in (Get-ChildItem -LiteralPath $dir -Filter "ggml-*.bin" -File -ErrorAction SilentlyContinue)) {
      if ($Model -and $file.Name -ne $Model) { continue }
      if ($file.Length -lt 1000000) { continue }
      $rank = Get-ModelRank $file.Name
      if ($rank -gt $bestRank) { $best = $file.FullName; $bestRank = $rank }
    }
  }
  if ($Model -and -not $best) { Stop-Mody "no_model" ("Model was not found: " + $Model) }
  return $best
}

function Find-VadModel([string]$ModelPath) {
  if ($NoVad -or -not $ModelPath) { return $null }
  $vad = Get-ChildItem -LiteralPath (Split-Path -Parent $ModelPath) -Filter "ggml-silero-*.bin" -File -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($vad) { return $vad.FullName }
  return $null
}

function Find-Ffmpeg([string]$CliPath) {
  $candidates = @()
  if ($FfmpegPath) { $candidates += $FfmpegPath }
  $command = Get-Command "ffmpeg" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { $candidates += $command.Source }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Microsoft/WinGet/Links/ffmpeg.exe") }
  if ($CliPath) { $candidates += (Join-Path (Split-Path -Parent $CliPath) "ffmpeg.exe") }
  foreach ($candidate in $candidates) {
    $found = Get-ExistingFile $candidate
    if ($found) { return $found }
  }
  return $null
}

function Get-WavSeconds([string]$PathValue) {
  $stream = [System.IO.File]::OpenRead($PathValue)
  try {
    $reader = New-Object System.IO.BinaryReader($stream)
    if ([System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne "RIFF") { return 0 }
    [void]$reader.ReadUInt32()
    if ([System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne "WAVE") { return 0 }
    $byteRate = 0
    while (($stream.Position + 8) -le $stream.Length) {
      $id = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
      $size = [int64]$reader.ReadUInt32()
      if ($id -eq "fmt ") {
        $start = $stream.Position
        [void]$reader.ReadUInt16(); [void]$reader.ReadUInt16(); [void]$reader.ReadUInt32()
        $byteRate = [int]$reader.ReadUInt32()
        [void]$stream.Seek($start + $size + ($size % 2), [System.IO.SeekOrigin]::Begin)
      } elseif ($id -eq "data") {
        $dataBytes = [Math]::Min($size, $stream.Length - $stream.Position)
        if ($byteRate -gt 0) { return [Math]::Round($dataBytes / $byteRate, 2) }
        return 0
      } else {
        [void]$stream.Seek($size + ($size % 2), [System.IO.SeekOrigin]::Current)
      }
    }
    return 0
  } finally { $stream.Dispose() }
}

function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $lines = & $Exe @Arguments 2>&1 | ForEach-Object { [string]$_ }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  return @{ code = $code; output = (($lines | Select-Object -Last 20) -join " ") }
}

function Format-Clock([int64]$Milliseconds) {
  $span = [TimeSpan]::FromMilliseconds([double]$Milliseconds)
  return ("{0:00}:{1:00}:{2:00}" -f [int][Math]::Floor($span.TotalHours), $span.Minutes, $span.Seconds)
}

$result = $null
$exitCode = 0
$work = ""
try {
  if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) { Stop-Mody "unsupported_platform" "Windows only." }
  if ($Language -notmatch "^(auto|[a-z]{2,3})$") { Stop-Mody "bad_language" "Use a language code such as ko, en, ja or auto." }
  $cli = Find-WhisperCli
  $modelPath = Find-Model $cli
  $vadPath = Find-VadModel $modelPath
  $ffmpeg = Find-Ffmpeg $cli
  $missing = @()
  if (-not $cli) { $missing += "whisper-cli" }
  if (-not $modelPath) { $missing += "model" }
  if (-not $ffmpeg) { $missing += "ffmpeg(optional)" }
  if ($ListEngines) {
    $modelBytes = 0
    if ($modelPath) { $modelBytes = (Get-Item -LiteralPath $modelPath).Length }
    $result = [ordered]@{
      ok = $true; mode = "list_engines"; ready = [bool]($cli -and $modelPath); missing = $missing
      engines = @([ordered]@{ engine = "whisper.cpp"; ready = [bool]($cli -and $modelPath); whisperCli = $cli; model = $modelPath; modelBytes = $modelBytes; vadModel = $vadPath; ffmpeg = $ffmpeg })
    }
  } else {
    if (-not $cli) { Stop-Mody "no_engine" "whisper.cpp (whisper-cli.exe) was not found on this PC. See references/engines.md." }
    if (-not $modelPath) { Stop-Mody "no_model" "No ggml Whisper model (ggml-*.bin) was found next to whisper-cli. See references/engines.md." }
    if (-not $InputFile) { Stop-Mody "input_missing" "Pass -InputFile with the audio or video file chosen by the user." }
    $inputPath = Get-ExistingFile $InputFile
    if (-not $inputPath) { Stop-Mody "input_missing" ("File was not found: " + $InputFile) }
    $inputItem = Get-Item -LiteralPath $inputPath
    $extension = $inputItem.Extension.ToLowerInvariant()
    if ($AllowedInput -notcontains $extension) { Stop-Mody "bad_input_type" ("Unsupported file type: " + $extension) }
    if ($inputItem.Length -le 0) { Stop-Mody "input_missing" "The file is empty." }
    if ($inputItem.Length -gt 4GB) { Stop-Mody "too_long" "The file is larger than 4 GB." }
    if (-not $ffmpeg -and $DirectInput -notcontains $extension) { Stop-Mody "no_ffmpeg" "ffmpeg was not found, so only wav, mp3, flac and ogg can be read." }
    $cleanPrompt = (([string]$Prompt) -replace "[\r\n\t]", " ").Trim()
    if ($cleanPrompt.Length -gt 400) { $cleanPrompt = $cleanPrompt.Substring(0, 400) }
    $root = if ($OutputRoot) { Resolve-FullPath $OutputRoot } else { Resolve-FullPath "output" }
    $root = $root.TrimEnd([char[]]@([char]92, [char]47))
    if ([System.IO.Path]::GetPathRoot($root + [System.IO.Path]::DirectorySeparatorChar).TrimEnd([char[]]@([char]92, [char]47)) -eq $root) { Stop-Mody "bad_output_root" "The output folder cannot be a drive root." }
    $name = if ($OutName) { $OutName } else { [System.IO.Path]::GetFileNameWithoutExtension($inputItem.Name) }
    $name = ($name -replace '[<>:"/\\|?*\x00-\x1F]', "_").Trim().TrimEnd(".")
    if ($name.Length -gt 80) { $name = $name.Substring(0, 80) }
    if (-not $name) { $name = "transcript" }
    $targets = [ordered]@{ text = (Join-Path $root ($name + ".txt")); timed = (Join-Path $root ($name + ".timed.txt")); srt = (Join-Path $root ($name + ".srt")); json = (Join-Path $root ($name + ".json")) }
    foreach ($target in $targets.Values) {
      if ((Test-Path -LiteralPath $target) -and -not $Force) { Stop-Mody "exists" ("Result already exists: " + $target) }
    }
    [void][System.IO.Directory]::CreateDirectory($root)
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ("mody-stt-" + [guid]::NewGuid().ToString("N"))
    [void][System.IO.Directory]::CreateDirectory($work)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $audio = $inputPath
    $audioSeconds = 0
    if ($ffmpeg) {
      $audio = Join-Path $work "input.wav"
      $converted = Invoke-Native $ffmpeg @("-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", $inputPath, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", $audio)
      if ($converted.code -ne 0 -or -not (Test-Path -LiteralPath $audio)) { Stop-Mody "convert_failed" ("ffmpeg could not read the file. " + $converted.output) }
      $audioSeconds = Get-WavSeconds $audio
    } elseif ($extension -eq ".wav") {
      $audioSeconds = Get-WavSeconds $audio
    }
    if ($audioSeconds -gt ($MaxMinutes * 60)) { Stop-Mody "too_long" ("Audio is " + [Math]::Round($audioSeconds / 60, 1) + " minutes; the limit is " + $MaxMinutes + ".") }
    $threadCount = if ($Threads -gt 0) { $Threads } else { [Math]::Min(8, [Environment]::ProcessorCount) }
    $outBase = Join-Path $work "result"
    $cliArgs = @("-m", $modelPath, "-f", $audio, "-l", $Language, "-t", [string]$threadCount, "-bs", "5", "-bo", "5", "-mc", "0", "-osrt", "-oj", "-of", $outBase, "-np")
    if ($vadPath) { $cliArgs += @("--vad", "-vm", $vadPath, "-vsd", "500", "-vp", "200") }
    if ($cleanPrompt) { $cliArgs += @("--prompt", $cleanPrompt, "--carry-initial-prompt") }
    if ($NoGpu) { $cliArgs += "-ng" }
    $run = Invoke-Native $cli $cliArgs
    if ($run.code -ne 0) { Stop-Mody "engine_failed" ("whisper-cli exit code " + $run.code + ". " + $run.output) }
    $jsonPath = $outBase + ".json"
    if (-not (Test-Path -LiteralPath $jsonPath)) { Stop-Mody "engine_failed" "whisper-cli did not write a result file." }
    $parsed = [System.IO.File]::ReadAllText($jsonPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $segments = @()
    foreach ($segment in @($parsed.transcription)) {
      $segmentText = ([string]$segment.text).Trim()
      if (-not $segmentText) { continue }
      $segments += [ordered]@{ startMs = [int64]$segment.offsets.from; endMs = [int64]$segment.offsets.to; text = $segmentText }
    }
    $plainLines = @($segments | ForEach-Object { $_.text })
    $timedLines = @($segments | ForEach-Object { "[" + (Format-Clock $_.startMs) + "] " + $_.text })
    $plain = ($plainLines -join [Environment]::NewLine)
    [System.IO.File]::WriteAllText($targets.text, $plain + [Environment]::NewLine, $Utf8Bom)
    [System.IO.File]::WriteAllText($targets.timed, (($timedLines -join [Environment]::NewLine) + [Environment]::NewLine), $Utf8Bom)
    $srtSource = $outBase + ".srt"
    $srtText = ""
    if (Test-Path -LiteralPath $srtSource) { $srtText = [System.IO.File]::ReadAllText($srtSource, [System.Text.Encoding]::UTF8) }
    [System.IO.File]::WriteAllText($targets.srt, $srtText, $Utf8Bom)
    $elapsed = [Math]::Round($clock.Elapsed.TotalSeconds, 1)
    $summary = [ordered]@{ engine = "whisper.cpp"; model = [System.IO.Path]::GetFileName($modelPath); vad = [bool]$vadPath; gpuRequested = (-not $NoGpu); language = $Language; audioSeconds = $audioSeconds; elapsedSeconds = $elapsed; segments = $segments }
    [System.IO.File]::WriteAllText($targets.json, ($summary | ConvertTo-Json -Depth 6), $Utf8NoBom)
    $preview = $plain
    if ($preview.Length -gt 400) { $preview = $preview.Substring(0, 400) }
    $result = [ordered]@{
      ok = $true; mode = "transcribe"; engine = "whisper.cpp"; model = [System.IO.Path]::GetFileName($modelPath); vad = [bool]$vadPath; gpuRequested = (-not $NoGpu)
      language = $Language; input = $inputPath; inputBytes = $inputItem.Length; audioSeconds = $audioSeconds; elapsedSeconds = $elapsed
      segments = $segments.Count; chars = $plain.Length; files = $targets; preview = $preview
    }
  }
} catch {
  $message = [string]$_.Exception.Message
  if ($message.StartsWith("MODY|")) {
    $parts = $message.Split([char[]]@([char]124), 3)
    $result = [ordered]@{ ok = $false; error = $parts[1]; detail = $parts[2] }
  } else {
    $result = [ordered]@{ ok = $false; error = "transcribe_failed"; detail = $message }
  }
  $exitCode = 1
} finally {
  if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
Write-Output ($result | ConvertTo-Json -Compress -Depth 6)
exit $exitCode

