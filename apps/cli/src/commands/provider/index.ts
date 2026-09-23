import { Command } from "commander";
import { runLsCommand } from "./ls.js";
import { runModelsCommand } from "./models.js";
import { runDiagnosticCommand } from "./diagnostic.js";
import { runUpdateCommand } from "./update.js";
import { runUpdateSettingsCommand } from "./update-settings.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";

export function createProviderCommand(): Command {
  const provider = new Command("provider").description("Manage agent providers");

  addJsonAndDaemonHostOptions(
    provider.command("ls").description("List available providers and status"),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("models")
      .description("List models for a provider")
      .argument("<provider>", "Provider name (claude, codex, opencode)")
      .option("--thinking", "Include thinking option IDs for each model"),
  ).action(withOutput(runModelsCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("diagnostic")
      .description("Show provider installation, environment, and availability diagnostics")
      .argument("<provider>", "Provider name"),
  ).action(withOutput(runDiagnosticCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("update")
      .description("Check for and install newer provider CLI releases")
      .argument("[provider]", "Provider to update; omit to list, or use --all")
      .option("--check", "Only report versions; do not install anything")
      .option("--all", "Update every provider that has a newer release"),
  ).action(withOutput(runUpdateCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("update-settings")
      .description("Show or change automatic provider update behaviour")
      .option("--auto-update <bool>", "Install newer releases automatically (true/false)")
      .option("--check-enabled <bool>", "Poll for newer releases in the background (true/false)")
      .option("--interval <minutes>", "Minutes between background checks")
      .option("--ignore <providers>", "Comma-separated provider ids to skip"),
  ).action(withOutput(runUpdateSettingsCommand));

  return provider;
}
