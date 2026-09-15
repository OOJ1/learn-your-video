import { useCallback, useEffect, useRef, useState } from "react";
import { GraduationCap, RefreshCw, AlertTriangle, Sparkles, Power } from "lucide-react";
import { api, pointsToMarkers, type Doc, type DocType } from "./lib/api";
import { Button, Tabs } from "./components/ui";
import { UploadZone } from "./components/UploadZone";
import { DocList } from "./components/DocList";
import { SummaryHeadline, SummaryPanel, SummaryTags } from "./components/SummaryPanel";
import { ChatPanel } from "./components/ChatPanel";
import { GrabberPanel } from "./components/GrabberPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { VideoPlayer, type VideoPlayerHandle } from "./components/VideoPlayer";

const BUSY = ["uploaded", "parsing", "transcribing", "embedding", "summarizing"];

export default function App({ onShowIntro }: { onShowIntro?: () => void }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tab, setTab] = useState<"all" | DocType>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [module, setModule] = useState<"study" | "grabber">("study");
  const playerRef = useRef<VideoPlayerHandle>(null);
  const playerBoxRef = useRef<HTMLDivElement>(null);
  /** 连接失败自动重试计数（成功后归零），避免"启动后列表是空的、得手动点刷新" */
  const retryRef = useRef(0);
  /** 停止服务状态：idle 正常 / stopping 点击后等待 / stopped 已停止 */
  const [stopState, setStopState] = useState<"idle" | "stopping" | "stopped">("idle");

  const load = useCallback(async () => {
    try {
      const [a, v] = await Promise.all([api.list("article"), api.list("video")]);
      const merged = [...(a.items || []), ...(v.items || [])].sort(
        (x, y) => y.created_at - x.created_at
      );
      setDocs(merged);
      setErr("");
      retryRef.current = 0;
    } catch (e: any) {
      setErr(`无法连接后端（${api.base || "同源"}）：${e?.message || e}`);
      // 刚启动时后端可能还没就绪：指数退避自动重试，最多 6 次（约 20 秒）
      if (retryRef.current < 6) {
        const delay = Math.min(8000, 500 * Math.pow(1.8, retryRef.current));
        retryRef.current += 1;
        window.setTimeout(load, delay);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 有任务在处理中时轮询刷新
  useEffect(() => {
    const hasBusy = docs.some((d) => BUSY.includes(d.status));
    if (!hasBusy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [docs, load]);

  const selected = docs.find((d) => d.id === selectedId) || null;
  const visible = tab === "all" ? docs : docs.filter((d) => d.type === tab);

  const onSelect = async (d: Doc) => {
    setSelectedId(d.id);
    try {
      const r = await api.get(d.type, d.id);
      setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...r.doc } : x)));
    } catch {
      /* 详情拉取失败不影响选中 */
    }
  };

  const onDelete = async (d: Doc) => {
    if (!confirm(`确定删除「${d.filename}」？相关向量与字幕也会一并清除。`)) return;
    try {
      await api.remove(d.type, d.id);
      if (selectedId === d.id) setSelectedId(null);
      await load();
    } catch (e: any) {
      alert(e?.message || "删除失败");
    }
  };

  // 处理失败 → 重跑完整流水线（解析/转写 + 向量化 + 摘要）
  const onRetry = async (d: Doc) => {
    try {
      await api.retry(d.type, d.id);
      await load();
    } catch (e: any) {
      alert(e?.message || "重试失败");
    }
  };

  // 已完成 → 只重跑摘要与评分，复用已有转写/解析结果
  const onResummarize = async (d: Doc) => {
    try {
      await api.resummarize(d.type, d.id);
      await load();
    } catch (e: any) {
      alert(e?.message || "重新生成失败");
    }
  };

  const seek = (sec: number) => {
    playerRef.current?.seek(sec);
    playerBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // 停止整个服务（后端 + 前端）：先确认，再请求后端自杀
  const onStop = async () => {
    if (stopState !== "idle") return;
    if (
      !confirm(
        "确定停止「你的学习搭子」吗？\n后端与前端服务都会关闭，需要重新启动才能继续使用。"
      )
    ) {
      return;
    }
    setStopState("stopping");
    try {
      await api.stop();
    } catch {
      /* 即便没拿到 200（后端可能已提前挂掉），停止通常也已触发 */
    }
    setStopState("stopped");
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-white/50 bg-white/45 px-4 py-2.5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
        <GraduationCap className="h-5 w-5" />
        {/* 两个模块标题，点击来回切换 */}
        <button
          onClick={() => setModule("study")}
          className={`flex items-baseline gap-2 rounded px-1.5 py-0.5 transition-colors ${
            module === "study" ? "bg-white/60" : "hover:bg-white/50"
          }`}
          title="切回上传 · 总结 · 问答"
        >
          <span className={`text-sm font-semibold ${module === "study" ? "" : "text-muted-foreground"}`}>
            你的学习搭子
          </span>
          <span className="text-[11px] text-muted-foreground">上传 · 总结 · 问答</span>
        </button>

        <span className="text-white/40">|</span>

        <button
          onClick={() => setModule("grabber")}
          className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
            module === "grabber" ? "bg-white/60 font-medium" : "text-muted-foreground hover:bg-white/50"
          }`}
          title="把网上视频下载到本地"
        >
          无法有效下载视频？点我试试！
        </button>

        {/* 重新打开产品介绍页（滚动叙事） */}
        {onShowIntro && (
          <button
            onClick={onShowIntro}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/50"
            title="重新看看「你的学习搭子」能做什么"
          >
            <Sparkles className="h-3 w-3" />
            介绍一下自己
          </button>
        )}

        <div className="flex-1" />
        {err && (
          <button
            onClick={() => {
              retryRef.current = 0;
              load();
            }}
            title="点击立即重试"
            className="flex max-w-[46%] items-center gap-1 truncate rounded border border-red-300/60 bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-600 transition-colors hover:bg-red-500/20"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{err}</span>
            <RefreshCw className="h-3 w-3 shrink-0" />
          </button>
        )}
        <SettingsDialog />
        {stopState === "idle" && (
          <Button size="sm" variant="destructive" onClick={onStop} title="停止并关闭所有服务">
            <Power className="h-3.5 w-3.5" />
            停止
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={load} title="刷新">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </header>

      {module === "grabber" ? (
        <GrabberPanel
          onImported={(d) => {
            setModule("study");
            setSelectedId(d.id);
            load();
          }}
        />
      ) : (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-white/50 bg-white/35 backdrop-blur-xl">
          <div className="border-b p-3">
            <UploadZone
              onUploaded={(d) => {
                load();
                setSelectedId(d.id);
              }}
            />
          </div>
          <div className="px-3 pt-3">
            <Tabs
              value={tab}
              onChange={(v) => setTab(v as any)}
              tabs={[
                { value: "all", label: `全部 ${docs.length}` },
                { value: "article", label: "文章" },
                { value: "video", label: "视频" },
              ]}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <DocList
              docs={visible}
              selectedId={selectedId}
              onSelect={onSelect}
              onDelete={onDelete}
              onRetry={onRetry}
            />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              选择左侧文件，或上传一个新文件开始
            </div>
          ) : (
            <>
              {/* 左侧摘要列 + 右侧问答列；两列之间用边界线区分 */}
              <div className="grid min-h-0 flex-1 grid-cols-4">
                {/* 左：摘要列（顶部文件名条仅限本列，不再延伸到右侧问答） */}
                <div className="col-span-3 flex min-h-0 flex-col">
                  <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/60 bg-white/40 px-4 backdrop-blur">
                    <span className="truncate text-sm font-medium">{selected.filename}</span>
                    <span className="rounded border border-white/50 bg-white/50 px-1.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur">
                      {selected.type === "video" ? "视频" : "文章"}
                    </span>
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    <SummaryHeadline
                      doc={selected}
                      onRetry={onRetry}
                      onResummarize={onResummarize}
                    />

                    {/* 主题标签：紧跟在「一句话标题」下方 */}
                    <SummaryTags doc={selected} />

                    {selected.type === "video" && selected.status === "ready" && (
                      <div ref={playerBoxRef}>
                        <VideoPlayer
                          key={selected.id}
                          ref={playerRef}
                          src={api.videoUrl(selected.id)}
                          markers={pointsToMarkers(selected.summary)}
                        />
                      </div>
                    )}

                    <SummaryPanel
                      key={selected.id}
                      doc={selected}
                      onSeek={selected.type === "video" ? seek : undefined}
                    />
                  </div>
                </div>

                {/* 右：问答列（自带顶部「问答」条，与左侧以边界线区分） */}
                <div className="min-h-0">
                  <ChatPanel
                    key={selected.id}
                    doc={selected}
                    onSeek={selected.type === "video" ? seek : undefined}
                  />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      )}

      {/* 停止服务的全屏遮罩：点击「停止」后，后端会杀掉自己与前端的进程，
          页面随后会失联，这里给出明确的「已停止」反馈 */}
      {stopState !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-md">
          <div className="mx-4 max-w-sm rounded-2xl border border-white/60 bg-white/85 px-8 py-7 text-center shadow-xl">
            {stopState === "stopping" ? (
              <>
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                <p className="text-sm font-medium text-foreground">正在停止服务…</p>
              </>
            ) : (
              <>
                <div className="mb-2 text-3xl">✅</div>
                <p className="text-sm font-semibold text-foreground">服务已停止</p>
                <p className="mt-2 text-xs text-muted-foreground">可以关闭此页面了。</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  需要再次使用请双击桌面「学习搭子」启动。
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
