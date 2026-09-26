import { statfs } from "node:fs/promises";
import os from "node:os";

export interface CpuTimesSample {
  idle: number;
  total: number;
}

export interface DiskUsage {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface HostMetrics {
  sampledAt: string;
  hostname: string;
  platform: NodeJS.Platform;
  arch: string;
  uptimeSeconds: number;
  cpu: {
    cores: number;
    model: string | null;
    /** 0-100 across all cores over the sample window; null when no window exists yet. */
    usagePercent: number | null;
    /** 1/5/15 minute load averages; null on Windows where Node reports zeros. */
    loadAverage: [number, number, number] | null;
  };
  memory: { totalBytes: number; freeBytes: number; usedBytes: number };
  daemon: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    /** 0-100 of one core over the sample window; null without a window. */
    cpuPercent: number | null;
    uptimeSeconds: number;
  };
  disk: DiskUsage | null;
}

export function sampleCpuTimes(cpus: os.CpuInfo[] = os.cpus()): CpuTimesSample {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

export function cpuUsagePercent(previous: CpuTimesSample, current: CpuTimesSample): number | null {
  const total = current.total - previous.total;
  if (total <= 0) return null;
  const busy = total - (current.idle - previous.idle);
  return clampPercent((busy / total) * 100);
}

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** Volume stats for the filesystem holding `target`; statfs works on Windows too (Node >= 18.15). */
export async function readDiskUsage(target: string): Promise<DiskUsage> {
  const stats = await statfs(target);
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  // `bfree` includes root-reserved blocks, so used = total - bfree.
  const usedBytes = Math.max(0, totalBytes - stats.bfree * stats.bsize);
  return { path: target, totalBytes, freeBytes, usedBytes };
}

const MIN_WINDOW_MS = 200;

/**
 * Samples host and daemon-process load. CPU figures are deltas against the
 * previous call; when the last call is too recent or absent it takes a short
 * window itself, so every response carries a real percentage.
 */
export class HostMetricsSampler {
  private last: { at: number; cpu: CpuTimesSample; process: NodeJS.CpuUsage } | null = null;

  constructor(
    private readonly options: { diskPath: string; sleep?: (ms: number) => Promise<void> },
  ) {}

  async sample(): Promise<HostMetrics> {
    if (!this.last || Date.now() - this.last.at < MIN_WINDOW_MS) {
      this.last = this.takeCounters();
      await (this.options.sleep ?? defaultSleep)(MIN_WINDOW_MS + 50);
    }
    const previous = this.last;
    const current = this.takeCounters();
    this.last = current;

    const elapsedMicros = (current.at - previous.at) * 1000;
    const processMicros =
      current.process.user -
      previous.process.user +
      current.process.system -
      previous.process.system;
    const cpus = os.cpus();
    const memory = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const loads = os.loadavg();

    return {
      sampledAt: new Date(current.at).toISOString(),
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(os.uptime()),
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model?.trim() || null,
        usagePercent: cpuUsagePercent(previous.cpu, current.cpu),
        loadAverage:
          process.platform === "win32" ? null : [loads[0] ?? 0, loads[1] ?? 0, loads[2] ?? 0],
      },
      memory: { totalBytes: totalMem, freeBytes: freeMem, usedBytes: totalMem - freeMem },
      daemon: {
        pid: process.pid,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        cpuPercent:
          elapsedMicros > 0 ? Math.round((processMicros / elapsedMicros) * 1000) / 10 : null,
        uptimeSeconds: Math.round(process.uptime()),
      },
      disk: await readDiskUsage(this.options.diskPath).catch(() => null),
    };
  }

  private takeCounters() {
    return { at: Date.now(), cpu: sampleCpuTimes(), process: process.cpuUsage() };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
