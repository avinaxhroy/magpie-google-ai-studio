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
  searchRoots,
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

/**
 * Whether a real Chromium engine is present, which is what the family scan
 * requires. Tests that expect the scan to accept a bundle must stage one.
 */
function fakeChromiumEngine(app: string): void {
  const resources = join(
    app,
    "Contents",
    "Frameworks",
    "Test Framework.framework",
    "Versions",
    "Current",
    "Resources",
  );
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(resources, "icudtl.dat"), "");
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
    fakeChromiumEngine(join(root, "Applications", "Some New Chromium Browser.app"));
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

test("macOS only matches Chromium family names as whole words", () => {
  const root = scratch();
  try {
    // Each of these contains a browser name as a substring and matched the
    // old unanchored /dia|arc|edge|opera/ regex.
    const decoys = [
      "FedoraMediaWriter",
      "Archive Utility",
      "Media Player",
      "Knowledge Base",
      "Operation Manager",
      "India Post",
      "Monarch",
      "Radiant",
    ];
    for (const name of decoys) fakeBundle(root, name, name);
    const found = browserCandidates(macRoots(root));
    expect(found.filter((candidate) => decoys.includes(candidate.name))).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS still accepts a real Chromium fork it has never heard of", () => {
  const root = scratch();
  try {
    const path = fakeBundle(root, "Aurora Chromium", "Aurora Chromium");
    fakeChromiumEngine(join(root, "Applications", "Aurora Chromium.app"));
    expect(browserCandidates(macRoots(root)).some((candidate) => candidate.path === path)).toBe(true);
    const lowercase = fakeBundle(root, "Brave Nightly", "Brave Nightly");
    fakeChromiumEngine(join(root, "Applications", "Brave Nightly.app"));
    expect(browserCandidates(macRoots(root)).some((candidate) => candidate.path === lowercase)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS ignores a browser-shaped app that ships no Chromium engine", () => {
  const root = scratch();
  try {
    // Chrome Remote Desktop really installs into /Applications and really has
    // the word Chrome as a whole token; only the engine check rejects it.
    const path = fakeBundle(root, "Chrome Remote Desktop", "Chrome Remote Desktop");
    const found = browserCandidates(macRoots(root));
    expect(found.some((candidate) => candidate.path === path)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS skips a bundle whose binary is not named after it", () => {
  const root = scratch();
  try {
    // Chrome Crashpad handlers are X_OK and sort before the main binary.
    const bundle = join(root, "Applications", "Thorium.app", "Contents", "MacOS");
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, "chrome_crashpad_handler"), "");
    chmodSync(join(bundle, "chrome_crashpad_handler"), 0o755);
    fakeChromiumEngine(join(root, "Applications", "Thorium.app"));
    const found = browserCandidates(macRoots(root));
    // The helper must never reach Bun.spawn; a skipped bundle is fine, a
    // candidate pointing at Chrome's crash handler is not.
    expect(found.some((candidate) => candidate.path === join(bundle, "chrome_crashpad_handler"))).toBe(false);
    expect(pickBrowser(found)?.path).not.toBe(join(bundle, "chrome_crashpad_handler"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS matches the bundle's binary regardless of case", () => {
  const root = scratch();
  try {
    const app = join(root, "Applications", "Sidekick.app");
    const bundle = join(app, "Contents", "MacOS");
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, "sidekick"), "");
    chmodSync(join(bundle, "sidekick"), 0o755);
    fakeChromiumEngine(app);
    const found = browserCandidates(macRoots(root));
    expect(found.find((candidate) => candidate.name === "Sidekick")?.path).toBe(join(bundle, "sidekick"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS launches the bundle's own executable, not a helper", () => {
  const root = scratch();
  try {
    const bundle = join(root, "Applications", "Aurora Chromium.app", "Contents", "MacOS");
    mkdirSync(bundle, { recursive: true });
    // Helpers sort first here, as `code-sidecar` does inside Cline.app.
    for (const entry of ["aurora_helper", "Aurora Chromium"]) {
      writeFileSync(join(bundle, entry), "");
      chmodSync(join(bundle, entry), 0o755);
    }
    fakeChromiumEngine(join(root, "Applications", "Aurora Chromium.app"));
    const found = browserCandidates(macRoots(root));
    const aurora = found.find((candidate) => candidate.name === "Aurora Chromium");
    expect(aurora?.path).toBe(join(bundle, "Aurora Chromium"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS prefers a stable browser over another vendor's pre-release", () => {
  const root = scratch();
  try {
    fakeBundle(root, "Google Chrome Canary", "Google Chrome Canary");
    const brave = fakeBundle(root, "Brave Browser", "Brave Browser");
    expect(pickBrowser(browserCandidates(macRoots(root)))?.path).toBe(brave);
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
  expect(message).toContain("40 candidate paths exist but none can run");
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

test("the missing-browser error names the directories that were scanned", () => {
  const root = scratch();
  try {
    const roots = searchRoots(macRoots(root));
    expect(roots).toEqual([join(root, "Applications")]);
    const message = missingBrowserError([], roots).message;
    expect(message).toContain("No Chromium-family browser found");
    expect(message).toContain(`Checked ${join(root, "Applications")}`);
    expect(message).not.toContain("Searched:");
    expect(message.length).toBeLessThanOrEqual(480);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the missing-browser error truncates on a character boundary", () => {
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    name: `Browser ${index}`,
    // An emoji home directory, staged so the high surrogate lands near the cut.
    path: `/Users/\u{1F600}\u{1F600}\u{1F600}aaaa/Browser ${index}.app/Contents/MacOS/Browser`,
  }));
  const message = missingBrowserError(candidates).message;
  expect(message.length).toBeLessThanOrEqual(480);
  // A pair split across the cut decodes back as U+FFFD and is not equal.
  expect(Buffer.from(message, "utf8").toString("utf8")).toBe(message);
});

test("chromePath either returns a runnable browser or explains how to set one", () => {
  // The regression this guards: a hardcoded Chrome path that does not exist.
  // A developer with BUN_CHROME_PATH exported must not be able to fail this.
  const saved = process.env.BUN_CHROME_PATH;
  delete process.env.BUN_CHROME_PATH;
  try {
    let path: string;
    try {
      path = chromePath();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("No Chromium-family browser found");
      return;
    }
    expect(isExecutable(path)).toBe(true);
  } finally {
    if (saved === undefined) delete process.env.BUN_CHROME_PATH;
    else process.env.BUN_CHROME_PATH = saved;
  }
});

test("chromePath rejects a configured browser that does not exist", () => {
  expect(() => chromePath("/definitely/not/a/browser")).toThrow("The configured browser is missing");
});
