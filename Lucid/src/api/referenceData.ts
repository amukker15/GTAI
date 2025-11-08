/**
 * Update these arrays whenever you onboard a new driver or route. They serve as
 * a single source of truth for IDs that also exist inside Snowflake so the UI
 * can reference friendly names without hardcoding them elsewhere.
 */
export type RouteDefinition = {
  id: string;
  from: string;
  to: string;
  avgSpeedMph: number;
  note?: string;
};

export const ROUTES: RouteDefinition[] = [
  { id: "ATL-CHI", from: "Atlanta, GA", to: "Chicago, IL", avgSpeedMph: 62 },
  { id: "CHI-ATL", from: "Chicago, IL", to: "Atlanta, GA", avgSpeedMph: 60},
  { id: "ATL-HOU", from: "Atlanta, GA", to: "Houston, TX", avgSpeedMph: 63 },
  { id: "HOU-ATL", from: "Houston, TX", to: "Atlanta, GA", avgSpeedMph: 62 },
  { id: "LAX-HOU", from: "Los Angeles, CA", to: "Houston, TX", avgSpeedMph: 64 },
  { id: "HOU-LAX", from: "Houston, TX", to: "Los Angeles, CA", avgSpeedMph: 65 },
  { id: "LAX-SEA", from: "Los Angeles, CA", to: "Seattle, WA", avgSpeedMph: 61 },
  { id: "SEA-LAX", from: "Seattle, WA", to: "Los Angeles, CA", avgSpeedMph: 60 },
  { id: "SEA-SAN", from: "Seattle, WA", to: "San Diego, CA", avgSpeedMph: 59 },
  { id: "SAN-SEA", from: "San Diego, CA", to: "Seattle, WA", avgSpeedMph: 58 },
  { id: "SAN-LAX", from: "San Diego, CA", to: "Los Angeles, CA", avgSpeedMph: 57},
  { id: "LAX-SAN", from: "Los Angeles, CA", to: "San Diego, CA", avgSpeedMph: 57 },
];

export const ROUTE_SPEED_MPH: Record<RouteDefinition["id"], number> = Object.fromEntries(
  ROUTES.map((route) => [route.id, route.avgSpeedMph])
);

export function getRouteById(id: string): RouteDefinition | undefined {
  return ROUTES.find((r) => r.id === id);
}

export type DriverDefinition = {
  driverId: string;
  driverName: string;
  truckId: string;
  company?: string;
  routeId: RouteDefinition["id"];
};

export const DRIVERS: DriverDefinition[] = [
  { driverId: "DRV-001", driverName: "Aditya Mukker", truckId: "LF-101", company: "Lucid Freight", routeId: "ATL-CHI" },
  { driverId: "DRV-002", driverName: "Navadeep Budda", truckId: "LF-202", company: "Lucid Freight", routeId: "LAX-HOU" },
  { driverId: "DRV-003", driverName: "Fawaz Sabir", truckId: "LF-303", company: "Lucid Freight", routeId: "SEA-SAN" },
  { driverId: "DRV-004", driverName: "Ojas Mediratta", truckId: "LF-404", company: "Lucid Freight", routeId: "ATL-HOU" },
];