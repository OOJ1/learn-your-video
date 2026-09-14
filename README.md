# 你的学习搭子 · README

个人 AI 知识助手：上传文章或视频，自动提取内容、生成摘要，建立小型本地知识库；带 RAG 问答与联网搜索增强。

> 项目代号 `study-buddy`，路径 `E:\study-buddy`，前后端分离。

## 功能概览

- **文章**：上传 txt / pdf / md → 直接进 Prompt 上下文（**不做向量化**）→ 生成一句话摘要 + 核心要点 → Markdown 导出
- **视频**：上传 mp4 → FFmpeg 抽音 → faster-whisper（**热词注入**）→ 按段落切分 + 时间戳 metadata → ChromaDB 向量化 → 摘要 + RAG + 点击引用跳秒
- **视频通用归纳**：不预设是教学视频，自动识别类型（教程 / 访谈 / 会议 / 评测 / vlog / 新闻 / 娱乐等）后按类型归纳
- **含金量评分**：信息密度 / 实用性 / 结构清晰度 / 观点独特性 / 时效性 五维各 20 分，总分 100，附评语与观看建议
- **问答**：LLM 觉得本地知识不足时自动触发 Tavily / DuckDuckGo 联网，回答带 `[n]` 引用与来源（网页引用可点击跳转）
- **容错重试**：处理失败可「重试」重跑全流程；已完成可「重新生成」只重跑摘要（复用转写，且向量幂等不翻倍）
- **前端**：React + Vite + Tailwind + shadcn 风格，左右分栏，Markdown 渲染，进度条，时间戳跳转

## 当前配置

| 项 | 当前值 | 说明 |
|---|---|---|
| LLM | Ollama `qwen3.5:9b` (本地) | 已修复：走 `/api/chat` + `think=false`，避免 9B 推理模型 token 被思考吃光 |
| Embedding | `BAAI/bge-small-zh-v1.5` (fastembed/ONNX，CPU) | 512 维，中文检索效果优于 MiniLM |
| 向量库 | ChromaDB 持久化在 `backend/data/chroma/` | |
| 缓存 | 内存 + JSON 落盘（Redis 自动降级） | 不装 Redis 也能重启不丢数据 |
| 联网搜索 | Tavily（需 Key）+ DuckDuckGo 兜底 | 当前 DDG 在国内不通，需申请 Tavily Key |
| GPU | 无 | Whisper 走 CPU + int8 |

## 目录结构

```
E:\study-buddy\
├── backend/
│   ├── .env                     # 实际配置（已 git ignore）
│   ├── .env.example             # 配置模板
│   ├── requirements.txt
│   ├── scripts/
│   │   └── check_env.py         # 环境自检（模型/Embedding/Redis/Ollama）
│   ├── data/
│   │   ├── audio/  subs/  store/  chroma/  models/
│   │   ├── test_article.md      # 测试素材
│   │   ├── test_video.mp4
│   │   └── speech.mp3
│   └── app/
│       ├── main.py              # FastAPI 入口
│       ├── config.py            # 配置中心（pydantic-settings）
│       ├── core/                # LLM / Embedding / HF 镜像配置
│       ├── services/            # parsers / article / vector / video / store
│       ├── agents/              # search / qa
│       └── api/                 # routes_articles / routes_videos / routes_chat
├── frontend/
│   ├── vite.config.ts           # 已配 /api 代理到 :8000
│   ├── tailwind.config.js
│   └── src/
│       ├── components/          # UploadZone / DocList / SummaryPanel / ChatPanel / ui
│       ├── lib/                 # api 客户端、工具函数
│       ├── App.tsx              # 左右分栏主页面
│       └── index.css            # Tailwind + 自定义主题
├── start.ps1                    # Windows 一键启动（后台无窗口）
├── stop.ps1                     # 关闭后端 + 前端
├── logs/                        # 后端 + 前端运行日志
├── PROGRESS.md                  # 阶段交付记录
└── README.md
```

## 快速开始

### 1. 启动前置（一次性）

```powershell
# Ollama 服务与模型
ollama serve                      # 另开窗口保持运行
ollama pull qwen3.5:9b            # 或更轻的 qwen2.5:7b

# （可选）Tavily API Key
# 申请：https://tavily.com → 免费 1000 次/月
# 填入 backend\.env  : TAVILY_API_KEY=tvly-xxxxxxxxxxxx
```

### 2. 启动服务

```powershell
cd E:\study-buddy
.\start.ps1          # 后台启动（无黑窗），日志写入 logs\
```

停止：

