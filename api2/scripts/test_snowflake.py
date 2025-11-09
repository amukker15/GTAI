"""Simple script to validate a live Snowflake connection and query the two tables.

Run this locally after setting the environment variables. It prints current user
and counts from `DRIVERS` and `DROWSINESS_MEASUREMENTS` under the configured
database/schema. This script intentionally does not contain any credentials.

Example (PowerShell):
  $env:SNOWFLAKE_USER = "FAWAZSABIR"
  $env:SNOWFLAKE_PASSWORD = "H4ackathon25!!!"
  $env:SNOWFLAKE_ACCOUNT = "NV61963"
  $env:SNOWFLAKE_WAREHOUSE = "COMPUTE_WH"
  $env:SNOWFLAKE_DATABASE = "LCD_ENDPOINTS"
  $env:SNOWFLAKE_SCHEMA = "PUBLIC"
  python scripts/test_snowflake.py
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import Any

try:
    import dotenv
    dotenv.load_dotenv()
except Exception:
    # python-dotenv is optional; environment variables can be set directly.
    pass

import snowflake.connector


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        print(f"ERROR: environment variable {name} is required", file=sys.stderr)
        sys.exit(2)
    return v


def insert_measurement_row(
    cur,
    conn,
    database: str | None,
    schema: str | None,
    payload: dict[str, Any],
    fallback_driver: str,
    fallback_session: str,
    ts_seconds: int,
) -> None:
    """Insert an aggregate window payload into DROWSINESS_MEASUREMENTS."""

    driver_value = payload.get("driver_id") or fallback_driver or "demo_driver"
    session_value = payload.get("session_id") or fallback_session or f"{driver_value}_session"
    ts_value = payload.get("ts_end")
    if not ts_value:
        ts_value = datetime.now(timezone.utc).isoformat()

    measurement = {
        "driver_id": driver_value,
        "session_id": session_value,
        "ts": ts_value,
        "perclos": payload.get("perclos_30s"),
        "perclos_percent": payload.get("PERCLOS"),
        "ear_threshold": payload.get("ear_thresh_T"),
        "pitchdown_avg": payload.get("pitchdown_avg_30s"),
        "pitchdown_max": payload.get("pitchdown_max_30s"),
        "droop_time": payload.get("droop_time_30s"),
        "droop_duty": payload.get("droop_duty_30s"),
        "pitch_threshold": payload.get("pitch_thresh_Tp"),
        "yawn_count": payload.get("yawn_count_30s"),
        "yawn_time": payload.get("yawn_time_30s"),
        "yawn_duty": payload.get("yawn_duty_30s"),
        "yawn_peak": payload.get("yawn_peak_30s"),
        "confidence": payload.get("confidence"),
        "fps": payload.get("fps"),
    }

    table_parts = [p for p in (database, schema, "DROWSINESS_MEASUREMENTS") if p]
    table_name = ".".join(table_parts) if table_parts else "DROWSINESS_MEASUREMENTS"
    columns = ",".join(measurement.keys())
    placeholders = ",".join(["%s"] * len(measurement))
    sql = f"INSERT INTO {table_name} ({columns}) VALUES ({placeholders})"
    cur.execute(sql, list(measurement.values()))
    conn.commit()
    print(
        f"[Snowflake] Inserted row for driver={driver_value}, session={session_value}, "
        f"timestamp={ts_value}, window={ts_seconds}s"
    )


def main() -> None:
    user = require_env("SNOWFLAKE_USER")
    password = require_env("SNOWFLAKE_PASSWORD")
    # Account locator may be incomplete in some setups; allow specifying
    # a full host via SNOWFLAKE_HOST (e.g. nv61963.us-east-1.snowflakecomputing.com)
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    host = os.getenv("SNOWFLAKE_HOST")
    if not account and not host:
        print("ERROR: either SNOWFLAKE_ACCOUNT or SNOWFLAKE_HOST must be set", file=sys.stderr)
        sys.exit(2)
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE", "LCD_ENDPOINTS")
    schema = os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC")

    conn_kwargs: dict[str, Any] = dict(
        user=user,
        password=password,
        database=database,
        schema=schema,
    )
    # Prefer host override when provided (useful when account locator needs
    # region/org qualifiers). The connector accepts a 'host' argument. Some
    # connector versions still require an 'account' param — derive it from the
    # host when missing.
    if host:
        conn_kwargs["host"] = host
        # Snowflake connector often still requires an 'account' param even when
        # a host is supplied. Prefer an explicit SNOWFLAKE_ACCOUNT if provided,
        # otherwise derive it from the host's left-most label.
        if account:
            conn_kwargs["account"] = account
        else:
            derived = host.split(".")[0]
            conn_kwargs["account"] = derived
    else:
        conn_kwargs["account"] = account
    if warehouse:
        conn_kwargs["warehouse"] = warehouse

    print("Connecting to Snowflake with:")
    print(f"  user={user}")
    print(f"  account={account}")
    print(f"  database={database}, schema={schema}")
    if warehouse:
        print(f"  warehouse={warehouse}")

    try:
        conn = snowflake.connector.connect(**conn_kwargs)
    except Exception as exc:
        # Print full exception for easier diagnosis (includes Snowflake error codes)
        import traceback

        print("Failed to connect to Snowflake:", file=sys.stderr)
        traceback.print_exc()
        # Mask password when printing connection parameters
        safe = dict(conn_kwargs)
        if "password" in safe:
            safe["password"] = "***REDACTED***"
        print("Connection parameters used:", safe, file=sys.stderr)
        sys.exit(3)

    try:
        cur = conn.cursor()
        try:
            # Ensure an active warehouse is selected for the session if one was
            # provided. Some accounts require an explicit USE WAREHOUSE call.
            if warehouse:
                try:
                    cur.execute(f"USE WAREHOUSE {warehouse}")
                    print(f"Using warehouse: {warehouse}")
                except Exception as we:
                    print(f"Could not set warehouse {warehouse}: {we}")
                    # Try to discover a usable warehouse by listing available
                    # warehouses and attempting to use each one until success.
                    try:
                        cur.execute("SHOW WAREHOUSES")
                        wh_rows = cur.fetchall()
                        wh_desc = [d[0].upper() for d in cur.description]
                        name_idx = None
                        for i, n in enumerate(wh_desc):
                            if n in ("NAME", "WAREHOUSE_NAME"):
                                name_idx = i
                                break
                        if name_idx is None:
                            # Fallback: assume first column is the name
                            name_idx = 0
                        # Build and print candidate list for visibility
                        candidates = [r[name_idx] for r in wh_rows]
                        print("Available warehouses:")
                        for c in candidates:
                            print(f"  - {c}")
                        tried = 0
                        for candidate in candidates:
                            try:
                                cur.execute(f"USE WAREHOUSE {candidate}")
                                print(f"Using discovered warehouse: {candidate}")
                                warehouse = candidate
                                break
                            except Exception:
                                tried += 1
                                continue
                        if tried and warehouse is None:
                            print("Could not find a usable warehouse from SHOW WAREHOUSES; continuing without an active warehouse.")
                    except Exception as se:
                        print(f"Could not list warehouses: {se}")

            cur.execute("SELECT CURRENT_USER(), CURRENT_ACCOUNT()")
            row = cur.fetchone()
            print("Connected as:", row)

            # Count rows in the two tables (fully qualified names to be explicit)
            drivers_q = f"SELECT COUNT(*) FROM {database}.{schema}.DRIVERS"
            meas_q = f"SELECT COUNT(*) FROM {database}.{schema}.DROWSINESS_MEASUREMENTS"

            for name, q in [("DRIVERS", drivers_q), ("DROWSINESS_MEASUREMENTS", meas_q)]:
                try:
                    cur.execute(q)
                    c = cur.fetchone()[0]
                    print(f"{name} rows: {c}")
                except Exception as e:
                    print(f"Could not query {name}: {e}")

            # --- Batch upload: post every video to /api/window to populate Snowflake ---
            try:
                import requests
            except Exception:
                print("\nrequests library not installed; skipping API tester upload. Install with: pip install requests")
            else:
                from pathlib import Path
                import json

                # Locate the videos directory relative to this script
                script_dir = Path(__file__).parent
                videos_dir = script_dir.parent / "videos"
                if not videos_dir.exists():
                    print("\nNo videos directory found; skipping API uploads.")
                else:
                    truck_map = {
                        "sample1.mov": "LF-101",
                        "sample2.mp4": "LF-202",
                        "sample3.mov": "LF-303",
                        "sample4.mov": "LF-404",
                    }
                    ping_seconds = (30, 60, 90)
                    allowed_exts = {".mp4", ".mov", ".avi", ".mkv", ".mpg", ".webm"}
                    base_url = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip('/')
                    upload_url = f"{base_url}/api/window"
                    processed = 0

                    video_files = sorted(
                        [p for p in videos_dir.iterdir() if p.is_file() and p.suffix.lower() in allowed_exts],
                        key=lambda p: p.name,
                    )

                    if not video_files:
                        print("\nNo video files found in videos/; skipping API uploads.")
                    else:
                        print(f"\nUploading {len(video_files)} videos to {upload_url} at timestamps {ping_seconds}")
                        for video_path in video_files:
                            truck_id = truck_map.get(video_path.name)
                            if not truck_id:
                                print(f"Skipping {video_path.name}: no truck mapping provided.")
                                continue

                            session_id = f"{truck_id}_{video_path.stem}"
                            for ts in ping_seconds:
                                print(f"\nUploading {video_path.name} for truck {truck_id} at t={ts}s")
                                try:
                                    with open(video_path, "rb") as fh:
                                        files = {"video": (video_path.name, fh, "application/octet-stream")}
                                        data = {
                                            "timestamp": str(ts),
                                            "session_id": session_id,
                                            "driver_id": truck_id,
                                        }
                                        resp = requests.post(upload_url, files=files, data=data, timeout=180)
                                    resp.raise_for_status()
                                except Exception as exc:
                                    resp_obj = getattr(exc, "response", None)
                                    code = getattr(resp_obj, "status_code", "n/a")
                                    print(f"Upload failed for {video_path.name} @ {ts}s: {exc} (status {code})")
                                    if resp_obj is not None:
                                        try:
                                            print(resp_obj.text)
                                        except Exception:
                                            pass
                                    continue

                                processed += 1
                                try:
                                    payload = resp.json()
                                    try:
                                        insert_measurement_row(
                                            cur,
                                            conn,
                                            database,
                                            schema,
                                            payload,
                                            truck_id,
                                            session_id,
                                            ts,
                                        )
                                    except Exception as db_exc:
                                        print(
                                            f"[Snowflake] Insert failed for session {session_id} at {ts}s: {db_exc}"
                                        )
                                    # Show a concise summary so we know the analysis succeeded.
                                    perclos = payload.get("perclos_30s")
                                    yawn_count = payload.get("yawn_count_30s")
                                    print(
                                        f"Success -> session={session_id}, timestamp={ts}, "
                                        f"perclos_30s={perclos}, yawn_count_30s={yawn_count}"
                                    )
                                    print(json.dumps({"driver_id": truck_id, "session_id": session_id}, indent=2))
                                except Exception:
                                    print("Upload succeeded but response was not JSON:")
                                    try:
                                        print(resp.text)
                                    except Exception:
                                        pass

                        if processed == 0:
                            print("\nNo API uploads were completed successfully.")
        finally:
            cur.close()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
