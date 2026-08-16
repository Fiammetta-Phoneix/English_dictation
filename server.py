"""Local-only web server and English transcription API for Dictation."""

from __future__ import annotations

import json
import hashlib
import mimetypes
import os
import re
import tempfile
import threading
from datetime import datetime
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / ".models"
RUNTIME_DIR = ROOT / ".runtime"
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
ALLOWED_MODELS = {"tiny.en", "base.en", "small.en"}
ALLOWED_SELECTION_COUNTS = {0, 10, 20, 30}
FAVORITES_PATH = ROOT / "例句.md"
favorites_lock = threading.Lock()


def format_srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def clean_segment_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def merge_transcript_segments(segments: list[dict]) -> list[dict]:
    """Join Whisper chunks into sentence-like units instead of exposing decoder cuts."""
    merged = []
    current = None

    def flush():
        nonlocal current
        if current:
            current["text"] = clean_segment_text(current["text"])
            merged.append(current)
            current = None

    for segment in segments:
        if current and segment["start"] - current["end"] > 1.25:
            flush()
        if current is None:
            current = dict(segment)
        else:
            current["text"] = f"{current['text']} {segment['text']}"
            current["end"] = segment["end"]

        word_count = len(segment_words(current["text"]))
        duration = current["end"] - current["start"]
        sentence_ended = bool(re.search(r"[.!?][\"']?$", current["text"].strip()))
        if (sentence_ended and word_count >= 4) or word_count >= 32 or duration >= 18:
            flush()
    flush()

    # A very short trailing decoder fragment usually belongs to the preceding sentence.
    repaired = []
    for segment in merged:
        words = segment_words(segment["text"])
        if repaired and len(words) < 5:
            previous = repaired[-1]
            gap = segment["start"] - previous["end"]
            combined_words = len(segment_words(previous["text"])) + len(words)
            if gap <= 1.25 and combined_words <= 40:
                previous["text"] = clean_segment_text(f"{previous['text']} {segment['text']}")
                previous["end"] = segment["end"]
                continue
        repaired.append(segment)
    return repaired


def segment_words(text: str) -> list[str]:
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())


def curate_segments(segments: list[dict], target_count: int) -> list[dict]:
    """Select useful dictation sentences while rejecting trivial or repetitive ones."""
    if target_count == 0:
        return segments

    filler_words = {"um", "uh", "erm", "hmm", "yeah", "okay", "like"}
    accepted = []
    accepted_sets = []
    ranked = []
    for segment in segments:
        words = segment_words(segment["text"])
        if not 7 <= len(words) <= 36:
            continue
        unique_ratio = len(set(words)) / len(words)
        filler_ratio = sum(word in filler_words for word in words) / len(words)
        if unique_ratio < 0.55 or filler_ratio > 0.18:
            continue
        word_set = set(words)
        duration = max(0.1, segment["end"] - segment["start"])
        speech_rate = len(words) / duration
        if speech_rate < 0.7 or speech_rate > 5.5:
            continue
        length_score = min(len(words), 22) - abs(16 - min(len(words), 16)) * 0.25
        complexity_score = sum(len(word) for word in words) / len(words)
        completeness_bonus = 3 if re.search(r"[.!?][\"']?$", segment["text"].strip()) else -2
        score = length_score + complexity_score * 1.4 + unique_ratio * 6 - filler_ratio * 20 + completeness_bonus
        ranked.append((score, segment, word_set))

    for _, segment, word_set in sorted(ranked, key=lambda item: item[0], reverse=True):
        duplicate = False
        for previous_set in accepted_sets:
            union = word_set | previous_set
            similarity = len(word_set & previous_set) / len(union) if union else 1
            if similarity >= 0.72:
                duplicate = True
                break
        if duplicate:
            continue
        accepted.append(segment)
        accepted_sets.append(word_set)
        if len(accepted) >= target_count:
            break

    return sorted(accepted, key=lambda segment: segment["start"])


def transcribe_audio(audio_path: Path, model_name: str, selection_count: int = 0) -> dict:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("识别组件尚未安装，请先运行 setup.bat。") from exc

    MODEL_DIR.mkdir(exist_ok=True)
    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        download_root=str(MODEL_DIR),
    )
    segments_iter, info = model.transcribe(
        str(audio_path),
        language="en",
        task="transcribe",
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=True,
    )
    segments = []
    for segment in segments_iter:
        text = clean_segment_text(segment.text)
        if not text:
            continue
        segments.append({
            "start": round(float(segment.start), 3),
            "end": round(float(segment.end), 3),
            "text": text,
        })

    raw_segment_count = len(segments)
    segments = merge_transcript_segments(segments)
    total_segments = len(segments)
    segments = curate_segments(segments, selection_count)
    srt_blocks = []
    import_lines = []
    for index, segment in enumerate(segments, 1):
        start = format_srt_time(segment["start"])
        end = format_srt_time(segment["end"])
        srt_blocks.append(f"{index}\n{start} --> {end}\n{segment['text']}")
        import_lines.append(f"{start} --> {end} | {segment['text']}")

    return {
        "language": info.language,
        "language_probability": round(float(info.language_probability), 4),
        "duration": round(float(info.duration), 2),
        "segments": segments,
        "total_segments": total_segments,
        "raw_segment_count": raw_segment_count,
        "selected_segments": len(segments),
        "selection_count": selection_count,
        "srt": "\n\n".join(srt_blocks),
        "import_text": "\n".join(import_lines),
        "model": model_name,
    }


