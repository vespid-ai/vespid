async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("worker bootstrap ready", "v2");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
