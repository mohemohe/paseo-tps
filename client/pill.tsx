import { useSettings, type PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect } from "react";
import { settings } from "../shared/settings";

/**
 * The pill label is not a component, so its icon relays the correction setting
 * to the registration layer while the composer is visible.
 */
export function createTpsIcon(onCorrectWithUsageChange: (value: boolean) => void) {
  return function TpsIcon({ size, color }: PluginButtonIconProps) {
    const state = useSettings(settings);
    const correctWithUsage = state.status === "ready" ? state.values.correctWithUsage : undefined;
    useEffect(() => {
      if (correctWithUsage !== undefined) onCorrectWithUsageChange(correctWithUsage);
    }, [correctWithUsage, onCorrectWithUsageChange]);
    return <Icon name="Gauge" size={size} color={color} />;
  };
}
