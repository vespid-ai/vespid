import { buildGatewayServer } from "./server.js";

async function main(): Promise<void> {
  const server = await buildGatewayServer();
  const host = process.env.GATEWAY_HOST ?? "0.0.0.0";
  const port = Number(process.env.GATEWAY_PORT ?? 3002);
  await server.listen({ host, port });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

