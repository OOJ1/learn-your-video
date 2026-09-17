import logging
import os
import subprocess
import sys
import threading
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import get_settings, reload_settings
from app.core.embeddings import get_embedder
from app.core.llm import get_llm

# app.* 下的 logger（如 app.video 的转写进度）统一输出到 stdout，
# 与 uvicorn 的 access log 一起落盘到 logs/backend.log（stderr 留给报错堆栈）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
for _noisy in ("httpx", "httpcore", "urllib3", "huggingface_hub", "faster_whisper"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

settings = get_settings()

app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api.routes_articles import router as articles_router  # noqa: E402
from app.api.routes_chat import router as chat_router  # noqa: E402
from app.api.routes_grabber import router as grabber_router  # noqa: E402
from app.api.routes_videos import router as videos_router  # noqa: E402

app.include_router(articles_router)
app.include_router(videos_router)
app.include_router(chat_router)
app.include_router(grabber_router)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "llm_provider": settings.LLM_PROVIDER,
        "embed_provider": settings.EMBED_PROVIDER,
        "search_provider": settings.SEARCH_PROVIDER,
    }


# study-buddy 项目根目录（backend/app/main.py -> 上溯三级到 E:\study-buddy）
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_STOP_SCRIPT = os.path.join(_PROJECT_ROOT, "stop.ps1")


@app.post("/api/stop")
async def stop_services():
    """停止整个「学习搭子」（后端 8000 + 前端 5173）。

    关键点：用一个独立的后台子进程执行 stop.ps1，先把 200 响应发回浏览器，
    再由它杀掉后端自身与前端的进程——否则自杀会卡在响应还没发出去。
    子进程的创建标志必须用 CREATE_NO_WINDOW，原因见下方注释。
    """
    def _trigger():
        try:
            # 等本请求的响应先通过网络送出去
            time.sleep(1.0)
            # 为什么不用 DETACHED_PROCESS：它创建的子进程没有控制台，而 powershell.exe
            # 是控制台程序——无控制台时会「启动即退出、什么都不执行」（实测连
            # `-Command "exit 7"` 都返回 0），于是停止脚本等于从没跑过，
            # 表现为「点了停止按钮但服务还在」。CREATE_NO_WINDOW 提供一个隐藏控制台，
            # 既能正常执行 PowerShell，又不会闪出黑窗口。
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            # 优先用 stop.ps1（与桌面「停止」完全一致）；失败再退回统一入口的 stop 动作
            for _args in (
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", _STOP_SCRIPT],
                ["cmd.exe", "/c", _LAUNCHER, "stop"],
            ):
                try:
                    subprocess.Popen(
                        _args,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        creationflags=flags,
                    )
                    return
                except Exception:
                    continue
        except Exception:
            pass

    threading.Thread(target=_trigger, daemon=True).start()
    return {"ok": True, "message": "正在停止服务，稍后页面将不可用，可关闭此窗口。"}


@app.get("/api/diagnose")
def diagnose():
    """逐项探测依赖可用性，前端启动时可据此提示用户"""
    out = {}
    for key, fn in (("llm", lambda: get_llm().health()),
                    ("embedding", lambda: get_embedder().health())):
        try:
            out[key] = fn()
        except Exception as e:
            out[key] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    try:
        import redis
        r = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=3)
        r.ping()
        out["redis"] = {"ok": True, "url": settings.REDIS_URL}
    except Exception as e:
        out["redis"] = {"ok": False, "url": settings.REDIS_URL,
                        "error": f"{type(e).__name__}: {e}"}
    return out


@app.get("/api/models")
def list_models():
    """列出当前 provider 可用模型，供前端下拉选择"""
    try:
        return {"ok": True, "models": get_llm().list_models()}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "models": []}


@app.get("/api/config")
def read_config():
    s = get_settings()
    from app.agents.search import web_search_status

    # 联网是否可用由后端唯一判定，前端只负责按结论锁定开关 + 显示原因
    web_ok, web_why = web_search_status()
    return {
        "app_name": s.APP_NAME,
        "llm_provider": s.LLM_PROVIDER,
        "llm_model": s.OPENAI_MODEL if s.LLM_PROVIDER == "openai" else s.OLLAMA_MODEL,
        "embed_provider": s.EMBED_PROVIDER,
        "embed_model": s.LOCAL_EMBED_MODEL if s.EMBED_PROVIDER == "local" else s.OPENAI_EMBED_MODEL,
        "search_provider": s.SEARCH_PROVIDER,
        "has_llm_key": bool(s.OPENAI_API_KEY) and not s.OPENAI_API_KEY.startswith("sk-REPLACE"),
        "has_tavily_key": bool(s.TAVILY_API_KEY),
        "web_search_available": web_ok,
        "web_search_reason": web_why,
        "video_top_k": s.VIDEO_TOP_K,
        "article_top_k": s.ARTICLE_TOP_K,
        "max_article_chars": s.MAX_ARTICLE_CHARS,
        "article_vectorize_min_chars": s.ARTICLE_VECTORIZE_MIN_CHARS,
    }


