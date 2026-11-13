import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserCandidates,
  configuredBrowserError,
  isExecutable,
  missingBrowserError,
  pickBrowser,
} from "../src/browsers.ts";
import { chromePath } from "../src/dependencies.ts";

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "magpie-browsers-"));
  return root;
}

function fakeBundle(root: string, bundle: string, executable: string): string {
  const directory = join(root, "Applications", `${bundle}.app`, "Contents", "MacOS");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, executable);
  writeFileSync(path, "");
  chmodSync(path, 0o755);
  return path;
}

/** Discovery confined to the scratch directory, so the host's own browsers never leak in. */
function macRoots(root: string) {
  return { platform: "darwin" as const, home: root, applications: [join(root, "Applications")] };
}

test("a macOS machine with only Brave still finds a browser", () => {
  const root = scratch();
  try {
    const brave = fakeBundle(root, "Brave Browser", "Brave Browser");
    const found = browserCandidates(macRoots(root));
    const picked = pickBrowser(found);
    expect(picked?.path).toBe(brave);
    expect(picked?.name).toBe("Brave Browser");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS prefers a stable channel over beta and canary", () => {
  const root = scratch();
  try {
    fakeBundle(root, "Google Chrome Canary", "Google Chrome Canary");
    fakeBundle(root, "Google Chrome Beta", "Google Chrome Beta");
    const stable = fakeBundle(root, "Google Chrome", "Google Chrome");
    expect(pickBrowser(browserCandidates(macRoots(root)))?.path).toBe(stable);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS skips a known bundle whose executable is missing", () => {
  const root = scratch();
  try {
    // Only the .app directory exists, as after a broken or partial install.
    mkdirSync(join(root, "Applications", "Google Chrome.app", "Contents", "MacOS"), { recursive: true });
    const edge = fakeBundle(root, "Microsoft Edge", "Microsoft Edge");
    expect(pickBrowser(browserCandidates(macRoots(root)))?.path).toBe(edge);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS picks up an unlisted Chromium-family bundle", () => {
  const root = scratch();
  try {
    const path = fakeBundle(root, "Some New Chromium Browser", "Some New Chromium Browser");
    const found = browserCandidates(macRoots(root));
    expect(found.some((candidate) => candidate.path === path)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS ignores application bundles that are not browsers", () => {
  const root = scratch();
  try {
    fakeBundle(root, "Tropico 6", "Tropico 6");
    const found = browserCandidates(macRoots(root));
    expect(found.some((candidate) => candidate.path.includes("Tropico"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows checks the user profile as well as Program Files", () => {
  const found = browserCandidates({
    platform: "win32",
    env: { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    home: "C:\\Users\\me",
  });
  const paths = found.map((candidate) => candidate.path);
  expect(paths).toContain("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  expect(paths).toContain(
    "C:\\Users\\me\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  );
  expect(paths.some((path) => path.endsWith("msedge.exe"))).toBe(true);
  expect(new Set(paths).size).toBe(paths.length);
});

test("the missing-browser error names what was searched and fits the sign-in card", () => {
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    name: `Browser ${index}`,
    path: `/very/long/application/directory/number/${index}/Browser.app/Contents/MacOS/Browser`,
  }));
  const message = missingBrowserError(candidates).message;
  expect(message).toContain("No Chromium-family browser found");
  expect(message).toContain("BUN_CHROME_PATH");
  expect(message).toContain(candidates[0].path);
  expect(message).toContain("and 37 more");
  // Magpie truncates sign-in errors at 500 characters.
  expect(message.length).toBeLessThanOrEqual(480);
});

test("the configured-browser error names the path instead of failing raw", () => {
  const message = configuredBrowserError("/opt/browsers/nope").message;
  expect(message).toContain("/opt/browsers/nope");
  expect(message).toContain("chromePath");
  expect(message).toContain("BUN_CHROME_PATH");
});

test("isExecutable rejects directories and missing paths", () => {
  const root = scratch();
  try {
    expect(isExecutable(root)).toBe(false);
    expect(isExecutable(join(root, "nope"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("chromePath either returns a runnable browser or explains how to set one", () => {
  // The regression this guards: a hardcoded Chrome path that does not exist.
  let path: string;
  try {
    path = chromePath();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("No Chromium-family browser found");
    return;
  }
  expect(isExecutable(path)).toBe(true);
});

test("chromePath rejects a configured browser that does not exist", () => {
  expect(() => chromePath("/definitely/not/a/browser")).toThrow("The configured browser is missing");
});
