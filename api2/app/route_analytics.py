from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
from typing import Any

from . import snowflake_db
from .models import (
    RouteAnalyticsRequest,
    RouteAnalyticsResponse,
    RouteAnalyticsRow,
)

CORTEX_MODEL = os.getenv("SNOWFLAKE_CORTEX_MODEL", "mistral-7b")
DEFAULT_LOOKBACK_DAYS = 30

ROUTE_ANALYTICS_SQL_TEMPLATE = """
WITH base AS (
    SELECT
        route_id,
        driver_id,
        window_ts,
        perclos_30s,
        yawn_count_30s,
        yawn_duty_30s,
        droop_duty_30s,
        pitchdown_avg_30s,
        pitchdown_max_30s,
        driver_state,
        risk_score
    FROM ROUTE_WINDOW_METRICS
    {where_clause}
),
agg AS (
    SELECT
        route_id,
        COUNT(*) AS window_count,
        AVG(risk_score) AS avg_risk,
        AVG(perclos_30s) AS avg_perclos,
        AVG(yawn_duty_30s) AS avg_yawn_duty,
        AVG(droop_duty_30s) AS avg_droop_duty,
        AVG(yawn_count_30s) AS avg_yawn_count,
        AVG(pitchdown_max_30s) AS avg_pitch_max,
        AVG(pitchdown_avg_30s) AS avg_pitch_avg,
        SUM(CASE WHEN driver_state = 'Drowsy' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS drowsy_rate,
        SUM(CASE WHEN driver_state = 'Asleep' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS asleep_rate,
        MAX(risk_score) AS peak_risk
    FROM base
    GROUP BY route_id
),
riskiest AS (
    SELECT route_id, window_ts, risk_score
    FROM (
        SELECT
            route_id,
            window_ts,
            risk_score,
            ROW_NUMBER() OVER (PARTITION BY route_id ORDER BY risk_score DESC, window_ts DESC) AS rn
        FROM base
    )
    WHERE rn = 1
)
SELECT
    a.route_id,
    a.window_count,
    a.avg_risk,
    a.avg_perclos,
    a.avg_yawn_duty,
    a.avg_droop_duty,
    a.avg_yawn_count,
    a.avg_pitch_max,
    a.avg_pitch_avg,
    a.drowsy_rate,
    a.asleep_rate,
    a.peak_risk,
    r.window_ts AS riskiest_ts,
    r.risk_score AS riskiest_risk,
    c.route_length_km,
    c.visibility_avg_km,
    c.elevation_change_m,
    c.intersection_count,
    c.nighttime_proportion,
    c.rest_stops_per_100km
FROM agg a
LEFT JOIN riskiest r ON r.route_id = a.route_id
LEFT JOIN ROUTE_CHARACTERISTICS c ON c.route_id = a.route_id
WHERE a.window_count >= %s
ORDER BY a.avg_risk DESC
{limit_clause}
"""


def run_route_analytics(payload: RouteAnalyticsRequest) -> RouteAnalyticsResponse:
    rows = _query_route_rows(payload)
    if payload.include_narrative and rows:
        narratives = _generate_cortex_recommendations(rows)
    else:
        narratives = {}

    enriched_rows: list[RouteAnalyticsRow] = []
    for row in rows:
        normalized = { (k.upper() if isinstance(k, str) else k): v for k, v in row.items() }
        route_id = normalized.get("ROUTE_ID")
        if not route_id:
            continue
        payload_dict = {
            "route_id": route_id,
            "window_count": int(normalized.get("WINDOW_COUNT", 0) or 0),
            "avg_risk": _to_float(normalized.get("AVG_RISK")) or 0.0,
            "drowsy_rate": _to_float(normalized.get("DROWSY_RATE")) or 0.0,
            "asleep_rate": _to_float(normalized.get("ASLEEP_RATE")) or 0.0,
            "avg_perclos": _to_float(normalized.get("AVG_PERCLOS")) or 0.0,
            "avg_yawn_duty": _to_float(normalized.get("AVG_YAWN_DUTY")) or 0.0,
            "avg_droop_duty": _to_float(normalized.get("AVG_DROOP_DUTY")) or 0.0,
            "avg_yawn_count": _to_float(normalized.get("AVG_YAWN_COUNT")),
            "avg_pitch_max": _to_float(normalized.get("AVG_PITCH_MAX")),
            "avg_pitch_avg": _to_float(normalized.get("AVG_PITCH_AVG")),
            "peak_risk": _to_float(normalized.get("PEAK_RISK")),
            "riskiest_ts": normalized.get("RISKIEST_TS"),
            "riskiest_risk": _to_float(normalized.get("RISKIEST_RISK")),
            "route_length_km": _to_float(normalized.get("ROUTE_LENGTH_KM")),
            "visibility_avg_km": _to_float(normalized.get("VISIBILITY_AVG_KM")),
            "elevation_change_m": _to_float(normalized.get("ELEVATION_CHANGE_M")),
            "intersection_count": _to_float(normalized.get("INTERSECTION_COUNT")),
            "nighttime_proportion": _to_float(normalized.get("NIGHTTIME_PROPORTION")),
            "rest_stops_per_100km": _to_float(normalized.get("REST_STOPS_PER_100KM")),
            "cortex_summary": narratives.get(normalized.get("ROUTE_ID")),
        }
        enriched_rows.append(RouteAnalyticsRow(**payload_dict))

    return RouteAnalyticsResponse(
        generated_at=datetime.now(timezone.utc),
        routes=enriched_rows,
    )


