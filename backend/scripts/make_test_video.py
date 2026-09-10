"""生成测试视频：edge-tts 合成中文语音 + ffmpeg 压成 mp4。

用法: python scripts/make_test_video.py <文本文件> <名称>
例  : python scripts/make_test_video.py data/samples/vlog_cafe.txt test_vlog

文本走文件传入（UTF-8），避免命令行中文编码问题。
"""
import asyncio
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import edge_tts  # noqa: E402

from app.services.video import resolve_ffmpeg  # noqa: E402

VOICE = "zh-CN-XiaoxiaoNeural"


async def tts(text: str, out: pathlib.Path) -> None:
    await edge_tts.Communicate(text, VOICE).save(str(out))


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit("usage: python scripts/make_test_video.py <text_file> <name>")
    text_file, name = pathlib.Path(sys.argv[1]), sys.argv[2]
    if not text_file.exists():
        sys.exit(f"文本文件不存在: {text_file}")

    d = pathlib.Path("data")
    d.mkdir(exist_ok=True)
    mp3, mp4 = d / f"{name}.mp3", d / f"{name}.mp4"

    asyncio.run(tts(text_file.read_text(encoding="utf-8").strip(), mp3))
    print("audio:", mp3, mp3.stat().st_size, "bytes")

    cmd = [resolve_ffmpeg(), "-y", "-f", "lavfi", "-i", "color=c=navy:s=640x360:r=10",
           "-i", str(mp3), "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
           "-c:a", "aac", str(mp4)]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if p.returncode != 0 or not mp4.exists():
        print("ffmpeg 失败:", (p.stderr or "")[-400:])
        sys.exit(1)
    print("video:", mp4, mp4.stat().st_size, "bytes")
    print("NAME=" + name)


if __name__ == "__main__":
    main()