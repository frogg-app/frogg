//! Command line. Without arguments the binary is the standalone front (env-configured, see
//! `config`). `--supervise` makes it the daemon: it supervises the Node worker in place of
//! `packages/server/scripts/supervisor-entrypoint.ts`, which is how the CLI starts it when
//! `FROGG_RS_FRONT=1`:
//!
//!   frogg-daemond --supervise --node <node> [--node-arg <arg>]... --worker <daemon-worker.js>
//!                 [-- <worker args>...]

use std::path::PathBuf;

pub struct Cli {
    pub supervise: Option<SuperviseArgs>,
}

pub struct SuperviseArgs {
    pub node: PathBuf,
    pub node_args: Vec<String>,
    pub worker: PathBuf,
    pub worker_args: Vec<String>,
}

impl Cli {
    pub fn parse(args: impl IntoIterator<Item = String>) -> anyhow::Result<Self> {
        let mut args = args.into_iter();
        let mut supervise = false;
        let mut node = None;
        let mut node_args = Vec::new();
        let mut worker = None;
        let mut worker_args = Vec::new();
        while let Some(arg) = args.next() {
            let mut value = |name: &str| {
                args.next()
                    .ok_or_else(|| anyhow::anyhow!("{name} needs a value"))
            };
            match arg.as_str() {
                "--supervise" => supervise = true,
                "--node" => node = Some(PathBuf::from(value("--node")?)),
                "--node-arg" => node_args.push(value("--node-arg")?),
                "--worker" => worker = Some(PathBuf::from(value("--worker")?)),
                "--" => {
                    worker_args.extend(args.by_ref());
                    break;
                }
                "--version" => {
                    println!("{}", env!("CARGO_PKG_VERSION"));
                    std::process::exit(0);
                }
                other => anyhow::bail!("unknown argument {other:?}"),
            }
        }
        if !supervise {
            if node.is_some() || worker.is_some() || !worker_args.is_empty() {
                anyhow::bail!("--node, --worker and worker arguments need --supervise");
            }
            return Ok(Self { supervise: None });
        }
        Ok(Self {
            supervise: Some(SuperviseArgs {
                node: node.ok_or_else(|| anyhow::anyhow!("--supervise needs --node"))?,
                node_args,
                worker: worker.ok_or_else(|| anyhow::anyhow!("--supervise needs --worker"))?,
                worker_args,
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> anyhow::Result<Cli> {
        Cli::parse(args.iter().map(|a| a.to_string()))
    }

    #[test]
    fn no_arguments_is_the_standalone_front() {
        assert!(parse(&[]).unwrap().supervise.is_none());
    }

    #[test]
    fn parses_a_supervised_launch() {
        let cli = parse(&[
            "--supervise",
            "--node",
            "/n",
            "--node-arg",
            "--disable-warning=DEP0040",
            "--worker",
            "/w.js",
            "--",
            "--no-relay",
            "--web-ui",
        ])
        .unwrap();
        let spec = cli.supervise.unwrap();
        assert_eq!(spec.node, PathBuf::from("/n"));
        assert_eq!(spec.node_args, ["--disable-warning=DEP0040"]);
        assert_eq!(spec.worker, PathBuf::from("/w.js"));
        assert_eq!(spec.worker_args, ["--no-relay", "--web-ui"]);
    }

    #[test]
    fn rejects_incomplete_or_unknown_arguments() {
        assert!(parse(&["--supervise", "--node", "/n"]).is_err());
        assert!(parse(&["--worker", "/w.js"]).is_err());
        assert!(parse(&["--bogus"]).is_err());
        assert!(parse(&["--node"]).is_err());
    }
}
