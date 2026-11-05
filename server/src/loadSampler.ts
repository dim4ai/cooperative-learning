import { readFileSync } from 'fs';

// What the machine is doing, from /proc. LiveKit runs on the same host, so this covers it too.
// The drop counters are the kernel's: packets lost on this server. Loss on the way to the
// listeners' networks isn't visible from here.

export interface MachineSample {
  cpuPct: number;
  memUsedMb: number;
  rxPps: number;
  txPps: number;
  udpDropped: number; // since the previous sample
}

interface Counters { at: number; busy: number; total: number; rx: number; tx: number; drops: number }

function readCounters(): Counters {
  const cpu = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const total = cpu.reduce((a, b) => a + b, 0);
  const idle = cpu[3] + (cpu[4] ?? 0); // idle + iowait
  let rx = 0;
  let tx = 0;
  for (const line of readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
    const [name, data] = line.split(':');
    if (!data || /^\s*(lo|docker|veth|br-)/.test(name)) continue;
    const f = data.trim().split(/\s+/).map(Number);
    rx += f[1];
    tx += f[9];
  }
  const udp = readFileSync('/proc/net/snmp', 'utf8').split('\n').filter(l => l.startsWith('Udp:'));
  const names = udp[0].trim().split(/\s+/);
  const values = udp[1].trim().split(/\s+/).map(Number);
  const counter = (n: string) => values[names.indexOf(n)] ?? 0;
  return { at: Date.now(), busy: total - idle, total, rx, tx, drops: counter('RcvbufErrors') + counter('SndbufErrors') };
}

function memUsedMb(): number {
  const mem = readFileSync('/proc/meminfo', 'utf8');
  const kb = (n: string) => Number(new RegExp(`^${n}:\\s+(\\d+)`, 'm').exec(mem)?.[1] ?? 0);
  return Math.round((kb('MemTotal') - kb('MemAvailable')) / 1024);
}

/** Each call gives the load since the previous one; null on the first call or off Linux */
export function createSampler(): () => MachineSample | null {
  let prev: Counters | null = null;
  return () => {
    try {
      const now = readCounters();
      const last = prev;
      prev = now;
      if (!last) return null;
      const seconds = Math.max(1, (now.at - last.at) / 1000);
      return {
        cpuPct: Math.round(1000 * (now.busy - last.busy) / Math.max(1, now.total - last.total)) / 10,
        memUsedMb: memUsedMb(),
        rxPps: Math.round((now.rx - last.rx) / seconds),
        txPps: Math.round((now.tx - last.tx) / seconds),
        udpDropped: now.drops - last.drops,
      };
    } catch {
      return null;
    }
  };
}
