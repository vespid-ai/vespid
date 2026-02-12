import { z } from "zod";

const argsSchema = z.object({
  command: z.enum(["connect", "start"]).default("start"),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const command = argv[2] === "connect" ? "connect" : "start";
  return argsSchema.parse({ command });
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  // eslint-disable-next-line no-console
  console.log(`vespid node-agent ${parsed.command} (bootstrap mode)`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
