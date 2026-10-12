import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { createTpsIcon } from "./pill";
import { createTpsStore, type TpsStore } from "./store";

interface AgentTarget {
  id: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
}

interface AttachedPill {
  workspaceId: string;
  registration: PluginButtonRegistration;
  store: TpsStore;
}

export interface TpsMeters {
  /** Applies the correction setting to every registered pill. */
  setCorrectWithUsage(value: boolean): void;
  stop(): void;
}

/**
 * Registers one TPS pill per active agent and keeps them in sync with the agent
 * directory. Pills measure the agent's live timeline; the store owns that
 * subscription for as long as the pill exists.
 */
export function registerTpsMeters(client: PluginClientContext): TpsMeters {
  const pills = new Map<string, AttachedPill>();
  const lifetime = new AbortController();
  let stopped = false;
  let correctWithUsage = true;
  let unsubscribe: (() => void) | undefined;

  function setCorrectWithUsage(value: boolean) {
    if (value === correctWithUsage) return;
    correctWithUsage = value;
    for (const pill of pills.values()) pill.store.setCorrectWithUsage(value);
  }

  const TpsIcon = createTpsIcon(setCorrectWithUsage);

  function detach(agentId: string) {
    const pill = pills.get(agentId);
    if (!pill) return;
    pills.delete(agentId);
    pill.store.dispose();
    pill.registration.remove();
  }

  function attach(agent: AgentTarget) {
    if (stopped) return;
    if (!agent.workspaceId || agent.archivedAt) {
      detach(agent.id);
      return;
    }
    const existing = pills.get(agent.id);
    if (existing) {
      if (existing.workspaceId === agent.workspaceId) return;
      detach(agent.id);
    }

    let registration: PluginButtonRegistration | undefined;
    const store = createTpsStore(
      client.paseo.agents.ref(agent.id).timeline,
      (snapshot) => registration?.update({ label: snapshot.label, title: snapshot.title }),
      { onError: (error) => console.error("[paseo-tps] Timeline observation failed", error) },
    );
    store.setCorrectWithUsage(correctWithUsage);
    const initial = store.getSnapshot();
    registration = client.addComposerPill({
      id: "tps",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        title: initial.title,
        icon: TpsIcon,
        label: initial.label,
        behavior: {
          kind: "action",
          onPress() {
            store.reset();
          },
        },
      },
    });
    pills.set(agent.id, { workspaceId: agent.workspaceId, registration, store });
  }

  void client.paseo.agents
    .list({ scope: "active", sync: {}, subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (stopped) {
        void subscription.release().catch(() => {});
        return;
      }
      unsubscribe = subscription.subscribe({
        snapshot: ({ entries }) => {
          const present = new Set(entries.map(({ agent }) => agent.id));
          for (const id of [...pills.keys()]) if (!present.has(id)) detach(id);
          for (const { agent } of entries) attach(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          if (message.payload.kind === "remove") detach(message.payload.agentId);
          else attach(message.payload.agent);
        },
        error: (error) => {
          if (!stopped) console.error("[paseo-tps] Agent observation failed", error);
        },
      });
    })
    .catch((error) => {
      if (!stopped) console.error("[paseo-tps] Agent observation failed", error);
    });

  return {
    setCorrectWithUsage,
    stop() {
      stopped = true;
      lifetime.abort();
      unsubscribe?.();
      unsubscribe = undefined;
      for (const id of [...pills.keys()]) detach(id);
    },
  };
}