```powershell
.\stop.ps1
```

> 两个服务以隐藏窗口方式后台运行，不会再弹出 cmd 窗口；
> 再次执行 `start.ps1` 会自动清理占用 8000/5173 的旧实例。

或手动：

```powershell
# 后端
E:\study-buddy\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 前端
cd E:\study-buddy\frontend && npx vite --host 127.0.0.1
```

打开 <http://127.0.0.1:5173>

### 3. 长视频提速（默认已开启，无需安装）

转写是长视频耗时的绝对大头。本机实测（8 分 14 秒音频、`small` 模型）：

| 设备 | 转写耗时 | RTF |
|---|---|---|
| CPU（int8） | 106.1s | 0.214 |
| **GPU（int8_float16）** | **16.9s** | **0.034** |

**默认就是 `WHISPER_DEVICE=auto`，会自动按顺序找 CUDA 12 运行库**：

1. `backend\.env` 里显式配置的 `WHISPER_CUDA_DLL_DIR`；
2. venv 里的 `nvidia-*-cu12` 轮子（`site-packages/nvidia/*/bin`）；
3. **本机 Ollama 自带的 `lib/ollama/cuda_v12`** —— 零下载，本机已实测可用（与 Ollama 同时占用
   显卡也没问题：Ollama 常驻 6.4G 时 Whisper 仍能正常转写）。

三者都找不到才退回 CPU。**加载时会用 1 秒静音做一次真实自检，失败自动退回 CPU** ——
所以缺库不会让转写整个失败（ctranslate2 是「模型能加载、一推理才报错」，不实测会踩坑）。

当前配置下不需要装任何东西。若你不想依赖 Ollama 的库，可自行安装官方运行时：

```powershell
E:\study-buddy\.venv\Scripts\pip install nvidia-cublas-cu12 nvidia-cudnn-cu12 nvidia-cuda-runtime-cu12
```

其它可调项（`backend\.env`）：

```ini
WHISPER_DEVICE=auto          # cpu / cuda / auto
WHISPER_COMPUTE_TYPE=        # 留空 = cuda→int8_float16 / cpu→int8
WHISPER_BEAM_SIZE=5          # CPU 上想再快约 1/3 可设 1（精度略降）
WHISPER_CUDA_DLL_DIR=        # 手动指定 CUDA 运行库目录
```

### 4. 自检

```powershell
E:\study-buddy\.venv\Scripts\python.exe E:\study-buddy\backend\scripts\check_env.py
```

## 切换 LLM Provider

`backend\.env`：
```ini
LLM_PROVIDER=ollama    # 或 openai
```

`openai` 模式兼容任意 OpenAI 协议端点：DeepSeek / 通义千问 / 智谱 / OpenAI / SiliconFlow 等。改 `OPENAI_BASE_URL` + `OPENAI_API_KEY` 即可。

## 已知限制

- **联网搜索**：已配置 Tavily Key（DDG 在国内不通，Tavily 是唯一可达引擎）。问答的「智能联网 / 强制联网」可用，网页引用可点击跳转
- **Ollama 9B CPU**：摘要要 15–30 秒/篇；想快可换 `qwen2.5:7b`（非推理模型）
- **内存兜底**：无 Redis 时为单进程模式；`--workers > 1` 数据会不一致
- **视频转写**：CPU 跑 Whisper `small` 约 1 小时视频 20–40 分钟；GPU 不在路线内
- **含金量评分**：仅视频有（文章未做），且依赖 LLM 主观判断，供参考不盲信

## 测试脚本

```powershell
cd E:\study-buddy\backend
python scripts\check_env.py                    # 环境自检
python scripts\test_video_pipeline.py          # 视频全链路（上传→转写→摘要→评分）
python scripts\test_retry.py <video_doc_id>    # 重试幂等性（chunks 不应翻倍）
python scripts\test_web_mock.py                # 联网链路（用假搜索结果，无需 Key）
python scripts\test_chat_web.py                # 真实联网问答端到端（需 Key + 后端运行中）
```

## 开发路线

- [x] P0 环境与骨架
- [x] P1 LLM / Embedding 抽象层
- [x] P2 文章模块（不上向量）
- [x] P3 视频模块（Whisper 热词 + 时间戳向量）
- [x] P4 RAG 问答 + 联网搜索双引擎
- [x] P5 前端（左右分栏 + Markdown + 进度条）
- [x] P6 联调、文档、启动脚本
- [x] P7 功能增强（通用摘要 / 含金量评分 / 重试 / 搜索指引）

详见 `PROGRESS.md`。