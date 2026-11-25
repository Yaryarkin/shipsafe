import { describe, expect, it } from "vitest";
import {
  classifyUserAgent,
  DESKTOP_MIN_WIDTH,
  deviceForWidth,
  orientationFor,
  SERVER_DEVICE,
  sameDeviceInfo,
  TABLET_MIN_WIDTH,
  type DeviceInfo,
} from "../device";

describe("deviceForWidth", () => {
  it("uses the documented breakpoints: mobile < 768, tablet 768-1024, desktop > 1024", () => {
    expect(TABLET_MIN_WIDTH).toBe(768);
    expect(DESKTOP_MIN_WIDTH).toBe(1025);
    expect(deviceForWidth(320)).toBe("mobile");
    expect(deviceForWidth(767)).toBe("mobile");
    expect(deviceForWidth(768)).toBe("tablet");
    expect(deviceForWidth(1024)).toBe("tablet");
    expect(deviceForWidth(1025)).toBe("desktop");
    expect(deviceForWidth(2560)).toBe("desktop");
  });

  it("falls back to mobile for nonsense widths instead of throwing", () => {
    expect(deviceForWidth(Number.NaN)).toBe("mobile");
    expect(deviceForWidth(-10)).toBe("mobile");
    expect(deviceForWidth(Number.POSITIVE_INFINITY)).toBe("mobile");
    expect(deviceForWidth(0)).toBe("mobile");
  });
});

describe("orientationFor", () => {
  it("is portrait only when taller than wide", () => {
    expect(orientationFor(768, 1024)).toBe("portrait");
    expect(orientationFor(1024, 768)).toBe("landscape");
    expect(orientationFor(800, 800)).toBe("landscape");
  });
});

describe("classifyUserAgent", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
  const androidPhone = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
  const androidTablet = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";

  it("recognises phones, tablets and desktops", () => {
    expect(classifyUserAgent({ userAgent: iphone })).toBe("mobile");
    expect(classifyUserAgent({ userAgent: androidPhone })).toBe("mobile");
    expect(classifyUserAgent({ userAgent: ipad })).toBe("tablet");
    expect(classifyUserAgent({ userAgent: androidTablet })).toBe("tablet");
    expect(classifyUserAgent({ userAgent: windows })).toBe("desktop");
    expect(classifyUserAgent({ userAgent: mac, maxTouchPoints: 0 })).toBe("desktop");
  });

  it("treats a touch-capable Mac as an iPad (iPadOS reports itself as macOS)", () => {
    expect(classifyUserAgent({ userAgent: mac, maxTouchPoints: 5 })).toBe("tablet");
  });

  it("uses userAgentData.mobile when the string is silent, and stays unknown with no data", () => {
    expect(classifyUserAgent({ userAgent: "", uaDataMobile: true })).toBe("mobile");
    expect(classifyUserAgent({ userAgent: "", uaDataMobile: false })).toBe("desktop");
    expect(classifyUserAgent({})).toBe("unknown");
    expect(classifyUserAgent({ userAgent: "", uaDataMobile: null })).toBe("unknown");
  });

  it("never throws on odd input", () => {
    expect(() => classifyUserAgent({ userAgent: "\u0000 weird \n agent", maxTouchPoints: -1 })).not.toThrow();
  });
});

describe("hydration-safe defaults", () => {
  it("the server snapshot is a stable, desktop, non-touch, motion-allowed device", () => {
    expect(SERVER_DEVICE).toEqual({ device: "desktop", orientation: "landscape", isTouch: false, uaHint: "unknown", reducedMotion: false });
  });

  it("compares snapshots field by field so unchanged reads keep the same identity", () => {
    const copy: DeviceInfo = { ...SERVER_DEVICE };
    expect(sameDeviceInfo(copy, SERVER_DEVICE)).toBe(true);
    expect(sameDeviceInfo({ ...copy, device: "tablet" }, SERVER_DEVICE)).toBe(false);
    expect(sameDeviceInfo({ ...copy, isTouch: true }, SERVER_DEVICE)).toBe(false);
    expect(sameDeviceInfo({ ...copy, orientation: "portrait" }, SERVER_DEVICE)).toBe(false);
    expect(sameDeviceInfo({ ...copy, uaHint: "mobile" }, SERVER_DEVICE)).toBe(false);
    expect(sameDeviceInfo({ ...copy, reducedMotion: true }, SERVER_DEVICE)).toBe(false);
  });
});
