import { pairingScheme } from "@frogg/branding";
import os from "node:os";

import {
  buildPairingUrl,
  ConnectionOfferV2Schema,
  type ConnectionOffer,
  type ConnectionOfferV3,
} from "@frogg/protocol/connection-offer";
import { rankLanIpv4Addresses } from "@frogg/protocol/daemon-endpoints";

interface BuildOfferEndpointsArgs {
  listenHost: string;
  port: number;
}

export function buildOfferEndpoints({ listenHost, port }: BuildOfferEndpointsArgs): string[] {
  const endpoints: string[] = [];

  const isLoopbackHost = listenHost === "127.0.0.1" || listenHost === "localhost";
  const isWildcardHost = listenHost === "0.0.0.0" || listenHost === "::" || listenHost === "[::]";

  if (isWildcardHost) {
    const lanIp = getPrimaryLanIp();
    if (lanIp) {
      endpoints.push(`${lanIp}:${port}`);
    }
  } else if (!isLoopbackHost) {
    endpoints.push(`${listenHost}:${port}`);
  }

  endpoints.push(`localhost:${port}`);

  return dedupePreserveOrder(endpoints);
}

export async function createConnectionOfferV2(args: {
  serverId: string;
  daemonPublicKeyB64: string;
  relay: { endpoint: string; useTls?: boolean };
}): Promise<ConnectionOffer> {
  return ConnectionOfferV2Schema.parse({
    v: 2,
    serverId: args.serverId,
    daemonPublicKeyB64: args.daemonPublicKeyB64,
    relay: args.relay,
  });
}

export function encodeOfferToPairingUrl(args: {
  offer: ConnectionOffer | ConnectionOfferV3;
  appBaseUrl: string;
}): string {
  const json = JSON.stringify(args.offer);
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  return args.appBaseUrl
    ? buildPairingUrl(args.appBaseUrl, encoded)
    : `${pairingScheme}://pair#offer=${encoded}`;
}

function getPrimaryLanIp(): string | null {
  const override = process.env.FROGG_PRIMARY_LAN_IP?.trim();
  if (override) return override;
  return rankLanIpv4Addresses(os.networkInterfaces())[0] ?? null;
}

function dedupePreserveOrder(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
