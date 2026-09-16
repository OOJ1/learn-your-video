// 默认走同源（Vite dev 代理 / 生产同源部署）；需要直连后端时设 VITE_API_BASE
const BASE = (import.meta as any).env?.VITE_API_BASE || "";

export type DocType = "article" | "video";

export interface ScoreDim {
  label: string;
  score: number; // 0-20
  reason: string;
}

export interface ValueScore {
  dimensions?: Record<string, ScoreDim>;
  total: number; // 0-100
  level: string;
  verdict: string;
  watch_advice: string;
}

/** 带视频时间戳的要点/脉络条目（t 为 null 表示旧数据或无法定位，不可跳转） */
export interface KeyPoint {
  t?: number | null;
  text: string;
}

/** 知识笔记小节：标题 + 若干条知识点 */
export interface NoteSection {
  title: string;
  points: string[];
}

export interface Summary {
  one_liner?: string;
  key_points?: (string | KeyPoint)[];
  /** 画面要点：视频画面中呈现的关键信息（含屏幕文字/图表） */
  visual_points?: (string | KeyPoint)[];
  /** 模型对内容的评价与看法 */
  review?: string;
  /** 知识笔记（替代旧版 outline 内容脉络） */
  notes?: NoteSection[];
  /** @deprecated 旧版字段，仅用于兼容历史数据 */
  outline?: (string | KeyPoint)[];
  tags?: string[];
  reading_minutes?: number;
  video_type?: string;
  value_score?: ValueScore | null;
}

/** 归一化条目：兼容旧版纯字符串 */
export function asPoint(item: string | KeyPoint): KeyPoint {
  return typeof item === "string" ? { t: null, text: item } : item;
}

/** 播放器进度条上的时间戳标记（时间戳直接来自核心要点） */
export interface PlayerMarker {
  t: number;
  text: string;
}

/**
 * 从摘要里抽取可跳转的时间戳标记：核心要点自带起始秒数，直接复用。
 * 旧版记录若没有 key_points，则退回 outline（内容脉络）。
 * 结果按时间升序去重，供进度条打刻度与悬停预览。
 */
export function pointsToMarkers(summary?: Summary | null): PlayerMarker[] {
  const src = summary?.key_points?.length ? summary.key_points : summary?.outline || [];
  const seen = new Set<number>();
  const out: PlayerMarker[] = [];
  for (const item of src) {
    const p = asPoint(item);
    if (p.t == null || !p.text) continue;
    const t = Math.max(0, Math.round(p.t));
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ t, text: p.text });
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface Doc {
  id: string;
  filename: string;
  type: DocType;
  status: string;
  progress: number;
  message?: string;
  created_at: number;
  size?: number;
  chars?: number;
  duration?: number;
  chunks?: number;
  /** 文章：正文超过阈值、已切块写入向量库（问答走检索而不是整篇直投） */
  vectorized?: boolean;
  segments?: number;
  language?: string;
  hotwords?: string;
  summary?: Summary | null;
  /** 画面识别：按时间排序的画面描述（屏幕上呈现的内容） */
  visual_timeline?: { t: number; text: string }[];
  /** 画面识别抽出的关键帧，file 用于 /frames/{file} 缩略图 */
  frames?: { t: number; file: string }[];
  error?: string;
}

export interface Ref {
  index: number;
  kind: "article" | "video" | "visual" | "web";
  label: string;
  doc_id?: string | null;
  start?: number | null;
  end?: number | null;
  url?: string | null;
  snippet?: string;
  cited?: boolean;
}

