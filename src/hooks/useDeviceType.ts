"use client";

import { useSyncExternalStore } from "react";
import { classifyUserAgent, deviceForWidth, orientationFor, SERVER_DEVICE, sameDeviceInfo, type DeviceInfo } from "@/lib/device";

/**
 * Device category for JavaScript decisions (default open cards, autofocus, copy that depends on
 * touch). Layout itself is pure CSS, so nothing visual depends on this hook.
 *
 * Hydration-safe: React uses `SERVER_DEVICE` for the server render and for hydration, then switches
 * to the real values on the client without a mismatch. One shared store serves every caller, so a
 * resize recomputes once, and components re-render only when the category, orientation or input
 * type actually changes (not on every pixel).
 */

interface NavigatorWithHints extends Navigator {
  userAgentData?: { mobile?: boolean };
}

let current: DeviceInfo = SERVER_DEVICE;
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;

function read(): DeviceInfo {
  const nav = navigator as NavigatorWithHints;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  return {
    device: deviceForWidth(window.innerWidth),
    orientation: orientationFor(window.innerWidth, window.innerHeight),
    isTouch: coarse || noHover,
    uaHint: classifyUserAgent({ userAgent: nav.userAgent, uaDataMobile: nav.userAgentData?.mobile ?? null, maxTouchPoints: nav.maxTouchPoints }),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

function getSnapshot(): DeviceInfo {
  const next = read();
  if (!sameDeviceInfo(next, current)) current = next;
  return current;
}

function getServerSnapshot(): DeviceInfo {
  return SERVER_DEVICE;
}

function emit() {
  listeners.forEach((listener) => listener());
}

function attach() {
  const queries = ["(pointer: coarse)", "(hover: none)", "(prefers-reduced-motion: reduce)"].map((query) => window.matchMedia(query));
  let frame = 0;
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(emit);
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  queries.forEach((query) => query.addEventListener("change", emit));
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    queries.forEach((query) => query.removeEventListener("change", emit));
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) detach = attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
    }
  };
}

/**
 * The device as it is right now, read straight from the browser. Use it inside effects: during
 * hydration the hook still reports the server snapshot, which is wrong for decisions such as
 * "focus the input" that must not fire on a phone.
 */
export function readDeviceNow(): DeviceInfo {
  return typeof window === "undefined" ? SERVER_DEVICE : read();
}

export function useDeviceType(): DeviceInfo {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
