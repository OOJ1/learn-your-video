import { useEffect, useState } from "react";
import {
  Download as DownloadIcon,
  Link2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  History,
  Trash2,
} from "lucide-react";
import { api, type Doc } from "../lib/api";
import { Button, Input } from "./ui";
import { fmtBytes, fmtTime } from "../lib/utils";

type Job = {
  id: string;
  status: string;
  progress: number;
  message: string;
  filename: string;
  title?: string;
  size: number;
  duration: number;
  error?: string;
};

/** 文件名形如 {job_id}_{标题}.mp4，展示时把 job_id 前缀去掉 */
const displayName = (j: Job) => {
  const n = j.filename || j.title || "视频";
  return n.startsWith(`${j.id}_`) ? n.slice(j.id.length + 1) : n;
};

/** 视频抓取模块：把网上视频下载到本地（自动转成可直接播放的格式） */
export function GrabberPanel({ onImported }: { onImported?: (d: Doc) => void }) {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState(720);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState<Job[]>([]);
  const [busyId, setBusyId] = useState("");

  const loadHistory = async () => {
    try {
      const r = await api.grabJobs();
      setHistory((r.items || []) as Job[]);
    } catch {
      // 历史列表失败不影响下载主流程，静默忽略
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const start = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setErr("");
    setJob(null);
    try {
      const r = await api.grabDownload(url.trim(), quality);
      await poll(r.job_id);
    } catch (e: any) {
      setErr(e?.message || "下载失败");
    } finally {
      setBusy(false);
      await loadHistory();
    }
  };

  const poll = async (jobId: string) => {
    for (let i = 0; i < 600; i++) {
      const r = await api.grabJob(jobId);
      const j = r.job as Job;
      setJob(j);
      if (j.status === "done" || j.status === "failed") return;
      await new Promise((res) => setTimeout(res, 1500));
    }
    setErr("下载超时，请重试");
  };

  const importToLib = async () => {
    if (!job) return;
    setImporting(true);
    setErr("");
    try {
      const r = await api.grabImport(job.id);
      onImported?.(r.doc);
    } catch (e: any) {
      setErr(e?.message || "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const importHistory = async (jobId: string) => {
    setBusyId(jobId);
    setErr("");
    try {
      const r = await api.grabImport(jobId);
      onImported?.(r.doc);
      await loadHistory();
    } catch (e: any) {
      setErr(e?.message || "导入失败");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (j: Job) => {
    const name = displayName(j);
    const ok = window.confirm(
      `删除「${name}」？\n\n会同时删除已下载的视频文件（${j.size ? fmtBytes(j.size) : "未知大小"}）。\n` +
        `已导入知识库的副本不受影响。`
    );
    if (!ok) return;
    setBusyId(j.id);
    setErr("");
    try {
      await api.grabDelete(j.id);
      await loadHistory();
    } catch (e: any) {
      setErr(e?.message || "删除失败");
    } finally {
      setBusyId("");
    }
  };

  // 当前这次下载单独用进度卡片展示，历史列表里就不重复出现了
  const others = history.filter((j) => j.id !== job?.id);
  const totalBytes = others.reduce((s, j) => s + (j.size || 0), 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        {/* 傻瓜式操作说明 */}
        <div className="rounded-2xl border border-white/60 bg-white/45 p-4 backdrop-blur shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.65)]">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4" />
            三步把网上视频存到本地
          </p>
          <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-slate-800 to-slate-900 text-[10px] text-primary-foreground">
                1
              </span>
              <span>
                在 B 站 / YouTube 等网站打开想保存的视频，复制浏览器地址栏的<b>完整链接</b>
                （也支持手机 App 里「分享 → 复制链接」得到的那种）。
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-slate-800 to-slate-900 text-[10px] text-primary-foreground">
                2
              </span>
              <span>把链接粘到下面的输入框，选清晰度，点「开始下载」。</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-slate-800 to-slate-900 text-[10px] text-primary-foreground">
                3
              </span>
              <span>
                下载完成后可以<b>保存到本地</b>，或<b>一键导入知识库</b>直接做转写总结
                （系统会自动转成双击就能播放的格式，不用再装播放器）。
              </span>
            </li>
          </ol>
        </div>

        {/* 输入区 */}
        <div className="space-y-2 rounded-2xl border border-white/60 bg-white/45 p-4 backdrop-blur shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.65)]">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && start()}
              placeholder="粘贴视频链接，例如 https://www.bilibili.com/video/BV..."
              className="h-9 text-xs"
            />
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">清晰度</span>
            {[1080, 720, 480].map((q) => (
              <label key={q} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="quality"
                  checked={quality === q}
                  onChange={() => setQuality(q)}
                />
                {q}P
              </label>
            ))}
            <div className="flex-1" />
            <Button size="sm" onClick={start} disabled={busy || !url.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {busy ? "处理中…" : "开始下载"}
            </Button>
          </div>
        </div>

        {err && (
          <p className="flex items-center gap-1.5 rounded-lg bg-red-500/10 p-3 text-xs text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {err}
          </p>
        )}

        {/* 当前进度 */}
        {job && (
          <div className="space-y-3 rounded-2xl border border-white/60 bg-white/45 p-4 backdrop-blur shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.65)]">
            <div className="flex items-center gap-2 text-xs">
              {job.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : job.status === "failed" ? (
                <AlertTriangle className="h-4 w-4 text-red-600" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <span className="font-medium">{displayName(job)}</span>
              <span className="flex-1" />
              <span className="text-muted-foreground">{job.progress}%</span>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/40">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  job.status === "failed" ? "bg-red-500" : "bg-emerald-500"
                }`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">{job.message}</p>

            {job.status === "done" && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="text-[11px] text-muted-foreground">
                  {job.size ? fmtBytes(job.size) : ""}
                  {job.duration ? ` · ${fmtTime(job.duration)}` : ""}
                </span>
                <div className="flex-1" />
                <a
                  href={api.grabFileUrl(job.id)}
                  className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md border border-white/60 bg-white/50 px-3 text-xs font-medium text-foreground backdrop-blur transition-colors hover:bg-white/70"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  保存到本地
                </a>
                <Button size="sm" onClick={importToLib} disabled={importing}>
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {importing ? "导入中…" : "导入知识库并总结"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 历史下载：下载的文件会一直留在本地，这里可以随时取用或清理 */}
        {others.length > 0 && (
          <div className="rounded-2xl border border-white/60 bg-white/40 backdrop-blur shadow-[0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.6)]">
            <div className="flex items-center gap-1.5 border-b border-white/40 px-4 py-2.5">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">历史下载</span>
              <span className="text-[11px] text-muted-foreground">
                {others.length} 个 · 占用 {fmtBytes(totalBytes)}
              </span>
            </div>
            <div className="divide-y divide-white/40">
              {others.map((j) => (
                <div key={j.id} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{displayName(j)}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {j.status === "done"
                        ? `${fmtBytes(j.size || 0)}${
                            j.duration ? ` · ${fmtTime(j.duration)}` : ""
                          }`
                        : j.message}
                    </p>
                  </div>
                  {j.status === "done" && (
                    <>
                      <a
                        href={api.grabFileUrl(j.id)}
                        title="保存到本地"
                        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/60 bg-white/50 px-2.5 text-xs font-medium text-foreground backdrop-blur transition-colors hover:bg-white/70"
                      >
                        <DownloadIcon className="h-3.5 w-3.5" />
                        保存
                      </a>
                      <Button
                        size="sm"
                        variant="outline"
                        title="导入知识库并总结"
                        onClick={() => importHistory(j.id)}
                        disabled={busyId === j.id}
                      >
                        {busyId === j.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        导入
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    title="删除记录并移除文件"
                    onClick={() => remove(j)}
                    disabled={busyId === j.id}
                    className="text-muted-foreground hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
