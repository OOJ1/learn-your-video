import { useRef, useState } from "react";
import { UploadCloud, FileText, Video, X, Loader2 } from "lucide-react";
import { api, guessType, type Doc } from "../lib/api";
import { Button, Input } from "./ui";
import { fmtBytes } from "../lib/utils";

export function UploadZone({ onUploaded }: { onUploaded: (d: Doc) => void }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [hotwords, setHotwords] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setErr("");
    if (!guessType(f.name)) {
      setErr("仅支持 txt / md / pdf 或 mp4 / mov 等视频格式");
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!file) return;
    const t = guessType(file.name)!;
    setBusy(true);
    setErr("");
    try {
      const r = await api.upload(t, file, hotwords);
      onUploaded(r.doc);
      setFile(null);
      setHotwords("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (e: any) {
      setErr(e?.message || "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const type = file ? guessType(file.name) : null;

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
          dragging ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
        }`}
      >
        <UploadCloud className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          拖拽文件到此处，或<span className="text-foreground underline-offset-2 hover:underline">点击选择</span>
        </p>
        <p className="text-[11px] text-muted-foreground">文章：txt / md / pdf　视频：mp4 / mov / mkv</p>
        <p className="mt-0.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-700">
          提示：本工具靠「听懂内容」来总结，纯画面、无解说、只有背景音乐的视频提取不到有效信息。
          建议上传<b>有人讲解、访谈、课程、会议</b>这类带对话解说的内容，效果最好。
        </p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".txt,.md,.markdown,.pdf,.mp4,.mov,.mkv,.avi,.webm,.m4v,.flv"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      {file && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-2">
          <div className="flex items-center gap-2 text-xs">
            {type === "video" ? (
              <Video className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="flex-1 truncate">{file.name}</span>
            <span className="text-muted-foreground">{fmtBytes(file.size)}</span>
            <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {type === "video" && (
            <Input
              value={hotwords}
              onChange={(e) => setHotwords(e.target.value)}
              placeholder="热词（逗号分隔）：RAG, 检索增强生成, 大模型"
              className="h-8 text-xs"
            />
          )}

          <Button size="sm" className="w-full" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {busy ? "上传中…" : "开始处理"}
          </Button>
        </div>
      )}

      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
