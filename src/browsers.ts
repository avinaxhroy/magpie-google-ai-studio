import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, win32 } from "node:path";

/** A Chromium-family browser this plugin can drive through Bun.WebView. */
export interface BrowserCandidate {
  /** Product name used in messages, for example "Brave Browser". */
  name: string;
  /** Absolute path to the executable. */
  path: string;
}

interface AppBundle {
  name: string;
  bundle: string;
  executable: string;
}

interface WindowsBrowser {
  name: string;
  directory: string;
  executable: string;
}

interface UnixBrowser {
  name: string;
  executable: string;
}

// Bun.WebView drives a browser over Chrome's DevTools protocol, so only
// Chromium-family browsers work. Stable channels come first, then beta, dev
// and canary, because a machine that has both usually wants the stable one.
const MAC_BUNDLES: AppBundle[] = [
  { name: "Google Chrome", bundle: "Google Chrome.app", executable: "Google Chrome" },
  { name: "Chromium", bundle: "Chromium.app", executable: "Chromium" },
  { name: "Google Chrome Beta", bundle: "Google Chrome Beta.app", executable: "Google Chrome Beta" },
  { name: "Google Chrome Dev", bundle: "Google Chrome Dev.app", executable: "Google Chrome Dev" },
  { name: "Google Chrome Canary", bundle: "Google Chrome Canary.app", executable: "Google Chrome Canary" },
  { name: "Brave Browser", bundle: "Brave Browser.app", executable: "Brave Browser" },
  { name: "Brave Browser Beta", bundle: "Brave Browser Beta.app", executable: "Brave Browser Beta" },
  { name: "Brave Browser Nightly", bundle: "Brave Browser Nightly.app", executable: "Brave Browser Nightly" },
  { name: "Microsoft Edge", bundle: "Microsoft Edge.app", executable: "Microsoft Edge" },
  { name: "Microsoft Edge Beta", bundle: "Microsoft Edge Beta.app", executable: "Microsoft Edge Beta" },
  { name: "Microsoft Edge Dev", bundle: "Microsoft Edge Dev.app", executable: "Microsoft Edge Dev" },
  { name: "Microsoft Edge Canary", bundle: "Microsoft Edge Canary.app", executable: "Microsoft Edge Canary" },
  { name: "Vivaldi", bundle: "Vivaldi.app", executable: "Vivaldi" },
  { name: "Arc", bundle: "Arc.app", executable: "Arc" },
  { name: "Opera", bundle: "Opera.app", executable: "Opera" },
  { name: "Opera GX", bundle: "Opera GX.app", executable: "Opera GX" },
  { name: "Helium", bundle: "Helium.app", executable: "Helium" },
  { name: "Thorium", bundle: "Thorium.app", executable: "Thorium" },
  { name: "Yandex Browser", bundle: "Yandex.app", executable: "Yandex" },
];

const WINDOWS_BROWSERS: WindowsBrowser[] = [
  { name: "Google Chrome", directory: "Google\\Chrome\\Application", executable: "chrome.exe" },
  { name: "Chromium", directory: "Chromium\\Application", executable: "chrome.exe" },
  { name: "Google Chrome Beta", directory: "Google\\Chrome Beta\\Application", executable: "chrome.exe" },
  { name: "Google Chrome Dev", directory: "Google\\Chrome Dev\\Application", executable: "chrome.exe" },
  { name: "Google Chrome Canary", directory: "Google\\Chrome SxS\\Application", executable: "chrome.exe" },
  { name: "Brave", directory: "BraveSoftware\\Brave-Browser\\Application", executable: "brave.exe" },
  { name: "Microsoft Edge", directory: "Microsoft\\Edge\\Application", executable: "msedge.exe" },
  { name: "Microsoft Edge Beta", directory: "Microsoft\\Edge Beta\\Application", executable: "msedge.exe" },
  { name: "Microsoft Edge Dev", directory: "Microsoft\\Edge Dev\\Application", executable: "msedge.exe" },
  { name: "Microsoft Edge Canary", directory: "Microsoft\\Edge SxS\\Application", executable: "msedge.exe" },
  { name: "Vivaldi", directory: "Vivaldi\\Application", executable: "vivaldi.exe" },
  { name: "Opera", directory: "Programs\\Opera", executable: "opera.exe" },
  { name: "Opera GX", directory: "Programs\\Opera GX", executable: "opera.exe" },
  { name: "Yandex Browser", directory: "Yandex\\YandexBrowser\\Application", executable: "browser.exe" },
];

