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
  // Atlanta ↔ Chicago
  { id: "ATL-CHI", from: "Atlanta, GA", to: "Chicago, IL", avgSpeedMph: 62 },
  { id: "CHI-ATL", from: "Chicago, IL", to: "Atlanta, GA", avgSpeedMph: 59 },
  // Dallas ↔ Atlanta
  { id: "DAL-ATL", from: "Dallas, TX", to: "Atlanta, GA", avgSpeedMph: 64 },
  { id: "ATL-DAL", from: "Atlanta, GA", to: "Dallas, TX", avgSpeedMph: 61 },
  // Dallas ↔ Los Angeles
  { id: "DAL-LAX", from: "Dallas, TX", to: "Los Angeles, CA", avgSpeedMph: 65 },
  { id: "LAX-DAL", from: "Los Angeles, CA", to: "Dallas, TX", avgSpeedMph: 62 },
  // Los Angeles ↔ Seattle
  { id: "LAX-SEA", from: "Los Angeles, CA", to: "Seattle, WA", avgSpeedMph: 61 },
  { id: "SEA-LAX", from: "Seattle, WA", to: "Los Angeles, CA", avgSpeedMph: 63 },
  // New York City ↔ Savannah
  { id: "NYC-SAV", from: "New York City, NY", to: "Savannah, GA", avgSpeedMph: 63 },
  { id: "SAV-NYC", from: "Savannah, GA", to: "New York City, NY", avgSpeedMph: 66 },
  // New York City ↔ Chicago
  { id: "NYC-CHI", from: "New York City, NY", to: "Chicago, IL", avgSpeedMph: 60 },
  { id: "CHI-NYC", from: "Chicago, IL", to: "New York City, NY", avgSpeedMph: 58 },
  // Seattle ↔ Salt Lake City
  { id: "SEA-SLC", from: "Seattle, WA", to: "Salt Lake City, UT", avgSpeedMph: 64 },
  { id: "SLC-SEA", from: "Salt Lake City, UT", to: "Seattle, WA", avgSpeedMph: 61 },
  // Chicago ↔ Seattle (new)
  { id: "CHI-SEA", from: "Chicago, IL", to: "Seattle, WA", avgSpeedMph: 62 },
  { id: "SEA-CHI", from: "Seattle, WA", to: "Chicago, IL", avgSpeedMph: 65 },
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