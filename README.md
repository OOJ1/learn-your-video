# 你的学习搭子 · study-buddy

把视频和文章变成**能追问的知识**：上传后自动转写 / 解析、识别画面、生成带时间戳的摘要，并建立本地知识库供问答。

本地优先 —— 模型与向量库都跑在自己的机器上（也可一键切到云端 API），资料不外传。

## 功能

| 能力 | 说明 |
|---|---|
| 视频 | FFmpeg 抽音 → faster-whisper 转写（可注热词，有显卡自动加速）→ 向量化 → 摘要 |
| 文章 | txt / md / pdf 解析后直存；正文超过阈值自动切块向量化，问答走检索 |
| 画面识别 | 抽取关键帧交给视觉模型，识别 PPT / 图表 / 屏幕文字，与字幕一起理解 |
| 时间戳摘要 | 每条要点自带秒数，点击跳回原片位置，进度条同步刻度 |
| 含金量评分 | 信息密度 / 实用性 / 结构清晰度 / 观点独特性 / 时效性 五维评分（视频） |
| 问答 | 基于本地向量检索作答，结论标注来源；资料不足时可智能联网补充 |
| 导出 | 一键导出 Markdown 总结，或下载 SRT 字幕 |

> **文章的向量化是按需触发的**：正文不超过 `ARTICLE_VECTORIZE_MIN_CHARS`（默认 8000 字）时整篇直投给模型，
> 又准又省一次嵌入；超过阈值才切块入库、问答走 Top-K 检索——模型上下文装不下超长正文，直投会被截断、丢掉中间段落。
> 视频则一律向量化（字幕切片 + 画面识别结果），问答时带回时间戳。

## 技术栈

- **后端**：FastAPI + Uvicorn · faster-whisper · ChromaDB · Ollama / 任意 OpenAI 兼容端点
- **前端**：React + Vite + TypeScript + Tailwind CSS
- **存储**：本地文件 + JSON 落盘（装了 Redis 则自动启用）

## 快速开始

完整步骤见 **[QUICKSTART.md](./QUICKSTART.md)**，3 分钟跑起来。最省事的方式：

```powershell
cd study-buddy
.\学习搭子.cmd      # 或直接双击：菜单里选 1 启动
```

启停都收在这一个入口里——菜单可 **启动 / 停止 / 查看状态**，也支持带参数直接执行：
`.\学习搭子.cmd start`（`stop` / `status` 同理，桌面快捷方式与网页右上角的「停止」按钮走的正是这条路径）。
启动会确认页面可用后再打开浏览器；首次进入介绍页还能一键创建带图标的桌面快捷方式。

## 目录结构

```
study-buddy/
├── backend/                  # FastAPI 服务
│   ├── app/
│   │   ├── main.py           # 入口：路由挂载 / 配置 / 停止 / 桌面快捷方式
│   │   ├── config.py         # 配置中心（pydantic-settings）
│   │   ├── core/             # LLM / Embedding / HF 镜像
│   │   ├── services/         # 解析 / 转写 / 向量 / 存储 / 画面识别
│   │   ├── agents/           # 搜索 / 问答
│   │   └── api/              # routes_articles / routes_videos / routes_chat / routes_grabber
│   ├── scripts/              # 环境自检与各类测试脚本
│   ├── .env.example          # 配置模板（.env 不入库）
│   └── requirements.txt
├── frontend/                 # React + Vite 前端
│   ├── src/                  # components / lib / App.tsx
│   └── public/               # 图标与字体
├── 学习搭子.cmd              # 统一启停入口：菜单式（启动 / 停止 / 查看状态）
├── start.ps1 / stop.ps1      # 菜单实际调用的启动、停止脚本
├── logs/                     # 运行日志（不入库）
└── README.md · QUICKSTART.md
```

## 配置

配置集中在 `backend/.env`（模板 `backend/.env.example`），常用项：

```ini
LLM_PROVIDER=ollama                 # ollama / openai
OLLAMA_MODEL=qwen3.5:9b             # 本地模型（想快可换 qwen2.5:7b）

OPENAI_BASE_URL=                    # 云端：任意 OpenAI 兼容端点（DeepSeek / 通义千问 / 智谱 …）
OPENAI_API_KEY=

EMBED_PROVIDER=local                # local / openai
ARTICLE_VECTORIZE_MIN_CHARS=8000    # 文章正文超过这个字数才切块向量化（以内整篇直投）
WHISPER_DEVICE=auto                 # cpu / cuda / auto
TAVILY_API_KEY=                     # 可选，联网搜索
```

改完重启后端生效；也可直接在前端右上角「**设置中心**」里修改（内含千问 API 的接入指引）。

## 已知限制

- **转写是长视频耗时大头**：CPU 约 0.2× 实时；检测到 CUDA 会自动走 GPU（实测约快 6 倍）
- **单进程**：无 Redis 时为内存模式，`--workers > 1` 会造成数据不一致
- **含金量评分**：仅视频提供，且依赖模型主观判断，仅供参考
- **联网搜索**：需自备 Tavily Key（DuckDuckGo 在国内不可达）
