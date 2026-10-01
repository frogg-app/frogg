import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addJsonOption } from "../../utils/command-options.js";
import {
  runIndexBuildCommand,
  runIndexSignCommand,
  runIndexVerifyCommand,
  runKeygenCommand,
  runNewCommand,
  runPackCommand,
} from "./authoring.js";
import {
  makeSetEnabledCommand,
  runInstallCommand,
  runLinkCommand,
  runListCommand,
  runReposAddCommand,
  runReposListCommand,
  runReposRemoveCommand,
  runUninstallCommand,
  runUnlinkCommand,
  runUpdateCommand,
} from "./daemon.js";

export function createPluginsCommand(): Command {
  const plugins = new Command("plugins").description(
    "Manage plugins, repositories and plugin authoring",
  );

  addJsonAndDaemonHostOptions(
    plugins.command("list").alias("ls").description("List installed and dev-linked plugins"),
  ).action(withOutput(runListCommand));
  addJsonAndDaemonHostOptions(
    plugins
      .command("install")
      .description("Install a plugin from a configured repository")
      .argument("<id>", "Plugin id")
      .option("--version <version>", "Exact version or range (default: newest compatible)")
      .option("--repo <url>", "Repository index URL when several carry the plugin")
      .option("-y, --yes", "Grant the requested capabilities without prompting"),
  ).action(withOutput(runInstallCommand));
  addJsonAndDaemonHostOptions(
    plugins.command("uninstall").description("Uninstall a plugin").argument("<id>", "Plugin id"),
  ).action(withOutput(runUninstallCommand));
  addJsonAndDaemonHostOptions(
    plugins
      .command("enable")
      .description("Enable an installed plugin")
      .argument("<id>", "Plugin id"),
  ).action(withOutput(makeSetEnabledCommand(true)));
  addJsonAndDaemonHostOptions(
    plugins
      .command("disable")
      .description("Disable an installed plugin")
      .argument("<id>", "Plugin id"),
  ).action(withOutput(makeSetEnabledCommand(false)));
  addJsonAndDaemonHostOptions(
    plugins
      .command("update")
      .description("Update a plugin, or list available updates")
      .argument("[id]", "Plugin id; omit to list updates, or use --all")
      .option("--all", "Update every plugin with an update available")
      .option("--version <version>", "Target version or range")
      .option("-y, --yes", "Grant capabilities an update adds without prompting"),
  ).action(withOutput(runUpdateCommand));

  const repos = plugins.command("repos").description("Manage plugin repositories");
  addJsonAndDaemonHostOptions(
    repos.command("list").alias("ls").description("List repositories and their status"),
  ).action(withOutput(runReposListCommand));
  addJsonAndDaemonHostOptions(
    repos
      .command("add")
      .description("Add a user repository (when the build allows it)")
      .argument("<url>", "HTTPS URL of the repository's index.json")
      .option(
        "--public-key <base64>",
        "Pin this ed25519 key instead of trusting <url>.pub on first use",
      )
      .option("--name <name>", "Display name (default: the index's name)"),
  ).action(withOutput(runReposAddCommand));
  addJsonAndDaemonHostOptions(
    repos
      .command("remove")
      .description("Remove a user repository")
      .argument("<url>", "Repository URL"),
  ).action(withOutput(runReposRemoveCommand));

  addJsonAndDaemonHostOptions(
    plugins
      .command("link")
      .description("Link a local plugin folder (beta daemons; hot-reloads)")
      .argument("<dir>", "Plugin folder on the host"),
  ).action(withOutput(runLinkCommand));
  addJsonAndDaemonHostOptions(
    plugins
      .command("unlink")
      .description("Unlink a dev-linked plugin")
      .argument("<id>", "Plugin id"),
  ).action(withOutput(runUnlinkCommand));

  addJsonOption(
    plugins
      .command("new")
      .description("Scaffold a plugin")
      .argument("<id>", "Plugin id, e.g. acme.jira-links")
      .option("--name <name>", "Display name (default: derived from the id)")
      .option("--dir <dir>", "Target directory (default: ./<id>)"),
  ).action(withOutput(runNewCommand));
  addJsonOption(
    plugins
      .command("pack")
      .description("Validate the manifest and write <id>-<version>.tgz and its sha256")
      .argument("[dir]", "Plugin folder (default: current directory)")
      .option("--out <dir>", "Output directory (default: the plugin folder)"),
  ).action(withOutput(runPackCommand));
  addJsonOption(
    plugins
      .command("keygen")
      .description("Generate an ed25519 keypair for signing a repository")
      .option("--out <file>", "Write the private key to this file (0600) instead of printing it"),
  ).action(withOutput(runKeygenCommand));

  const index = plugins.command("index").description("Repository index tooling (used by repo CI)");
  addJsonOption(
    index
      .command("build")
      .description("Build index.json from plugin folders and packed tarballs")
      .requiredOption("--plugins <dir>", "Folder of plugins/<category>/<id>/")
      .requiredOption("--tarballs <dir>", "Folder containing the packed .tgz files")
      .requiredOption("--base-url <url>", "Public URL the tarballs are served from")
      .requiredOption("--name <name>", "Repository display name")
      .option("--categories <file>", "categories.json; every category folder must be declared")
      .option("--commit <sha>", "Source commit recorded per version")
      .requiredOption("--out <file>", "Where to write index.json"),
  ).action(withOutput(runIndexBuildCommand));
  addJsonOption(
    index
      .command("sign")
      .description("Sign index.json, writing index.json.sig and index.json.pub")
      .argument("<file>", "index.json")
      .option(
        "--key-env <var>",
        "Environment variable holding the private key",
        "PLUGIN_REPO_SIGNING_KEY",
      )
      .option("--key-file <file>", "File holding the private key"),
  ).action(withOutput(runIndexSignCommand));
  addJsonOption(
    index
      .command("verify")
      .description(
        "Verify index.json's signature and, optionally, every tarball's sha256 and manifest",
      )
      .argument("<file>", "index.json")
      .option("--public-key <base64>", "Repository public key (default: $PLUGIN_REPO_PUBLIC_KEY)")
      .option("--tarballs <dir>", "Also verify the tarballs in this folder"),
  ).action(withOutput(runIndexVerifyCommand));

  return plugins;
}
