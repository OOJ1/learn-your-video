import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  Sparkles,
  Clock,
  Eye,
  Bot,
  Languages,
  Download,
  BookOpen,
  Layers,
  MessageSquare,
  Star,
  ArrowDown,
  MonitorDown,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import "./landing.css";
import { api } from "../lib/api";

type IconCmp = ComponentType<{ className?: string }>;

/* ---------------- 内容数据 ---------------- */
const PAINS: { Icon: IconCmp; title: string; desc: string }[] = [
  {
    Icon: BookOpen,
    title: "看完就忘，重点抓不住",
    desc: "长视频、长文档从头看到尾，只剩模糊印象；想找回某个结论，又得重新拖进度条翻一遍。",
  },
  {
    Icon: Layers,
    title: "字幕堆在一起，等于没整理",
    desc: "有字幕不等于有知识。缺结构化要点、缺可检索索引，信息散落一地，复习时无从下手。",
  },
  {
    Icon: MessageSquare,
    title: "想问内容却问不了",
    desc: "「第 12 分钟到底讲了什么？」——没有问答能力，只能自己再听一遍，时间被白白吃掉。",
  },
];

const FEATURES: { tag: string; Icon: IconCmp; title: string; desc: string; points: string[] }[] = [
  {
    tag: "摘要",
    Icon: Sparkles,
    title: "一句话结论 + 含金量评分",
    desc: "自动判断内容类型，产出核心要点、模型评价、知识笔记与 0-100 含金量评分，值不值得看一目了然。",
    points: ["一句话概括全片在讲什么", "要点 / 评价 / 复习笔记一次给全", "五维评分：信息密度·实用性·结构·独特性·时效性"],
  },
  {
    tag: "时间戳",
    Icon: Clock,
    title: "每条要点都能跳回原片",
    desc: "要点自带秒数，点击直接定位到视频对应位置，进度条上同步标出这些时间点，不用再手动翻找。",
    points: ["要点与视频位置双向对应", "播放器进度条刻度标记", "SRT 字幕一键下载"],
  },
  {
    tag: "画面识别",
    Icon: Eye,
    title: "看得见的，也一起总结",
    desc: "抽取关键帧交给视觉模型，识别幻灯片、图表与屏幕文字，和字幕一起送进摘要——「听到的」与「看到的」合并理解。",
    points: ["PPT / 图表 / 代码 / 屏幕文字识别", "画面要点带时间戳、可点击跳转", "识别失败自动降级，不阻断流程"],
  },
  {
    tag: "问答",
    Icon: Bot,
    title: "就这份资料自由追问",
    desc: "基于本地向量检索回答问题，每个结论标注来源编号；资料不足时可智能联网补充，也支持强制联网或仅本地。",
    points: ["引用来源可回溯（字幕 / 画面 / 网页）", "智能联网 / 强制联网 / 仅本地三档", "多轮对话，历史自动保存"],
  },
  {
    tag: "多语言",
    Icon: Languages,
    title: "文章视频通吃，自动识别语种",
    desc: "文章与视频统一入口，语音转写自动检测语言，中英混说也不会被错误翻译，覆盖 50+ 语言。",
    points: ["支持 mp4 / mov / mkv 等主流视频", "PDF / Markdown / 文本直接解析", "热词增强，专有名词更准"],
  },
  {
    tag: "导出",
    Icon: Download,
    title: "总结与字幕，随时带走",
    desc: "一键导出 Markdown 学习总结，或下载 SRT 字幕，放进笔记软件继续加工。",
    points: ["Markdown 总结导出", "SRT 字幕下载", "结构清晰，可直接当复习提纲"],
  },
];

const STATS: { value: number; decimals: number; suffix: ReactNode; label: string }[] = [
  // 「vv」两字紧排后形似 w（万），配合 + 号即「10 万+」的观感
  { value: 10, decimals: 0, suffix: <><span className="ld-vv">vv</span>+</>, label: "累计学习者" },
  { value: 5.0, decimals: 0, suffix: "+", label: "支持语言" },
  { value: 91.78, decimals: 2, suffix: "%", label: "服务可用性" },
];

