import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings, X, Eye, EyeOff, CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";
import { api } from "../lib/api";
import { Button, Input } from "./ui";

type Cfg = {
  llm_provider: string;
  llm_model: string;
  has_llm_key: boolean;
  has_tavily_key: boolean;
  search_provider: string;
};

/* ---------------- 输入格式校验 ----------------
 * 粘贴 Key 是最容易出错的一步：多带空格、少复制一段、带引号、复制成别的平台的 Key。
 * 这里在前端就把明显不合法的输入拦下来，避免「保存成功但调用一直 401」这种难查的问题。
 * 注意：前端校验只是第一道闸，后端写 .env 前不重复校验（保持可手工编辑 .env 的灵活性）。
 */
/** 大模型 Key：OpenAI / DeepSeek / 通义千问兼容模式 均为 sk- 开头 */
const LLM_KEY_RE = /^sk-(proj-)?[A-Za-z0-9_-]{16,}$/;
/** Tavily 联网搜索 Key：tvly- 开头 */
const TAVILY_KEY_RE = /^tvly-[A-Za-z0-9_-]{16,}$/;
/** Base URL：必须是 http(s) 开头的完整地址 */
const URL_RE = /^https?:\/\/[^\s]+$/i;

const LLM_KEY_HINT = "格式不对：应以 sk- 开头，后接至少 16 位字母/数字（如 sk-1a2b3c…，注意不要带引号或空格）";
const TAVILY_KEY_HINT = "格式不对：应以 tvly- 开头（在 Tavily 控制台复制，如 tvly-1a2b3c…）";
const URL_HINT = "格式不对：需以 http:// 或 https:// 开头";

/** 千问 API 接入步骤：鼠标悬停「?」时展示（传送至 body 渲染，避免被弹窗 overflow 裁剪） */
function QwenHelpTip() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const iconRef = useRef<SVGSVGElement>(null);

  const show = () => {
    const r = iconRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      <HelpCircle ref={iconRef} className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
      {pos &&
        createPortal(
          <span
            className="fixed z-[60] w-72 -translate-x-1/2 rounded-lg border border-white/10 bg-slate-900/95 p-3 text-[11px] leading-relaxed text-slate-100 shadow-xl"
            style={{ left: pos.x, top: pos.y }}
          >
            <b>如何获取大模型 API（以通义千问 Qwen 为例）：</b>
            <br />
            1. 打开阿里云百炼 <b>bailian.aliyun.com</b>，注册 / 登录（支付宝、淘宝账号可直接登录）
            <br />
            2. 进入控制台 →「API-KEY 管理」→ 创建 API Key，复制以 <b>sk-</b> 开头的密钥
            <br />
            3. 上方选择「云端 API」，Base URL 填{" "}
            <b>https://dashscope.aliyuncs.com/compatible-mode/v1</b>，模型名填{" "}
            <b>qwen-plus</b>（便宜可用 qwen-turbo，更强用 qwen-max）
            <br />
            4. 把 API Key 粘贴到下方输入框，点「保存」即可
            <br />
            <span className="text-slate-400">
              新用户通常有免费额度；DeepSeek 等其他 OpenAI 兼容服务同理，换 Base URL 和模型名即可。
            </span>
          </span>,
          document.body
        )}
    </span>
  );
}

/** 输入项下方的校验提示：error 标红、ok 标绿 */
function FieldHint({ error, ok, okText }: { error?: string; ok?: boolean; okText?: string }) {
  if (error) {
    return (
      <p className="flex items-start gap-1 text-[11px] text-red-600">
        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
        {error}
      </p>
    );
  }
  if (ok && okText) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        {okText}
      </p>
    );
  }
  return null;
}

