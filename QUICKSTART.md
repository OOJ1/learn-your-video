# 快速开始

> 3 分钟跑起来。完整说明见 [README.md](./README.md)。

## 1. 前置条件（只需一次）

| 组件 | 要求 |
|---|---|
| Python 环境 | 已建好的 venv：`.venv/`（项目根目录） |
| Node.js | ≥ 18（`node -v` 可查） |
| Ollama | 已安装，且已拉取模型 |

```powershell
ollama serve             # 保持运行
ollama pull qwen3.5:9b   # 想更快可换 qwen2.5:7b
```

> 不想用本地模型？把 `backend\.env` 改成 `LLM_PROVIDER=openai`，填好 `OPENAI_BASE_URL` 与 `OPENAI_API_KEY` 即可（DeepSeek / 通义千问等均可）。

## 2. 一键启动

```powershell
cd study-buddy
.\学习搭子.cmd        # 或直接双击：立即启动
```

**双击即启动，不进菜单。** 停止：点网页右上角「停止」，或执行 `.\学习搭子.cmd stop`。

其他用法：`.\学习搭子.cmd status` 看运行状态，`.\学习搭子.cmd menu` 打开交互面板。

**启动**会依次：清理旧实例 → 启动后端（:8000）→ 启动前端（:5173）→ 确认页面可用后自动打开浏览器。
**停止**会释放 8000 / 5173。

> 服务以隐藏窗口后台运行，不再弹 cmd 窗口；日志写入 `logs\`。
> 想看实时日志：`Get-Content .\logs\backend.log -Wait -Tail 50`

### 手动启动（备用）

```powershell
# 终端 1：后端
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir backend

# 终端 2：前端
cd frontend
npx vite --host 127.0.0.1
```

## 3. 开始使用

浏览器打开 **<http://127.0.0.1:5173>**

1. **上传**：左侧拖入文章（txt / md / pdf）或视频（mp4）
2. **等处理**：解析中 →（长文）向量化中 → 摘要生成中 → 已完成（文章十几秒；视频需先转写，更长）
3. **看总结**：视频会额外给出类型识别与含金量评分
4. **问答**：右下聊天框提问，回答带 `[n]` 引用；视频引用可点击跳到对应秒数
5. **导出**：摘要页点「导出 Markdown」，或下载 SRT 字幕
6. **出问题**：卡片上「**重试**」重跑完整流程；只想换摘要点「**重新生成**」，快得多

## 4. 首次使用前：先配置大模型

「学习搭子」依赖大模型完成总结与问答，**本地 Ollama 与云端 API 至少配置其一，否则无法使用**：

- **本地 Ollama**：完成上面的 `ollama serve` + `ollama pull` 即可
- **云端 API**：网页右上角「设置中心」→ 选「云端 API」→ 填 Base URL / API Key / 模型名

以通义千问为例（设置中心里有「?」悬停指引）：

1. 打开 <https://bailian.aliyun.com> 注册 / 登录
2. 控制台 →「API-KEY 管理」→ 创建并复制 `sk-` 开头的密钥
3. Base URL 填 `https://dashscope.aliyuncs.com/compatible-mode/v1`，模型名填 `qwen-plus`
4. 粘贴 Key → 保存

## 5. 可选：联网搜索

不配也能用，只是问答不会联网。DuckDuckGo 在国内不通，需自备 Tavily Key：

1. 打开 <https://tavily.com> 注册（免费 1000 次/月，不用绑卡）
2. Dashboard 复制形如 `tvly-xxx` 的 Key
3. 写入 `backend\.env`：`TAVILY_API_KEY=tvly-你的Key`（纯英文数字，不要带引号）
4. 重启后端生效；`GET http://127.0.0.1:8000/api/config` 中 `has_tavily_key` 应为 `true`

## 6. 环境自检

```powershell
.venv\Scripts\python.exe backend\scripts\check_env.py
```

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| 页面打不开 | 确认前端在运行；地址用 `http://127.0.0.1:5173`（不是 8000） |
| 摘要一直转圈 | Ollama 没启动 → `ollama serve`；或查看 `logs\` 下的日志 |
| 回答为空 / 报错 | 确认模型可用，且 `backend\.env` 中 `OLLAMA_THINK=false` |
| 重启后列表还在 | 正常，数据已 JSON 落盘 |
| 联网回答「资料中未提及」 | 未配置 Tavily Key，属预期降级 |
| 想彻底关掉服务 | 页面右上角点「停止」，或执行 `学习搭子.cmd stop` |
| 文章没建向量索引 | 正常。正文未超过 `ARTICLE_VECTORIZE_MIN_CHARS`（默认 8000 字）时整篇直投给模型，更快也更准 |
