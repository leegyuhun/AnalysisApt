<#
.SYNOPSIS
    네이버 부동산 매물을 다시 수집하고, 변경분이 있으면 커밋해서 GitHub Pages에 반영한다.

.DESCRIPTION
    update-prices.bat 이 이 스크립트를 호출한다. 직접 실행해도 동작한다.
    수집 → 변경 확인 → 커밋 → 푸시 순서이며, 어느 단계든 실패하면 원인과 대처를 안내하고 멈춘다.
    매물이 하나도 안 바뀌었으면 커밋하지 않는다.

.PARAMETER NoPush
    커밋까지만 하고 푸시는 건너뛴다. 오프라인이거나 내용을 먼저 확인하고 싶을 때.

.PARAMETER NoPause
    끝난 뒤 Enter 대기 없이 바로 종료한다. 예약 실행 등 자동화용.
#>
param(
    [switch]$NoPush,
    [switch]$NoPause
)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Write-Step($n, $msg) { Write-Host "[$n/4] $msg" -ForegroundColor Cyan }
function Write-Note($msg) { Write-Host "       $msg" -ForegroundColor DarkGray }

function Exit-Script($code) {
    Write-Host ''
    if (-not $NoPause) { Read-Host '닫으려면 Enter를 누르세요' | Out-Null }
    exit $code
}

function Fail($msg, $hint) {
    Write-Host ''
    Write-Host "  [실패] $msg" -ForegroundColor Red
    if ($hint) { $hint -split "`n" | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray } }
    Exit-Script 1
}

# 아직 원격에 올리지 못한 커밋 수 (지난번 푸시가 실패했을 수 있다)
function Get-UnpushedCount {
    $n = git rev-list --count '@{u}..HEAD'
    if ($LASTEXITCODE -ne 0) { return 0 }
    return [int]$n
}

function Invoke-Push {
    Write-Host ''
    Write-Step 4 'GitHub에 반영'
    git push --quiet
    if ($LASTEXITCODE -ne 0) {
        Fail '푸시 실패' '커밋은 끝났으니 네트워크 확인 후 git push 만 다시 하면 됩니다.'
    }
    Write-Host ''
    Write-Host '  완료. 20초쯤 뒤 사이트에 반영됩니다.' -ForegroundColor Green
    Write-Host '  https://leegyuhun.github.io/AnalysisApt/' -ForegroundColor Green
}

Write-Host ''
Write-Host '  ============================================' -ForegroundColor DarkGray
Write-Host '    매물 시세 갱신' -ForegroundColor White
Write-Host '  ============================================' -ForegroundColor DarkGray
Write-Host ''

# ── 1) 원격 변경분을 먼저 당겨온다 ────────────────────────────
Write-Step 1 '원격 변경 사항 확인'
git pull --rebase --quiet
if ($LASTEXITCODE -ne 0) {
    Fail 'git pull 실패' "수정 중인 파일이 남아 있거나 원격과 충돌했을 수 있습니다.`ngit status 로 확인하세요."
}

# ── 2) 네이버 부동산 수집 ─────────────────────────────────────
Write-Step 2 '네이버 부동산 매물 수집'
Write-Host ''
npm run scrape
if ($LASTEXITCODE -ne 0) {
    Fail '매물 수집 실패' "네이버가 일시적으로 차단했거나 응답 구조가 바뀌었을 수 있습니다.`n잠시 뒤 다시 시도하고, 계속 실패하면 scripts/scrape.mjs 를 점검하세요."
}

# ── 3) 변경분이 있을 때만 커밋 ────────────────────────────────
Write-Host ''
Write-Step 3 '변경 사항 확인'

git add data/articles
if ($LASTEXITCODE -ne 0) { Fail 'git add 실패' 'git status 로 확인하세요.' }

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Note '바뀐 매물이 없습니다. 커밋할 내용이 없습니다.'

    # 지난번에 푸시하지 못한 커밋이 남아 있으면 이번에 마저 올린다
    $pending = Get-UnpushedCount
    if ($pending -gt 0 -and -not $NoPush) {
        Write-Note "다만 아직 올리지 못한 커밋이 $pending 건 있습니다."
        Invoke-Push
    }
    elseif ($pending -gt 0) {
        Write-Note "아직 올리지 못한 커밋이 $pending 건 있습니다. git push 로 반영하세요."
    }
    Exit-Script 0
}

git --no-pager diff --cached --stat

# 커밋 메시지에 단지별 매물 건수를 남겨두면 git log만 봐도 추이가 보인다
$summary = Get-ChildItem (Join-Path $root 'data\articles\*.json') | ForEach-Object {
    $j = Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    "$($j.complexName) $($j.totalCount)건"
}
$message = "매물 시세 갱신 ($(Get-Date -Format 'yyyy-MM-dd')) — " + ($summary -join ', ')

# -m 으로 넘기면 PowerShell 5.1이 한글을 ANSI로 전달해 깨질 수 있어 파일로 넘긴다
$msgFile = Join-Path ([System.IO.Path]::GetTempPath()) 'analysisapt-commit-msg.txt'
[System.IO.File]::WriteAllText($msgFile, $message, (New-Object System.Text.UTF8Encoding($false)))
git commit -F $msgFile --quiet
$commitCode = $LASTEXITCODE
Remove-Item $msgFile -Force -ErrorAction SilentlyContinue
if ($commitCode -ne 0) { Fail '커밋 실패' 'git status 로 확인하세요.' }

Write-Host ''
Write-Note $message

# ── 4) 푸시 ───────────────────────────────────────────────────
if ($NoPush) {
    Write-Host ''
    Write-Step 4 '-NoPush 지정됨 — 커밋만 하고 종료합니다'
    Write-Note '나중에 반영하려면: git push'
    Exit-Script 0
}

Invoke-Push
Exit-Script 0
