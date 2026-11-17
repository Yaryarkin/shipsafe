import { describe, expect, it } from "vitest";
import { ScanError, type ScanErrorCode } from "../errors";
import { isBlockedIp, normalizeUrl } from "../ssrf";

function errorCodeOf(input: string): ScanErrorCode | null {
  try {
    normalizeUrl(input);
    return null;
  } catch (error) {
    if (error instanceof ScanError) return error.code;
    throw error;
  }
}

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("blocks private/reserved IPv4 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["::1", "::", "fd00::1", "fc00::abcd", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1"])(
    "blocks private/reserved IPv6 %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    },
  );

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "104.20.23.154", "172.32.0.1", "172.15.255.255", "172.66.147.243"])(
    "allows public IPv4 %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it.each(["2606:4700:10::6814:179a", "2001:4860:4860::8888"])("allows public IPv6 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it("refuses strings that are not IP addresses", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });
});

describe("normalizeUrl", () => {
  it("adds https:// and a trailing slash to bare domains", () => {
    expect(normalizeUrl("example.com").href).toBe("https://example.com/");
  });

  it("keeps the path and query, strips the hash and lowercases the host", () => {
    expect(normalizeUrl("  https://Example.COM/app?x=1#section ").href).toBe("https://example.com/app?x=1");
  });

  it("accepts allowed non-default ports", () => {
    expect(normalizeUrl("example.com:8080").port).toBe("8080");
    expect(normalizeUrl("http://example.com:8443/").port).toBe("8443");
  });

  it.each([
    "http://localhost",
    "http://localhost:3000",
    "http://app.localhost",
    "http://printer.local",
    "http://db.internal",
    "http://metadata.google.internal",
  ])("blocks local hostname %s", (input) => {
    expect(errorCodeOf(input)).toBe("BLOCKED_TARGET");
  });

  it.each([
    "http://127.0.0.1",
    "http://10.0.0.5",
    "http://172.20.0.1",
    "http://192.168.0.10",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]",
    "http://[fd00::1]",
    "http://[::ffff:127.0.0.1]",
    "http://2130706433",
    "http://0x7f000001",
    "http://0177.0.0.1",
  ])("blocks private IP literal %s (including decimal/hex/octal/mapped forms)", (input) => {
    expect(errorCodeOf(input)).toBe("BLOCKED_TARGET");
  });

  it.each(["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "gopher://example.com"])(
    "blocks non-HTTP protocol %s",
    (input) => {
      expect(errorCodeOf(input)).toBe("BLOCKED_TARGET");
    },
  );

  it("blocks credentials and non-web ports", () => {
    expect(errorCodeOf("https://user:pass@example.com")).toBe("BLOCKED_TARGET");
    expect(errorCodeOf("https://example.com:22")).toBe("BLOCKED_TARGET");
  });

  it("rejects malformed input", () => {
    expect(errorCodeOf("notaurl")).toBe("INVALID_URL");
    expect(errorCodeOf("https://")).toBe("INVALID_URL");
  });

  it("allows public IP literals", () => {
    expect(normalizeUrl("http://8.8.8.8").hostname).toBe("8.8.8.8");
  });
});
