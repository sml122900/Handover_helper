# 파이프라인 부하 테스트용 가상 영상 생성 (Windows 전용 — System.Speech 한국어 음성)
# golden/sample-demo.txt(가상 카페 마감조 대본)를 TTS로 읽혀 목표 길이까지 반복 → 정지 화면 mp4
#
# ⚠ 용도 제한: 처리 시간·청크 분할·타임아웃 검증 전용.
#   합성 음성이라 STT 정확도·문서 품질 지표로 PROGRESS.md·README에 인용 금지.
#   실데이터(private-data/) 사용 금지. 산출물은 output/tts/ (gitignore) — 커밋 금지.
#
# 사용법: powershell -File scripts/make-tts-video.ps1 [-Minutes 30] [-Out output/tts/tts-30min.mp4]
param(
  [int]$Minutes = 30,
  [string]$Out = "output/tts/tts-${Minutes}min.mp4"
)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq "ko-KR" } | Select-Object -First 1
if (-not $voice) { throw "한국어(ko-KR) TTS 음성이 없습니다. Windows 설정 > 시간 및 언어 > 음성에서 추가하세요." }
$synth.SelectVoice($voice.VoiceInfo.Name)

# [mm:ss] 타임스탬프 제거한 대본 1회분
$text = (Get-Content golden/sample-demo.txt -Encoding UTF8 |
  ForEach-Object { $_ -replace '^\[\d+:\d+\]\s*', '' } |
  Where-Object { $_ }) -join "`n"

$dir = Split-Path $Out -Parent
New-Item -ItemType Directory -Force $dir | Out-Null
$wav = Join-Path $dir "pass.wav"
$synth.SetOutputToWaveFile((Resolve-Path -LiteralPath $dir).Path + "\pass.wav")
$synth.Speak($text)
$synth.SetOutputToNull()
$synth.Dispose()

# 1회분 wav를 반복해 목표 길이로 + 1280x720 정지 화면 (실제 화면 녹화와 비슷한 디코딩 부하)
$ffmpeg = node -p "require('ffmpeg-static')"
$seconds = $Minutes * 60
& $ffmpeg -y -hide_banner -loglevel error `
  -stream_loop -1 -i $wav `
  -f lavfi -i "color=c=0x1f2937:s=1280x720:r=30" `
  -t $seconds -map 1:v -map 0:a `
  -c:v libx264 -preset ultrafast -tune stillimage -pix_fmt yuv420p `
  -c:a aac -b:a 64k -shortest $Out
if ($LASTEXITCODE -ne 0) { throw "ffmpeg 실패 ($LASTEXITCODE)" }

Remove-Item $wav
$size = [math]::Round((Get-Item $Out).Length / 1MB, 1)
Write-Output "생성: $Out (${Minutes}분, ${size}MB) — 처리 시간 검증 전용, 품질 지표 인용 금지"
