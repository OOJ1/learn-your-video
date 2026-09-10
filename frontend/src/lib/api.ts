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

export interface Summary {
  one_liner?: string;
  key_points?: (string | KeyPoint)[];
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

/** 时间轴分段：覆盖全片的逐段总结，t_start/t_end 单位为秒 */
export interface TimelinePart {
  t_start: number;
  t_end: number;
  text: string;
}

export interface Doc {
  id: string;
  filename: string;
  type: DocType;
  timeline?: TimelinePart[];
  status: string;
  progress: number;
  message?: string;
  created_at: number;
  size?: number;
  chars?: number;
  duration?: number;
  chunks?: number;
  segments?: number;
  language?: string;
  hotwords?: string;
  summary?: Summary | null;
  error?: string;
}

export interface Ref {
  index: number;
  kind: "article" | "video" | "web";
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

  exportUrl: (t: DocType, id: string) => `${BASE}/api/${plural(t)}/${id}/export`,
  srtUrl: (id: string) => `${BASE}/api/videos/${id}/srt`,
  videoUrl: (id: string) => `${BASE}/api/videos/${id}/file`,
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
  grabJob: (jobId: string) =>
    req<{ ok: boolean; job: Record<string, any> }>(`/api/grabber/jobs/${jobId}`),
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
