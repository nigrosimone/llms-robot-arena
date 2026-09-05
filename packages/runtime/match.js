import {
  createMatch,
  sensorsFor,
  step,
  closeReplay,
  digest,
} from "../sim/index.js";
export async function runMatch({
  bots,
  seed = 0,
  mirrored = false,
  mode = "exhibition",
  budgetMode = "fuel",
  createClient,
  onProgress = () => {},
}) {
  const clients = await Promise.all(bots.map(() => createClient()));
  try {
    await Promise.all(
      clients.map((c, i) =>
        c.request({ type: "init", source: bots[i].source, budgetMode }),
      ),
    );
    const refs = bots.map((b) => ({
      id: b.id,
      model: b.model ?? "Local controller",
      codeSha256: digest(b.source),
    }));
    const m = createMatch(seed, mirrored, refs);
    while (!m.result) {
      const snapshots = [sensorsFor(m, 0), sensorsFor(m, 1)];
      const out = await Promise.all(
        clients.map((c, i) =>
          c.request({ type: "tick", sensors: snapshots[i] }),
        ),
      );
      step(
        m,
        out,
        out.map((o) => digest(o.memory)),
      );
      if (m.tick % 120 === 0) onProgress(m.tick / 7200);
    }
    return closeReplay(m, mode, {
      engine: "QuickJS 0.31.0 / WASM",
      budgetMode,
      fuelInterrupts: budgetMode === "fuel" ? 8 : null,
    });
  } finally {
    for (const c of clients) c.close();
  }
}
