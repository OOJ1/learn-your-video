import { FileText, Video, Trash2, Loader2, RotateCw } from "lucide-react";
import type { Doc } from "../lib/api";
import { Badge, Progress } from "./ui";
import { cn, fmtBytes, fmtDate, fmtTime } from "../lib/utils";

const STATUS: Record<string, { label: string; variant: any }> = {
  uploaded: { label: "已上传", variant: "secondary" },
  parsing: { label: "解析中", variant: "warn" },
  transcribing: { label: "语音转写中", variant: "warn" },
  embedding: { label: "向量化中", variant: "warn" },
  summarizing: { label: "生成摘要中", variant: "warn" },
  ready: { label: "已完成", variant: "success" },
  failed: { label: "失败", variant: "danger" },
};

const BUSY = ["uploaded", "parsing", "transcribing", "embedding", "summarizing"];

export function DocList({
  docs,
  selectedId,
  onSelect,
  onDelete,
  onRetry,
}: {
  docs: Doc[];
  selectedId: string | null;
  onSelect: (d: Doc) => void;
  onDelete: (d: Doc) => void;
  onRetry: (d: Doc) => void;
}) {
  if (!docs.length) {
    return (
      <p className="px-1 py-6 text-center text-xs text-muted-foreground">
        还没有文件，先在上方上传一个吧
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {docs.map((d) => {
        const st = STATUS[d.status] || { label: d.status, variant: "secondary" };
        const busy = BUSY.includes(d.status);
        return (
          <div
            key={d.id}
            onClick={() => onSelect(d)}
            className={cn(
              "group cursor-pointer rounded-lg border border-white/60 bg-white/40 p-2 backdrop-blur transition-all duration-200",
              selectedId === d.id
                ? "border-indigo-400/60 bg-white/75 shadow-[0_2px_10px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.9)]"
                : "shadow-[0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-white/60"
            )}
          >
            <div className="flex items-start gap-2">
              {d.type === "video" ? (
                <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{d.filename}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {fmtDate(d.created_at)}
                  {d.size ? ` · ${fmtBytes(d.size)}` : ""}
                  {d.duration ? ` · ${fmtTime(d.duration)}` : ""}
                </p>
              </div>
              {d.status === "failed" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(d);
                  }}
                  title="重试"
                  className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-amber-600 hover:bg-amber-50"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  重试
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(d);
                }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="删除"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
              </button>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <Badge variant={st.variant} className="shrink-0">
                {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {st.label}
              </Badge>
              {d.status === "ready" && d.vectorized && (
                <span
                  className="shrink-0 rounded bg-indigo-50 px-1 py-0.5 text-[10px] text-indigo-600"
                  title={`长文已切块并写入向量库（${d.chunks ?? 0} 块），问答走检索`}
                >
                  已建索引
                </span>
              )}
              {busy && <Progress value={d.progress || 0} className="flex-1" />}
              {d.status === "failed" && d.message && (
                <span className="truncate text-[11px] text-red-600" title={d.message}>
                  {d.message}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
