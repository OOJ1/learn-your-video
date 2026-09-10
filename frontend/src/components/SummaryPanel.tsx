import { useState } from "react";
import {
  Download,
  Sparkles,
  Clock,
  FileText,
  RefreshCw,
  Gauge,
  Play,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { Doc, ValueScore, KeyPoint, Summary } from "../lib/api";
import { asPoint } from "../lib/api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui";
import { api } from "../lib/api";
import { cn, fmtTime } from "../lib/utils";

function scoreColor(total: number) {
  if (total >= 70) return "bg-emerald-500";
  if (total >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

/** 带悬停提示的维度标签：解释文字默认不展示，鼠标悬停时才出现 */
function DimLabel({ text, tip }: { text: string; tip?: string }) {
  if (!tip) return <span>{text}</span>;
  return (
    <span className="group relative cursor-help border-b border-dashed border-muted-foreground/50">
      {text}
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-56 rounded-md border bg-popover p-2 text-[11px] font-normal leading-snug text-popover-foreground shadow-md group-hover:block">
        {tip}
      </span>
    </span>
  );
}

/** 视频含金量评分卡：总分 + 五维（默认折叠，悬停看解释）+ 评语 */
function ScoreCard({ vs }: { vs: ValueScore }) {
  const [open, setOpen] = useState(false);
  const dims = Object.entries(vs.dimensions || {});
  const pct = (n: number) => Math.min(100, Math.max(0, (n / 20) * 100));

  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <div className="w-12 shrink-0 text-center">
          <div className="text-2xl font-bold leading-none">{vs.total}</div>
          <div className="text-[10px] text-muted-foreground">/ 100</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 font-semibold">
              <Gauge className="h-3 w-3" />
              含金量评分
            </span>
            <span className="shrink-0 text-muted-foreground">{vs.level}</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-1.5 rounded-full transition-all", scoreColor(vs.total))}
              style={{ width: `${Math.min(100, Math.max(0, vs.total))}%` }}
            />
          </div>
        </div>
      </div>

      {!!dims.length && (
        <>
          <button
            onClick={() => setOpen(!open)}
            className="mt-2.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {open ? "收起细节" : "展开细节"}
            <span className="text-[10px]">（悬停各维度可看解释）</span>
          </button>

          {open && (
            <div className="mt-2 space-y-1.5">
              {dims.map(([key, d]) => (
                <div key={key}>
                  <div className="flex items-center justify-between text-[11px]">
                    <DimLabel text={d.label || key} tip={d.reason} />
                    <span className="tabular-nums text-muted-foreground">{d.score}/20</span>
                  </div>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-1 rounded-full bg-primary/60"
                      style={{ width: `${pct(d.score)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {vs.verdict && (
        <p className="mt-3 border-t pt-2 text-xs leading-relaxed">{vs.verdict}</p>
      )}
      {vs.watch_advice && (
        <p className="mt-1 text-[11px] text-muted-foreground">观看建议：{vs.watch_advice}</p>
      )}
    </div>
  );
}

/** 单条要点/脉络：有时间戳且可跳转时渲染为按钮，否则纯文本 */
function PointItem({
  item,
  onSeek,
}: {
  item: string | KeyPoint;
  onSeek?: (sec: number) => void;
}) {
  const p = asPoint(item);
  const canJump = p.t != null && !!onSeek;

  if (!canJump) {
    return (
      <li className="flex gap-2 text-sm">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
        <span>{p.text}</span>
      </li>
    );
  }

  return (
    <li>
      <button
        onClick={() => onSeek!(p.t!)}
        title="点击跳转到视频对应位置"
        className="flex w-full gap-2 rounded-lg px-1.5 py-1 -mx-1.5 text-left text-sm hover:bg-accent"
      >
        <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
          <Play className="h-2.5 w-2.5" />
          {fmtTime(p.t!)}
        </span>
        <span className="min-w-0">{p.text}</span>
      </button>
    </li>
  );
}

export function SummaryPanel({
  doc,
  onRetry,
  onResummarize,
  onSeek,
}: {
  doc: Doc;
  onRetry: (d: Doc) => void;
  onResummarize: (d: Doc) => void;
  onSeek?: (sec: number) => void;
}) {
  const s: Summary | null | undefined = doc.summary;
  const isVideo = doc.type === "video";
  const failed = doc.status === "failed";

  if (!s) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          {failed ? (
            <div className="space-y-2">
              <p className="text-red-600">处理失败：{doc.error || doc.message}</p>
              <Button size="sm" variant="outline" onClick={() => onRetry(doc)}>
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </Button>
            </div>
          ) : (
            "摘要生成中，请稍候…"
          )}
        </CardContent>
      </Card>
    );
  }

  const title =
    isVideo && s.video_type ? `${s.video_type} · 内容总结` : isVideo ? "视频总结" : "内容总结";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          {title}
        </CardTitle>
        <div className="flex gap-1.5">
          {isVideo && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(api.srtUrl(doc.id), "_blank")}
            >
              字幕 SRT
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onResummarize(doc)}
            title="复用已有转写，只重跑摘要与评分"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新生成
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(api.exportUrl(doc.type, doc.id), "_blank")}
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed">
          {s.one_liner || "（暂无摘要）"}
        </p>

        {s.value_score && <ScoreCard vs={s.value_score} />}

        {/* 时间轴分段：覆盖全片各时间段，点击任意一段跳转 */}
        {isVideo && !!doc.timeline?.length && (
          <div className="rounded-xl border">
            <p className="border-b px-3 py-1.5 text-xs font-semibold">
              全片时间轴 · 分段速览{onSeek ? "（点击跳转）" : ""}
              <span className="ml-1 font-normal text-muted-foreground">
                共 {doc.timeline.length} 段
              </span>
            </p>
            <div className="max-h-72 space-y-0.5 overflow-y-auto p-1.5">
              {doc.timeline.map((p, i) => (
                <button
                  key={i}
                  onClick={() => onSeek?.(p.t_start)}
                  className="flex w-full gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                >
                  <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    <Play className="h-2.5 w-2.5" />
                    {fmtTime(p.t_start)}
                    <span className="text-muted-foreground">–{fmtTime(p.t_end)}</span>
                  </span>
                  <span className="min-w-0 py-0.5">{p.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!!s.key_points?.length && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              核心要点{onSeek && isVideo ? "（点击跳转视频）" : ""}
            </p>
            <ul className="space-y-0.5">
              {s.key_points.map((k, i) => (
                <PointItem key={i} item={k} onSeek={onSeek} />
              ))}
            </ul>
          </div>
        )}

        {!!s.outline?.length && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              内容脉络{onSeek && isVideo ? "（点击跳转视频）" : ""}
            </p>
            <ol className="space-y-0.5">
              {s.outline.map((o, i) => (
                <PointItem key={i} item={o} onSeek={onSeek} />
              ))}
            </ol>
          </div>
        )}

        {!!s.tags?.length && (
          <div className="flex flex-wrap gap-1.5">
            {s.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t pt-2 text-[11px] text-muted-foreground">
          {s.reading_minutes ? (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              约 {s.reading_minutes} 分钟
            </span>
          ) : null}
          {doc.chars ? (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {doc.chars} 字
            </span>
          ) : null}
          {doc.chunks ? <span>向量块 {doc.chunks}</span> : null}
          {doc.duration ? <span>时长 {fmtTime(doc.duration)}</span> : null}
          {doc.language ? <span>语言 {doc.language}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