def _query_route_rows(payload: RouteAnalyticsRequest) -> list[dict[str, Any]]:
    start, end = _normalize_range(payload)
    filters = []
    params: list[Any] = []

    if start is not None:
        filters.append("window_ts >= %s")
        params.append(start.isoformat())
    if end is not None:
        filters.append("window_ts <= %s")
        params.append(end.isoformat())
    if payload.route_ids:
        placeholders = ",".join(["%s"] * len(payload.route_ids))
        filters.append(f"route_id IN ({placeholders})")
        params.extend(payload.route_ids)

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    limit_clause = ""
    if payload.limit:
        limit_clause = f"LIMIT {int(payload.limit)}"

    min_windows = payload.min_windows or 20
    params.append(min_windows)

    sql = ROUTE_ANALYTICS_SQL_TEMPLATE.format(
        where_clause=where_clause,
        limit_clause=limit_clause,
    )
    return snowflake_db.fetchall(sql, tuple(params))


def _normalize_range(payload: RouteAnalyticsRequest) -> tuple[datetime | None, datetime | None]:
    now = datetime.now(timezone.utc)
    start = _ensure_timezone(payload.start)
    end = _ensure_timezone(payload.end)

    if start and end:
        return min(start, end), max(start, end)

    fallback_days = payload.lookback_days or DEFAULT_LOOKBACK_DAYS
    if start and not end:
        return start, start + timedelta(days=fallback_days)
    if end and not start:
        return end - timedelta(days=fallback_days), end

    return now - timedelta(days=fallback_days), now


def _ensure_timezone(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _generate_cortex_recommendations(rows: list[dict[str, Any]]) -> dict[str, str]:
    summaries: dict[str, str] = {}
    for row in rows:
        route_id = row.get("ROUTE_ID")
        if not route_id:
            continue
        prompt = _build_prompt(row)
        try:
            result = snowflake_db.fetchall(
                "SELECT SNOWFLAKE.CORTEX.COMPLETE(%s, %s) AS summary",
                (CORTEX_MODEL, prompt),
            )
        except Exception as exc:
            summaries[route_id] = f"Cortex unavailable: {exc}"
            continue
        if result:
            summary_value = result[0].get("SUMMARY") or result[0].get("summary")
            if isinstance(summary_value, (str, bytes)):
                summaries[route_id] = summary_value if isinstance(summary_value, str) else summary_value.decode("utf-8", "ignore")
            else:
                summaries[route_id] = str(summary_value)
    return summaries


def _build_prompt(row: dict[str, Any]) -> str:
    route_id = row.get("ROUTE_ID", "unknown route")
    avg_risk = _to_float(row.get("AVG_RISK")) or 0.0
    drowsy_rate = (_to_float(row.get("DROWSY_RATE")) or 0.0) * 100
    asleep_rate = (_to_float(row.get("ASLEEP_RATE")) or 0.0) * 100
    perclos = (_to_float(row.get("AVG_PERCLOS")) or 0.0) * 100
    yaw_duty = (_to_float(row.get("AVG_YAWN_DUTY")) or 0.0) * 100
    droop = (_to_float(row.get("AVG_DROOP_DUTY")) or 0.0) * 100
    nighttime = (_to_float(row.get("NIGHTTIME_PROPORTION")) or 0.0) * 100
    rest_stops = _to_float(row.get("REST_STOPS_PER_100KM"))

    return (
        "You are the operations analyst for Lucid Freight. "
        f"Summarize fatigue risk for route {route_id} in 3 concise bullet points. "
        f"Metrics: avg risk {avg_risk:.1f}/100, drowsy rate {drowsy_rate:.1f}%, asleep rate {asleep_rate:.1f}%, "
        f"avg PERCLOS {perclos:.1f}%, avg yawn duty {yaw_duty:.1f}%, avg droop duty {droop:.1f}%, "
        f"nighttime driving {nighttime:.1f}%, rest stops per 100km {rest_stops or 'unknown'}. "
        "Recommend an actionable change (schedule shift, rest stop planning, or coaching) and call out the biggest business impact."
    )


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
