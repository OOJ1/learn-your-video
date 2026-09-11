import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Loader2, Globe, Link2, Play, BookOpen, AlertTriangle } from "lucide-react";
import { api, type Doc, type Ref } from "../lib/api";
import { Button, Textarea } from "./ui";
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
}: {
  doc: Doc;
  onSeek?: (sec: number) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [useWeb, setUseWeb] = useState<"auto" | "on" | "off">("auto");
  const [searchOff, setSearchOff] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 后端关闭联网搜索时，前端同步置灰「强制联网」，避免点了没反应
  useEffect(() => {
    api
      .config()
      .then((c: any) => setSearchOff((c?.search_provider || "off").toLowerCase() === "off"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .history(doc.id)
      .then((r) =>
        setMsgs(
          (r.items || []).map((m: any) => ({
            role: m.role,
            content: m.content,
            refs: m.refs,
          }))
        )
      )
      .catch(() => setMsgs([]));
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
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold">问答</span>
        <div className="flex items-center gap-1">
          {(["auto", "on", "off"] as const).map((v) => {
            const disabled = searchOff && v === "on";
            return (
              <button
                key={v}
                onClick={() => !disabled && setUseWeb(v)}
                title={disabled ? "联网搜索已关闭，可在右上角设置中心开启" : undefined}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] transition-colors",
                  disabled
                    ? "cursor-not-allowed text-muted-foreground/40 line-through"
                    : useWeb === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                )}
              >
                {v === "auto" ? "智能联网" : v === "on" ? "强制联网" : "仅本地"}
              </button>
            );
          })}
          {searchOff && (
            <span className="ml-1 text-[10px] text-muted-foreground">（联网已关闭）</span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!msgs.length && (
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
                  ? "bg-primary text-primary-foreground"
                  : m.error
                  ? "bg-red-50 text-red-700"
                  : "border bg-muted/40"
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

      <div className="border-t p-2">
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
