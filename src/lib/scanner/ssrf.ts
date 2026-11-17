import dns from "node:dns";
import net from "node:net";
import { ScanError } from "./errors";

/**
 * SSRF guard. Every outbound request goes through:
 *  1. assertSafeUrl()  – protocol / port / hostname / IP-literal validation (also on every redirect hop)
 *  2. safeLookup()     – DNS hook used by the socket itself, so the IP that is actually connected to
 *                        is validated (defeats DNS rebinding between the check and the connect).
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp"];
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data"]);

// Separate lists on purpose: a single BlockList matches IPv4 queries against IPv6 rules such as
// ::ffff:0:0/96, which would wrongly block every public IPv4 address.
const ipv4BlockList = new net.BlockList();
const ipv6BlockList = new net.BlockList();

// IPv4: unspecified, private, CGNAT, loopback, link-local, reserved, documentation, benchmarking, multicast.
const IPV4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
for (const [address, prefix] of IPV4_BLOCKED) ipv4BlockList.addSubnet(address, prefix, "ipv4");

// IPv6: unspecified, loopback, IPv4-mapped/translated, discard, docs, 6to4, ULA, link-local, site-local, multicast.
const IPV6_BLOCKED: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];
for (const [address, prefix] of IPV6_BLOCKED) ipv6BlockList.addSubnet(address, prefix, "ipv6");

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function isBlockedIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return ipv4BlockList.check(address, "ipv4");
  if (version === 6) {
    const mapped = MAPPED_IPV4.exec(address);
    if (mapped?.[1] && ipv4BlockList.check(mapped[1], "ipv4")) return true;
    return ipv6BlockList.check(address, "ipv6");
  }
  return true; // not a valid IP: refuse
}

export function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** Structural validation with no network access. Throws ScanError on anything unsafe. */
export function assertSafeUrl(url: URL): void {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new ScanError("BLOCKED_TARGET", "Only http:// and https:// URLs can be scanned.");
  }
  if (url.username || url.password) {
    throw new ScanError("BLOCKED_TARGET", "URLs containing credentials are not allowed.");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new ScanError("BLOCKED_TARGET", "Only standard web ports (80, 443, 8080, 8443) can be scanned.");
  }

  const hostname = stripBrackets(url.hostname.toLowerCase()).replace(/\.$/, "");
  if (!hostname) throw new ScanError("INVALID_URL", "The URL is missing a hostname.");

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new ScanError("BLOCKED_TARGET", "Local and internal hostnames cannot be scanned.");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new ScanError("BLOCKED_TARGET", "Private, loopback and reserved IP addresses cannot be scanned.");
    }
    return;
  }

  if (!hostname.includes(".") || !/^[a-z0-9.-]+$/.test(hostname)) {
    throw new ScanError("INVALID_URL", "Enter a public domain such as https://your-app.com.");
  }
}

/** Accepts loose input ("example.com", "https://example.com/path#x") and returns a normalized, validated URL. */
export function normalizeUrl(input: string): URL {
  let raw = input.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (!hasScheme) {
    // Reject things like "javascript:alert(1)" or "file:/etc/passwd", but allow "example.com:8080".
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw)) {
      throw new ScanError("BLOCKED_TARGET", "Only http:// and https:// URLs can be scanned.");
    }
    raw = `https://${raw}`;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScanError("INVALID_URL", "That does not look like a valid URL.");
  }

  url.hash = "";
  assertSafeUrl(url);
  return url;
}

/** Up-front DNS check so the user gets a clear error before any request is attempted. */
export async function assertPublicDns(url: URL): Promise<void> {
  const hostname = stripBrackets(url.hostname);
  if (net.isIP(hostname)) return; // already validated by assertSafeUrl

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new ScanError("DNS_FAILURE", `Could not resolve ${hostname}. Check the domain and try again.`);
  }
  if (addresses.length === 0) {
    throw new ScanError("DNS_FAILURE", `Could not resolve ${hostname}.`);
  }
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    throw new ScanError(
      "BLOCKED_TARGET",
      "This domain resolves to a private or reserved IP address and cannot be scanned.",
    );
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * Replacement for dns.lookup used by http/https sockets. Refuses the connection if ANY resolved
 * address is private or reserved.
 */
export function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { all: true, family: options.family }, (err, addresses) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    const first = addresses[0];
    if (!first) {
      const empty: NodeJS.ErrnoException = new Error(`No addresses found for ${hostname}`);
      empty.code = "ENOTFOUND";
      callback(empty, "", 0);
      return;
    }
    if (addresses.some((entry) => isBlockedIp(entry.address))) {
      const blocked: NodeJS.ErrnoException = new Error(`Refusing to connect to a private address for ${hostname}`);
      blocked.code = "ESSRFBLOCKED";
      callback(blocked, "", 0);
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
}
