"""Load route telemetry + characteristics into Snowflake for analytics.

Usage:
    cd api2
    python scripts/load_route_data.py \
        --windows /path/to/lucid_all_routes_800.csv \
        --routes /path/to/route_characteristics.csv \
        --truncate

Environment:
    Relies on the same SNOWFLAKE_* variables as app/snowflake_db.py.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from app import snowflake_db
from app.models import StateRequest
from app.state_classifier import DriverStateClassifier


WINDOW_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ROUTE_WINDOW_METRICS (
    route_id STRING,
    driver_id STRING,
    window_ts TIMESTAMP_TZ,
    perclos_30s FLOAT,
    pitchdown_avg_30s FLOAT,
    pitchdown_max_30s FLOAT,
    droop_time_30s FLOAT,
    droop_duty_30s FLOAT,
    yawn_count_30s INT,
    yawn_time_30s FLOAT,
    yawn_duty_30s FLOAT,
    yawn_peak_30s FLOAT,
    driver_state STRING,
    risk_score FLOAT,
    created_at TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP()
)
"""

ROUTE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ROUTE_CHARACTERISTICS (
    route_id STRING,
    route_length_km FLOAT,
    visibility_avg_km FLOAT,
    elevation_change_m FLOAT,
    intersection_count FLOAT,
    nighttime_proportion FLOAT,
    rest_stops_per_100km FLOAT,
    updated_at TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP()
)
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load Lucid telemetry CSVs into Snowflake.")
    parser.add_argument("--windows", required=True, help="Path to lucid_all_routes_800.csv")
    parser.add_argument("--routes", required=True, help="Path to route_characteristics.csv")
    parser.add_argument("--truncate", action="store_true", help="Truncate destination tables before insert.")
    parser.add_argument("--max-rows", type=int, default=None, help="Optional cap on rows for quick tests.")
    return parser.parse_args()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        return [row for row in reader]


def stable_route_for_driver(driver_id: str, route_ids: list[str]) -> str:
    digest = hashlib.sha256(driver_id.encode("utf-8")).hexdigest()
    idx = int(digest, 16) % len(route_ids)
    return route_ids[idx]


def to_state_request(row: dict[str, str], session_id: str) -> StateRequest:
    ts_raw = row["TIMESTAMP"]
    ts_str = ts_raw.replace("Z", "+00:00")
    ts = datetime.fromisoformat(ts_str)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    else:
        ts = ts.astimezone(timezone.utc)

    def _float(key: str, default: float = 0.0) -> float:
        value = row.get(key)
        if value in (None, "", "null"):
            return default
        return float(value)

    def _int(key: str, default: int = 0) -> int:
        value = row.get(key)
        if value in (None, "", "null"):
            return default
        return int(float(value))

    return StateRequest(
        ts_end=ts,
        session_id=session_id,
        driver_id=row["DRIVER_ID"],
        perclos_30s=_float("PERCLOS_30S"),
        ear_thresh_T=0.2,
        pitchdown_avg_30s=_float("PITCHDOWN_AVG_30S"),
        pitchdown_max_30s=_float("PITCHDOWN_MAX_30S"),
        droop_time_30s=_float("DROOP_TIME_30S"),
        droop_duty_30s=_float("DROOP_DUTY_30S"),
        pitch_thresh_Tp=20.0,
        yawn_count_30s=_int("YAWN_COUNT_30S"),
        yawn_time_30s=_float("YAWN_TIME_30S"),
        yawn_duty_30s=_float("YAWN_DUTY_30S"),
        yawn_peak_30s=_float("YAWN_PEAK_30S"),
        confidence="OK",
        fps=30.0,
    )


def chunked(iterable: Iterable[Any], size: int) -> Iterable[list[Any]]:
    batch: list[Any] = []
    for item in iterable:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def main() -> None:
    args = parse_args()
    windows_path = Path(args.windows).expanduser()
    routes_path = Path(args.routes).expanduser()

    window_rows = read_csv(windows_path)
    route_rows = read_csv(routes_path)
    if args.max_rows:
        window_rows = window_rows[: args.max_rows]

    route_ids = [row["ROUTE_ID"] for row in route_rows]
    if not route_ids:
        raise SystemExit("route_characteristics.csv did not contain any rows.")
    classifier = DriverStateClassifier()

    telemetry_payloads = []
    for row in window_rows:
        driver_id = row["DRIVER_ID"]
        route_id = stable_route_for_driver(driver_id, route_ids)
        session_id = f"{driver_id}::{route_id}"
        request = to_state_request(row, session_id)
        state = classifier.classify(request)
        telemetry_payloads.append(
            (
                route_id,
                driver_id,
                request.ts_end,
                request.perclos_30s or 0.0,
                request.pitchdown_avg_30s or 0.0,
                request.pitchdown_max_30s or 0.0,
                request.droop_time_30s or 0.0,
                request.droop_duty_30s or 0.0,
                request.yawn_count_30s or 0,
                request.yawn_time_30s or 0.0,
                request.yawn_duty_30s or 0.0,
                request.yawn_peak_30s or 0.0,
                state.state,
                state.risk_score,
            )
        )

    conn = snowflake_db.get_conn()
    cur = conn.cursor()
    try:
        cur.execute(ROUTE_TABLE_SQL)
        cur.execute(WINDOW_TABLE_SQL)
        if args.truncate:
            cur.execute("TRUNCATE TABLE ROUTE_CHARACTERISTICS")
            cur.execute("TRUNCATE TABLE ROUTE_WINDOW_METRICS")

        route_insert_sql = """
            INSERT INTO ROUTE_CHARACTERISTICS
            (route_id, route_length_km, visibility_avg_km, elevation_change_m, intersection_count, nighttime_proportion, rest_stops_per_100km)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
        """
        route_payloads = [
            (
                row["ROUTE_ID"],
                float(row.get("ROUTE_LENGTH_KM", 0) or 0),
                float(row.get("VISIBILITY_AVG_KM", 0) or 0),
                float(row.get("ELEVATION_CHANGE_M", 0) or 0),
                float(row.get("INTERSECTION_COUNT", 0) or 0),
                float(row.get("NIGHTTIME_PROPORTION", 0) or 0),
                float(row.get("REST_STOPS_PER_100KM", 0) or 0),
            )
            for row in route_rows
        ]
        if route_payloads:
            cur.execute("TRUNCATE TABLE ROUTE_CHARACTERISTICS")
            cur.executemany(route_insert_sql, route_payloads)
            print(f"[Snowflake] Loaded {len(route_payloads)} route definitions.")

        window_insert_sql = """
            INSERT INTO ROUTE_WINDOW_METRICS (
                route_id,
                driver_id,
                window_ts,
                perclos_30s,
                pitchdown_avg_30s,
                pitchdown_max_30s,
                droop_time_30s,
                droop_duty_30s,
                yawn_count_30s,
                yawn_time_30s,
                yawn_duty_30s,
                yawn_peak_30s,
                driver_state,
                risk_score
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        inserted = 0
        for batch in chunked(telemetry_payloads, 200):
            cur.executemany(window_insert_sql, batch)
            inserted += len(batch)
        print(f"[Snowflake] Inserted {inserted} telemetry windows across {len(route_ids)} routes.")

        conn.commit()
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
