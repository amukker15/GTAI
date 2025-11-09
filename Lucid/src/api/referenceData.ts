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
  { id: "DAL-ATL", from: "Dallas, TX", to: "Atlanta, GA", avgSpeedMph: 62 },
  { id: "DAL-LAX", from: "Dallas, TX", to: "Los Angeles, CA", avgSpeedMph: 65 },
  { id: "LAX-SEA", from: "Los Angeles, CA", to: "Seattle, WA", avgSpeedMph: 61 },
  { id: "NYC-SAV", from: "New York City, NY", to: "Savannah, GA", avgSpeedMph: 63 },
  { id: "NYC-CHI", from: "New York City, NY", to: "Chicago, IL", avgSpeedMph: 60 },
  { id: "SEA-SLC", from: "Seattle, WA", to: "Salt Lake City, UT", avgSpeedMph: 64 },
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
  { driverId: "DRV-001", driverName: "Ojas Mediratta", truckId: "LF-101", company: "Lucid Freight", routeId: "ATL-CHI" },
  { driverId: "DRV-002", driverName: "Fawaz Sabir", truckId: "LF-202", company: "Lucid Freight", routeId: "DAL-LAX" },
  { driverId: "DRV-003", driverName: "Navadeep Budda", truckId: "LF-303", company: "Lucid Freight", routeId: "SEA-SLC" },
  { driverId: "DRV-004", driverName: "Aditya Mukker", truckId: "LF-404", company: "Lucid Freight", routeId: "NYC-SAV" },
];