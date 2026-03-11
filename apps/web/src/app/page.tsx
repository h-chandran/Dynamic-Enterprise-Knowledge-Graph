import { appEnv } from "@/lib/env";
import { VisualizationScreen } from "@/features/visualization/VisualizationScreen";

export default function HomePage() {
  return (
    <main className="app-shell">
      <VisualizationScreen appName={appEnv.NEXT_PUBLIC_APP_NAME} />
    </main>
  );
}
