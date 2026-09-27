import type { SshTarget } from "@frogg/protocol/ssh-deploy/args";

/** OpenSSH client arguments for one deploy command; see `executor.ts`. */
export function buildSshArgs(target: SshTarget, command: string): string[] {
  return [
    "-T",
    "-o",
    ...(target.sshPassword
      ? [
          "NumberOfPasswordPrompts=1",
          "-o",
          "PreferredAuthentications=publickey,keyboard-interactive,password",
        ]
      : ["BatchMode=yes"]),
    "-o",
    "ConnectTimeout=10",
    ...(target.sshPort ? ["-p", String(target.sshPort)] : []),
    ...(target.identityFile ? ["-i", target.identityFile, "-o", "IdentitiesOnly=yes"] : []),
    target.host,
    command,
  ];
}
