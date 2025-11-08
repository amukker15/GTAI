/**
 * Update these arrays whenever you onboard a new driver or route. They serve as
 * a single source of truth for IDs that also exist inside Snowflake so the UI
 * can reference friendly names without hardcoding them elsewhere.
 */
export type RouteDefinition = {
  id: string;
  from: string;
  to: string;
  note?: string;
};

export const ROUTES: RouteDefinition[] = [
  { id: "ATL-CHI", from: "Atlanta, GA", to: "Chicago, IL", note: "I-75 / I-65" },
  { id: "LAX-HOU", from: "Los Angeles, CA", to: "Houston, TX" },
  { id: "SEA-SAN", from: "Seattle, WA", to: "San Diego, CA" },
];

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
];
