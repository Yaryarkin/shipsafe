import { describe, expect, it } from "vitest";
import { buildLaunchUrl, parseLaunchParams } from "../launch-params";
import { carriedQueryFrom, hrefWithQuery, NAV_ITEMS, ORDER_PATH, REPORT_PATH, viewForPath } from "../nav";

describe("views", () => {
  it("defines the four views with unique routes", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual(["scan", "report", "history", "order"]);
    expect(new Set(NAV_ITEMS.map((item) => item.href)).size).toBe(4);
    expect(NAV_ITEMS.every((item) => item.href.startsWith("/") && item.label && item.short)).toBe(true);
    expect(REPORT_PATH).toBe("/report");
    expect(ORDER_PATH).toBe("/order");
  });

  it("maps paths to views, including trailing slashes and nested paths", () => {
    expect(viewForPath("/")).toBe("scan");
    expect(viewForPath("/report")).toBe("report");
    expect(viewForPath("/report/")).toBe("report");
    expect(viewForPath("/history")).toBe("history");
    expect(viewForPath("/order")).toBe("order");
    expect(viewForPath("/order/thanks")).toBe("order");
  });

  it("treats unknown paths as the scanner and does not match on a prefix of a longer word", () => {
    expect(viewForPath("/nope")).toBe("scan");
    expect(viewForPath("/reports")).toBe("scan");
    expect(viewForPath("")).toBe("scan");
  });
});

describe("carried query", () => {
  it("keeps share, tracking and Telegram parameters and drops the launch keys", () => {
    expect(carriedQueryFrom("?url=my-app.com&scan=1&utm_source=telegram&s=94&g=A")).toBe("?utm_source=telegram&s=94&g=A");
    expect(carriedQueryFrom("?start=pay_quick&mode=url")).toBe("?start=pay_quick");
    expect(carriedQueryFrom("?url=my-app.com&mode=url&scan=1")).toBe("");
    expect(carriedQueryFrom("")).toBe("");
  });

  it("appends the carried query to a view path", () => {
    expect(hrefWithQuery("/report", "?utm_source=telegram")).toBe("/report?utm_source=telegram");
    expect(hrefWithQuery("/", "")).toBe("/");
    expect(hrefWithQuery("/history", "?")).toBe("/history");
    expect(hrefWithQuery("/order", "tier=full")).toBe("/order?tier=full");
  });

  it("a launch link survives the full round trip: parsed once, carried params preserved", () => {
    const link = new URL(buildLaunchUrl("https://shipsafe.example", { url: "https://my-app.com", autoScan: true }));
    link.searchParams.set("utm_source", "telegram");
    const launch = parseLaunchParams((key) => link.searchParams.get(key));
    expect(launch).toEqual({ url: "https://my-app.com", mode: "url", autoScan: true });
    expect(hrefWithQuery("/report", carriedQueryFrom(link.search))).toBe("/report?utm_source=telegram");
  });
});