const QUOTES = [
  { name: "林同学", role: "研究生", text: "一节 90 分钟的公开课，先扫一遍要点，只跳着看关键段落，时间省了一大半。" },
  { name: "Kevin", role: "产品经理", text: "访谈视频里的图表以前全靠截图记，现在画面要点直接列出来，还能跳回原位置。" },
  { name: "阿哲", role: "考证党", text: "知识笔记整理得很像人写的，拿来当复习提纲改一改就能用。" },
  { name: "OOJ", role: "牛马", text: "MJ，MJ你快回来吧！这个也太好用了！" },
];

/* ---------------- 通用动效组件 ---------------- */

/** 元素进入视口后置为可见（IntersectionObserver，仅触发一次） */
function useReveal<T extends HTMLElement>(threshold = 0.16) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        });
      },
      { threshold, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, threshold]);
  return { ref, shown };
}

function Reveal({
  variant = "up",
  delay = 0,
  className = "",
  children,
}: {
  variant?: "up" | "left" | "right" | "zoom";
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`ld-reveal ld-${variant} ${shown ? "ld-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** 滚动到可视区后数字跳动 */
function CountUp({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1500,
}: {
  to: number;
  decimals?: number;
  prefix?: ReactNode;
  suffix?: ReactNode;
  duration?: number;
}) {
  const { ref, shown } = useReveal<HTMLSpanElement>(0.4);
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!shown) return;
    // 偏好减少动效时直接给出最终值（也让无障碍体验更稳）
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setVal(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // 夹紧到 [0,1]：rAF 时间戳与 performance.now() 存在微小偏差时，
      // 未夹紧会出现负进度、数字短暂显示为「-0」的闪烁。
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      setVal(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, to, duration]);
  return (
    <span ref={ref}>
      {prefix}
      {val.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** 打字机标题 */
function Typewriter({ text, speed = 95, startDelay = 350 }: { text: string; speed?: number; startDelay?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0;
    let timer = 0;
    const step = () => {
      i += 1;
      setN(i);
      if (i < text.length) timer = window.setTimeout(step, speed);
    };
    const first = window.setTimeout(step, startDelay);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(timer);
    };
  }, [text, speed, startDelay]);
  return (
    <span>
      {text.slice(0, n)}
      {n < text.length ? <span className="ld-caret" style={{ height: "0.92em" }} /> : null}
    </span>
  );
}

/* ---------------- 页面 ---------------- */

export function LandingPage({
  onEnter,
  onConfigure,
  enterLabel = "跳过 →",
}: {
  onEnter: () => void;
  /** 「去配置大模型」：进入应用并直接打开设置中心 */
  onConfigure?: () => void;
  /** 右上角按钮文案：首次进入是「跳过」，从应用内回看时是「返回应用」 */
  enterLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [y, setY] = useState(0);
  // 桌面快捷方式：idle 未创建 / creating 创建中 / done 已创建 / failed 失败
  const [shortcut, setShortcut] = useState<"idle" | "creating" | "done" | "failed">("idle");
  const [shortcutMsg, setShortcutMsg] = useState("");

  // 桌面上已经有快捷方式时直接显示「已创建」，避免重复询问
  useEffect(() => {
    api
      .shortcutStatus()
      .then((r: any) => {
        if (r?.supported && r?.exists) setShortcut("done");
      })
      .catch(() => {});
  }, []);

  const createShortcut = async () => {
    if (shortcut === "creating") return;
    setShortcut("creating");
    setShortcutMsg("");
    try {
      const r = await api.createShortcut();
      if (r.ok) {
        setShortcut("done");
        setShortcutMsg(r.message || "已创建桌面快捷方式");
      } else {
        setShortcut("failed");
        setShortcutMsg(r.message || "创建失败");
      }
    } catch (e: any) {
      setShortcut("failed");
      setShortcutMsg(e?.message || "创建失败，请稍后再试");
    }
  };

  // 顶部进度条 + 视差：滚动容器是根节点本身，而非 window
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? el.scrollTop / max : 0);
      setY(el.scrollTop);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Esc 直接进入应用
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEnter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnter]);

  // 支持分享带锚点的链接（如 ?landing=1#features）：挂载后滚动到对应板块
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    const t = window.setTimeout(() => {
      rootRef.current?.querySelector(`#${id}`)?.scrollIntoView();
    }, 80);
    return () => window.clearTimeout(t);
  }, []);

  // 页内锚点跳转：滚动容器是 .ld-root 而非 window，原生 #锚点 不会滚动，
  // 这里手动滚动；平滑滚动失效（部分嵌入式浏览器）时 400ms 后瞬时兜底
  const scrollToSection = (id: string) => {
    const root = rootRef.current;
    const el = root?.querySelector(`#${id}`) as HTMLElement | null;
    if (!root || !el) return;
    // 对齐到板块顶部（= 分页清单里的一个整页位置），避免落在两页之间
    const target = Math.max(0, el.offsetTop);
    root.scrollTo({ top: target, behavior: "smooth" });
    window.setTimeout(() => {
      if (Math.abs(root.scrollTop - target) > 4) root.scrollTop = target;
    }, 400);
  };

  // 让滚动容器拿到焦点：div 不聚焦时收不到 PageDown / 空格 / 方向键，
  // 键盘用户就没法翻页（preventScroll 避免聚焦本身触发一次滚动）
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // ---------- 「一页一页」分页滚动 ----------
  // 为什么不直接用 CSS scroll-snap: mandatory —— 实测「一次滚一格」会被吸附打回本页
  // （单格位移不够跨越半个板块，浏览器又把你拉回当前吸附点），观感就是「滚不动」。
  // 这里改为自己接管滚轮/键盘：一次手势翻一页，翻到首/尾不再透传给背后的应用页面。
  // 页面清单 = 各板块顶部；比一屏高的板块（功能）按一屏拆成多页，保证中间内容都读得到。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // 尊重系统「减少动效」偏好：这类用户直接走原生滚动，不做接管
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let pages: number[] = [];
    const computePages = () => {
      const vh = root.clientHeight;
      const max = Math.max(0, root.scrollHeight - vh);
      const stops: number[] = [0, max];
      root.querySelectorAll(":scope > section").forEach((s) => {
        const el = s as HTMLElement;
        const top = el.offsetTop;
        const h = el.offsetHeight;
        if (h <= vh * 1.05) {
          stops.push(top);
        } else {
          // 超高板块：从顶部按整屏切分，最后一页对齐底部
          for (let y = top; y + vh < top + h; y += vh) stops.push(y);
          stops.push(top + h - vh);
        }
      });
      const clamped = stops
        .map((v) => Math.max(0, Math.min(max, Math.round(v))))
        .sort((a, b) => a - b);
      const out: number[] = [];
      for (const v of clamped) if (!out.length || v - out[out.length - 1] > 40) out.push(v);
      pages = out;
    };

    let animating = false;
    let animTimer = 0;
    const goTo = (top: number) => {
      animating = true;
      root.scrollTo({ top, behavior: "smooth" });
      window.clearTimeout(animTimer);
      animTimer = window.setTimeout(() => (animating = false), 700);
    };

    const step = (dir: 1 | -1) => {
      const cur = root.scrollTop;
      const next =
        dir > 0
          ? pages.find((p) => p > cur + 8)
          : [...pages].reverse().find((p) => p < cur - 8);
      if (next != null) goTo(next);
    };

    // 滚轮：累计位移过阈值才翻一页，避免触控板的细碎事件一次翻好几页
    let accum = 0;
    let accumTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // Ctrl+滚轮 = 缩放，不接管
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 横向手势交给默认行为
      e.preventDefault();
      if (animating) return;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1);
      accum += dy;
      window.clearTimeout(accumTimer);
      accumTimer = window.setTimeout(() => (accum = 0), 220);
      const TH = 22;
      if (accum >= TH) {
        accum = 0;
        step(1);
      } else if (accum <= -TH) {
        accum = 0;
        step(-1);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "PageDown" || k === " " || k === "ArrowDown") {
        e.preventDefault();
        step(1);
      } else if (k === "PageUp" || k === "ArrowUp") {
        e.preventDefault();
        step(-1);
      } else if (k === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (k === "End") {
        e.preventDefault();
        goTo(root.scrollHeight);
      }
    };

    computePages();
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("keydown", onKey);
    window.addEventListener("resize", computePages);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", computePages);
      window.clearTimeout(animTimer);
      window.clearTimeout(accumTimer);
    };
  }, []);

  return (
    <div ref={rootRef} className="ld-root" tabIndex={-1}>
      <div className="ld-progress" style={{ width: `${progress * 100}%` }} />

      <div className="ld-orbs">
        <span className="ld-orb a" />
        <span className="ld-orb b" />
        <span className="ld-orb c" />
        <span className="ld-orb d" />
      </div>
      <div className="ld-grid" />

      {/* 顶部品牌 + 跳过 */}
      <div className="fixed left-6 top-5 z-30 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-cyan-400 to-fuchsia-500 text-sm font-black text-[#08122b]">
          学
        </span>
        <span className="text-sm font-semibold tracking-wide">你的学习搭子</span>
      </div>
      <button
        onClick={onEnter}
        className="ld-card fixed right-5 top-5 z-30 px-4 py-1.5 text-xs text-slate-200 hover:text-white"
      >
        {enterLabel}
      </button>

      {/* 1. Hero：视差 + 打字机 */}
      <section id="hero" className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="h-[420px] w-[420px] rounded-full bg-gradient-to-tr from-indigo-500/30 via-cyan-400/20 to-fuchsia-500/25 blur-[70px] will-change-transform"
            style={{ transform: `translateY(${y * 0.16}px)` }}
          />
        </div>

        <div
          className="relative z-10"
          style={{ transform: `translateY(${y * -0.06}px)`, opacity: Math.max(0, 1 - y / 720) }}
        >
          <span className="ld-card inline-flex items-center gap-2 px-3 py-1 text-xs text-cyan-200">
            ✦ AI 学习搭子 · 上传即总结
          </span>
          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-bold leading-[1.15] tracking-tight sm:text-6xl">
            <Typewriter text="把你的视频与文章" />
            <br />
            <span className="ld-grad-text">变成能追问的知识</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-300/90 sm:text-lg">
            上传视频或文章，自动转写、识别画面、生成带时间戳的总结；然后就内容自由追问，
            每个回答都标注来源。
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onEnter}
              className="ld-cta-grad rounded-xl px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition-transform hover:scale-[1.03]"
            >
              开始使用 →
            </button>
            <button
              onClick={() => scrollToSection("features")}
              className="ld-card px-7 py-3 text-sm text-slate-200 hover:text-white"
            >
              了解功能
            </button>
          </div>
        </div>

        <div className="ld-bounce absolute bottom-8 flex flex-col items-center gap-1 text-slate-400">
          <span className="text-[11px] tracking-widest">向下滚动</span>
          <ArrowDown className="h-4 w-4" />
        </div>
      </section>

      {/* 2. 痛点：3 张卡片渐入 */}
      <section id="pain" className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <p className="text-center text-xs uppercase tracking-[0.34em] text-cyan-300/80">Pain Points</p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">
              学的内容越来越多，记住的却越来越少
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PAINS.map((p, i) => (
              <Reveal key={p.title} delay={i * 130} className="h-full">
                <div className="ld-card h-full p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-cyan-400/20 text-cyan-200">
                    <p.Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300/85">{p.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 3. 解决方案：左右交替滑入 */}
      <section id="features" className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <p className="text-center text-xs uppercase tracking-[0.34em] text-cyan-300/80">Solution</p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">
              不止是摘要，而是可追问的知识
            </h2>
          </Reveal>

          <div className="mt-20 space-y-24">
            {FEATURES.map((f, i) => {
              const flip = i % 2 === 1;
              return (
                <div key={f.title} className="grid items-center gap-10 md:grid-cols-2">
                  <Reveal
                    variant={flip ? "right" : "left"}
                    className={flip ? "md:order-2" : ""}
                  >
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-cyan-200">
                      {f.tag}
                    </span>
                    <h3 className="mt-4 text-2xl font-bold tracking-tight">{f.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300/85">{f.desc}</p>
                    <ul className="mt-5 space-y-2 text-sm text-slate-300/80">
                      {f.points.map((pt) => (
                        <li key={pt} className="flex gap-2.5">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/70" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </Reveal>

                  <Reveal
                    variant={flip ? "left" : "right"}
                    delay={110}
                    className={flip ? "md:order-1" : ""}
                  >
                    <div className="ld-card aspect-video w-full overflow-hidden">
                      <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-500/25 via-transparent to-fuchsia-500/25">
                        <div className="ld-grid absolute inset-0 opacity-60" />
                        <f.Icon className="relative h-16 w-16 text-cyan-200/85" />
                      </div>
                    </div>
                  </Reveal>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4. 数据统计：数字跳动 */}
      <section id="stats" className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <p className="text-center text-xs uppercase tracking-[0.34em] text-cyan-300/80">By the numbers</p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">
              已经被这样用起来
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            {STATS.map((s, i) => (
              <Reveal key={s.label} variant="zoom" delay={i * 150} className="h-full">
                <div className="ld-card h-full p-8 text-center">
                  <div className="ld-grad-text text-4xl font-extrabold tabular-nums sm:text-5xl">
                    <CountUp to={s.value} decimals={s.decimals} suffix={s.suffix} />
                  </div>
                  <p className="mt-3 text-sm text-slate-300/80">{s.label}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 5. 用户评价：错落渐入 */}
      <section id="quotes" className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <p className="text-center text-xs uppercase tracking-[0.34em] text-cyan-300/80">Loved by learners</p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">他们这样说</h2>
          </Reveal>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {QUOTES.map((q, i) => (
              <Reveal
                key={q.name}
                delay={i * 120}
                className={`h-full ${i % 2 === 1 ? "lg:translate-y-5" : ""}`}
              >
                <figure className="ld-card flex h-full flex-col p-5">
                  <div className="flex gap-0.5 text-amber-300">
                    {Array.from({ length: 5 }).map((_, k) => (
                      <Star key={k} className="h-3.5 w-3.5 fill-current" />
                    ))}
                  </div>
                  <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-slate-200/90">
                    「{q.text}」
                  </blockquote>
                  <figcaption className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-400">
                    <span className="font-medium text-slate-200">{q.name}</span> · {q.role}
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 6. 底部 CTA：渐变动画 */}
      <section id="cta" className="relative z-10 px-6 pb-24 pt-6">
        <div className="mx-auto max-w-5xl">
          {/* 首次使用必读：必须配置大模型；顺带提供桌面快捷方式 */}
          <Reveal variant="zoom">
            <div className="ld-card mb-8 p-6 sm:p-8">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                开始之前，请先完成一次配置
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-300/85">
                「学习搭子」依赖大模型完成总结与问答：<b>本地 Ollama</b> 或{" "}
                <b>云端 API Key</b>（DeepSeek / 通义千问等均可）至少配置其一，
                <span className="text-amber-200">否则无法使用</span>。
                设置中心里有「?」悬停指引，教你一步步申请千问 API。
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={onConfigure || onEnter}
                  className="ld-cta-grad rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition-transform hover:scale-[1.03]"
                >
                  去配置大模型 / API →
                </button>

                <button
                  onClick={createShortcut}
                  disabled={shortcut === "creating" || shortcut === "done"}
                  className="ld-card inline-flex items-center gap-2 px-5 py-2.5 text-sm text-slate-200 hover:text-white disabled:opacity-70"
                  title="在桌面创建「学习搭子」快捷方式，以后双击即可启动"
                >
                  {shortcut === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <MonitorDown className="h-4 w-4" />
                  )}
                  {shortcut === "creating"
                    ? "正在创建…"
                    : shortcut === "done"
                      ? "快捷方式已就绪"
                      : "在桌面创建快捷方式"}
                </button>
              </div>
              {shortcutMsg && (
                <p
                  className={`mt-3 text-[11px] ${
                    shortcut === "failed" ? "text-red-400" : "text-emerald-300"
                  }`}
                >
                  {shortcutMsg}
                </p>
              )}
            </div>
          </Reveal>

          <Reveal variant="zoom">
            <div className="ld-cta-grad rounded-[26px] p-[1.5px] shadow-2xl shadow-indigo-950/40">
              <div className="rounded-[25px] bg-slate-950/85 px-8 py-14 text-center backdrop-blur-xl">
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">现在就上传第一份资料</h2>
                <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-300/85">
                  视频、文章都行。丢进来，几分钟后带走一份带时间戳的总结，和一个能回答你问题的知识库。
                </p>
                <button
                  onClick={onEnter}
                  className="ld-cta-grad mt-8 rounded-xl px-8 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
                >
                  进入学习搭子 →
                </button>
              </div>
            </div>
          </Reveal>
          <p className="mt-6 text-center text-xs text-slate-400/70">
            你的学习搭子 · 本地优先，资料不外传 · 按 Esc 也可进入
          </p>
        </div>
      </section>
    </div>
  );
}
