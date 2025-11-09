# Lucid

## Problem Statement
Thousands of freight trucking accidents occur every single year due to drowsiness, caused by factors such as truckers being overworked. Though ELD mandates (which document total hours driven) have made some progress, truckers still struggle to stay awake on long hauls.  

## Our Solution
Lucid repeatedly takes the 15 seconds leading up to any timestamp in a driver video and runs a MediaPipe‑powered computer-vision pipeline to estimate PERCLOS(Percentage of Closure Of the Pupil over Seconds), head pose, yawns, heart rate, and heart rate variablity, and classifies the driver’s current state (Lucid, Drowsy, Asleep).  Each window’s metrics and the derived state feed a Snowflake lakehouse where fleet ops can query and trend the data.  A React dashboard streams the most recent five vigilance variables for every truck (PERCLOS, Head Down Degrees, Yawns/15s, Heart rate, HRV), highlights risk levels, and links to long‑term analytics pulled from Snowflake.  Companies can click any truck or fallback route marker to open that driver’s full detail view, tweak thresholds, and review alert history.

## AI + CV Stack
- **MediaPipe Face Mesh & Pose** for landmark extraction.
- **Custom drowsiness heuristics** (EAR/MAR integration, adaptive thresholds, yawn + nod detection, pitch tracking).
- **Driver state classifier** that blends PERCLOS, yawns, droop duty, and pitch metrics into risk tiers and persists recent states so the vitals simulator can infer HR/HRV distributions.
- **Snowflake** stores the derived telemetry plus business-optimized route analysis, enabling downstream BI and forecasting workloads.

## How We Built It
- **Backend (`api2/`)**
  - FastAPI services (`app/main.py`) receive uploads, spawn the `WindowAnalyzer`, and expose `/api/*` CV endpoints plus `/v1/state` and vitals simulators.
  - Analyzer is written in Python with OpenCV, MediaPipe, and NumPy (see `app/analyzer.py`, `app/sim_vitals.py`, `app/state_classifier.py`).
  - State caching + vitals simulation keep HR/HRV streams realistic even when Snowflake is queried at 30 s cadence.
  - `/analytics/routes` talks directly to Snowflake + Cortex to summarize every route and return the AI-written recommendations the dashboard shows.
- **Frontend (`Lucid/`)**
  - React + TypeScript + Vite UI with Zustand state management and React Leaflet for the live map.
  - API layer (`src/api/*.ts`) now proxies every request through a configurable Snowflake REST gateway (`VITE_SNOWFLAKE_API_BASE`, `VITE_SNOWFLAKE_API_KEY`) and falls back to the curated driver/route data when telemetry hasn’t landed yet.
  - The Route Analysis page (replaces Long-term Trends) visualizes Snowflake aggregates per route and surfaces Cortex summaries for business calls.
  - Main screen shows per‑truck status dots plus deterministic red fallback points along each configured route; clicking any marker navigates to `/truck/:id`.
  - Route analytics view calls `/analytics/routes` to pull Snowflake aggregates + Cortex summaries for rest-stop planning and shift adjustments.
  - Snowflake used to flash phone

### Tech Stack
- **Computer Vision**: Python, FastAPI, OpenCV, MediaPipe, NumPy.
- **Simulation / State**: Custom heuristics + stochastic vitals generator.
- **Frontend**: React 18, TypeScript, Vite, Zustand, Tailwind styles, React Leaflet, Recharts.
- **Data**: Snowflake (REST API), fallback config in `src/api/referenceData.ts`. Use `api2/scripts/load_route_data.py` to push `lucid_all_routes_800.csv` + `route_characteristics.csv` into Snowflake before hitting the new `/analytics/routes` endpoint.
- **Tooling**: Vitest-ready frontend, Pytest suites for classifier/sim (see `api2/tests`).

## Challenges
- _To be documented._

## Accomplishments
- _To be documented._

## What We Learned
- _To be documented._

## What’s Next for Lucid
- _To be documented._