const UNIX_BROWSERS: UnixBrowser[] = [
  { name: "Google Chrome", executable: "google-chrome-stable" },
  { name: "Chromium", executable: "chromium" },
  { name: "Google Chrome", executable: "google-chrome" },
  { name: "Google Chrome Beta", executable: "google-chrome-beta" },
  { name: "Google Chrome Dev", executable: "google-chrome-unstable" },
  { name: "Chromium", executable: "chromium-browser" },
  { name: "Brave", executable: "brave-browser" },
  { name: "Brave", executable: "brave" },
  { name: "Microsoft Edge", executable: "microsoft-edge" },
  { name: "Microsoft Edge", executable: "microsoft-edge-stable" },
  { name: "Microsoft Edge Beta", executable: "microsoft-edge-beta" },
  { name: "Microsoft Edge Dev", executable: "microsoft-edge-dev" },
  { name: "Vivaldi", executable: "vivaldi" },
  { name: "Vivaldi", executable: "vivaldi-stable" },
  { name: "Opera", executable: "opera" },
  { name: "Yandex Browser", executable: "yandex-browser" },
  { name: "Helium", executable: "helium-browser" },
  { name: "Thorium", executable: "thorium-browser" },
];

// Bundles outside the list above are still picked up when their name says
// they are Chromium-family, so a new browser works without a code change.
const MAC_FAMILY = /chrome|chromium|brave|edge|vivaldi|arc|opera|helium|thorium|yandex|slimjet|sidekick|dia/i;

export interface CandidateRoots {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  home?: string;
  /** Overrides the macOS application directories, for tests. */
  applications?: string[];
}

/** Whether `path` is a file this user can execute. */
export function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function unique(candidates: BrowserCandidate[]): BrowserCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    return true;
  });
}

function macBundleCandidates(root: string): BrowserCandidate[] {
  let names: string[];
  try {
    names = readdirSync(root).filter((name) => name.endsWith(".app") && MAC_FAMILY.test(name));
  } catch {
    return [];
  }
  const found: BrowserCandidate[] = [];
  for (const bundle of names) {
    const directory = join(root, bundle, "Contents", "MacOS");
    try {
      const executable = readdirSync(directory).find((entry) => isExecutable(join(directory, entry)));
      if (executable) {
        const path = join(directory, executable);
        found.push({ name: basename(bundle, ".app"), path });
      }
    } catch {
      /* A bundle without a MacOS directory is not a browser. */
    }
  }
  return found;
}

function macCandidates(roots: string[]): BrowserCandidate[] {
  const known = roots.flatMap((root) =>
    MAC_BUNDLES.map((browser) => ({
      name: browser.name,
      path: join(root, browser.bundle, "Contents", "MacOS", browser.executable),
    })),
  );
  return [...known, ...roots.flatMap(macBundleCandidates)];
}

function windowsCandidates(env: Record<string, string | undefined>): BrowserCandidate[] {
  const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
    (root): root is string => Boolean(root),
  );
  return roots.flatMap((root) =>
    WINDOWS_BROWSERS.map((browser) => ({
      name: browser.name,
      path: win32.join(root, browser.directory, browser.executable),
    })),
  );
}

function unixCandidates(): BrowserCandidate[] {
  const found: BrowserCandidate[] = [];
  for (const browser of UNIX_BROWSERS) {
    const path = Bun.which(browser.executable);
    if (path) found.push({ name: browser.name, path });
  }
  return found;
}

/**
 * Every Chromium-family browser this machine could run, most preferred first.
 * Paths are not checked here; `pickBrowser` does that.
 */
export function browserCandidates(roots: CandidateRoots = {}): BrowserCandidate[] {
  const platform = roots.platform ?? process.platform;
  const env = roots.env ?? process.env;
  const home = roots.home ?? homedir();
  const applications = roots.applications ?? [join("/", "Applications"), join(home, "Applications")];
  if (platform === "darwin") return unique(macCandidates(applications));
  if (platform === "win32") return unique(windowsCandidates(env));
  return unique(unixCandidates());
}

/** The first candidate whose executable exists, or undefined. */
export function pickBrowser(
  candidates: BrowserCandidate[],
  works: (path: string) => boolean = isExecutable,
): BrowserCandidate | undefined {
  return candidates.find((candidate) => works(candidate.path));
}

/**
 * The browser a user must install or point at. Kept under the 500-character
 * limit on the error Magpie shows in its sign-in card.
 */
export function missingBrowserError(candidates: BrowserCandidate[]): Error {
  const shown = candidates
    .slice(0, 3)
    .map((candidate) => candidate.path)
    .join(", ");
  const searched = candidates.length > 3 ? `${shown}, and ${candidates.length - 3} more` : shown;
  const message = `No Chromium-family browser found. Install Chrome, Chromium, Brave, Edge, Vivaldi, Arc or Opera, or set BUN_CHROME_PATH (or the chromePath plugin option) to a browser executable. Searched: ${searched}`;
  return new Error(message.length <= 480 ? message : `${message.slice(0, 476)}...`);
}

/** The message for an explicitly configured browser that is not usable. */
export function configuredBrowserError(path: string): Error {
  return new Error(
    `The configured browser is missing or not executable: ${path}. Check the chromePath plugin option or BUN_CHROME_PATH.`,
  );
}