/** 右上角设置中心：配置大模型与联网搜索的 API Key */
export function SettingsDialog({
  open: openProp,
  onOpenChange,
  onSaved,
}: {
  /** 受控模式：由外部（如介绍页「去配置」）控制开关；不传则组件内部自管 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 保存成功后回调：让外层（问答面板等）重新拉 /api/config 刷新联网可用性 */
  onSaved?: () => void;
}) {
  const [openInner, setOpenInner] = useState(false);
  const open = openProp !== undefined ? openProp : openInner;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setOpenInner(v);
  };
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [tavilyKey, setTavilyKey] = useState("");
  const [webOn, setWebOn] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 已失焦过的字段：避免用户刚敲第一个字符就被标红 */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  // ---- 校验：留空视为「不修改」，不报错；一旦填了就必须符合格式 ----
  const llmKeyErr = apiKey.trim() && !LLM_KEY_RE.test(apiKey.trim()) ? LLM_KEY_HINT : "";
  const tavilyKeyErr = tavilyKey.trim() && !TAVILY_KEY_RE.test(tavilyKey.trim()) ? TAVILY_KEY_HINT : "";
  const baseUrlErr = baseUrl.trim() && !URL_RE.test(baseUrl.trim()) ? URL_HINT : "";
  const llmKeyOk = !!apiKey.trim() && !llmKeyErr;
  const tavilyKeyOk = !!tavilyKey.trim() && !tavilyKeyErr;
  const baseUrlOk = !!baseUrl.trim() && !baseUrlErr;
  /** 有任何一项格式错误 → 不允许保存 */
  const invalid = !!(llmKeyErr || tavilyKeyErr || baseUrlErr);

  const close = () => {
    setOpen(false);
    setMsg(null);
    setTouched({});
  };

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setTouched({});
    api
      .config()
      .then((c: any) => {
        setCfg(c);
        setProvider(c.llm_provider || "ollama");
        setModel(c.llm_model || "");
        setWebOn((c.search_provider || "off") !== "off");
      })
      .catch(() => {});
  }, [open]);

  const save = async () => {
    // 双保险：按钮已 disabled，这里再挡一次
    if (llmKeyErr || tavilyKeyErr || baseUrlErr) {
      setMsg({ ok: false, text: "存在格式不正确的输入项，请修正后再保存" });
      return;
    }
    setSaving(true);
    setMsg(null);
    const patch: Record<string, string> = {
      LLM_PROVIDER: provider,
      // 勾上就写 auto：Key 已在后端配置过时不必重新粘贴
      SEARCH_PROVIDER: webOn ? "auto" : "off",
    };
    if (provider === "openai") {
      if (model.trim()) patch.OPENAI_MODEL = model.trim();
      if (baseUrl.trim()) patch.OPENAI_BASE_URL = baseUrl.trim();
      if (apiKey.trim()) patch.OPENAI_API_KEY = apiKey.trim();
    } else {
      if (model.trim()) patch.OLLAMA_MODEL = model.trim();
      if (baseUrl.trim()) patch.OLLAMA_BASE_URL = baseUrl.trim();
    }
    if (tavilyKey.trim()) patch.TAVILY_API_KEY = tavilyKey.trim();
    // 保存成功后清空已粘贴的 Key 输入框，避免明文残留在页面上
    const clearKeyInputs = () => {
      setApiKey("");
      setTavilyKey("");
      setTouched({});
    };

    try {
      const r = await api.saveConfig(patch);
      setMsg({ ok: true, text: `已保存并生效：${(r.saved || []).join("、") || "无变更"}` });
      clearKeyInputs();
      // 让「已配置」状态（has_llm_key / has_tavily_key）立刻刷新
      api.config().then((c: any) => setCfg(c)).catch(() => {});
      onSaved?.();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="设置中心">
        <Settings className="h-3.5 w-3.5" />
      </Button>

      {/* 弹窗遮罩必须传送到 body：header 带 backdrop-filter，会让内部的
          fixed 定位退化为相对 header 定位，弹窗会塌成一条线无法显示 */}
      {open &&
      createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/35 p-8 backdrop-blur-sm">
          <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-white/70 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.3),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl">
            <div className="flex items-center gap-2 border-b border-white/50 px-4 py-3">
              <Settings className="h-4 w-4" />
              <span className="text-sm font-semibold">设置中心</span>
              <div className="flex-1" />
              <button onClick={close} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {/* 大模型 */}
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  大模型
                  <QwenHelpTip />
                </p>
                <div className="flex gap-3 text-xs">
                  {[
                    { v: "ollama", label: "本地 Ollama" },
                    { v: "openai", label: "云端 API（DeepSeek / OpenAI 兼容）" },
                  ].map((o) => (
                    <label key={o.v} className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="provider"
                        checked={provider === o.v}
                        onChange={() => setProvider(o.v)}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>

                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={provider === "ollama" ? "模型名，如 qwen3.5:9b" : "模型名，如 deepseek-chat"}
                  className="h-8 text-xs"
                />
                <div className="space-y-1">
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    onBlur={() => markTouched("baseUrl")}
                    placeholder={
                      provider === "ollama"
                        ? "http://127.0.0.1:11434/v1"
                        : "https://api.deepseek.com/v1"
                    }
                    className={`h-8 text-xs ${
                      (touched.baseUrl || invalid) && baseUrlErr ? "border-red-400/80" : ""
                    }`}
                  />
                  {(touched.baseUrl || invalid) && (
                    <FieldHint error={baseUrlErr} ok={baseUrlOk} okText="地址格式正确" />
                  )}
                </div>

                {provider === "openai" && (
                  <div className="space-y-1">
                    <div className="relative">
                      <Input
                        type={showKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        onBlur={() => markTouched("apiKey")}
                        placeholder={`API Key（sk- 开头）${cfg?.has_llm_key ? "，已配置可留空" : ""}`}
                        className={`h-8 pr-8 text-xs ${
                          (touched.apiKey || invalid) && llmKeyErr ? "border-red-400/80" : ""
                        }`}
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    {(touched.apiKey || invalid) && (
                      <FieldHint error={llmKeyErr} ok={llmKeyOk} okText="Key 格式正确" />
                    )}
                  </div>
                )}
              </div>

              {/* 联网搜索 */}
              <div className="space-y-2 rounded-xl border border-white/40 bg-white/30 p-3 backdrop-blur">
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={webOn}
                    onChange={(e) => setWebOn(e.target.checked)}
                  />
                  开启联网搜索
                  <span className="font-normal text-muted-foreground">
                    （问答栏的「智能联网 / 强制联网」总开关）
                  </span>
                </label>

                {/* 三态文案：关闭 / 已开启且可用 / 已开启但缺 Key（后者问答页联网仍被锁死） */}
                <p
                  className={`text-[11px] ${
                    !webOn
                      ? "text-muted-foreground"
                      : cfg?.has_tavily_key
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {!webOn
                    ? "当前状态：已关闭 · 问答栏的联网开关会整体置灰，只能用「仅本地」"
                    : cfg?.has_tavily_key
                    ? "当前状态：已开启 · Tavily Key 已配置，问答栏可正常联网"
                    : "当前状态：已开启但缺少 API Key · 问答栏联网开关仍会置灰，请填入下方 Key 并保存"}
                </p>

                {webOn && (
                  <>
                    <p className="rounded-md bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-700">
                      联网搜索需要 Tavily 的 API Key。获取方式：
                      <br />
                      1. 打开 tavily.com 注册账号（可用 Google / GitHub 登录）
                      <br />
                      2. 登录后进入 Dashboard，复制 <b>API Key</b>（以 tvly- 开头）
                      <br />
                      3. 粘贴到下面输入框并保存；免费额度每月 1000 次，够个人使用
                    </p>
                    <div className="space-y-1">
                      <Input
                        type={showKey ? "text" : "password"}
                        value={tavilyKey}
                        onChange={(e) => setTavilyKey(e.target.value)}
                        onBlur={() => markTouched("tavilyKey")}
                        placeholder={`Tavily API Key（tvly- 开头）${cfg?.has_tavily_key ? "，已配置可留空" : ""}`}
                        className={`h-8 text-xs ${
                          (touched.tavilyKey || invalid) && tavilyKeyErr ? "border-red-400/80" : ""
                        }`}
                      />
                      {(touched.tavilyKey || invalid) && (
                        <FieldHint error={tavilyKeyErr} ok={tavilyKeyOk} okText="Key 格式正确" />
                      )}
                    </div>
                    {!cfg?.has_tavily_key && !tavilyKeyOk && (
                      <p className="flex items-center gap-1 text-[11px] text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                        还没有 Key：此时联网功能不可用，问答栏的联网开关会锁死在「仅本地」
                      </p>
                    )}
                  </>
                )}
              </div>

              {msg && (
                <p
                  className={`flex items-center gap-1.5 rounded-lg p-2 text-[11px] ${
                    msg.ok ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-600"
                  }`}
                >
                  {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {msg.text}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-white/40 px-4 py-3">
              <span className="text-[11px] text-muted-foreground">
                {invalid ? (
                  <span className="flex items-center gap-1 text-red-600">
                    <AlertTriangle className="h-3 w-3" />
                    有输入项格式不正确，修正后才能保存
                  </span>
                ) : (
                  "保存后立即生效，配置写入后端 .env"
                )}
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={close}>
                关闭
              </Button>
              <Button size="sm" onClick={save} disabled={saving || invalid} title={invalid ? "请先修正标红的输入项" : undefined}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
