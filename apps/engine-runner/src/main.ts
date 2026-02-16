import { buildEngineRunnerServer } from "./server.js";

async function main() {
  const host = process.env.ENGINE_RUNNER_HOST ?? "0.0.0.0";
  const port = Number(process.env.ENGINE_RUNNER_PORT ?? 3003);

  const server = await buildEngineRunnerServer();
  await server.listen({ host, port });

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
