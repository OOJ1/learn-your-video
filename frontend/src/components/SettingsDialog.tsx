import { useEffect, useState } from "react";
import { Settings, X, Eye, EyeOff, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { Button, Input } from "./ui";

type Cfg = {
  llm_provider: string;
  llm_model: string;
  has_llm_key: boolean;
  has_tavily_key: boolean;
  search_provider: string;
};

/** 右上角设置中心：配置大模型与联网搜索的 API Key */
export function SettingsDialog() {
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (!open) return;
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
    setSaving(true);
    setMsg(null);
    const patch: Record<string, string> = {
      LLM_PROVIDER: provider,
      // 勾上就写 auto：Key 已在后端配置过时不必重新粘贴
      SEARCH_PROVIDER: webOn ? "auto" : "off",
    };
    if (provider === "openai") {
      if (model) patch.OPENAI_MODEL = model;
      if (baseUrl) patch.OPENAI_BASE_URL = baseUrl;
      if (apiKey) patch.OPENAI_API_KEY = apiKey;
    } else {
      if (model) patch.OLLAMA_MODEL = model;
      if (baseUrl) patch.OLLAMA_BASE_URL = baseUrl;
    }
    if (tavilyKey) patch.TAVILY_API_KEY = tavilyKey;

    try {
      const r = await api.saveConfig(patch);
      setMsg({ ok: true, text: `已保存并生效：${(r.saved || []).join("、") || "无变更"}` });
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

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-8">
          <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-white/60 bg-white/70 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center gap-2 border-b border-white/40 px-4 py-3">
              <Settings className="h-4 w-4" />
              <span className="text-sm font-semibold">设置中心</span>
              <div className="flex-1" />
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {/* 大模型 */}
              <div className="space-y-2">
                <p className="text-xs font-semibold">大模型</p>
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
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={
                    provider === "ollama"
                      ? "http://127.0.0.1:11434/v1"
                      : "https://api.deepseek.com/v1"
                  }
                  className="h-8 text-xs"
                />

                {provider === "openai" && (
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={`API Key${cfg?.has_llm_key ? "（已配置，留空表示不修改）" : ""}`}
                      className="h-8 pr-8 text-xs"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
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

                <p
                  className={`text-[11px] ${
                    webOn ? "text-emerald-600" : "text-muted-foreground"
                  }`}
                >
                  当前状态：{webOn ? "已开启" : "已关闭"}
                  {cfg?.has_tavily_key ? " · Tavily Key 已配置" : " · 未配置 Tavily Key"}
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
                    <Input
                      type={showKey ? "text" : "password"}
                      value={tavilyKey}
                      onChange={(e) => setTavilyKey(e.target.value)}
                      placeholder={`Tavily API Key${cfg?.has_tavily_key ? "（已配置，留空表示不修改）" : ""}`}
                      className="h-8 text-xs"
                    />
                    {!cfg?.has_tavily_key && !tavilyKey && (
                      <p className="flex items-center gap-1 text-[11px] text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                        还没有 Key：保存后会自动降级为 DuckDuckGo（国内网络可能失败）
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
                保存后立即生效，配置写入后端 .env
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                关闭
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