class _ConfigPatch(BaseModel):
    patch: dict


@app.post("/api/config/save")
def save_config(body: _ConfigPatch):
    """设置中心保存：只允许改写白名单内的键，写回 .env 后立即生效"""
    from app.config import EDITABLE_KEYS, save_settings

    patch = {k: str(v) for k, v in (body.patch or {}).items() if k in EDITABLE_KEYS}
    dropped = [k for k in (body.patch or {}) if k not in EDITABLE_KEYS]
    save_settings(patch)
    s = get_settings()
    return {
        "ok": True,
        "saved": sorted(patch),
        "ignored": dropped,
        "llm_provider": s.LLM_PROVIDER,
        "llm_model": s.OPENAI_MODEL if s.LLM_PROVIDER == "openai" else s.OLLAMA_MODEL,
        "search_provider": s.SEARCH_PROVIDER,
    }


@app.post("/api/config/reload")
def reload_config():
    s = reload_settings()
    # 与 read_config 保持一致：返回当前 provider 实际生效的模型
    model = s.OPENAI_MODEL if s.LLM_PROVIDER == "openai" else s.OLLAMA_MODEL
    return {"ok": True, "llm_provider": s.LLM_PROVIDER, "llm_model": model}


# ---------- 桌面快捷方式 ----------
# 启停已封装进单一入口「学习搭子.cmd」（菜单式：启动 / 停止 / 状态）。
# 快捷方式不带参数 → 打开菜单；带 start / stop 参数 → 直接执行对应动作。
_LAUNCHER = os.path.join(_PROJECT_ROOT, "学习搭子.cmd")
_SHORTCUT_NAME = "学习搭子.lnk"
# 快捷方式图标：优先用前端 public 里已做过多尺寸优化的 favicon.ico
_ICON_PATH = os.path.join(_PROJECT_ROOT, "frontend", "public", "favicon.ico")


@app.get("/api/shortcut/status")
def shortcut_status():
    """桌面是否已有「学习搭子」快捷方式"""
    if sys.platform != "win32":
        return {"ok": True, "supported": False, "exists": False}
    desktop = _get_desktop_dir()
    return {
        "ok": True,
        "supported": True,
        "exists": os.path.exists(os.path.join(desktop, _SHORTCUT_NAME)),
    }


@app.post("/api/shortcut/create")
def create_shortcut():
    """在桌面创建/更新「学习搭子.lnk」：双击打开统一入口（启动 / 停止 / 状态），并带上项目图标。

    幂等：已存在时也会重写一遍，这样早先创建（指向旧 start.cmd、没有图标）的
    快捷方式能借此一并修正。
    """
    if sys.platform != "win32":
        return {"ok": False, "supported": False, "message": "仅支持 Windows 桌面快捷方式"}
    try:
        desktop = _get_desktop_dir()
        lnk = os.path.join(desktop, _SHORTCUT_NAME)
        existed = os.path.exists(lnk)

        # 图标行：ico 存在才写（Windows 用 "路径,索引" 指定图标，0 = 第一个图标）
        icon_line = ""
        if os.path.exists(_ICON_PATH):
            icon_line = f"$sc.IconLocation = '{_ICON_PATH},0'; "

        ps = (
            "$ws = New-Object -ComObject WScript.Shell; "
            f"$sc = $ws.CreateShortcut('{lnk}'); "
            f"$sc.TargetPath = '{_LAUNCHER}'; "
            f"$sc.WorkingDirectory = '{_PROJECT_ROOT}'; "
            # 带 start 参数：双击桌面图标直接启动服务，不弹菜单。
            # 想停止时点网页右上角「停止」，或手动双击「学习搭子.cmd」进菜单选 2。
            "$sc.Arguments = 'start'; "
            "$sc.Description = '你的学习搭子 · 上传即总结'; "
            f"{icon_line}"
            "$sc.Save()"
        )
        r = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if r.returncode != 0 or not os.path.exists(lnk):
            return {"ok": False, "message": f"创建失败：{(r.stderr or r.stdout or '').strip()[:200]}"}
        return {
            "ok": True,
            "existed": existed,
            "path": lnk,
            "icon": _ICON_PATH if icon_line else None,
            "message": "已更新桌面快捷方式" if existed else "已在桌面创建「学习搭子」快捷方式",
        }
    except Exception as e:
        return {"ok": False, "message": f"创建失败：{type(e).__name__}: {e}"}


def _get_desktop_dir() -> str:
    """取真实桌面路径（OneDrive 重定向也能拿到）"""
    try:
        r = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command",
             "[Environment]::GetFolderPath('Desktop')"],
            capture_output=True, text=True, timeout=10,
        )
        d = (r.stdout or "").strip()
        if d:
            return d
    except Exception:
        pass
    return os.path.join(os.path.expanduser("~"), "Desktop")
