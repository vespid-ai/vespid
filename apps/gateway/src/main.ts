import { buildGatewayEdgeServer } from "./edge/server.js";
import { startGatewayBrainRuntime } from "./brain/runtime.js";

async function main(): Promise<void> {
  const role = (process.env.GATEWAY_ROLE ?? "all").toLowerCase();
  const runEdge = role === "all" || role === "edge";
  const runBrain = role === "all" || role === "brain";

  const host = process.env.GATEWAY_HOST ?? "0.0.0.0";
  const port = Number(process.env.GATEWAY_PORT ?? 3002);

  const edgeServer = runEdge ? await buildGatewayEdgeServer() : null;
  const brainRuntime = runBrain ? await startGatewayBrainRuntime() : null;

  if (edgeServer) {
    await edgeServer.listen({ host, port });
  }

  const shutdown = async () => {
    try {
      if (edgeServer) await edgeServer.close();
    } catch {
      // ignore
    }
    try {
      if (brainRuntime) await brainRuntime.close();
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  if (!runEdge && runBrain) {
    // Brain-only: keep the process alive.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
