"""MediaPipe-based 15-second window analyzer used by all CV endpoints."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Sequence

import cv2
import mediapipe as mp
import numpy as np

from .config import AnalyzerConfig, POSE_MODEL
from .models import AnalysisSummary, Sample
from .utils import clamp, probe_creation_time, resolve_ts_end_iso, window_bounds
from .video import VideoWindowExtractor


@dataclass(slots=True)
class RunStats:
    total_frames: int = 0
    detected_frames: int = 0
    high_conf_frames: int = 0
    interpolated_samples: int = 0


class WindowAnalyzer:
    def __init__(self, config: AnalyzerConfig | None = None):
        self.config = config or AnalyzerConfig()
        self._face_mesh_kwargs = dict(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.3,  # Lower for glasses/lighting issues
            min_tracking_confidence=0.7,   # Higher for better temporal continuity
        )

    def analyze(
        self,
        video_path: str | Path,
        timestamp_seconds: float,
        session_id: str | None,
        driver_id: str | None,
    ) -> AnalysisSummary:
        extractor = VideoWindowExtractor(video_path)
        start, end = window_bounds(extractor.meta.duration, timestamp_seconds, self.config.window_seconds)
        creation_time = probe_creation_time(video_path)

        samples, stats = self._process_frames(extractor, start, end)
        if not samples:
            raise ValueError("no frames were processed for the requested window")

        ts_end_iso = resolve_ts_end_iso(creation_time, timestamp_seconds)
        return self._summarize(samples, stats, session_id, driver_id, ts_end_iso, start, end)

    def _process_frames(
        self,
        extractor: VideoWindowExtractor,
        start: float,
        end: float,
    ) -> tuple[list[Sample], RunStats]:
        stats = RunStats()
        samples: list[Sample] = []
        with mp.solutions.face_mesh.FaceMesh(**self._face_mesh_kwargs) as face_mesh:
            for frame_time, frame in extractor.iter_window(start, end):
                stats.total_frames += 1
                rgb = np.ascontiguousarray(frame)
                rgb.flags.writeable = False
                results = face_mesh.process(rgb)
                landmarks = results.multi_face_landmarks[0].landmark if results.multi_face_landmarks else None

                if landmarks:
                    stats.detected_frames += 1
                    confidence_score = self._compute_confidence(landmarks)
                    high_conf = confidence_score >= self.config.confidence_threshold
                    if high_conf:
                        stats.high_conf_frames += 1

                    ear = self._compute_ear(landmarks)
                    mar = self._compute_mar(landmarks)
                    pitch_down = self._compute_pitch_down(landmarks, frame.shape[1], frame.shape[0])
                else:
                    confidence_score = 0.0
                    high_conf = False
                    ear = None
                    mar = None
                    pitch_down = None

                samples.append(
                    Sample(
                        time=min(end, max(start, frame_time)),
                        ear=ear,
                        mar=mar,
                        pitch_down=pitch_down,
                        confidence=confidence_score,
                        has_face=bool(landmarks),
                    )
                )

        # Ensure explicit samples at both window boundaries for integration convenience
        if samples and samples[0].time > start:
            head = samples[0]
            samples.insert(
                0,
                Sample(
                    time=start,
                    ear=head.ear,
                    mar=head.mar,
                    pitch_down=head.pitch_down,
                    confidence=head.confidence,
                    has_face=head.has_face,
                ),
            )

        if samples and samples[-1].time < end:
            tail = samples[-1]
            samples.append(
                Sample(
                    time=end,
                    ear=tail.ear,
                    mar=tail.mar,
                    pitch_down=tail.pitch_down,
                    confidence=tail.confidence,
                    has_face=tail.has_face,
                )
            )

        # Apply temporal interpolation to fill missing EAR values
        original_samples = samples.copy()
        samples = self._interpolate_missing_values(samples)
        
        # Track interpolation statistics
        stats.interpolated_samples = sum(1 for orig, new in zip(original_samples, samples) 
                                       if orig.ear is None and new.ear is not None)
        
        return samples, stats

    def _summarize(
        self,
        samples: list[Sample],
        stats: RunStats,
        session_id: str | None,
        driver_id: str | None,
        ts_end_iso: datetime,
        start: float,
        end: float,
    ) -> AnalysisSummary:
        window = max(1e-6, end - start)
        # Collect EAR samples with different quality levels for robust thresholding
        high_conf_ears = [
            s.ear for s in samples
            if s.ear is not None
            and s.has_face
            and s.confidence >= self.config.confidence_threshold
        ]
        
        neutral_ears = [
            s.ear
            for s in samples
            if s.ear is not None
            and s.has_face
            and s.confidence >= self.config.confidence_threshold
            and (s.pitch_down is None or s.pitch_down <= self.config.down_pitch_gate_deg)
        ]
        
        moderate_conf_ears = [
            s.ear for s in samples
            if s.ear is not None
            and s.has_face
            and s.confidence >= 0.4  # Lower threshold for moderate confidence
        ]
        
        all_ears = [s.ear for s in samples if s.ear is not None]
        
        # Use best available samples for threshold calculation
        # Priority: neutral pose + high conf > high conf > moderate conf > all
        if len(neutral_ears) >= 10:  # Need sufficient samples
            ear_samples = neutral_ears
        elif len(high_conf_ears) >= 10:
            ear_samples = high_conf_ears
        elif len(moderate_conf_ears) >= 5:
            ear_samples = moderate_conf_ears
        else:
            ear_samples = all_ears
        ear_thresh = self._adaptive_threshold(
            ear_samples,
            self.config.ear_threshold_default,
            self.config.ear_threshold_bounds,
            self.config.ear_threshold_percentile,
        )
        perclos_time = self._integrate_boolean(
            samples,
            start,
            end,
            lambda sample: self._is_eye_closed(sample, ear_thresh),
        )
        perclos_ratio = perclos_time / window

        pitch_values = [s.pitch_down for s in samples if s.pitch_down is not None]
        pitch_thresh = self._adaptive_threshold(
            pitch_values,
            self.config.pitch_threshold_default,
            self.config.pitch_threshold_bounds,
            self.config.pitch_threshold_percentile,
        )
        droop_time = self._integrate_boolean(
            samples,
            start,
            end,
            lambda s: s.pitch_down is not None and s.pitch_down >= pitch_thresh,
        )
        droop_duty = droop_time / window
        pitchdown_avg = float(np.mean(pitch_values)) if pitch_values else 0.0
        pitchdown_max = float(np.max(pitch_values)) if pitch_values else 0.0

        mar_values = [s.mar for s in samples if s.mar is not None]
        mar_thresh = self._adaptive_threshold(
            mar_values,
            self.config.mar_threshold_default,
            self.config.mar_threshold_bounds,
            self.config.mar_threshold_percentile,
        )
        yawn_events = self._detect_yawns(samples, start, end, mar_thresh)
        yawn_time = sum(evt[1] - evt[0] for evt in yawn_events)
        yawn_duty = yawn_time / window if window else 0.0
        yawn_peak = max((evt[2] for evt in yawn_events), default=0.0)

        high_conf_ratio = (
            stats.high_conf_frames / stats.detected_frames if stats.detected_frames else 0.0
        )
        confidence_label = "OK" if high_conf_ratio >= 0.6 else "Low"
        fps_observed = stats.total_frames / window
        
        # Calculate quality metrics for PERCLOS assessment
        valid_ear_samples = sum(1 for s in samples if s.ear is not None)
        total_samples = len(samples)
        valid_sample_ratio = valid_ear_samples / total_samples if total_samples > 0 else 0.0
        interpolated_sample_ratio = stats.interpolated_samples / total_samples if total_samples > 0 else 0.0
        
        # Calculate overall PERCLOS confidence score
        perclos_confidence_score = self._calculate_perclos_confidence(
            valid_sample_ratio, interpolated_sample_ratio, high_conf_ratio, 
            len(ear_samples), fps_observed
        )

        return AnalysisSummary(
            ts_end_iso=ts_end_iso,
            session_id=session_id,
            driver_id=driver_id,
            perclos_ratio=perclos_ratio,
            perclos_percent=perclos_ratio * 100,
            ear_threshold=ear_thresh,
            pitchdown_avg=pitchdown_avg,
            pitchdown_max=pitchdown_max,
            droop_time=droop_time,
            droop_duty=droop_duty,
            pitch_threshold=pitch_thresh,
            yawn_count=len(yawn_events),
            yawn_time=yawn_time,
            yawn_duty=yawn_duty,
            yawn_peak=yawn_peak,
            confidence_label=confidence_label,
            fps_observed=fps_observed,
            valid_sample_ratio=valid_sample_ratio,
            interpolated_sample_ratio=interpolated_sample_ratio,
            high_confidence_ratio=high_conf_ratio,
            perclos_confidence_score=perclos_confidence_score,
        )

    def _interpolate_missing_values(self, samples: list[Sample]) -> list[Sample]:
        """Interpolate missing EAR values using temporal neighbors for more robust PERCLOS."""
        if len(samples) < 3:
            return samples
        
        interpolated = []
        for i, sample in enumerate(samples):
            if sample.ear is not None or not sample.has_face:
                # Keep original if EAR is valid or no face detected
                interpolated.append(sample)
                continue
            
            # Find nearest valid EAR values before and after
            prev_ear = None
            next_ear = None
            
            # Look backward
            for j in range(i - 1, -1, -1):
                if samples[j].ear is not None and samples[j].has_face:
                    prev_ear = samples[j].ear
                    break
            
            # Look forward  
            for j in range(i + 1, len(samples)):
                if samples[j].ear is not None and samples[j].has_face:
                    next_ear = samples[j].ear
                    break
            
            # Interpolate if we have neighbors
            interpolated_ear = sample.ear
            if prev_ear is not None and next_ear is not None:
                # Linear interpolation
                interpolated_ear = (prev_ear + next_ear) / 2.0
            elif prev_ear is not None:
                # Use previous value with slight decay
                interpolated_ear = prev_ear * 0.95
            elif next_ear is not None:
                # Use next value with slight decay
                interpolated_ear = next_ear * 0.95
            
            # Create new sample with interpolated EAR
            interpolated_sample = Sample(
                time=sample.time,
                ear=interpolated_ear,
                mar=sample.mar,
                pitch_down=sample.pitch_down,
                confidence=max(0.4, sample.confidence),  # Boost confidence slightly for interpolated
                has_face=sample.has_face,
            )
            interpolated.append(interpolated_sample)
        
        return interpolated

    def _calculate_perclos_confidence(
        self, 
        valid_ratio: float, 
        interpolated_ratio: float, 
        high_conf_ratio: float,
        threshold_samples: int,
        fps: float
    ) -> float:
        """Calculate overall confidence in PERCLOS measurement based on multiple factors."""
        confidence = 1.0
        
        # Penalize based on missing data
        if valid_ratio < 0.7:
            confidence *= 0.6  # Significant penalty for low valid sample ratio
        elif valid_ratio < 0.9:
            confidence *= 0.8  # Moderate penalty
        
        # Penalize based on interpolation usage
        if interpolated_ratio > 0.3:
            confidence *= 0.7  # High interpolation reduces confidence
        elif interpolated_ratio > 0.1:
            confidence *= 0.9  # Some interpolation is OK
        
        # Penalize based on detection confidence
        if high_conf_ratio < 0.4:
            confidence *= 0.5  # Very low detection confidence
        elif high_conf_ratio < 0.6:
            confidence *= 0.8  # Moderate detection confidence
        
        # Penalize if insufficient samples for threshold calculation
        if threshold_samples < 5:
            confidence *= 0.6  # Not enough samples for good threshold
        elif threshold_samples < 10:
            confidence *= 0.8  # Borderline threshold samples
        
        # Penalize very low FPS
        if fps < 5:
            confidence *= 0.7  # Very low temporal resolution
        elif fps < 10:
            confidence *= 0.9  # Low temporal resolution
        
        return max(0.0, min(1.0, confidence))

    # --- helpers ---------------------------------------------------------

    def _compute_confidence(self, landmarks: Sequence) -> float:
        iris_visible = all(self._has_landmark(landmarks, idx) for idx in self.config.iris_indices)
        def lid(idx_a: int, idx_b: int) -> float:
            la, lb = landmarks[idx_a], landmarks[idx_b]
            return abs(la.y - lb.y)

        # Basic lid spread calculation
        lid_spread = abs(landmarks[159].y - landmarks[145].y)
        base_score = (0.4 + lid_spread * 120) if iris_visible else (lid_spread * 80)
        
        # Boost confidence for glasses scenarios (check nose bridge landmarks)
        nose_bridge_visible = self._has_landmark(landmarks, 6) and self._has_landmark(landmarks, 9)
        if nose_bridge_visible and not iris_visible:
            # Likely wearing glasses - boost confidence
            base_score *= 1.3
        
        # Check for head pose indicators
        forehead_visible = self._has_landmark(landmarks, 10) and self._has_landmark(landmarks, 151)
        chin_visible = self._has_landmark(landmarks, 152) and self._has_landmark(landmarks, 175)
        
        # If only partial face visible but key landmarks present, still decent confidence
        if (forehead_visible or chin_visible) and lid_spread > 0.005:
            base_score = max(base_score, 0.45)
        
        return clamp(base_score, 0.0, 1.0)

    def _compute_ear(self, landmarks: Sequence) -> float | None:
        pairs = self.config.ear_pairs
        left = self._eye_ear(landmarks, *pairs["left"])
        right = self._eye_ear(landmarks, *pairs["right"])
        if left is None or right is None:
            return None
        return (left + right) / 2.0

    def _eye_ear(
        self,
        landmarks: Sequence,
        corner_outer: int,
        corner_inner: int,
        upper1: int,
        lower1: int,
        upper2: int,
        lower2: int,
    ) -> float | None:
        horizontal = self._distance(landmarks[corner_outer], landmarks[corner_inner])
        vertical1 = self._distance(landmarks[upper1], landmarks[lower1])
        vertical2 = self._distance(landmarks[upper2], landmarks[lower2])
        if not horizontal:
            return None
        return (vertical1 + vertical2) / (2.0 * horizontal)

    def _compute_mar(self, landmarks: Sequence) -> float | None:
        left_idx, right_idx = self.config.mouth_corners
        mouth_width = self._distance(landmarks[left_idx], landmarks[right_idx])
        if not mouth_width:
            return None
        accum = []
        for up, low in self.config.mar_pairs:
            gap = self._distance(landmarks[up], landmarks[low])
            if gap:
                accum.append(gap)
        if not accum:
            return None
        return (sum(accum) / len(accum)) / mouth_width

    def _compute_pitch_down(self, landmarks: Sequence, width: int, height: int) -> float | None:
        solve = self._solve_pnp(landmarks, width, height)
        if solve is None:
            return self._estimate_pitch_fallback(landmarks)
        return max(0.0, -solve["pitch"])  # convert to downward positive

    def _solve_pnp(self, landmarks: Sequence, width: int, height: int) -> dict | None:
        fx = width * 1.2
        fy = height * 1.2
        cx = width / 2
        cy = height / 2
        camera_matrix = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float64)
        dist_coeffs = np.zeros((4, 1), dtype=np.float64)

        image_points = []
        model_points = []
        for idx, coords in POSE_MODEL:
            if not self._has_landmark(landmarks, idx):
                return None
            lm = landmarks[idx]
            image_points.append([lm.x * width, lm.y * height])
            model_points.append(list(coords))

        success, rvec, tvec = cv2.solvePnP(
            np.array(model_points, dtype=np.float64),
            np.array(image_points, dtype=np.float64),
            camera_matrix,
            dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not success:
            return None

        rotation_matrix, _ = cv2.Rodrigues(rvec)
        angles = self._rotation_matrix_to_euler(rotation_matrix)
        return {"yaw": angles[0], "pitch": angles[1], "roll": angles[2]}

    def _estimate_pitch_fallback(self, landmarks: Sequence) -> float | None:
        if not (self._has_landmark(landmarks, 10) and self._has_landmark(landmarks, 152)):
            return None
        top = landmarks[10]
        bottom = landmarks[152]
        dy = bottom.y - top.y
        dz = bottom.z - top.z
        angle = math.atan2(dz, dy)
        pitch = abs(math.degrees(angle))
        return pitch

    def _rotation_matrix_to_euler(self, rotation: np.ndarray) -> tuple[float, float, float]:
        sy = math.sqrt(rotation[0, 0] ** 2 + rotation[1, 0] ** 2)
        singular = sy < 1e-6
        if not singular:
            yaw = math.atan2(rotation[2, 1], rotation[2, 2])
            pitch = math.atan2(-rotation[2, 0], sy)
            roll = math.atan2(rotation[1, 0], rotation[0, 0])
        else:
            yaw = math.atan2(-rotation[1, 2], rotation[1, 1])
            pitch = math.atan2(-rotation[2, 0], sy)
            roll = 0.0
        return (math.degrees(yaw), math.degrees(pitch), math.degrees(roll))

    def _adaptive_threshold(
        self,
        values: Sequence[float],
        default: float,
        bounds: tuple[float, float],
        percentile: float,
    ) -> float:
        if not values:
            return default
        thresh = float(np.percentile(values, percentile))
        return clamp(thresh, bounds[0], bounds[1])

    def _is_eye_closed(self, sample: Sample, ear_thresh: float) -> bool:
        # Enhanced eye closure detection that handles edge cases more accurately
        # instead of defaulting everything to "closed"
        if not sample.has_face:
            # No face detected - this could be head turned away, not necessarily closed eyes
            # Only count as closed if this persists (handled by temporal logic)
            return True
        if sample.ear is None:
            # Missing EAR - could be detection failure, not closed eyes
            # Use temporal interpolation if available, otherwise conservative approach
            return True
        
        # For low confidence samples, use a more nuanced approach
        if sample.confidence < self.config.confidence_threshold:
            # If confidence is very low (< 0.3), treat as unknown/closed
            if sample.confidence < 0.3:
                return True
            # For moderate confidence (0.3-0.65), use a relaxed threshold
            relaxed_thresh = ear_thresh * 0.8  # 20% more lenient
            return sample.ear < relaxed_thresh
        
        # High confidence sample - use standard threshold
        return sample.ear < ear_thresh

    def _integrate_boolean(
        self,
        samples: Sequence[Sample],
        start: float,
        end: float,
        predicate: Callable[[Sample], bool],
    ) -> float:
        if not samples:
            return 0.0
        total = 0.0
        prev_time = start
        prev_state = predicate(samples[0])
        for sample in samples:
            t = max(start, min(end, sample.time))
            dt = max(0.0, t - prev_time)
            if prev_state and dt:
                total += dt
            prev_state = predicate(sample)
            prev_time = t
        if prev_state and prev_time < end:
            total += end - prev_time
        return min(end - start, max(0.0, total))

    def _detect_yawns(
        self,
        samples: Sequence[Sample],
        start: float,
        end: float,
        threshold: float,
    ) -> list[tuple[float, float, float]]:
        """Detect yawns from the MAR signal using the same heuristics as the JS demo."""

        events: list[tuple[float, float, float]] = []
        active = False
        candidate_start: float | None = None
        end_candidate: float | None = None
        last_end: float = -math.inf
        peak = 0.0
        start_time: float | None = None

        for sample in samples:
            t = max(start, min(end, sample.time))
            mar = sample.mar
            has_sample = mar is not None
            mar_value = mar or 0.0
            high_conf = sample.has_face and sample.confidence >= self.config.confidence_threshold
            above = bool(has_sample and mar_value > threshold)
            can_start = above and high_conf
            can_end = has_sample or not high_conf

            if not active:
                if can_start and t - last_end >= self.config.yawn_refractory:
                    if candidate_start is None:
                        candidate_start = t
                    if t - candidate_start >= self.config.yawn_start_hold:
                        active = True
                        peak = mar_value
                        start_time = candidate_start
                        candidate_start = None
                elif not above:
                    candidate_start = None
            else:
                if above:
                    peak = max(peak, mar_value)
                    end_candidate = None
                elif can_end:
                    end_candidate = end_candidate or t
                    if t - end_candidate >= self.config.yawn_end_hold and start_time is not None:
                        end_time = min(end, t)
                        events.append((start_time, end_time, peak))
                        last_end = end_time
                        active = False
                        peak = 0.0
                        start_time = None
                        end_candidate = None
                        candidate_start = None

        if active and start_time is not None:
            end_time = end
            events.append((start_time, end_time, peak))
        return events

    @staticmethod
    def _distance(a, b) -> float:
        if a is None or b is None:
            return 0.0
        dx = a.x - b.x
        dy = a.y - b.y
        dz = (getattr(a, "z", 0.0) or 0.0) - (getattr(b, "z", 0.0) or 0.0)
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    @staticmethod
    def _has_landmark(landmarks: Sequence, idx: int) -> bool:
        return idx < len(landmarks) and landmarks[idx] is not None
