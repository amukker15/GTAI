from __future__ import annotations

import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Union


TimestampInput = Union[str, float, int]


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def parse_timestamp(value: TimestampInput) -> float:
    """Accept floats, ints, or timecode strings (HH:MM:SS[.mmm])."""

    if isinstance(value, (float, int)):
        seconds = float(value)
        if seconds < 0:
            raise ValueError("timestamp must be non-negative")
        return seconds

    value = str(value).strip()
    if not value:
        raise ValueError("timestamp is required")

    try:
        seconds = float(value)
        if seconds < 0:
            raise ValueError
        return seconds
    except ValueError:
        pass

    if ":" in value:
        parts = value.split(":")
        if len(parts) > 3:
            raise ValueError(f"invalid timecode: {value}")
        seconds = 0.0
        for part in parts:
            if not part:
                raise ValueError(f"invalid timecode: {value}")
            seconds = seconds * 60 + float(part)
        if seconds < 0:
            raise ValueError
        return seconds

    raise ValueError(f"unable to parse timestamp '{value}'")


def probe_creation_time(path: Union[str, Path]) -> datetime | None:
    """Use ffprobe (if available) to pull the recording start time."""

    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        str(path),
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            check=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    creation_raw = payload.get("format", {}).get("tags", {}).get("creation_time")
    if not creation_raw:
        return None

    try:
        if creation_raw.endswith("Z"):
            creation_raw = creation_raw[:-1] + "+00:00"
        return datetime.fromisoformat(creation_raw)
    except ValueError:
        return None


def window_bounds(duration: float | None, ts_end: float, window_seconds: float) -> tuple[float, float]:
    print(f"[WindowBounds] Processing timestamp {ts_end}s, duration={duration}s, window={window_seconds}s")
    
    if duration and duration > 0 and ts_end > duration:
        print(f"[WindowBounds] ERROR: timestamp {ts_end}s exceeds video duration {duration}s")
        raise ValueError(
            f"timestamp {ts_end:.2f}s exceeds video duration {duration:.2f}s"
        )
    
    start = ts_end - window_seconds
    print(f"[WindowBounds] Calculated start={start}s, end={ts_end}s")
    
    if start < 0:
        # For demo purposes, when we don't have enough history, start from beginning
        # This handles the video loop case where timestamps < 15s are requested
        print(f"[WindowBounds] Adjusting window for timestamp {ts_end}s: using 0s-{ts_end}s instead of {start}s-{ts_end}s")
        start = 0.0
        # If the available window is too short, extend to minimum viable window
        if ts_end < 5.0:  # Need at least 5 seconds for meaningful analysis
            old_ts_end = ts_end
            ts_end = min(5.0, duration or 5.0)
            print(f"[WindowBounds] Extended short window: {old_ts_end}s -> {ts_end}s")
    
    print(f"[WindowBounds] Final window: {start}s to {ts_end}s")
    return start, ts_end


def resolve_ts_end_iso(
    creation_time: datetime | None, offset_seconds: float
) -> datetime:
    if creation_time:
        return creation_time + timedelta(seconds=offset_seconds)
    return datetime.now(timezone.utc)
