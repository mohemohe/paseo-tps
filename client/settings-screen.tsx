import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Text } from "react-native";
import { settings } from "../shared/settings";

export interface TpsSettingsProps extends PluginSurfaceProps {
  onCorrectWithUsageChange(value: boolean): void;
}

export function TpsSettings({ theme, onCorrectWithUsageChange }: TpsSettingsProps) {
  const state = useSettings(settings);
  const correctWithUsage = state.status === "ready" ? state.values.correctWithUsage : undefined;
  useEffect(() => {
    if (correctWithUsage !== undefined) onCorrectWithUsageChange(correctWithUsage);
  }, [correctWithUsage, onCorrectWithUsageChange]);

  if (state.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading settings…</Text>;
  }
  if (state.status !== "ready") {
    return (
      <SettingsSection title="Token rate">
        <Text style={{ color: theme.colors.statusDanger }}>{state.error}</Text>
        <SettingsCard>
          <SettingsAction label="Reload settings" actionLabel="Reload" onPress={() => void state.reload()} />
          {state.status === "invalid" ? (
            <SettingsAction
              label="Restore default settings"
              actionLabel="Reset"
              onPress={() => void state.reset()}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Token rate">
      <SettingsCard>
        <SettingsSwitch
          label="Correct the final rate with the provider's usage"
          hint="When on, a finished turn uses the provider's reported output tokens (turn_completed.usage.outputTokens) instead of the estimate. Live values are always estimates."
          value={state.values.correctWithUsage}
          disabled={state.saving}
          error={state.saveError}
          onValueChange={(correctWithUsage) =>
            void state.save({ ...state.values, correctWithUsage }, state.revision)
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
