import { RouteScreen } from "@/app/routes/route-screen";
import { getMastersPayload } from "@/lib/masters";

export default async function RoutesPage() {
  const masters = await getMastersPayload();

  return (
    <RouteScreen
      dbConnected={masters.dbConnected}
      routes={masters.routes}
      vehicles={masters.vehicles}
    />
  );
}
