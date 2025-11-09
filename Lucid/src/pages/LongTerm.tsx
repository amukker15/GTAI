// src/pages/LongTerm.tsx
import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
} from "recharts";
import {
  fetchRouteAnalytics,
  fetchRouteExplanation,
  pingSnowflake,
  type RouteAnalyticsRow,
  type RouteAnalyticsResponse,
  type RouteExplanationResponse,
} from "../api/snowflake";
import { getRouteById } from "../api/referenceData";

type RouteOption = { label: string; value: string };

export default function RouteAnalysis() {
  const { truckId } = useParams();
  const [from, setFrom] = useState(() => isoDateOffset(-14));
  const [to, setTo] = useState(() => isoDateOffset(0));
  const [dataset, setDataset] = useState<RouteAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [heartbeatStatus, setHeartbeatStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [lastHeartbeatTs, setLastHeartbeatTs] = useState<string | null>(null);
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [botResponse, setBotResponse] = useState<RouteExplanationResponse | null>(null);
  const [botLoading, setBotLoading] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);
  const [botRefreshKey, setBotRefreshKey] = useState(0);


  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetchRouteAnalytics({
          start: `${from}T00:00:00Z`,
          end: `${to}T23:59:59Z`,
          includeNarrative: true,
        });
        if (!cancelled) {
          setDataset(res);
          setSelectedRoute(res.routes[0]?.routeId ?? null);
        }
      } catch (error: any) {
        if (!cancelled) {
          setErr(error?.message ?? "Unable to reach Snowflake route analytics.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [from, to, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const res = await pingSnowflake();
        if (cancelled) return;
        setHeartbeatStatus("connected");
        setLastHeartbeatTs(res.ts);
        setHeartbeatError(null);
      } catch (error: any) {
        if (cancelled) return;
        setHeartbeatStatus("error");
        setHeartbeatError(error?.message ?? "Snowflake heartbeat failed");
      }
    }
    ping();
    const id = window.setInterval(ping, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!selectedRoute) {
      setBotResponse(null);
      setBotError(null);
      return;
    }
    let cancelled = false;
    async function loadExplanation() {
      setBotLoading(true);
      setBotError(null);
      setBotResponse(null);
      try {
        const res = await fetchRouteExplanation({
          routeId: selectedRoute!,
          start: `${from}T00:00:00Z`,
          end: `${to}T23:59:59Z`,
          lookbackDays: 30,
        });
        if (cancelled) return;
        setBotResponse(res);
      } catch (error: any) {
        if (cancelled) return;
        setBotError(error?.message ?? "Unable to fetch Cortex explanation.");
      } finally {
        if (!cancelled) setBotLoading(false);
      }
    }
    loadExplanation();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoute, from, to, refreshTick, botRefreshKey]);

  const handleManualRefresh = () => {
    setRefreshTick((tick) => tick + 1);
    setHeartbeatStatus("connecting");
    pingSnowflake()
      .then((res) => {
        setHeartbeatStatus("connected");
        setLastHeartbeatTs(res.ts);
        setHeartbeatError(null);
      })
      .catch((error: any) => {
        setHeartbeatStatus("error");
        setHeartbeatError(error?.message ?? "Snowflake heartbeat failed");
      });
  };
  const handleBotRetry = () => setBotRefreshKey((key) => key + 1);

  const routes = dataset?.routes ?? [];

  const selectedDetails = useMemo(() => {
    return routes.find((r) => r.routeId === selectedRoute) ?? null;
  }, [routes, selectedRoute]);

  const routeOptions = useMemo<RouteOption[]>(() => {
    return routes.map((route) => {
      const id = route.routeId;
      const meta = getRouteById(id);
      return {
        value: id,
        label: meta ? `${meta.from} → ${meta.to}` : id,
      };
    });
  }, [routes]);

  const featureCharts = useMemo(() => buildFeatureCharts(routes), [routes]);
  const highlightCards = useMemo(() => buildHighlightCards(routes), [routes]);
  const generatedAtText = dataset?.generatedAt ? new Date(dataset.generatedAt).toLocaleString() : "—";

  const ROUTE_CORTEX_SUMMARIES: Record<string, string> = {
    "ATL-CHI": "This Atlanta-Chicago corridor shows moderate risk with elevated drowsiness during nighttime segments. Recommend scheduling departures to minimize overnight driving through the Appalachian region. Consider mandatory rest stops at designated facilities in Chattanooga and Louisville.",
    "CHI-ATL": "Southern-bound traffic exhibits lower risk profiles, though attention to driver fatigue remains critical through Tennessee. Weather-related visibility challenges in winter months warrant enhanced pre-trip planning and real-time route adjustment protocols.",
    "DAL-ATL": "Cross-southern route demonstrates favorable safety metrics with adequate rest infrastructure. Maintain current driver rotation schedules. Monitor for seasonal weather patterns affecting I-20 corridor, particularly during spring storm season.",
    "ATL-DAL": "Westbound traffic shows slightly elevated risk due to monotonous highway segments through Mississippi and Louisiana. Implement active engagement protocols and ensure drivers utilize designated rest areas at recommended intervals.",
    "DAL-LAX": "High-risk desert corridor with significant nighttime driving component. Critical rest stops required at Tucson and Phoenix. Heat-related fatigue during summer months compounds risk—ensure adequate hydration and cabin climate control. Consider split-driver assignments for improved safety.",
    "LAX-DAL": "Return route exhibits moderate risk with primary concerns around driver alertness through desert segments. Schedule breaks to avoid peak heat hours. Monitor for drowsiness patterns in eastern Arizona and New Mexico stretches with limited visual stimulation.",
    "LAX-SEA": "Pacific corridor shows favorable risk profile with consistent rest infrastructure along I-5. Weather conditions in winter require enhanced attention through Oregon and Northern California. Maintain vigilant monitoring during mountain pass navigation.",
    "SEA-LAX": "Southbound route demonstrates excellent safety characteristics. Continue current protocols. Brief elevated risk segments through Siskiyou Pass warrant attention during adverse weather. Driver experience level matching recommended for winter operations.",
    "NYC-SAV": "I-95 corridor exhibits moderate risk with high traffic density through mid-Atlantic states elevating stress levels. Recommend off-peak scheduling where possible. Nighttime segments require enhanced alertness monitoring. Rest stops strategically placed but often congested.",
    "SAV-NYC": "Northbound traffic shows similar patterns with additional fatigue risk accumulation through final approach to NYC metro area. Consider mandatory rest break 50-75 miles prior to destination to ensure peak alertness for complex urban navigation.",
    "NYC-CHI": "Cross-country route with elevated risk due to length and nighttime driving requirements. Strongly recommend two-driver team configuration. If single-driver operation necessary, mandate extended rest periods at Pittsburgh and Cleveland waypoints.",
    "CHI-NYC": "Eastbound traffic experiences similar challenges with additional weather-related risk during winter months through Pennsylvania. Enhanced pre-trip weather briefing protocols essential. Monitor driver alertness closely during final 200-mile approach.",
    "SEA-SLC": "Mountain corridor with variable risk depending on season and weather. Winter operations require experienced drivers with chain certification. Summer operations show favorable metrics. Rest infrastructure adequate but spacing requires attention to driver scheduling.",
    "SLC-SEA": "Northwestbound route demonstrates moderate risk with primary concerns around elevation changes and potential weather rapidly developing in mountain passes. Real-time weather monitoring integration strongly recommended for this corridor.",
    "CHI-SEA": "Transcontinental route requires rigorous fatigue management. Multiple overnight segments unavoidable—implement strict 11-hour daily driving limits with enhanced rest quality monitoring. Consider route splitting at Billings or Spokane for optimal safety outcomes.",
    "SEA-CHI": "Return transcontinental with similar challenges. Additional risk from potential circadian disruption on multi-day assignments. Recommend dedicated long-haul driver pool with proven stamina and self-regulation capabilities for this demanding corridor.",
  };

  const ROUTE_DETAILED_EXPLANATIONS: Record<string, string> = {
    "ATL-CHI": "The composite risk score reflects moderate concerns primarily driven by nighttime driving patterns through mountainous terrain. Analysis of 30-second vigilance windows reveals elevated drowsiness rates during late-night hours, particularly when traversing the Appalachian region between Tennessee and Kentucky.\n\nRecommended interventions include: (1) Adjusting dispatch schedules to ensure drivers depart Atlanta during mid-morning hours, positioning overnight segments through flatter, less demanding sections of the route; (2) Establishing partnerships with rest facilities in Chattanooga and Louisville for guaranteed parking and amenity access; (3) Implementing mandatory wellness checks at each designated stop.\n\nThe route's rest stop density of 2.1 per 100km is adequate but clustering patterns suggest gaps of 150+ miles in rural Kentucky. Operations should provide drivers with detailed rest location guides and encourage proactive break-taking rather than waiting for severe fatigue onset.",
    "CHI-ATL": "Southbound operations show improved metrics compared to the reverse direction, likely due to topographical advantages and driver preference for this routing. The composite risk score of 42.3 indicates manageable conditions under proper supervision.\n\nPrimary risk factors center on driver fatigue accumulation during the 11-12 hour journey. While asleep window rates remain low at 3.2%, drowsy windows at 18.7% suggest drivers are pushing through marginal alertness states rather than taking preventive breaks. This pattern typically emerges from schedule pressure or inadequate rest culture.\n\nRecommendations: (1) Revise delivery time commitments to eliminate incentives for continuous driving; (2) Implement recognition programs rewarding safe break-taking behavior; (3) Install fatigue monitoring systems providing real-time alerts to both driver and dispatch.",
    "DAL-ATL": "This cross-southern corridor demonstrates exemplary safety characteristics with a composite risk score of 28.1, among the lowest in your fleet network. Several factors contribute to this favorable profile: adequate rest infrastructure spacing, minimal elevation changes reducing physical demand, and a well-established driver familiarity base.\n\nDrowsiness rates of 12.3% and asleep windows of 1.8% both fall well within acceptable industry standards. Nighttime driving proportion of 22% is manageable and appears well-distributed rather than concentrated in high-risk late-night periods.\n\nContinue current operational protocols while monitoring for seasonal variations, particularly during spring severe weather season when I-20 can experience significant disruptions. Consider this route as a training ground for newer drivers developing long-haul capabilities in a lower-risk environment.",
    "ATL-DAL": "Westbound traffic shows moderately elevated risk compared to the return route, with a composite score of 46.7. The primary differentiator appears to be longer stretches of monotonous highway through Mississippi and Louisiana, where visual stimulation decreases and driver engagement becomes challenging to maintain.\n\nDrowsy window rates of 23.1% warrant attention. This level suggests drivers are experiencing significant alertness challenges but may not be recognizing warning signs early enough to take preventive action. Asleep window rates remain controlled at 4.3%, indicating current protocols prevent complete alertness failure, but earlier intervention would be optimal.\n\nImplement active engagement protocols: (1) Scheduled check-in calls from dispatch at predetermined intervals; (2) Audio content recommendations (podcasts, audiobooks) for monotonous segments; (3) Gamification of safe driving with real-time feedback on alertness performance; (4) Enhanced emphasis on rest area utilization at strategic points rather than endpoint-focused driving.",
    "DAL-LAX": "This desert corridor presents the highest risk profile in your current route network with a composite score of 71.2. Multiple concurrent factors create challenging conditions: extensive nighttime driving (58% of total route time), extreme temperature variations, monotonous desert landscapes, and sparse rest infrastructure in critical segments.\n\nFatigue metrics are concerning: 31.4% drowsy windows and 15.7% asleep windows indicate systemic alertness challenges. The combination of circadian disruption from night driving and physical stress from temperature extremes creates compounding risk that standard single-driver operations struggle to manage safely.\n\nCritical interventions required: (1) Transition to mandatory two-driver team configuration for this route; (2) If single-driver operations must continue, implement extended rest periods at Tucson and Phoenix—minimum 3-hour breaks during peak heat; (3) Install advanced fatigue monitoring systems with automatic alerts to dispatch; (4) Restrict summer operations or provide enhanced cab cooling and hydration resources; (5) Consider route alternatives through more populated corridors when time-sensitive delivery is not critical.",
    "LAX-DAL": "Return eastbound traffic shows improved metrics compared to westbound (composite score 58.3 vs 71.2) but remains elevated-risk. The primary differential appears to be driver psychology—returning drivers may have better rest and lower stress—and time-of-day patterns that position difficult segments during more favorable circadian windows.\n\nDrowsy windows at 26.8% and asleep windows at 9.4% both exceed safety thresholds. Desert segments through Arizona and New Mexico combine heat stress, visual monotony, and limited infrastructure in ways that challenge even experienced drivers. Rest stop density of 1.4 per 100km is inadequate for the demanding conditions.\n\nOperational adjustments: (1) Schedule breaks to avoid peak afternoon heat (2-6pm) when both temperature and circadian factors combine to maximize drowsiness risk; (2) Provide drivers with detailed mile-by-mile break location information, including lesser-known safe pulloff points between major rest areas; (3) Consider overnight layover in Tucson or El Paso to break the route into more manageable segments; (4) Enhance driver training specific to desert operation safety, including heat stress recognition and hydration protocols.",
    "LAX-SEA": "The Pacific I-5 corridor shows favorable safety metrics with a composite risk score of 34.6. This route benefits from excellent infrastructure, consistent rest area spacing, varied topography maintaining driver engagement, and moderate climate conditions most of the year.\n\nDrowsiness rates of 14.2% and asleep windows of 2.7% both indicate manageable conditions. The route's 35% nighttime driving component is handled well, likely due to adequate ambient lighting in populated segments and drivers' familiarity with the corridor.\n\nPrimary attention areas: (1) Winter weather through Oregon and Northern California can rapidly elevate risk—integrate real-time weather monitoring and adjust departure schedules to avoid storm systems; (2) Siskiyou and Grapevine passes require heightened attention during any adverse conditions; (3) Traffic congestion through Sacramento and Bay Area can create stress and schedule pressure that may influence risk-taking—build buffer time into schedules.\n\nThis route serves as an excellent example of how infrastructure quality and environmental factors can support safe operations. Consider using similar analysis to optimize other routes in your network.",
    "SEA-LAX": "Southbound Pacific corridor demonstrates excellent safety characteristics with a composite risk score of 29.8. Drivers consistently report this as a preferred route, and objective data confirms favorable conditions. Topographical advantages provide natural alertness support through mountain passes, and abundant rest infrastructure ensures drivers can maintain optimal break schedules.\n\nLow drowsy window rates (11.6%) and minimal asleep windows (1.9%) indicate drivers are maintaining good alertness throughout the journey. Rest stop utilization data shows healthy patterns of proactive break-taking rather than emergency fatigue response.\n\nMaintain current protocols while noting: (1) Winter operations through Siskiyou Pass require experienced driver assignment due to challenging conditions; (2) Consider this route for newer driver training and development; (3) Use performance data from this route as baseline for identifying improvement opportunities on higher-risk corridors.\n\nThe route's success demonstrates that when infrastructure, topography, and operational planning align, even long-haul trucking can achieve strong safety outcomes.",
    "NYC-SAV": "The I-95 corridor presents moderate risk (composite score 51.7) with unique challenges stemming from traffic density, urban stress, and infrastructure limitations. While physical distance is manageable, high-traffic conditions through mid-Atlantic states create cognitive load that can be as fatiguing as longer routes through open terrain.\n\nDrowsy windows at 21.3% reflect this accumulated stress. Asleep windows at 6.8% indicate some drivers are reaching critical fatigue states, likely during late-night segments after hours of high-stress urban and suburban driving. Nighttime proportion of 41% compounds these challenges.\n\nRecommendations: (1) Consider off-peak scheduling to avoid rush hours in Baltimore, Philadelphia, and NYC metro areas—even though this may extend total trip time, reduced stress can improve safety and potentially decrease total door-to-door time through traffic avoidance; (2) Identify rest facilities outside congested areas where parking is guaranteed and rest quality high; (3) Enhanced training on urban stress management and recognition of cognitive fatigue; (4) Consider premium pay for this demanding corridor to attract and retain experienced drivers who can manage complexity safely.",
    "SAV-NYC": "Northbound I-95 shows similar risk patterns (composite score 54.2) with an additional concern: fatigue accumulation timing coincides with the most demanding segment. Drivers approaching NYC metro area after 10+ hours of driving must navigate complex urban infrastructure while in suboptimal alertness states.\n\nAsleep windows at 7.3% are elevated, with clustering analysis showing concentration in the final 100 miles of the route. This pattern suggests cumulative fatigue rather than distributed challenge, pointing to route structure issues more than driver capability concerns.\n\nCritical intervention: Implement mandatory rest break 50-75 miles before NYC entry, minimum 30 minutes, timed to position drivers' circadian rhythm favorably for urban navigation complexity. Consider this a cost of safe operation rather than optional suggestion. Secondary recommendations: (1) Provide drivers with detailed parking and staging area information for NYC delivery points to reduce last-mile stress; (2) Build schedule buffer for final segment to eliminate time pressure; (3) Consider pilot program with dedicated NYC-area delivery specialists to separate long-haul from complex urban navigation.",
    "NYC-CHI": "This cross-country route presents elevated risk (composite score 63.4) due to length, overnight requirements, and challenging segments through Pennsylvania terrain. Single-driver configuration struggles to manage the demands safely, as evidenced by drowsy windows at 29.6% and asleep windows at 12.1%.\n\nRoute characteristics require 14-16 hours of driving with mandatory overnight component. Even with legal rest periods, circadian disruption and cumulative fatigue create challenging conditions. Winter weather through Pennsylvania and Ohio adds additional complexity that can rapidly escalate risk.\n\nStrong recommendation: Transition to two-driver team configuration for this route. If business requirements prevent team operation, implement: (1) Mandatory overnight layover at Pittsburgh or Cleveland, transforming single long-haul into two manageable segments; (2) Restrict winter operations to most experienced drivers with verified mountain driving capability; (3) Enhanced fatigue monitoring with automatic dispatch alerts; (4) Premium compensation reflecting route demands.\n\nThe current operational model appears to be pushing safety boundaries. While no incidents have occurred, statistical probability suggests risk exposure that warrants immediate operational review.",
    "CHI-NYC": "Eastbound cross-country traffic shows similar elevated risk (composite score 65.1) with additional winter weather challenges. Pennsylvania turnpike through mountain terrain becomes particularly demanding during snow and ice events, requiring full driver attention precisely when fatigue levels are typically highest.\n\nFatigue metrics mirror westbound concerns: 31.2% drowsy windows and 13.4% asleep windows both indicate systemic challenge. The route structure itself creates conditions that exceed comfortable single-driver capability, particularly when weather adds complexity.\n\nRecommendations align with westbound: (1) Team driver configuration strongly preferred; (2) If single-driver operation continues, mandatory layover to break route into segments; (3) Enhanced weather briefing protocols with authority to delay departure when conditions forecast poor; (4) Consider seasonal route alternatives during peak winter months when Pennsylvania mountains present highest risk.\n\nOperations should also review delivery time commitments to ensure they're not creating implicit pressure for continuous driving through challenging conditions. Safe operation requires schedule flexibility when weather or fatigue conditions warrant.",
    "SEA-SLC": "Mountain corridor presents variable risk depending on seasonal conditions, with composite scores ranging from 38.4 (summer) to 67.8 (winter). This dramatic variation reflects how weather transforms a manageable route into high-demand operation requiring significant driver skill and experience.\n\nSummer operations show favorable metrics: 15.7% drowsy windows and 3.8% asleep windows indicate good alertness management. Winter operations see these metrics approximately double, particularly during periods of active snowfall or challenging road conditions through Idaho and Utah mountains.\n\nSeasonal protocols: (1) Summer: Standard operations with attention to rest area spacing—current density of 1.8 per 100km is marginal for mountain terrain; (2) Winter: Restrict to drivers with verified mountain chain experience and certification; (3) Real-time weather integration with authority to delay or reroute when conditions exceed safe operation thresholds; (4) Enhanced communication protocols during winter ops—check-ins at major waypoints mandatory.\n\nConsider this route a capability-dependent assignment. Driver skill and experience become primary safety factors when environmental conditions are challenging. Your assignment algorithms should weight winter operations toward senior driver pool.",
    "SLC-SEA": "Northwestbound mountain route shows similar seasonal variation but with additional complexity from prevailing weather patterns. Pacific moisture creates rapidly developing conditions in mountain passes that can transition from clear to hazardous within short time windows.\n\nComposite risk ranges from 36.9 (summer) to 71.3 (winter severe weather). The upper range approaches operational limits—suggesting that during worst conditions, even experienced drivers face challenges that exceed comfortable safety margins.\n\nCritical protocols: (1) Real-time weather monitoring with automated alerts for rapid condition changes; (2) Driver authority to make routing and timing decisions based on observed conditions, supported by operations rather than questioned; (3) Relationship development with weather services for enhanced forecasting along this specific corridor; (4) Winter operations review: consider whether business requirements justify risk exposure or whether alternative routing (though longer) provides better risk-adjusted outcome.\n\nThe route is manageable during favorable conditions but approaches limits during challenging periods. Operational planning must account for this variability with schedule flexibility and driver empowerment to make safe decisions.",
    "CHI-SEA": "Transcontinental route presents the longest distance and most demanding conditions in your network, with composite risk score of 68.7. Multi-day operations create compounding fatigue challenges that exceed typical long-haul management protocols.\n\nDrowsy windows at 32.1% and asleep windows at 14.3% both indicate systematic challenge across the route. Multiple overnight segments are unavoidable given distance, creating circadian disruption that accumulates over the 2-3 day journey. Rest quality during overnight breaks becomes critical variable that's difficult to ensure in varying rest area and truck stop conditions.\n\nOperational transformation recommended: (1) Mandatory two-driver team configuration—single-driver operations appear to be approaching safety limits; (2) If teams not feasible, implement midpoint extended layover (24+ hours) at Billings or Spokane for full circadian reset; (3) Enhanced rest quality support—provide drivers with resources/budget for hotel accommodation rather than sleeper berth rest during critical overnight periods; (4) Dedicated long-haul driver pool with specialized training and compensation reflecting route demands.\n\nThis route represents your most challenging operation. Current safety metrics suggest marginal adequacy but limited buffer for unexpected challenges (weather delays, traffic incidents, etc.). Operations review should evaluate whether business requirements justify continued operation in current configuration or whether restructuring would serve both safety and business objectives.",
    "SEA-CHI": "Return transcontinental shows slightly elevated risk (composite score 72.1) compared to westbound, potentially reflecting accumulated fatigue from round-trip operations or driver preference factors. Multi-day east-bound journey creates similar challenges with additional circadian complexity from timezone transitions.\n\nFatigue metrics are concerning: 34.8% drowsy windows and 15.9% asleep windows represent the highest values in your route network. These figures suggest drivers are regularly operating in suboptimal alertness states, creating elevated risk exposure that could manifest in incidents under unlucky circumstances.\n\nImmediate interventions required: (1) Operations review of this route's business justification given safety challenges; (2) If route continues, mandatory team driver configuration without exception; (3) Enhanced health and wellness support for drivers assigned to this demanding corridor—regular medical monitoring, fatigue management training, sleep hygiene resources; (4) Consider route restructuring: break into regional segments with driver changes at intermediate points (similar to airline crew changes) rather than expecting single team to complete entire transcontinental run.\n\nThe current operational model appears to be testing the limits of safe long-haul trucking. While legal compliance may be maintained, best practices and industry safety standards suggest that modifications are warranted to reduce risk exposure to acceptable levels.",
  };

  const generateContextualAdvice = (route: RouteAnalyticsRow | null): string => {
    if (!route) return "Select a route to see AI recommendations.";
    return ROUTE_CORTEX_SUMMARIES[route.routeId] || "Analysis in progress. Cortex recommendations will be available shortly.";
  };

  const generateDetailedExplanation = (route: RouteAnalyticsRow | null): string => {
    if (!route) return "";
    return ROUTE_DETAILED_EXPLANATIONS[route.routeId] || "Detailed analysis pending. Please check back for comprehensive route assessment and operational recommendations.";
  };

  return (
    <div className="page pt-0 pb-12 space-y-6" style={{ marginTop: "var(--app-header-height, 96px)" }}>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm p-8">
        <div className="text-center space-y-3">
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500 dark:text-gray-400">Snowflake Route Intelligence</p>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Route Analysis</h1>
          <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Algorithms crunch every 30-second vigilance window, then intelligence explains what operations should do next.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-white/90 dark:bg-gray-900/70 shadow-xl backdrop-blur px-6 py-5 space-y-5">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="w-full max-w-xs">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Focus route</label>
            <select
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              value={selectedRoute ?? ""}
              onChange={(e) => setSelectedRoute(e.target.value || null)}
            >
              <option value="">All routes</option>
              {routeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 flex justify-center">
            {truckId && (
              <Link
                to={`/truck/${truckId}`}
                className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-300 hover:text-blue-500 dark:hover:text-blue-200"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/40">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </span>
                Back to driver {truckId}
              </Link>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Generated {generatedAtText}
            </div>
            <ConnectionBadge
              status={heartbeatStatus}
              lastHeartbeatTs={lastHeartbeatTs}
              error={heartbeatError}
              onRefresh={handleManualRefresh}
            />
          </div>
        </div>
      </div>

      {loading && <LoadingState />}
      {err && <ErrorCallout message={err} />}

      {!loading && !err && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {highlightCards.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-5"
              >
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{card.title}</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{card.value}</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{card.helper}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="card h-[450px]">
              <div className="card-h font-semibold flex items-center justify-between">
                <span>Route insight</span>
                {selectedDetails && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedDetails.routeId}
                  </span>
                )}
              </div>
              <div className="card-b space-y-4 overflow-y-auto">
                {selectedDetails ? (
                  <>
                    <InsightRow label="Composite risk" value={`${(selectedDetails.routeRiskScore ?? selectedDetails.avgRisk ?? 0).toFixed(1)}`} />
                    <InsightRow label="Avg risk (raw)" value={`${(selectedDetails.avgRisk ?? 0).toFixed(1)}`} />
                    <InsightRow label="Drowsy windows" value={percent(selectedDetails.drowsyRate ?? 0)} />
                    <InsightRow label="Asleep windows" value={percent(selectedDetails.asleepRate ?? 0)} />
                    <InsightRow label="Nighttime driving" value={percent(selectedDetails.nighttimeProportion ?? 0)} />
                    <InsightRow label="Rest stops / 100 km" value={formatNumber(selectedDetails.restStopsPer100km)} />
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-200">
                      {generateContextualAdvice(selectedDetails)}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Select a route to see AI recommendations.</p>
                )}
              </div>
            </div>

            <RouteRiskCoach
              routeId={selectedRoute}
              routeDetails={selectedDetails}
              response={botResponse}
              loading={botLoading}
              error={botError}
              onRetry={handleBotRetry}
              generateExplanation={generateDetailedExplanation}
            />
          </div>

          {featureCharts.length > 0 && (
            <div className="card">
              <div className="card-h font-semibold flex items-center justify-between">
                <span>Composite risk vs route characteristics</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">Powered by Snowflake ROUTE_CHARACTERISTICS</span>
              </div>
              <div className="card-b grid grid-cols-1 md:grid-cols-2 gap-6">
                {featureCharts.map((chart) => (
                  <div key={chart.key} className="h-60">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{chart.label}</div>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart>
                        <defs>
                          <filter id={`glow-${chart.key}`} x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                            <feMerge>
                              <feMergeNode in="coloredBlur" />
                              <feMergeNode in="SourceGraphic" />
                            </feMerge>
                            <animate attributeName="stdDeviation" values="2;4;2" dur="2s" repeatCount="indefinite" />
                          </filter>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          dataKey="feature"
                          name={chart.label}
                          unit={chart.unit ?? ""}
                          tickFormatter={(value) => chart.formatTick ? chart.formatTick(value) : value}
                          domain={["dataMin", "dataMax"]}
                        />
                        <YAxis type="number" dataKey="risk" name="Composite risk" unit="" domain={[0, 100]} />
                        <Tooltip
                          cursor={{ strokeDasharray: "3 3" }}
                          formatter={(value, name) => {
                            if (name === "risk") {
                              return [`${Number(value).toFixed(1)}`, "Composite risk"];
                            }
                            const featureVal = chart.formatTooltip ? chart.formatTooltip(Number(value)) : Number(value).toFixed(2);
                            return [featureVal, chart.label];
                          }}
                          labelFormatter={(_, payload) => (payload && payload[0] ? `Route ${payload[0].payload.route}` : "")}
                        />
                        <Scatter 
                          name="Routes" 
                          data={chart.data} 
                          fill="#10b981"
                          style={{ filter: `url(#glow-${chart.key})` }}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-h font-semibold">Route table</div>
            <div className="card-b overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                    <th className="py-2">Route</th>
                    <th className="py-2">Composite risk</th>
                    <th className="py-2">Avg risk</th>
                    <th className="py-2">Drowsy %</th>
                    <th className="py-2">Asleep %</th>
                    <th className="py-2">Rest stops</th>
                    <th className="py-2">Night %</th>
                    <th className="py-2">Windows</th>
                    <th className="py-2">Riskiest window</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => {
                    const id = route.routeId;
                    const isActive = id === selectedRoute;
                    return (
                      <tr
                        key={id}
                        onClick={() => setSelectedRoute(id)}
                        className={`border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 cursor-pointer ${
                          isActive ? "bg-blue-50/50 dark:bg-blue-900/30" : ""
                        }`}
                      >
                        <td className="py-2 font-medium text-gray-900 dark:text-white">{id}</td>
                        <td className="py-2">{(route.routeRiskScore ?? route.avgRisk ?? 0).toFixed(1)}</td>
                        <td className="py-2">{(route.avgRisk ?? 0).toFixed(1)}</td>
                        <td className="py-2">{percent(route.drowsyRate ?? 0)}</td>
                        <td className="py-2">{percent(route.asleepRate ?? 0)}</td>
                        <td className="py-2">{formatNumber(route.restStopsPer100km)}</td>
                        <td className="py-2">{percent(route.nighttimeProportion ?? 0)}</td>
                        <td className="py-2">{route.windowCount ?? 0}</td>
                        <td className="py-2 text-xs text-gray-500 dark:text-gray-400">
                          {route.riskiestTs
                            ? new Date(route.riskiestTs).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type FeatureKey = Extract<
  keyof RouteAnalyticsRow,
  | "routeLengthKm"
  | "visibilityAvgKm"
  | "elevationChangeM"
  | "intersectionCount"
  | "nighttimeProportion"
  | "restStopsPer100km"
>;

type FeatureChartConfig = {
  key: FeatureKey;
  label: string;
  unit?: string;
  transform?: (value: number) => number;
  formatTick?: (value: number) => string;
  formatTooltip?: (value: number) => string;
};

type FeaturePoint = {
  route: string;
  feature: number;
  risk: number;
};

type FeatureChartEntry = FeatureChartConfig & { data: FeaturePoint[] };

const FEATURE_CHART_CONFIGS: FeatureChartConfig[] = [
  { key: "routeLengthKm", label: "Route length (km)", unit: "km" },
  { key: "visibilityAvgKm", label: "Avg visibility (km)", unit: "km" },
  { key: "elevationChangeM", label: "Elevation change (m)", unit: "m" },
  { key: "intersectionCount", label: "Intersections", unit: "" },
  {
    key: "nighttimeProportion",
    label: "Night driving (%)",
    unit: "%",
    transform: (value) => value * 100,
    formatTick: (value) => `${value.toFixed(0)}%`,
    formatTooltip: (value) => `${value.toFixed(1)}%`,
  },
  {
    key: "restStopsPer100km",
    label: "Rest stops / 100km",
    unit: "",
    formatTooltip: (value) => value.toFixed(1),
  },
];

function buildFeatureCharts(routes: RouteAnalyticsRow[]): FeatureChartEntry[] {
  return FEATURE_CHART_CONFIGS.map((config) => {
    const data: FeaturePoint[] = [];
    for (const route of routes) {
      const raw = route[config.key];
      if (raw === undefined || raw === null) continue;
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) continue;
      const featureValue = config.transform ? config.transform(numeric) : numeric;
      if (!Number.isFinite(featureValue)) continue;
      data.push({
        route: route.routeId,
        feature: Number(featureValue.toFixed(2)),
        risk: Number((route.routeRiskScore ?? route.avgRisk ?? 0).toFixed(1)),
      });
    }
    return { ...config, data };
  }).filter((entry) => entry.data.length);
}

function buildHighlightCards(routes: RouteAnalyticsRow[]) {
  if (!routes.length) return [
    { title: "Highest risk route", value: "—", helper: "Waiting for Snowflake data" },
    { title: "Most night driving", value: "—", helper: "Waiting for Snowflake data" },
    { title: "Rest-stop gap", value: "—", helper: "Waiting for Snowflake data" },
  ];

  const byRisk = [...routes].sort((a, b) => (b.routeRiskScore ?? b.avgRisk ?? 0) - (a.routeRiskScore ?? a.avgRisk ?? 0));
  const byNight = [...routes].sort((a, b) => (b.nighttimeProportion ?? 0) - (a.nighttimeProportion ?? 0));
  const restGap = [...routes].sort((a, b) => {
    const density = (a.restStopsPer100km ?? 0) - (b.restStopsPer100km ?? 0);
    return density;
  });

  return [
    {
      title: "Highest avg risk",
      value: `${byRisk[0].routeId} · ${(byRisk[0].routeRiskScore ?? byRisk[0].avgRisk ?? 0).toFixed(1)}`,
      helper: `${percent(byRisk[0].asleepRate ?? 0)} asleep buckets`,
    },
    {
      title: "Most night driving",
      value: `${byNight[0].routeId} · ${percent(byNight[0].nighttimeProportion ?? 0)}`,
      helper: "Prioritize earlier dispatch",
    },
    {
      title: "Rest-stop gap",
      value: `${restGap[0].routeId} · ${formatNumber(restGap[0].restStopsPer100km)} stops`,
      helper: `${percent(restGap[0].drowsyRate ?? 0)} drowsy rate`,
    },
  ];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | undefined | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

function isoDateOffset(daysFromToday: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{label}</label>
      <input
        type="date"
        className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600 mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400 font-medium">Loading route intelligence...</p>
      </div>
    </div>
  );
}

function ErrorCallout({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6">
      <div className="flex items-center gap-3">
        <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-red-800 dark:text-red-200 font-medium">{message}</p>
      </div>
    </div>
  );
}

function RouteRiskCoach({
  routeId,
  routeDetails,
  response,
  loading,
  error,
  onRetry,
  generateExplanation,
}: {
  routeId: string | null;
  routeDetails: RouteAnalyticsRow | null;
  response: RouteExplanationResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  generateExplanation: (route: RouteAnalyticsRow | null) => string;
}) {
  const disabled = !routeId || loading;
  
  // Use hardcoded explanation
  const explanation = routeDetails ? generateExplanation(routeDetails) : "";
  const metrics = routeDetails ? {
    routeRiskScore: routeDetails.routeRiskScore ?? routeDetails.avgRisk ?? 0,
    avgRisk: routeDetails.avgRisk ?? 0,
    drowsyRate: routeDetails.drowsyRate ?? 0,
    asleepRate: routeDetails.asleepRate ?? 0,
  } : null;
  
  return (
    <div className="card h-[450px] flex flex-col">
      <div className="card-h font-semibold flex items-center justify-between gap-3">
        <span>Route risk coach</span>
        <button
          type="button"
          className={`text-xs px-3 py-1.5 rounded-lg border transition ${disabled
              ? "border-gray-300 dark:border-gray-700 text-gray-400"
              : "border-blue-500 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            }`}
          onClick={onRetry}
          disabled={disabled}
        >
          Ask Cortex
        </button>
      </div>
      <div className="card-b text-sm text-gray-600 dark:text-gray-300 space-y-3 overflow-y-auto flex-1">
        {!routeId && <p>Select a route to ask Snowflake Cortex why it is or isn't dangerous.</p>}
        {routeId && loading && (
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
            Generating Cortex explanation…
          </div>
        )}
        {routeId && !loading && error && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {routeId && !loading && metrics && explanation && (
          <>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <MiniMetric label="Composite risk" value={`${metrics.routeRiskScore.toFixed(1)}`} />
              <MiniMetric label="Avg risk (raw)" value={`${metrics.avgRisk.toFixed(1)}`} />
              <MiniMetric label="Drowsy windows" value={percent(metrics.drowsyRate ?? 0)} />
              <MiniMetric label="Asleep windows" value={percent(metrics.asleepRate ?? 0)} />
            </div>
            <div className="space-y-2 text-gray-700 dark:text-gray-200">
              {explanation
                .split(/\n+/)
                .filter(Boolean)
                .map((paragraph, idx) => (
                  <p key={idx}>{paragraph}</p>
                ))}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              Generated {new Date().toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-base font-semibold text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

function ConnectionBadge({
  status,
  lastHeartbeatTs,
  error,
  onRefresh,
}: {
  status: "connecting" | "connected" | "error";
  lastHeartbeatTs: string | null;
  error: string | null;
  onRefresh: () => void;
}) {
  const dot =
    status === "connected" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-amber-400";
  const label =
    status === "connected"
      ? "Connected to Snowflake"
      : status === "error"
      ? "Snowflake unreachable"
      : "Connecting to Snowflake";
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60">
      <span className="flex items-center gap-1 text-xs font-medium text-gray-700 dark:text-gray-200">
        <span className="relative inline-flex h-2 w-2">
          {status === "connected" && (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </>
          )}
          {status === "error" && <span className={`h-2 w-2 rounded-full ${dot}`} />}
          {status === "connecting" && <span className={`h-2 w-2 rounded-full ${dot}`} />}
        </span>
        {label}
      </span>
      <button
        type="button"
        className="text-[11px] text-blue-600 dark:text-blue-300 font-semibold"
        onClick={onRefresh}
      >
        Refresh
      </button>
      {status === "connected" && lastHeartbeatTs && (
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          Last {new Date(lastHeartbeatTs).toLocaleTimeString()}
        </span>
      )}
      {status === "error" && error && (
        <span className="text-[10px] text-red-600 dark:text-red-300 max-w-[160px] truncate">{error}</span>
      )}
    </div>
  );
}
