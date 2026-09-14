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
  AlertTriangle,
  Quote,
  StickyNote,
  Eye,
  Film,
} from "lucide-react";
import type { Doc, ValueScore, KeyPoint, Summary } from "../lib/api";
import { asPoint } from "../lib/api";
import { Badge, Button, Card, CardContent } from "./ui";
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
    <span className="group relative inline-block cursor-help">
      <span className="border-b border-dashed border-muted-foreground/60 group-hover:border-foreground/60">
        {text}
      </span>
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 hidden w-72 max-w-[80vw] rounded-lg border border-white/60 bg-white/80 p-2.5 text-xs font-normal leading-relaxed text-popover-foreground shadow-lg ring-1 ring-black/5 backdrop-blur-xl group-hover:block">
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
    <div className="rounded-xl border border-white/60 bg-white/45 p-3 backdrop-blur shadow-[0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.6)]">
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
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/40">
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
            className="mt-2.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {open ? "收起细节" : "展开细节"}
            <span className="text-[11px] text-muted-foreground/80">（悬停各维度可看解释）</span>
          </button>

          {open && (
            <div className="mt-2.5 space-y-2.5">
              {dims.map(([key, d]) => (
                <div key={key}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <DimLabel text={d.label || key} tip={d.reason} />
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {d.score}/20
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/40">
                    <div
                      className="h-1.5 rounded-full bg-primary/60"
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
        className="flex w-full gap-2 rounded-lg px-1.5 py-1 -mx-1.5 text-left text-sm hover:bg-white/50"
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

/**
 * 顶部标题区：用一句话总结当标题，右侧放操作按钮。
 * 结构为「标题 → 视频窗口 → 核心要点（带时间戳）」，所以这里只呈现一句话结论。
 */
export function SummaryHeadline({
  doc,
  onRetry,
  onResummarize,
}: {
  doc: Doc;
  onRetry: (d: Doc) => void;
  onResummarize: (d: Doc) => void;
}) {
  const s: Summary | null | undefined = doc.summary;
  const isVideo = doc.type === "video";
  const failed = doc.status === "failed";

  if (!s) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-3">
          {failed ? (
            <>
              <span className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                处理失败：{doc.error || doc.message}
              </span>
              <Button size="sm" variant="outline" onClick={() => onRetry(doc)}>
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">摘要生成中，请稍候…</span>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-3.5">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-relaxed tracking-tight">
          {s.one_liner || "（暂无摘要）"}
        </h2>
        <div className="flex shrink-0 gap-1.5">
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
      </CardContent>
    </Card>
  );
}

/**
 * 主题标签：一排胶囊，默认展示在「一句话标题」下方。
 */
export function SummaryTags({ doc }: { doc: Doc }) {
  const tags = doc.summary?.tags;
  if (!tags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <Badge key={t} variant="secondary">
          {t}
        </Badge>
      ))}
    </div>
  );
}

/**
 * 详情区（放在视频下方）：核心要点（带时间戳，可点击跳转）+ 评分 + 模型评价 + 知识笔记。
 */
export function SummaryPanel({
  doc,
  onSeek,
}: {
  doc: Doc;
  onSeek?: (sec: number) => void;
}) {
  const s: Summary | null | undefined = doc.summary;
  const isVideo = doc.type === "video";
  if (!s) return null;

  const hasDetails =
    !!s.key_points?.length ||
    !!s.visual_points?.length ||
    !!doc.frames?.length ||
    !!s.outline?.length ||
    !!s.value_score ||
    !!doc.chars ||
    !!doc.duration;

  if (!hasDetails) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-3.5">
        {!!s.key_points?.length && (
          <div>
            <p className="mb-2 text-sm font-semibold">
              核心要点{onSeek && isVideo ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  （点击时间戳跳转视频，播放器进度条上同样标出了这些时间点）
                </span>
              ) : null}
            </p>
            <ul className="space-y-1">
              {s.key_points.map((k, i) => (
                <PointItem key={i} item={k} onSeek={onSeek} />
              ))}
            </ul>
          </div>
        )}

        {/* 画面要点：结合「看到的」——屏幕/画面上呈现的文字与图表 */}
        {!!s.visual_points?.length && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Eye className="h-3.5 w-3.5" />
              画面要点
              <span className="text-xs font-normal text-muted-foreground">
                （画面中呈现的信息，点击时间戳跳转）
              </span>
            </p>
            <ul className="space-y-1">
              {s.visual_points.map((k, i) => (
                <PointItem key={i} item={k} onSeek={onSeek} />
              ))}
            </ul>
          </div>
        )}

        {/* 关键帧缩略图：来自画面识别的抽帧，点击跳转到对应时间 */}
        {!!doc.frames?.length && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Film className="h-3.5 w-3.5" />
              关键帧
              <span className="text-xs font-normal text-muted-foreground">
                （共 {doc.frames.length} 张，点击跳转）
              </span>
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {doc.frames.map((f, i) => (
                <button
                  key={i}
                  onClick={() => onSeek?.(f.t)}
                  title={`跳转到 ${fmtTime(f.t)}`}
                  className="group relative h-16 w-28 shrink-0 overflow-hidden rounded-lg border border-white/50 bg-white/30"
                >
                  <img
                    src={api.frameUrl(doc.id, f.file)}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                    {fmtTime(f.t)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {s.value_score && <ScoreCard vs={s.value_score} />}

        {s.review ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Quote className="h-3.5 w-3.5" />
              模型评价
              <span className="text-xs font-normal text-muted-foreground">（对内容的看法）</span>
            </p>
            <p className="rounded-lg border-l-2 border-primary/50 bg-white/45 p-3 text-sm leading-relaxed backdrop-blur">
              {s.review}
            </p>
          </div>
        ) : null}

        {!!s.notes?.length && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <StickyNote className="h-3.5 w-3.5" />
              知识笔记
              <span className="text-xs font-normal text-muted-foreground">（可当复习笔记用）</span>
            </p>
            <div className="space-y-2">
              {s.notes.map((n, i) => (
                <div key={i} className="rounded-xl border border-white/50 bg-white/40 p-3 backdrop-blur">
                  {n.title ? (
                    <p className="mb-1.5 text-xs font-semibold text-foreground/90">{n.title}</p>
                  ) : null}
                  <ul className="space-y-1">
                    {n.points.map((p, j) => (
                      <li key={j} className="flex gap-2 text-sm leading-relaxed">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 旧数据兼容：还没有 review/notes 的历史摘要，继续展示原来的内容脉络 */}
        {!s.review && !s.notes?.length && !!s.outline?.length && (
          <div>
            <p className="mb-2 text-sm font-semibold">
              内容脉络
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                （旧版摘要，点右上角「重新生成」可换成模型评价 + 知识笔记）
              </span>
            </p>
            <ol className="space-y-1">
              {s.outline.map((o, i) => (
                <PointItem key={i} item={o} onSeek={onSeek} />
              ))}
            </ol>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t pt-2.5 text-[11px] text-muted-foreground">
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
