import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { PlayerMarker } from "../lib/api";
import { cn, fmtTime } from "../lib/utils";

const RATES = [0.75, 1, 1.25, 1.5, 2];
/** 悬停时判定为「命中某个时间戳」的横向容差（百分比） */
const SNAP_TOLERANCE = 3.5;

export interface VideoPlayerHandle {
  /** 跳转到指定秒数并播放（供要点/时间轴点击使用） */
  seek: (sec: number) => void;
  element: () => HTMLVideoElement | null;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/**
 * 自绘控制条的播放器：
 * - 进度条上按「核心要点」的起始秒数打刻度，悬停显示该要点内容，点击精确跳到该点
 * - 进度条任意位置悬停显示时间气泡，按住可拖动定位
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, { src: string; markers?: PlayerMarker[] }>(
  function VideoPlayer({ src, markers = [] }, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    const [playing, setPlaying] = useState(false);
    const [cur, setCur] = useState(0);
    const [dur, setDur] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [rate, setRate] = useState(1);
    const [muted, setMuted] = useState(false);
    const [hoverPct, setHoverPct] = useState<number | null>(null);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const [wrapW, setWrapW] = useState(0);
    const [barTop, setBarTop] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        seek(sec: number) {
          const v = videoRef.current;
          if (!v) return;
          const max = v.duration || dur || sec;
          const target = Math.max(0, Math.min(sec, max));
          v.currentTime = target;
          setCur(target);
          v.play().catch(() => {});
        },
        element: () => videoRef.current,
      }),
      [dur]
    );

    // 播放进度与状态同步：播放中用 rAF 平滑推进进度条
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      let raf = 0;

      const tick = () => {
        setCur(v.currentTime);
        if (!v.paused && !v.ended) raf = requestAnimationFrame(tick);
      };
      const onPlay = () => {
        setPlaying(true);
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      };
      const onPause = () => {
        setPlaying(false);
        cancelAnimationFrame(raf);
        setCur(v.currentTime);
      };
      const onMeta = () => {
        setDur(v.duration || 0);
        setCur(v.currentTime || 0);
      };
      const onProgress = () => {
        try {
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
        } catch {
          /* 忽略：部分浏览器在 seek 过程中会抛错 */
        }
      };
      const onRate = () => setRate(v.playbackRate);
      const onVolume = () => setMuted(v.muted || v.volume === 0);

      v.addEventListener("play", onPlay);
      v.addEventListener("pause", onPause);
      v.addEventListener("ended", onPause);
      v.addEventListener("loadedmetadata", onMeta);
      v.addEventListener("durationchange", onMeta);
      v.addEventListener("progress", onProgress);
      v.addEventListener("ratechange", onRate);
      v.addEventListener("volumechange", onVolume);
      onMeta();

      return () => {
        cancelAnimationFrame(raf);
        v.removeEventListener("play", onPlay);
        v.removeEventListener("pause", onPause);
        v.removeEventListener("ended", onPause);
        v.removeEventListener("loadedmetadata", onMeta);
        v.removeEventListener("durationchange", onMeta);
        v.removeEventListener("progress", onProgress);
        v.removeEventListener("ratechange", onRate);
        v.removeEventListener("volumechange", onVolume);
      };
    }, []);

    // 切换视频时重置显示，并显式让 <video> 重新加载资源。
    // 只改 src 属性在个别浏览器上会出现"画面仍是上一个视频 / 黑屏"的情况，
    // 手动 load() 可以确保新视频立刻生效，不必刷新页面。
    useEffect(() => {
      setCur(0);
      setDur(0);
      setBuffered(0);
      setPlaying(false);
      setHoverPct(null);
      setHoverIdx(null);
      try {
        videoRef.current?.load();
      } catch {
        /* 某些浏览器在无 src 时 load() 会抛错，忽略 */
      }
    }, [src]);

    // 记录播放器宽度与进度条纵向位置：悬停卡片要按像素夹在可视区内，
    // 不能只按百分比定位（否则靠近两端会探出容器被圆角 overflow-hidden 裁掉）
    useEffect(() => {
      const el = wrapRef.current;
      if (!el) return;
      const sync = () => {
        setWrapW(el.clientWidth);
        const b = barRef.current;
        if (b) setBarTop(b.getBoundingClientRect().top - el.getBoundingClientRect().top);
      };
      sync();
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const toggle = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }, []);

    const toggleMute = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      v.muted = !v.muted;
    }, []);

    const changeRate = useCallback((r: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.playbackRate = r;
      setRate(r);
    }, []);

    const toggleFullscreen = useCallback(() => {
      const el = wrapRef.current;
      if (!el) return;
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else el.requestFullscreen?.().catch(() => {});
    }, []);

    const pctOf = useCallback(
      (sec: number) => (dur > 0 ? clampPct((sec / dur) * 100) : 0),
      [dur]
    );

    /** 找出鼠标位置最近的时间戳刻度（超出容差返回 null） */
    const nearestIdx = useCallback(
      (pct: number) => {
        if (!markers.length || dur <= 0) return null;
        let best = -1;
        let bestDiff = Infinity;
        markers.forEach((m, i) => {
          const d = Math.abs(pctOf(m.t) - pct);
          if (d < bestDiff) {
            bestDiff = d;
            best = i;
          }
        });
        return bestDiff <= SNAP_TOLERANCE ? best : null;
      },
      [markers, dur, pctOf]
    );

    const ratioFromX = (clientX: number) => {
      const r = barRef.current?.getBoundingClientRect();
      if (!r || !r.width) return 0;
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    };

    const applyRatio = (ratio: number) => {
      const v = videoRef.current;
      if (!v || !dur) return;
      v.currentTime = ratio * dur;
      setCur(ratio * dur);
    };

    const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dur) return;
      e.stopPropagation();
      draggingRef.current = true;
      barRef.current?.setPointerCapture(e.pointerId);
      const ratio = ratioFromX(e.clientX);
      const pct = ratio * 100;
      const idx = nearestIdx(pct);
      if (idx != null) {
        // 命中刻度：精确跳到该要点的时间点
        applyRatio(clampPct(pctOf(markers[idx].t)) / 100);
      } else {
        applyRatio(ratio);
      }
      setHoverPct(pct);
      setHoverIdx(idx);
    };

    const onBarMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dur) return;
      const ratio = ratioFromX(e.clientX);
      const pct = ratio * 100;
      if (draggingRef.current) applyRatio(ratio);
      setHoverPct(pct);
      setHoverIdx(nearestIdx(pct));
    };

    const onBarUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try {
        barRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* 指针已释放时忽略 */
      }
    };

    const onBarKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const v = videoRef.current;
      if (!v) return;
      const step = e.shiftKey ? 30 : 5;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        v.currentTime = Math.min(dur || v.duration || 0, v.currentTime + step);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        v.currentTime = Math.max(0, v.currentTime - step);
      } else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        toggle();
      }
    };

    const curPct = pctOf(cur);
    const bufPct = pctOf(buffered);
    const activeMarker = hoverIdx != null ? markers[hoverIdx] : null;

    // 悬停卡片定位（按像素夹紧）：
    // 卡片有固定宽度且以锚点居中，若只用百分比定位，靠近进度条两端时卡片会探出播放器，
    // 被外层圆角容器的 overflow-hidden 裁掉 —— 表现为时间戳和文字缺一截。
    const BAR_PAD = 12; // 控制条 px-3
    const barW = Math.max(1, (wrapW || 320) - BAR_PAD * 2);
    const cardW = Math.min(280, Math.max(150, (wrapW || 320) - 16));
    const half = cardW / 2;
    const lo = half - BAR_PAD + 8; // 允许向左借一点控制条内边距，再留 8px 安全边
    const hi = barW - half + BAR_PAD - 8;
    const tipLeft =
      hoverPct == null || hi <= lo
        ? barW / 2
        : Math.min(Math.max((hoverPct / 100) * barW, lo), hi);
    // 卡片最高约 156px（头部 + 5 行文字 + 脚注）；上方放不下就翻到进度条下面
    const TIP_H = 156;
    const flipDown = !!activeMarker && barTop < TIP_H + 10;

    return (
      <div
        ref={wrapRef}
        className="vp-wrap group relative select-none overflow-hidden rounded-xl border bg-black"
      >
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          onClick={toggle}
          onDoubleClick={toggleFullscreen}
          className="block w-full cursor-pointer"
        />

        {/* 暂停时的中央播放按钮 */}
        {!playing && (
          <button
            onClick={toggle}
            aria-label="播放"
            className="absolute inset-0 z-10 flex items-center justify-center"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/25 backdrop-blur transition-transform hover:scale-105">
              <Play className="ml-0.5 h-6 w-6 text-white" />
            </span>
          </button>
        )}

        {/* 控制条 */}
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-2 pt-8">
          {/* 进度条：刻度 = 核心要点的时间点 */}
          <div
            ref={barRef}
            role="slider"
            tabIndex={0}
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(cur)}
            onPointerDown={onBarDown}
            onPointerMove={onBarMove}
            onPointerUp={onBarUp}
            onPointerCancel={onBarUp}
            onPointerLeave={() => {
              if (!draggingRef.current) {
                setHoverPct(null);
                setHoverIdx(null);
              }
            }}
            onKeyDown={onBarKey}
            className="group/bar relative flex h-5 cursor-pointer touch-none items-center outline-none"
          >
            <div className="relative h-1.5 w-full rounded-full bg-white/25 transition-all group-hover/bar:h-2">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/30"
                style={{ width: `${bufPct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-sky-400"
                style={{ width: `${curPct}%` }}
              />

              {/* 核心要点时间戳刻度 */}
              {markers.map((m, i) => (
                <span
                  key={i}
                  aria-label={`${fmtTime(m.t)} 核心要点`}
                  className={cn(
                    "absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-all",
                    hoverIdx === i ? "h-4 w-[4px] bg-amber-300 shadow" : "bg-amber-300/75"
                  )}
                  style={{ left: `${pctOf(m.t)}%` }}
                />
              ))}

              {/* 播放头 */}
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-sky-400/70"
                style={{ left: `${curPct}%` }}
              />
            </div>

            {/* 悬停竖线 */}
            {hoverPct != null && (
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-white/60"
                style={{ left: `${hoverPct}%` }}
              />
            )}

            {/* 悬停提示：命中刻度 → 显示该时间段的内容；否则显示时间气泡 */}
            {hoverPct != null && (
              <div
                className={cn(
                  "pointer-events-none absolute z-30 -translate-x-1/2",
                  flipDown ? "top-full mt-1.5" : "bottom-full mb-1.5"
                )}
                style={{ left: `${tipLeft}px` }}
              >
                {activeMarker ? (
                  <div
                    className="rounded-lg bg-neutral-900/95 p-2.5 text-left text-xs leading-relaxed text-white shadow-xl ring-1 ring-white/20"
                    style={{ width: `${cardW}px` }}
                  >
                    <div className="mb-1 flex items-center gap-1 font-mono text-[11px] text-amber-300">
                      <Play className="h-2.5 w-2.5 shrink-0" />
                      <span className="shrink-0">{fmtTime(activeMarker.t)}</span>
                      <span className="shrink-0 text-white/45">核心要点</span>
                    </div>
                    <div className="line-clamp-5 text-white/90">{activeMarker.text}</div>
                    <div className="mt-1 text-[10px] text-white/45">点击跳到这一点</div>
                  </div>
                ) : (
                  <span className="rounded bg-neutral-900/90 px-1.5 py-0.5 font-mono text-[11px] text-white ring-1 ring-white/15">
                    {fmtTime((hoverPct / 100) * (dur || 0))}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 按钮行 */}
          <div className="mt-1 flex items-center gap-2 text-white">
            <button
              onClick={toggle}
              aria-label={playing ? "暂停" : "播放"}
              className="rounded-md p-1 transition-colors hover:bg-white/15"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="font-mono text-[11px] tabular-nums text-white/90">
              {fmtTime(cur)} / {fmtTime(dur)}
            </span>
            {markers.length > 0 && (
              <span className="hidden text-[11px] text-white/55 sm:inline">
                · 进度条上 {markers.length} 个核心要点，悬停可看内容
              </span>
            )}
            <div className="flex-1" />
            <select
              value={rate}
              onChange={(e) => changeRate(Number(e.target.value))}
              aria-label="播放速度"
              className="rounded bg-white/10 px-1 py-0.5 text-[11px] text-white outline-none hover:bg-white/20"
            >
              {RATES.map((r) => (
                <option key={r} value={r} className="text-neutral-900">
                  {r}x
                </option>
              ))}
            </select>
            <button
              onClick={toggleMute}
              aria-label={muted ? "取消静音" : "静音"}
              className="rounded-md p-1 transition-colors hover:bg-white/15"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              onClick={toggleFullscreen}
              aria-label="全屏"
              className="rounded-md p-1 transition-colors hover:bg-white/15"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }
);
