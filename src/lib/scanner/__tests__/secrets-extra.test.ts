import { describe, expect, it } from "vitest";
import { analyzeSecrets, isRealDatabaseUrl } from "../checks/secret-patterns";
import type { Finding } from "../types";

/** Every dummy secret is assembled from fragments at runtime, so this file holds no real-looking key. */
const SITE = "https://example.com";
const j = (...parts: string[]) => parts.join("");

const DUMMY = {
  telegram: j("123456789", ":", "AA", "b".repeat(33)),
  npm: j("npm", "_", "c".repeat(36)),
  mailgun: j("key", "-", "d".repeat(32)),
  twilio: j("SK", "e".repeat(32)),
  digitalocean: j("dop", "_v1_", "f".repeat(64)),
  discord: j("MTIzNDU2Nzg5MDEyMzQ1Njc4", ".", "GabcdE", ".", "q".repeat(27)),
  awsSecret: j("aws_secret_access_key", "=", "A".repeat(20), "b".repeat(20)),
  fcm: j("AAAA", "abcdefg", ":", "g".repeat(140)),
  postgres: j("postgres", "://", "app_user", ":", "S3cr3tPassw0rd9", "@", "db.internal-prod.acme.io", ":5432/app"),
  mongo: j("mongodb+srv", "://", "admin", ":", "Zx9Qw8Er7Ty", "@", "cluster0.abc12.mongodb.net/shop"),
  serviceAccount: j('{"type": "service_account", "project_id": "demo", "private_key_id": "', "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4", '"}'),
};

function scan(text: string): Finding[] {
  return analyzeSecrets(SITE, [{ label: "/app.js", text }]);
}
const ids = (findings: Finding[]) => findings.map((item) => item.id);

describe("additional secret patterns", () => {
  it.each([
    ["telegram-bot-token", DUMMY.telegram],
    ["npm-token", DUMMY.npm],
    ["mailgun-key", DUMMY.mailgun],
    ["digitalocean-token", DUMMY.digitalocean],
    ["discord-bot-token", DUMMY.discord],
    ["aws-secret-key", DUMMY.awsSecret],
    ["firebase-server-key", DUMMY.fcm],
    ["database-url", DUMMY.postgres],
    ["database-url", DUMMY.mongo],
    ["google-service-account", DUMMY.serviceAccount],
  ])("detects %s as critical and never prints the raw value", (id, secret) => {
    const findings = scan(id === "google-service-account" ? secret : `window.__CONFIG__ = { value: "${secret}" };`);
    const hit = findings.find((item) => item.id === `secrets.${id}`);
    expect(hit?.severity).toBe("critical");
    expect(hit?.fixPrompt).toContain("Rotation first");
    expect(JSON.stringify(findings)).not.toContain(secret.slice(8, secret.length - 4));
  });

  it("rates a Twilio API key SID as a warning", () => {
    expect(scan(`const sid = "${DUMMY.twilio}";`).find((item) => item.id === "secrets.twilio-api-key")?.severity).toBe("warning");
  });

  it("keeps the 'no secrets' pass when only harmless text is present", () => {
    expect(ids(scan("const a = 1; // hello world 12345:ABC"))).toEqual(["secrets.none"]);
  });

  it("does not mistake an ordinary timestamp, version or short id for a token", () => {
    expect(ids(scan('const t="1700000000:AAhello"; const v="key-1.2.3"; const sk="SK12345";'))).toEqual(["secrets.none"]);
  });
});

describe("database URL false positives", () => {
  it.each([
    "postgres://user:password@localhost:5432/db",
    "postgresql://postgres:postgres@127.0.0.1/app",
    "mysql://root:root@db/app",
    "mongodb://user:<password>@cluster.example.com/test",
    "redis://default:${REDIS_PASSWORD}@cache.internal/0",
    "postgres://user:changeme@example.com/db",
    "postgres://user:xxxxxxxx@host/db",
  ])("ignores documentation-style string %s", (value) => {
    expect(isRealDatabaseUrl(value)).toBe(false);
    expect(ids(scan(`const url = "${value}";`))).toEqual(["secrets.none"]);
  });

  it("accepts a real-looking remote connection string", () => {
    expect(isRealDatabaseUrl(DUMMY.postgres)).toBe(true);
    expect(isRealDatabaseUrl("mongodb://user")).toBe(false);
  });
});
