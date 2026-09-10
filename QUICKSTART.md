# 你的学习搭子 · 快速启动

> 3 分钟跑起来。完整说明见 [README.md](./README.md)。

## 一、前置条件（只需一次）

| 组件 | 要求 | 检查方法 |
|---|---|---|
| Python venv | 已建好（`E:\study-buddy\.venv`） | 目录存在即可 |
| Node.js | ≥ 18 | `node -v` |
| Ollama | 已安装且有模型 | `ollama list` 应看到 `qwen3.5:9b` |

首次使用前，启动 Ollama 并确认模型：

```powershell
ollama serve          # 保持窗口运行（或确认它已在后台）
ollama list           # 需有 qwen3.5:9b；没有则 ollama pull qwen3.5:9b
```

> 想更快可换 `qwen2.5:7b`（非推理模型）：`ollama pull qwen2.5:7b`，再改 `backend\.env` 里 `OLLAMA_MODEL=qwen2.5:7b`。

## 二、一键启动（推荐）

```powershell
cd E:\study-buddy
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

脚本会自动：启动后端(:8000) → 启动前端(:5173) → 健康检查。

看到 `Health check: 200` 即成功。

**手动启动（备用）：**

```powershell
# 终端 1：后端
E:\study-buddy\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir E:\study-buddy\backend

# 终端 2：前端
cd E:\study-buddy\frontend
npx vite --host 127.0.0.1
```

**查看后端日志（终端输出）：**

日志随服务启动实时写入文件：

| 服务 | 日志文件 |
|---|---|
| 后端 | `E:\study-buddy\logs\backend.log` |
| 前端 | `E:\study-buddy\logs\frontend.log` |

实时滚动查看（PowerShell，`-Wait` 等价于 Linux `tail -f`）：

```powershell
Get-Content E:\study-buddy\logs\backend.log -Wait -Tail 50
```

也可以直接用 VS Code 打开日志文件。想看"原始终端滚屏"，用手动启动方式即可——输出直接打印在窗口里。

## 三、开始使用

浏览器打开 **<http://127.0.0.1:5173>**

1. **上传**：左侧拖入文章（txt/md/pdf）或视频（mp4）
2. **等处理**：状态从「解析中 → 摘要生成中 → 已完成」。文章约 15–30 秒；视频需先转写，更长
3. **看总结**：视频会额外给出**类型识别**（教程/访谈/会议/评测等）和**含金量评分**
   —— 信息密度 / 实用性 / 结构清晰度 / 观点独特性 / 时效性 各 20 分，总分 100，附评语与观看建议
4. **问答**：右下聊天框提问，回答带 `[n]` 引用；视频引用可点击跳转到对应秒数
5. **导出**：摘要页点「导出 Markdown」
6. **出问题？**
   - 状态「失败」→ 点卡片上的 **重试**，重跑完整流程（解析/转写 + 向量化 + 摘要）
   - 只是想换个摘要 → 点 **重新生成**，复用已有转写只重跑摘要，快得多

## 四、申请 Tavily Key（启用联网搜索）

> 不配也能用，只是问答不会联网。DDG 在国内不通，Tavily 是目前唯一实测可达的引擎。

1. 打开 **<https://tavily.com>**，点右上角 **Sign up**
2. 用 Google / GitHub 账号或邮箱注册（**免费额度 1000 次/月，不用绑信用卡**）
3. 登录后进入 Dashboard，首页即可看到 **API Key**，形如 `tvly-abc123...`，点复制
4. 编辑 `E:\study-buddy\backend\.env`，填入：

   ```ini
   TAVILY_API_KEY=tvly-你的真实Key
   ```

   ⚠️ 必须是**纯英文数字**，不要带引号、空格或中文注释在同一行。

5. **重启后端**生效（或调用 `POST /api/config/reload`）
6. 验证：`GET http://127.0.0.1:8000/api/config` 里 `has_tavily_key` 应为 `true`

之后问答时把「联网」设为 **自动** 或 **开**，LLM 判断本地知识不足时会自动搜索，回答里会带网页引用 `[n]`。

## 五、可选配置（`backend\.env`）

```ini
# 换云端大模型（DeepSeek / 通义 / 智谱等 OpenAI 兼容端点）
LLM_PROVIDER=openai
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_API_KEY=sk-xxxx
```

改完 `.env` 重启后端生效。

## 六、常见问题

| 现象 | 处理 |
|---|---|
| 页面打不开 | 确认前端窗口在跑；用 `http://127.0.0.1:5173` 而非 localhost:8000 |
| 摘要一直转圈 | Ollama 没启动 → `ollama serve`；或看 `E:\study-buddy\logs\backend.err` |
| 回答为空/报错 | `OLLAMA_THINK=false` 未生效？确认 `.env` 存在该项 |
| 重启后列表还在 | 正常，内存存储已 JSON 落盘（`backend/data/store/`） |
| 联网回答"资料中未提及" | 未配 Tavily Key，属预期降级 |
| 环境自检 | `E:\study-buddy\.venv\Scripts\python.exe E:\study-buddy\backend\scripts\check_env.py` |

## 七、关闭服务

直接关闭对应终端窗口，或：

```powershell
# 杀掉后端与前端进程
Get-NetTCPConnection -LocalPort 8000,5173 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```
