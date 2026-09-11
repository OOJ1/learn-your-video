import { useCallback, useEffect, useRef, useState } from "react";
import { GraduationCap, RefreshCw, AlertTriangle } from "lucide-react";
import { api, pointsToMarkers, type Doc, type DocType } from "./lib/api";
import { Button, Tabs } from "./components/ui";
import { UploadZone } from "./components/UploadZone";
import { DocList } from "./components/DocList";
import { SummaryHeadline, SummaryPanel } from "./components/SummaryPanel";
import { ChatPanel } from "./components/ChatPanel";
import { GrabberPanel } from "./components/GrabberPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { VideoPlayer, type VideoPlayerHandle } from "./components/VideoPlayer";

const BUSY = ["uploaded", "parsing", "transcribing", "embedding", "summarizing"];

export default function App() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tab, setTab] = useState<"all" | DocType>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [module, setModule] = useState<"study" | "grabber">("study");
  const playerRef = useRef<VideoPlayerHandle>(null);
  const playerBoxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [a, v] = await Promise.all([api.list("article"), api.list("video")]);
      const merged = [...(a.items || []), ...(v.items || [])].sort(
        (x, y) => y.created_at - x.created_at
      );
      setDocs(merged);
      setErr("");
    } catch (e: any) {
      setErr(`无法连接后端（${api.base}）：${e?.message || e}`);
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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-white/40 bg-white/40 px-4 py-2.5 backdrop-blur-xl">
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
        <div className="flex-1" />
        {err && (
          <span className="flex items-center gap-1 text-[11px] text-red-600">
            <AlertTriangle className="h-3 w-3" />
            {err}
          </span>
        )}
        <SettingsDialog />
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
        <aside className="flex w-80 shrink-0 flex-col border-r border-white/40 bg-white/30 backdrop-blur-xl">
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
              <div className="flex items-center gap-2 border-b border-white/40 bg-white/30 px-4 py-2 backdrop-blur">
                <span className="truncate text-sm font-medium">{selected.filename}</span>
                <span className="rounded border border-white/50 bg-white/50 px-1.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur">
                  {selected.type === "video" ? "视频" : "文章"}
                </span>
              </div>

              {/* 问答板块占 1/4；左侧自上而下：一句话标题 → 视频窗口 → 时间轴/核心要点 */}
              <div className="grid min-h-0 flex-1 grid-cols-4">
                <div className="col-span-3 min-h-0 space-y-3 overflow-y-auto border-r border-white/40 p-3">
                  <SummaryHeadline
                    doc={selected}
                    onRetry={onRetry}
                    onResummarize={onResummarize}
                  />

                  {selected.type === "video" && selected.status === "ready" && (
                    <div ref={playerBoxRef}>
                      <VideoPlayer
                        ref={playerRef}
                        src={api.videoUrl(selected.id)}
                        markers={pointsToMarkers(selected.summary)}
                      />
                    </div>
                  )}

                  <SummaryPanel
                    doc={selected}
                    onSeek={selected.type === "video" ? seek : undefined}
                  />
                </div>

                <div className="min-h-0">
                  <ChatPanel doc={selected} onSeek={selected.type === "video" ? seek : undefined} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      )}
    </div>
  );
}
