import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const server = await buildServer();
  const port = Number(process.env.API_PORT ?? 3001);
  const host = process.env.API_HOST ?? "0.0.0.0";
  await server.listen({ port, host });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
