"""Helper for extracting the requested 30-second slice from uploaded videos."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterator, Tuple

import cv2

from .models import StreamMeta


class VideoWindowExtractor:
    def __init__(self, path: str | Path):
        self.path = str(path)
        self.meta = self._inspect()

    def _inspect(self) -> StreamMeta:
        cap = cv2.VideoCapture(self.path)
        if not cap.isOpened():
            raise ValueError(f"unable to open video at {self.path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        if fps <= 0:
            fps = 30.0
        raw_frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        frame_count = int(raw_frame_count) if raw_frame_count and raw_frame_count > 0 else 0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
        duration = (frame_count / fps) if frame_count > 0 else None
        cap.release()

        return StreamMeta(
            fps=fps,
            frame_count=frame_count,
            duration=duration,
            width=width,
            height=height,
        )

    def iter_window(self, start: float, end: float) -> Iterator[Tuple[float, Any]]:
        cap = cv2.VideoCapture(self.path)
        if not cap.isOpened():
            raise ValueError(f"unable to open video at {self.path}")

        fps = self.meta.fps or 30.0
        # Try to seek directly; if it fails, fall back to manual skip
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0, start) * 1000)

        current_time = start
        frame_index = 0
        while current_time <= end:
            success, frame = cap.read()
            if not success:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            yield current_time, rgb
            frame_index += 1
            current_time = start + frame_index / fps

        cap.release()
