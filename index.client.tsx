import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { registerTpsMeters } from "./client/register";
import { TpsSettings } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  const meters = registerTpsMeters(client);
  const removeSettings = client.addSettingsScreen({
    id: "display",
    title: "Display",
    icon: "SlidersHorizontal",
    Component: (props: PluginSurfaceProps) => (
      <TpsSettings {...props} onCorrectWithUsageChange={meters.setCorrectWithUsage} />
    ),
  });
  return () => {
    void removeSettings();
    meters.stop();
  };
}
