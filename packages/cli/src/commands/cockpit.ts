import { Command } from "commander";
import { findProjectRoot, resolveBookId } from "../utils.js";
import { startStudio } from "./studio.js";

export const cockpitCommand = new Command("cockpit")
  .description("Start InkOS Studio directly in conversation cockpit")
  .argument("[bookId]", "Open cockpit for a specific book")
  .option("-p, --port <port>", "Server port", "4567")
  .action(async (bookIdArg: string | undefined, opts) => {
    const root = findProjectRoot();
    const bookId = bookIdArg ? await resolveBookId(bookIdArg, root) : undefined;

    await startStudio(root, {
      port: opts.port,
      label: "InkOS Cockpit",
      initialRoute: {
        pathname: "/cockpit/",
        searchParams: bookId ? { bookId } : undefined,
      },
    });
  });
