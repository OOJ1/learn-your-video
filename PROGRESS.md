# PROGRESS.md · 你的学习搭子

阶段性交付记录。P0–P6 详见 git 历史与 README，本文重点记录 P7 功能增强。

---

## P7 功能增强 — ✅ 完成（2026-09-10）

用户提出 4 项需求：**视频摘要通用化 / 含金量评分 / 重试与重新生成 / 联网搜索可用**。

### 1. 视频摘要通用化

`backend/app/services/video.py` 的 `VIDEO_SUMMARY_TEMPLATE` 原为「请生成**学习**总结」，仅适配教学视频。

改为：先判断视频类型（知识教程 / 访谈对话 / 会议记录 / 产品评测 / vlog / 新闻评论 / 娱乐综艺 / 其他），再按该类型特点归纳。输出新增 `video_type` 字段。

前端标题动态显示为「{类型} · 内容总结」。

### 2. 视频含金量评分（多维度）

| 维度 | 说明 | 分值 |
|---|---|---|
| `info_density` | 信息密度：单位时间有效信息量，水词多则低分 | 0–20 |
| `practicality` | 实用性：能否指导行动 / 解决问题 | 0–20 |
| `structure` | 结构清晰度：逻辑分明、有铺垫有结论 | 0–20 |
| `uniqueness` | 观点独特性：独到见解或一手经验 | 0–20 |
| `timeliness` | 时效性：是否随时间失效 | 0–20 |

总分 = 五维之和（0–100），附 `verdict` 评语与 `watch_advice` 观看建议。

**容错设计**（`_normalize_score`）：维度缺失补 0、越界 clamp、兼容 `{"score":x,"reason":""}` 与纯数字两种写法。

前端 `SummaryPanel.tsx` 新增 `ScoreCard` 组件：大号总分 + 档位标签 + 五维进度条 + 评语 + 建议。

> 实测：15 秒 RAG 讲解视频得 **70 分「含金量较高」**，评语「概念清晰但过于简略，适合作为入门引子」，建议「可倍速」—— 判断准确。

### 3. 重试 / 重新生成

| 接口 | 行为 |
|---|---|
| `POST /api/articles/{id}/retry` | 重跑完整流水线（解析 + 摘要） |
| `POST /api/videos/{id}/retry` | 重跑完整流水线（转写 + 向量化 + 摘要） |
| `POST /api/articles/{id}/resummarize` | 只重跑摘要 |
| `POST /api/videos/{id}/resummarize` | 只重跑摘要与评分，复用已有转写 |

**幂等性**：`process_video()` 开头先 `delete_doc(doc_id)` 清旧向量，否则重试会导致 ChromaDB 向量块翻倍。

前端：`DocList` 失败态显示琥珀色「重试」按钮；`SummaryPanel` 增加「重新生成」按钮。

> 实测：resummarize 15s、retry 20s，`chunks` 始终为 1 未翻倍 ✅

### 4. 联网搜索（Tavily）

代码早已实现 Tavily + DuckDuckGo 双引擎，但 DDG 在国内不可达、Tavily 无 Key，实际处于不可用状态。

用户选择自行申请 Key。申请指引已写入 `QUICKSTART.md` 第四节（tavily.com 注册 → Dashboard 复制 Key → 填 `.env` → 重启 → 验证 `has_tavily_key`）。免费 1000 次/月，无需绑卡。

### 验证结果

| 项 | 结果 |
|---|---|
| 前端 `npm run build` | ✅ tsc 无错，404.67 kB / gzip 125.56 kB |
| 后端 OpenAPI 路径 | ✅ 26 个，4 个新端点全部注册 |
| 视频全链路 | ✅ 转写 → 向量化 → 摘要 + 评分，30 秒 |
| 幂等性 | ✅ retry 后 chunks 未翻倍 |

---

## 踩坑记录（本轮）

1. **新版 FastAPI 路由懒加载**：`include_router` 不再立即展开路由，只塞入 `_IncludedRouter` 代理，遍历 `app.routes` 看不到真实路径。**验证路由必须用 `app.openapi()["paths"]`**。我因此误判"路由没注册"，浪费数轮排查。
2. **诊断脚本存放位置**：脚本放在项目根目录时，Python 把脚本目录（而非 cwd）加入 `sys.path[0]`，导致 `import app` 失败。诊断 backend 的脚本须放在 `backend/` 下。
3. **`import x as a` vs `from x import router as a`**：前者 `a` 是模块（`a.router.routes`），后者 `a` 是 router 对象（`a.routes`）。

---

## 历史阶段

- **P0** 环境与骨架 ✅ · **P1** LLM/Embedding 抽象 ✅ · **P2** 文章模块 ✅ · **P3** 视频模块 ✅ · **P4** RAG + 双引擎搜索 ✅ · **P5** 前端 ✅ · **P6** 联调与文档 ✅ · **P7** 功能增强 ✅
