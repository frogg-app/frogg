#!/usr/bin/env node
// Compares measure-rust-baselines.mjs summaries against the targets in docs/plans/rust-rebuild.md
// and prints a Markdown table (CI appends it to the job summary).
//
//   node scripts/bench/report-rust-targets.mjs --node node.json --front front.json \
//     [--standalone standalone.json] [--enforce]
//
// `--enforce` exits 1 when a phase 2 target is missed. CI reports without enforcing: hosted
// runners are shared, and a p99 a fraction of a millisecond apart is within their noise.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    node: { type: "string" },
    front: { type: "string" },
    standalone: { type: "string" },
    enforce: { type: "boolean", default: false },
  },
});
if (!values.node || !values.front) {
  console.error(
    "usage: report-rust-targets.mjs --node <json> --front <json> [--standalone <json>]",
  );
  process.exit(2);
}
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const node = read(values.node);
const front = read(values.front);
const standalone = values.standalone ? read(values.standalone) : null;

/** Phase 2 pass conditions (docs/plans/rust-rebuild.md, "What has to beat what"). */
const FIRST_PONG_TARGET_MS = 150;
const FORWARDED_RPC_BUDGET_MS = 0.2;

const ms = (n) => (n === undefined ? "n/a" : `${n} ms`);
const mb = (n) => (n === undefined ? "n/a" : `${n} MB`);
const rows = [];
const checks = [];
function check(name, actual, target, pass) {
  checks.push(pass);
  rows.push(`| ${name} | ${actual} | ${target} | ${pass ? "pass" : "**miss**"} |`);
}
function info(name, nodeValue, frontValue) {
  rows.push(`| ${name} | Node ${nodeValue}, front ${frontValue} | report only | |`);
}

check(
  "Spawn → first pong (front, p50)",
  ms(front.coldStartMs.firstPing.p50),
  `≤ ${FIRST_PONG_TARGET_MS} ms`,
  front.coldStartMs.firstPing.p50 <= FIRST_PONG_TARGET_MS,
);
// The fair baseline is the same worker pinged directly, interleaved with the front's pings in
// one run; a separate Node run on a shared VM varies by more than the budget.
const direct = front.directSessionRpcPingMs;
const baseline = direct ?? node.sessionRpcPingMs;
const baselineLabel = direct ? "same worker direct" : "Node run";
const budget = Math.round((baseline.p99 + FORWARDED_RPC_BUDGET_MS) * 100) / 100;
check(
  "Forwarded session RPC p99",
  ms(front.sessionRpcPingMs.p99),
  `≤ ${baselineLabel} ${baseline.p99} + ${FORWARDED_RPC_BUDGET_MS} = ${budget} ms`,
  front.sessionRpcPingMs.p99 <= budget,
);
if (direct) {
  rows.push(
    `| Forwarded session RPC p50 | front ${ms(front.sessionRpcPingMs.p50)}, direct ${ms(direct.p50)} | report only | |`,
  );
}
info("Spawn → listening (p50)", ms(node.coldStartMs.listen.p50), ms(front.coldStartMs.listen.p50));
info(
  "Spawn → first session RPC (p50)",
  ms(node.coldStartMs.firstSessionRpc?.p50),
  ms(front.coldStartMs.firstSessionRpc?.p50),
);
info("Session RPC p50", ms(node.sessionRpcPingMs.p50), ms(front.sessionRpcPingMs.p50));
info("Transport ping p99", ms(node.transportPingMs.p99), ms(front.transportPingMs.p99));
info("Idle RSS, process tree (p50)", mb(node.rssMb.p50), mb(front.rssMb.p50));
if (standalone) {
  rows.push(
    `| Front alone, no worker | first pong ${ms(standalone.coldStartMs.firstPing.p50)}, RSS ${mb(standalone.rssMb.p50)} | report only | |`,
  );
}

const out = [
  "### Rust daemon phase 2 vs Node",
  "",
  `Node: ${node.daemon}. Front: ${front.daemon}.`,
  "",
  "| Metric | Measured | Target | |",
  "| --- | --- | --- | --- |",
  ...rows,
  "",
];
process.stdout.write(`${out.join("\n")}\n`);
if (values.enforce && checks.includes(false)) process.exit(1);