class DictationHandler(SimpleHTTPRequestHandler):
    server_version = "DictationLocal/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/api/health":
            self.send_json({"ok": True})
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/transcribe":
            self.handle_transcription()
        elif path == "/api/favorites":
            self.handle_favorite()
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def handle_favorite(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        if not 0 < content_length <= 64 * 1024:
            self.send_json({"error": "收藏内容大小不正确。"}, HTTPStatus.BAD_REQUEST)
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            english = clean_segment_text(str(payload.get("en", "")))
            chinese = clean_segment_text(str(payload.get("zh", "")))
            source = clean_segment_text(str(payload.get("source", "")))
            time_range = clean_segment_text(str(payload.get("time", "")))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json({"error": "收藏数据格式不正确。"}, HTTPStatus.BAD_REQUEST)
            return
        if not english or len(english) > 2000:
            self.send_json({"error": "英文例句为空或过长。"}, HTTPStatus.BAD_REQUEST)
            return

        sentence_id = hashlib.sha256(english.casefold().encode("utf-8")).hexdigest()[:16]
        marker = f"<!-- sentence:{sentence_id} -->"
        with favorites_lock:
            existing = FAVORITES_PATH.read_text(encoding="utf-8") if FAVORITES_PATH.exists() else ""
            if marker in existing:
                self.send_json({"ok": True, "duplicate": True, "path": str(FAVORITES_PATH)})
                return
            if not existing:
                existing = "# 收藏例句\n\n"
            block = [marker, f"## {english}", "", f"- 中文：{chinese or '未提供'}"]
            if source:
                block.append(f"- 来源：{source}")
            if time_range:
                block.append(f"- 时间：{time_range}")
            block.extend([f"- 收藏时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", "", ""])
            FAVORITES_PATH.write_text(existing.rstrip() + "\n\n" + "\n".join(block), encoding="utf-8")
        self.send_json({"ok": True, "duplicate": False, "path": str(FAVORITES_PATH)})

    def handle_transcription(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            self.send_json({"error": "没有收到音频文件。"}, HTTPStatus.BAD_REQUEST)
            return
        if content_length > MAX_UPLOAD_BYTES:
            self.send_json({"error": "音频文件超过 500 MB 限制。"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.send_json({"error": "请求格式不正确。"}, HTTPStatus.BAD_REQUEST)
            return

        body = self.rfile.read(content_length)
        message = BytesParser(policy=default).parsebytes(
            b"Content-Type: " + content_type.encode("ascii") + b"\r\n\r\n" + body
        )
        audio_part = None
        model_name = "base.en"
        selection_count = 0
        for part in message.iter_parts():
            field_name = part.get_param("name", header="content-disposition")
            if field_name == "audio":
                audio_part = part
            elif field_name == "model":
                model_name = part.get_content().strip()
            elif field_name == "selection_count":
                try:
                    selection_count = int(part.get_content().strip())
                except ValueError:
                    selection_count = -1

        if audio_part is None:
            self.send_json({"error": "没有找到音频字段。"}, HTTPStatus.BAD_REQUEST)
            return
        if model_name not in ALLOWED_MODELS:
            self.send_json({"error": "不支持所选模型。"}, HTTPStatus.BAD_REQUEST)
            return
        if selection_count not in ALLOWED_SELECTION_COUNTS:
            self.send_json({"error": "不支持所选精选数量。"}, HTTPStatus.BAD_REQUEST)
            return

        original_name = audio_part.get_filename() or "audio.mp3"
        suffix = Path(original_name).suffix.lower() or mimetypes.guess_extension(audio_part.get_content_type()) or ".audio"
        RUNTIME_DIR.mkdir(exist_ok=True)
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(dir=RUNTIME_DIR, suffix=suffix, delete=False) as temp_file:
                temp_file.write(audio_part.get_payload(decode=True))
                temp_path = Path(temp_file.name)
            result = transcribe_audio(temp_path, model_name, selection_count)
            self.send_json(result)
        except Exception as exc:
            self.log_error("transcription failed: %s", exc)
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
        finally:
            if temp_path:
                temp_path.unlink(missing_ok=True)

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    host = "127.0.0.1"
    port = int(os.environ.get("DICTATION_PORT", "8767"))
    RUNTIME_DIR.mkdir(exist_ok=True)
    pid_path = RUNTIME_DIR / "server.pid"
    try:
        server = ThreadingHTTPServer((host, port), DictationHandler)
    except OSError as exc:
        raise SystemExit(f"无法启动：端口 {port} 已被其他程序占用。") from exc
    pid_path.write_text(str(os.getpid()), encoding="ascii")
    print(f"Dictation is running at http://{host}:{port}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        pid_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
