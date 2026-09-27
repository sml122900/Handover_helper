# 공개 전환 체크리스트 (사용자가 직접 실행)

리포: `https://github.com/sml122900/Handover_helper` · 로컬: `C:\project_2026\Handover_helper`
목적: 실데이터(실제 매장 인수인계)를 git **이력 전체**에서 제거한 뒤 공개 전환.
현재 HEAD에서는 이미 `private-data/`(gitignore)로 옮겼지만, 과거 커밋에는 남아 있다.

## 제거 대상 (세션 3-A 기준 — 빠짐없이)

**경로 삭제 (`--path`)** — 이력상 추적된 실데이터 파일 전부
```
golden/sample-01.txt
golden/sample-01.md
golden/sample-01-answer.md
golden/sample-01-main.md
golden/sample-01-merged.md
golden/sample-01-checklist.json
golden/sample-01-main-checklist.json
golden/sample-01-merged-checklist.json
samples/sample-01.txt
samples/sample-01b.txt
samples/sample-01-main.txt
samples/sample-01-merged.txt
tsconfig.tsbuildinfo   (빌드 산출물 — 해시 문자열이 검증 grep에 오탐)
```
- `golden/sample-02.txt`, `golden/sample-03.txt`: 전 이력에서 **0바이트** 빈 파일 → 실데이터 없음, 유지
- `results/`, `output/`(심판 근거 인용): 이력상 한 번도 추적된 적 없음 (gitignore) → 대상 없음
- 문서 속 실데이터 값: `docs/daily/2026-06-12.md`, `docs/par-materials.md` 과거 버전 → `--replace-text`로 치환
  (치환 목록은 값이 들어 있어 `private-data/history-redactions.txt`에만 보관)

**시크릿 스캔 결과** (gitleaks 8.30.1, `--log-opts=--all`, 29 커밋): **이력 내 유출 0건**. `git log --all -- .env` 결과 없음 (.env는 커밋된 적 없음) → 키 로테이션 불필요.

## 절차

### 0. 준비
```powershell
# Python 필요 (현재 PC에 없음)
winget install Python.Python.3.12
pip install git-filter-repo
```
`private-data/`를 별도 **private** 리포로 먼저 옮겨 둔다 (예: `sml122900/Handover_private-data`).

### 1. 미러 백업
```powershell
cd C:\project_2026
git clone --mirror https://github.com/sml122900/Handover_helper.git Handover_helper-backup.git
```

### 2. 새 클론에서 이력 재작성
```powershell
git clone https://github.com/sml122900/Handover_helper.git Handover_helper-publish
cd Handover_helper-publish
git filter-repo --invert-paths `
  --path golden/sample-01.txt --path golden/sample-01.md --path golden/sample-01-answer.md `
  --path golden/sample-01-main.md --path golden/sample-01-merged.md `
  --path golden/sample-01-checklist.json --path golden/sample-01-main-checklist.json `
  --path golden/sample-01-merged-checklist.json `
  --path samples/sample-01.txt --path samples/sample-01b.txt `
  --path samples/sample-01-main.txt --path samples/sample-01-merged.txt `
  --path tsconfig.tsbuildinfo `
  --replace-text C:\project_2026\Handover_helper\private-data\history-redactions.txt
```

### 3. 검증 (출력이 모두 비어야 함)
```powershell
git log --all --oneline -- golden/sample-01.txt samples/sample-01.txt
git rev-list --all | ForEach-Object { git grep -l -F -f C:\project_2026\Handover_helper\private-data\history-strings.txt $_ }
```
`history-strings.txt`: 매장명·비밀번호 값 등 고유 문자열 목록 (세션 3-A에서 작성, 비공개). 새 실데이터가 생기면 추가.

### 4. force push
```powershell
git remote add origin https://github.com/sml122900/Handover_helper.git   # filter-repo가 origin을 제거함
git push origin --force --all
git push origin --force --tags
```
열린 PR·포크가 있으면 옛 커밋이 PR ref로 남는다 → 닫고, 필요하면 GitHub Support에 cached view 삭제 요청.

### 5. 로컬 재클론
```powershell
cd C:\project_2026
git clone https://github.com/sml122900/Handover_helper.git Handover_helper-new
Copy-Item Handover_helper\.env Handover_helper-new\
Copy-Item -Recurse Handover_helper\private-data Handover_helper-new\
# 확인 후 옛 폴더 삭제, 새 폴더 이름 변경
```
옛 로컬 클론에서 push하면 제거한 이력이 되살아난다 — 반드시 버릴 것.

### 6. Vercel 재배포 확인
Vercel 대시보드 → 프로젝트 → Deployments에서 force push 이후 main 빌드 성공 확인 (필요 시 Redeploy).

### 7. 키 로테이션
스캔 결과 이력에 키 없음 → 불필요. (재작성 후 다시 스캔해서 0건이면 확정: `gitleaks git . --log-opts=--all`)

### 8. 공개 전환
```powershell
gh repo edit sml122900/Handover_helper --visibility public --accept-visibility-change-consequences
```
