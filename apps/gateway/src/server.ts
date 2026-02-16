import { createPool } from "@vespid/db";
import type { ResultsStore } from "./results-store.js";
import { buildGatewayEdgeServer } from "./edge/server.js";
import { startGatewayBrainRuntime } from "./brain/runtime.js";

export async function buildGatewayServer(input?: {
  pool?: ReturnType<typeof createPool>;
  serviceToken?: string;
  resultsStore?: ResultsStore;
  edgeId?: string;
  brainId?: string;
}) {
  const pool = input?.pool ?? createPool(process.env.DATABASE_URL);
  const ownsPool = !input?.pool;

  const edge = await buildGatewayEdgeServer({
    pool,
    ...(input?.serviceToken ? { serviceToken: input.serviceToken } : {}),
    ...(input?.resultsStore ? { resultsStore: input.resultsStore } : {}),
    ...(input?.edgeId ? { edgeId: input.edgeId } : {}),
  });

  const brain = await startGatewayBrainRuntime({
    pool,
    ...(input?.brainId ? { brainId: input.brainId } : {}),
    ...(input?.resultsStore ? { resultsStore: input.resultsStore } : {}),
  });

  edge.addHook("onClose", async () => {
    try {
      await brain.close();
    } catch {
      // ignore
    }
    if (ownsPool) {
      try {
        await pool.end();
      } catch {
        // ignore
      }
    }
  });

  return edge;
}
