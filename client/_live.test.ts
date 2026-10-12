import { readFileSync } from "node:fs";
import { it } from "vitest";
import { createPaseoClient } from "@getpaseo/client";
import { createTpsStore } from "./store";

const readCred = () => readFileSync(`${process.env.HOME}/.paseo/local-credential`, "utf8").trim();

it(
  "live store loop",
  async () => {
    const client = createPaseoClient({
      url: "ws://localhost:6767/ws",
      localCredential: readCred,
      clientId: "tps-observer",
      appVersion: "0.0.0",
      reconnect: { enabled: false },
    });
    await client.connect();
    const cwd = "/Volumes/980_1TB/develop/src/github.com/mohemohe/paseo-tps";
    const agent = await client.agents.create({
      config: { provider: process.env.SPEC ?? "codex/gpt-6.1-sol" },
      cwd,
    });
    console.log("AGENT", agent.id);

    let turn = 0;
    let done = false;
    let endedAt = 0;
    let lateEvents: string[] = [];
    const store = createTpsStore(agent.timeline, () => {});
    agent.timeline.subscribe((u) => {
      const e = u.event;
      if (done && e.type === "timeline") lateEvents.push(`${e.item.type}:${JSON.stringify(e.item.text ?? "").slice(0, 30)}`);
      if (e.type === "turn_completed" || e.type === "turn_failed" || e.type === "turn_canceled") {
        done = true;
        endedAt = Date.now();
      }
    });

    const prompts = [
      "Reply with exactly: alpha",
      "Reply with exactly: beta",
      "Reply with exactly: gamma",
      "Reply with exactly: delta",
    ];
    for (const prompt of prompts) {
      turn += 1;
      done = false;
      lateEvents = [];
      await agent.send(prompt);
      const deadline = Date.now() + 30_000;
      while (!done && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 300));
      const snap = store.getSnapshot();
      console.log(
        `TURN ${turn} FINAL label="${snap.label}" phase=${snap.phase} tokens=${snap.tokens} genMs=${Math.round(snap.generationMs)} lateAfterEnd=[${lateEvents.join(", ")}]`,
      );
    }
    store.dispose();
  },
  180_000,
);
