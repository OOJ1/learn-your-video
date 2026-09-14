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
} from "lucide-react";
import "./landing.css";

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
  { value: 50, decimals: 0, suffix: "+", label: "支持语言" },
  { value: 91.78, decimals: 2, suffix: "%", label: "服务可用性" },
];

const QUOTES = [
  { name: "林同学", role: "研究生", text: "一节 90 分钟的公开课，先扫一遍要点，只跳着看关键段落，时间省了一大半。" },
  { name: "Kevin", role: "产品经理", text: "访谈视频里的图表以前全靠截图记，现在画面要点直接列出来，还能跳回原位置。" },
  { name: "阿哲", role: "考证党", text: "知识笔记整理得很像人写的，拿来当复习提纲改一改就能用。" },
  { name: "Mia", role: "内容运营", text: "英文视频转写不会被乱翻译，问答时引用来源标得清清楚楚，很省心。" },
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
  enterLabel = "跳过 →",
}: {
  onEnter: () => void;
  /** 右上角按钮文案：首次进入是「跳过」，从应用内回看时是「返回应用」 */
  enterLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [y, setY] = useState(0);

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

  return (
    <div ref={rootRef} className="ld-root">
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
            className="h-[520px] w-[520px] rounded-full bg-gradient-to-tr from-indigo-500/30 via-cyan-400/20 to-fuchsia-500/25 blur-[90px]"
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
            <a
              href="#features"
              className="ld-card px-7 py-3 text-sm text-slate-200 hover:text-white"
            >
              了解功能
            </a>
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
