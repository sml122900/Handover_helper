# MCP 서버 — 인수인계 문서 읽기 도구 (설계 6-4)

`agent/mcp_server.py`는 인수인계 에이전트의 **읽기 도구 3개**를 [Model Context Protocol](https://modelcontextprotocol.io) 서버로 노출한다.
Claude Desktop 같은 MCP 클라이언트가 가상 매장 5곳의 인수인계 문서를 검색·조회할 수 있다.

- SDK: 공식 MCP Python SDK(`mcp` 2.x, `MCPServer`)
- 전송: **stdio** (Claude Desktop이 프로세스를 직접 띄운다)
- 실행: `npm run agent:mcp` (= `uv run --directory agent python mcp_server.py`, 표준입력을 기다리며 대기 — 직접 띄울 일은 거의 없다)
- 데이터: 가상 코퍼스(`data/virtual/`, 실제 매장·인물과 무관). 검색 인덱스는 임베딩 디스크 캐시로 만들고, 새 질의만 Voyage 임베딩을 호출한다(질의당 수십 토큰). Claude API는 호출하지 않는다

## 노출하는 도구 (모두 읽기 전용, 매장 ID 필수)

| 도구 | 인자 | 돌려주는 것 |
|---|---|---|
| `search_handover` | `store_id`, `query` | 매장 필터 검색 상위 5개: 출처(`S1 · 6. 예외 상황·꿀팁 · 영상 7:10~7:41`), 종류(문서/영상 발언), `needs_check`, 본문 |
| `get_procedure` | `store_id`, `name`(절차 이름) | 문서 "2. 절차" 항목의 단계 내용·영상 구간·`needs_check`. 못 찾으면 그 매장의 절차 이름 목록 |
| `get_current_tasks` | `store_id`, `current_time`(HH:MM, 선택) | 지금 시작한 일(최근 30분)·곧 있을 일(30분 이내). 시각을 안 주면 현재 서울 시각 |

`store_id`: `s1` 달빛커피(카페 마감) · `s2` 보리밭제과(베이커리 마감) · `s3` 한빛마트24(편의점 야간) · `s4` 오름피트니스(헬스장 오픈) · `s5` 동남물류 3센터(상하차 야간)

모든 도구에 MCP `annotations`로 `readOnlyHint: true`, `destructiveHint: false`를 붙인다. `needs_check`가 true인 근거는 `[AI 보완]`·`[확인 필요]` 항목이라, 서버 안내문(instructions)에서 클라이언트에 "[확인 필요]를 붙이고 점장 확인을 권하라"고 지시한다.

## 노출하지 않는 도구 — 쓰기 도구

`log_checklist`(체크리스트 완료 기록), `waste_log` 기록(폐기 대장), `notify_manager`(점장 알림)는 **노출하지 않는다**.

- 이 서비스의 쓰기는 **사용자 확인 단계**(확인 문구를 보여 주고 승인했을 때만 저장, 설계 6-2)를 반드시 거친다. 에이전트 API에서는 LangGraph `interrupt`로 멈췄다가 `/confirm`으로 승인·거절한다
- MCP 클라이언트에는 이 확인 단계가 없다. 쓰기 도구를 노출하면 클라이언트 모델이 판단만으로 기록·알림을 실행할 수 있어 설계 1-2의 "확인 없는 쓰기 금지"를 보장할 수 없다
- 그래서 기록이 필요하면 "인수인계 앱에서 확인 단계를 거쳐 기록하라"고 안내하도록 도구 설명과 서버 안내문에 적었다. 테스트(`agent/tests/test_mcp_server.py`)가 쓰기 도구가 목록에 없고 호출하면 `Unknown tool`로 실패하는지 확인한다

## Claude Desktop 연결 (이 PC 기준)

1. Claude Desktop → **설정 → 개발자 → 구성 편집**(Edit Config)으로 `claude_desktop_config.json`을 연다.
   이 PC의 Claude Desktop은 Microsoft Store(MSIX) 설치라 파일 위치는
   `C:\Users\이성민\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` 이다(일반 설치는 `%APPDATA%\Claude\`).
2. `mcpServers`에 아래 항목을 추가한다. 이미 다른 서버가 있으면 `"handover-agent": {...}` 항목만 합친다.

```json
{
  "mcpServers": {
    "handover-agent": {
      "command": "C:\\Users\\이성민\\AppData\\Roaming\\Python\\Python312\\Scripts\\uv.exe",
      "args": [
        "run",
        "--directory",
        "C:\\project_2026\\Handover_helper\\agent",
        "python",
        "mcp_server.py"
      ]
    }
  }
}
```

- `uv.exe` 경로는 이 PC에서 확인한 위치다(`PATH`에 없어 절대경로로 적는다). 키는 저장소 루트 `.env`의 `VOYAGE_API_KEY`를 서버가 직접 읽으므로 설정 파일에 넣지 않는다
- 사용자 폴더 이름에 한글이 있어 경로 문제가 생기면, `uv.exe`를 영문 경로(예: `C:\tools\uv.exe`)로 복사하고 `command`를 바꾼다

3. Claude Desktop을 **완전히 종료**(트레이 아이콘 → 종료)한 뒤 다시 연다.

## 연결 확인

- 설정 → 개발자에서 `handover-agent`가 **running**으로 보이는지 확인한다
- 대화 입력창의 도구(검색 및 도구) 메뉴에 `search_handover`·`get_procedure`·`get_current_tasks` 3개만 보이는지 확인한다(쓰기 도구는 없어야 정상)
- 실패하면 로그를 본다: `…\LocalCache\Roaming\Claude\logs\mcp-server-handover-agent.log` (MSIX 설치) — 표준에러에 찍힌 파이썬 오류가 여기 남는다
- Claude Desktop 없이 확인: `npm run agent:test -- -k mcp` (MCP 클라이언트로 stdio에 붙어 도구 목록·호출 결과를 검사)

## 데모용 질문 (가상 매장 기준)

1. **"달빛커피(s1)에서 마감 정산은 어떻게 해? 돈이 안 맞으면 어디에 알려야 해?"**
   → `get_procedure`(마감 정산) + `search_handover`. 기대: 포스 '마감정산' 버튼 → 현금은 금고 흰 봉투 → 차액 1,000원 이상이면 매장 단톡방, 출처(영상 6:48~7:41)와 함께
2. **"한빛마트24(s3)에서 지금 새벽 2시 5분이야. 지금 뭐 해야 하고 곧 할 일은 뭐야?"**
   → `get_current_tasks`(s3, 02:05). 기대: 지금 02:00 음료 입고·검수, 30분 안에 다가오는 일 없음
3. **"오름피트니스(s4) 러닝머신 벨트가 미끄러져. 어떻게 처리해? 점장님께 알림도 보내 줘."**
   → `search_handover`. 기대: 점검중 팻말 → 사진 → 직원 단톡방 순서를 안내하고, **알림은 이 서버로 보낼 수 없으니 앱의 확인 단계에서 보내라**고 답함(쓰기 도구 미노출 확인용)