export interface ChatResp {
  ok: boolean;
  answer: string;
  refs: Ref[];
  used_web?: boolean;
  engine?: string | null;
  reason?: string;
  search_error?: string;
  /** 本地资料与问题相关度普遍偏低（阈值未命中后回退最近邻） */
  low_relevance?: boolean;
  error?: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

const plural = (t: DocType) => (t === "article" ? "articles" : "videos");

export const api = {
  base: BASE,
  diagnose: () => req<Record<string, any>>("/api/diagnose"),

  // ---------- 停止整个服务（后端 + 前端） ----------
  stop: () => req<{ ok: boolean; message?: string }>("/api/stop", { method: "POST" }),

  list: (t: DocType) => req<{ items: Doc[] }>(`/api/${plural(t)}`),
  get: (t: DocType, id: string) => req<{ doc: Doc }>(`/api/${plural(t)}/${id}`),
  status: (t: DocType, id: string) =>
    req<{ status: string; progress: number; message: string; ready: boolean }>(
      `/api/${plural(t)}/${id}/status`
    ),

  upload: async (t: DocType, file: File, hotwords?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (t === "video" && hotwords) fd.append("hotwords", hotwords);
    return req<{ doc: Doc }>(`/api/${plural(t)}/upload`, { method: "POST", body: fd });
  },

  remove: (t: DocType, id: string) =>
    req<{ ok: boolean }>(`/api/${plural(t)}/${id}`, { method: "DELETE" }),

  // 处理失败后重跑完整流水线
  retry: (t: DocType, id: string) =>
    req<{ ok: boolean; message?: string }>(`/api/${plural(t)}/${id}/retry`, { method: "POST" }),
  // 只重跑摘要与评分，复用已有转写/解析结果
  resummarize: (t: DocType, id: string) =>
    req<{ ok: boolean; message?: string }>(`/api/${plural(t)}/${id}/resummarize`, { method: "POST" }),

  // ---------- 设置中心 ----------
  config: () => req<Record<string, any>>("/api/config"),
  saveConfig: (patch: Record<string, string>) =>
    req<{ ok: boolean; saved: string[]; ignored: string[] }>("/api/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch }),
    }),

  // ---------- 桌面快捷方式 ----------
  shortcutStatus: () =>
    req<{ ok: boolean; supported: boolean; exists: boolean }>("/api/shortcut/status"),
  createShortcut: () =>
    req<{ ok: boolean; existed?: boolean; path?: string; message: string }>(
      "/api/shortcut/create",
      { method: "POST" }
    ),

  exportUrl: (t: DocType, id: string) => `${BASE}/api/${plural(t)}/${id}/export`,
  srtUrl: (id: string) => `${BASE}/api/videos/${id}/srt`,
  videoUrl: (id: string) => `${BASE}/api/videos/${id}/file`,
  frameUrl: (id: string, file: string) => `${BASE}/api/videos/${id}/frames/${file}`,
  subtitles: (id: string) =>
    req<{ segments: { start: number; end: number; text: string }[] }>(
      `/api/videos/${id}/subtitles`
    ),

  chat: (docId: string, question: string, useWeb: "auto" | "on" | "off" = "auto") =>
    req<ChatResp>("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId, question, use_web: useWeb }),
    }),

  // ---------- 视频抓取（下载到本地 / 导入知识库） ----------
  grabPreview: (url: string) =>
    req<{ ok: boolean; title: string; duration: number; uploader: string; thumbnail: string }>(
      "/api/grabber/preview",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }
    ),
  grabDownload: (url: string, max_height: number) =>
    req<{ ok: boolean; job_id: string }>("/api/grabber/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, max_height }),
    }),
  grabJobs: () =>
    req<{ ok: boolean; items: Record<string, any>[] }>("/api/grabber/jobs"),
  grabJob: (jobId: string) =>
    req<{ ok: boolean; job: Record<string, any> }>(`/api/grabber/jobs/${jobId}`),
  grabDelete: (jobId: string) =>
    req<{ ok: boolean; removed: number }>(`/api/grabber/jobs/${jobId}`, {
      method: "DELETE",
    }),
  grabFileUrl: (jobId: string) => `${BASE}/api/grabber/jobs/${jobId}/file`,
  grabImport: (jobId: string, hotwords = "") =>
    req<{ ok: boolean; doc: Doc }>(`/api/grabber/jobs/${jobId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotwords }),
    }),

  history: (docId: string) => req<{ items: any[] }>(`/api/chat/${docId}/history`),
  clearHistory: (docId: string) =>
    req<{ ok: boolean }>(`/api/chat/${docId}/history`, { method: "DELETE" }),
};

export function guessType(filename: string): DocType | null {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (["mp4", "mov", "mkv", "avi", "webm", "m4v", "flv"].includes(ext)) return "video";
  if (["txt", "md", "markdown", "pdf"].includes(ext)) return "article";
  return null;
}
