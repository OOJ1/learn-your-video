import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Loader2, Globe, Link2, Play, BookOpen, AlertTriangle, Eye, Lock } from "lucide-react";
import { api, type Doc, type Ref } from "../lib/api";
import { Button, Textarea, HoverTip } from "./ui";
import { cn, fmtTime } from "../lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  refs?: Ref[];
  error?: boolean;
  /** 本次回答是否真的联网了（后端 meta） */
  usedWeb?: boolean;
  engine?: string | null;
  /** 未联网时的原因，如「资料已足够」「联网搜索已关闭」 */
  reason?: string;
  searchError?: string;
  /** 本地资料相关度偏低，回答仅供参考 */
  lowRelevance?: boolean;
}

export function ChatPanel({
  doc,
  onSeek,
  configVersion = 0,
}: {
  doc: Doc;
  onSeek?: (sec: number) => void;
  /** 设置中心每保存一次自增：用于重新拉配置，让联网开关的锁死状态即时更新 */
  configVersion?: number;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [useWeb, setUseWeb] = useState<"auto" | "on" | "off">("auto");
  /** 联网可用性与不可用原因（后端 /api/config 唯一判定）；null = 尚未拉取 */
  const [webStatus, setWebStatus] = useState<{ available: boolean; reason: string } | null>(null);
  const webLocked = webStatus ? !webStatus.available : false;
  const webReason = webStatus?.reason || "联网功能当前不可用，请到右上角设置中心检查";
  /** 历史问答载入中：避免切换视频时短暂显示上一个视频的问答记录 */
  const [histLoading, setHistLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 联网开关由后端判定：设置里关了联网、或没配 API Key，两档联网按钮都锁死，只能「仅本地」
  useEffect(() => {
    api
      .config()
      .then((c: any) => {
        // 老版本后端可能没有 web_search_available 字段，按旧规则兜底推导
        const available: boolean =
          typeof c?.web_search_available === "boolean"
            ? c.web_search_available
            : (c?.search_provider || "off").toLowerCase() !== "off" && !!c?.has_tavily_key;
        setWebStatus({
          available,
          reason:
            c?.web_search_reason ||
            (available ? "" : "联网功能当前不可用，请到右上角设置中心检查"),
        });
        // 已经选了联网、但当前不可用 → 回落到「仅本地」，避免发出一次注定不联网的请求
        if (!available) setUseWeb("off");
      })
      .catch(() => {});
  }, [configVersion]);

  useEffect(() => {
    let alive = true;
    setHistLoading(true);
    setMsgs([]); // 先清空，防止旧文档的问答残留在新文档下
    api
      .history(doc.id)
      .then((r) => {
        if (!alive) return;
        setMsgs(
          (r.items || []).map((m: any) => ({
            role: m.role,
            content: m.content,
            refs: m.refs,
          }))
        );
      })
      .catch(() => {
        if (alive) setMsgs([]);
      })
      .finally(() => {
        if (alive) setHistLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [doc.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async () => {
    const text = q.trim();
    if (!text || busy) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const r = await api.chat(doc.id, text, useWeb);
      if (!r.ok && r.error) {
        setMsgs((m) => [...m, { role: "assistant", content: r.error!, error: true }]);
      } else {
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            content: r.answer || "（无回答）",
            refs: r.refs,
            usedWeb: r.used_web,
            engine: r.engine,
            reason: r.reason,
            searchError: r.search_error,
            lowRelevance: r.low_relevance,
          },
        ]);
      }
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `请求失败：${e?.message || e}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 右侧问答列宽度只有 ~290px，标题 + 三档开关 + 状态提示挤在一行会把文字压成两行，
          所以拆成两行：第一行「问答 + 联网状态」，第二行放三档开关 */}
      <div className="shrink-0 border-b border-white/60 bg-white/40 px-3 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">问答</span>
          {webLocked && (
            <HoverTip content={webReason}>
              <span className="flex cursor-help items-center gap-1 whitespace-nowrap rounded bg-slate-500/10 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Lock className="h-2.5 w-2.5 shrink-0" />
                联网不可用
              </span>
            </HoverTip>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {(["auto", "on", "off"] as const).map((v) => {
            // 联网不可用时，「智能联网」「强制联网」全部锁死，只留「仅本地」
            const locked = webLocked && v !== "off";
            const label = v === "auto" ? "智能联网" : v === "on" ? "强制联网" : "仅本地";
            const btn = (
              <button
                onClick={() => !locked && setUseWeb(v)}
                aria-disabled={locked}
                title={locked ? webReason : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-2 py-0.5 text-[11px] transition-colors",
                  locked
                    ? "cursor-not-allowed text-muted-foreground/45 line-through"
                    : useWeb === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-white/50"
                )}
              >
                {locked && <Lock className="h-2.5 w-2.5 shrink-0" />}
                {label}
              </button>
            );
            return locked ? (
              <HoverTip key={v} content={webReason}>
                {btn}
              </HoverTip>
            ) : (
              <span key={v} className="inline-flex">
                {btn}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {histLoading && (
          <p className="flex items-center justify-center gap-1.5 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            载入问答历史…
          </p>
        )}

        {!histLoading && !msgs.length && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            基于「{doc.filename}」提问，回答会标注引用来源
          </p>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2",
                  m.role === "user"
                  ? "bg-gradient-to-b from-slate-800 to-slate-900 text-primary-foreground shadow-[0_2px_8px_rgba(15,23,42,0.24)]"
                  : m.error
                  ? "bg-red-500/10 text-red-700"
                  : "border border-white/70 bg-white/55 backdrop-blur shadow-[0_1px_2px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.7)]"
              )}
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap text-sm">{m.content}</p>
              ) : (
                <div className="md-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              )}

              {!!m.refs?.length && <RefList refs={m.refs} onSeek={onSeek} />}

              {m.role === "assistant" && !m.error && (m.usedWeb || m.searchError || m.reason || m.lowRelevance) && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                  {m.usedWeb ? (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">
                      <Globe className="h-3 w-3" />
                      已联网检索（{m.engine}）
                    </span>
                  ) : m.searchError ? (
                    <span className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700">
                      <Globe className="h-3 w-3" />
                      联网失败，仅依据本地资料：{m.searchError.slice(0, 60)}
                    </span>
                  ) : m.reason ? (
                    <span className="text-muted-foreground">未联网：{m.reason}</span>
                  ) : null}
                  {m.lowRelevance && (
                    <span
                      className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700"
                      title="该视频字幕与你的问题相似度偏低（短视频整段只有一个切片时常见），回答仅供参考"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      本地资料相关度低，回答仅供参考
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            思考中（本地模型较慢，请耐心等待）…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/60 bg-white/40 p-2 backdrop-blur">
        <div className="flex items-end gap-2">
          <Textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Enter 发送，Shift+Enter 换行"
            className="min-h-[38px] resize-none"
            rows={1}
          />
          <Button size="icon" onClick={send} disabled={busy || !q.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function RefList({ refs, onSeek }: { refs: Ref[]; onSeek?: (sec: number) => void }) {
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <p className="text-[11px] font-semibold text-muted-foreground">引用来源</p>
      {refs.map((r) => (
        <div key={r.index} className="flex items-start gap-1.5 text-[11px]">
          <span className="mt-px shrink-0 rounded bg-primary/10 px-1 font-medium text-primary">[{r.index}]</span>
          {r.kind === "web" ? (
            <a
              href={r.url || "#"}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-1 text-blue-600 hover:underline"
            >
              <Globe className="mt-px h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{r.label || r.url}</span>
            </a>
          ) : r.kind === "visual" && r.start != null ? (
            <button
              onClick={() => onSeek?.(r.start!)}
              className="flex items-start gap-1 text-left text-violet-600 hover:underline"
              title={r.snippet}
            >
              <Eye className="mt-px h-3 w-3 shrink-0" />
              <span>{fmtTime(r.start)} · 画面</span>
            </button>
          ) : r.kind === "video" && r.start != null ? (
            <button
              onClick={() => onSeek?.(r.start!)}
              className="flex items-start gap-1 text-left text-blue-600 hover:underline"
              title={r.snippet}
            >
              <Play className="mt-px h-3 w-3 shrink-0" />
              <span>
                {fmtTime(r.start)}
                {r.end != null && ` - ${fmtTime(r.end)}`}
              </span>
            </button>
          ) : (
            <span className="flex items-start gap-1 text-muted-foreground" title={r.snippet}>
              <BookOpen className="mt-px h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{r.label}</span>
            </span>
          )}
          {r.cited === false && <Link2 className="mt-px h-3 w-3 shrink-0 text-muted-foreground/50" />}
        </div>
      ))}
    </div>
  );
}
