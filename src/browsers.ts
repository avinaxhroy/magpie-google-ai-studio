import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
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
// Chromium-family browsers work. This is the order browsers are tried in;
// `browserCandidates` then moves every pre-release build behind the stable
// ones, so the table order only settles ties within a channel.
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

// Flatpak and Snap put their launchers outside PATH, so `Bun.which` alone
// makes a machine that installed Chromium that way look browserless.
const FLATPAK_BROWSERS: UnixBrowser[] = [
  { name: "Google Chrome", executable: "com.google.Chrome" },
  { name: "Chromium", executable: "org.chromium.Chromium" },
  { name: "Brave", executable: "com.brave.Browser" },
  { name: "Microsoft Edge", executable: "com.microsoft.Edge" },
  { name: "Vivaldi", executable: "com.vivaldi.Vivaldi" },
  { name: "Opera", executable: "com.opera.Opera" },
];

const FLATPAK_EXPORTS = ["/var/lib/flatpak/exports/bin", ".local/share/flatpak/exports/bin"];

const SNAP_BROWSERS: UnixBrowser[] = [
  { name: "Chromium", executable: "/snap/bin/chromium" },
  { name: "Brave", executable: "/snap/bin/brave" },
];

// Bundles outside the list above are still picked up when their name says
// they are Chromium-family, so a new browser works without a code change.
// The match is on whole name tokens: unanchored, "Media" would match "dia"
// and every media player on the machine would look like a browser.
const MAC_FAMILY =
  /(^|[\s-])(chrome|chromium|brave|edge|vivaldi|arc|opera|helium|thorium|yandex|slimjet|sidekick|dia)([\s-]|$)/i;

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

// Beta, Dev, Canary and Nightly builds exist to test the next release, so a
// machine that has both kinds should sign in with the stable one.
const PRERELEASE = /\b(beta|dev|canary|nightly|sxs|unstable)\b/i;

function stableFirst(a: BrowserCandidate, b: BrowserCandidate): number {
  return Number(PRERELEASE.test(a.name)) - Number(PRERELEASE.test(b.name));
}

function macBundleCandidates(root: string): BrowserCandidate[] {
  let names: string[];
  try {
    // Match the product name, not the file name: "Chromium.app" ends in a dot,
    // which no word boundary accepts.
    names = readdirSync(root).filter(
      (name) => name.endsWith(".app") && MAC_FAMILY.test(basename(name, ".app")),
    );
  } catch {
    return [];
  }
  const found: BrowserCandidate[] = [];
  for (const bundle of names) {
    const app = join(root, bundle);
    const name = basename(bundle, ".app");
    // A name is not enough: Chrome Remote Desktop and other Google apps carry
    // a browser name but ship no Chromium engine, so they can never answer a
    // DevTools protocol call.
    if (!isChromiumBundle(app)) continue;
    const directory = join(app, "Contents", "MacOS");
    const executable = macExecutable(directory, name);
    if (executable) found.push({ name, path: join(directory, executable) });
  }
  return found;
}

/**
 * Whether a bundle carries Chromium's engine. Every Chromium build puts its
 * `icudtl.dat` inside a `<Product> Framework.framework`, which a look-alike
 * application does not have.
 */
function isChromiumBundle(app: string): boolean {
  let frameworks: string[];
  try {
    frameworks = readdirSync(join(app, "Contents", "Frameworks"));
  } catch {
    return false;
  }
  return frameworks.some((framework) => {
    if (!framework.endsWith(".framework")) return false;
    const directory = join(app, "Contents", "Frameworks", framework);
    return (
      existsSync(join(directory, "Versions", "Current", "Resources", "icudtl.dat")) ||
      existsSync(join(directory, "Resources", "icudtl.dat"))
    );
  });
}

/**
 * The executable a bundle would launch. macOS names it after the bundle, so
 * only a case-insensitive match is accepted: `Contents/MacOS` also holds
 * helpers such as `chrome_crashpad_handler` or `steam.sh`, and readdir order
 * is not meaningful. Returning undefined skips the bundle rather than handing
 * a helper to Bun.spawn.
 */
function macExecutable(directory: string, name: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(directory).filter((entry) => isExecutable(join(directory, entry)));
  } catch {
    return undefined;
  }
  return entries.find((entry) => entry.toLowerCase() === name.toLowerCase());
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

function unixCandidates(home: string): BrowserCandidate[] {
  const found: BrowserCandidate[] = [];
  for (const browser of UNIX_BROWSERS) {
    const path = Bun.which(browser.executable);
    if (path) found.push({ name: browser.name, path });
  }
  for (const exports of FLATPAK_EXPORTS) {
    for (const browser of FLATPAK_BROWSERS) {
      const path = join(exports.startsWith("/") ? exports : join(home, exports), browser.executable);
      if (isExecutable(path)) found.push({ name: browser.name, path });
    }
  }
  for (const browser of SNAP_BROWSERS) {
    if (isExecutable(browser.executable)) found.push({ name: browser.name, path: browser.executable });
  }
  return found;
}

function rootsFor(roots: CandidateRoots) {
  return {
    platform: roots.platform ?? process.platform,
    env: roots.env ?? process.env,
    home: roots.home ?? homedir(),
    applications: roots.applications ?? [join("/", "Applications"), join(homedir(), "Applications")],
  };
}

/**
 * The places `browserCandidates` looks in, so a failure can name the
 * directories that were scanned instead of paths that never existed.
 */
export function searchRoots(roots: CandidateRoots = {}): string[] {
  const { platform, env, home, applications } = rootsFor(roots);
  if (platform === "darwin") return applications;
  if (platform === "win32")
    return [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter((root): root is string =>
      Boolean(root),
    );
  return [
    "PATH",
    "/snap/bin",
    ...FLATPAK_EXPORTS.map((exports) => (exports.startsWith("/") ? exports : join(home, exports))),
  ];
}

/**
 * Every Chromium-family browser this machine could run, most preferred first.
 * Paths are not checked here; `pickBrowser` does that.
 */
export function browserCandidates(roots: CandidateRoots = {}): BrowserCandidate[] {
  const { platform, env, home, applications } = rootsFor(roots);
  if (platform === "darwin") return unique(macCandidates(applications)).sort(stableFirst);
  if (platform === "win32") return unique(windowsCandidates(env)).sort(stableFirst);
  return unique(unixCandidates(home)).sort(stableFirst);
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
export function missingBrowserError(candidates: BrowserCandidate[], searched: string[] = []): Error {
  const hint =
    "No Chromium-family browser found. Install Chrome, Chromium, Brave, Edge, Vivaldi, Arc or Opera, or set BUN_CHROME_PATH (or the chromePath plugin option) to a browser executable.";
  const places = searched.length ? ` Checked ${searched.join(", ")}.` : "";
  let detail = " Nothing was found in the usual install locations.";
  // A candidate list here means every entry was checked and none could start,
  // which the user can only act on if one of the paths is named.
  if (candidates.length)
    detail = ` ${candidates.length} candidate paths exist but none can run; first was ${candidates[0].path}.`;
  return new Error(clamp(`${hint}${places}${detail}`));
}

/**
 * Trims a message to what Magpie's sign-in card shows without splitting a
 * surrogate pair: half of an emoji is not valid text.
 */
function clamp(message: string): string {
  // Magpie cuts sign-in errors at 500 UTF-16 units.
  if (message.length <= 480) return message;
  return `${Array.from(message).slice(0, 476).join("")}...`;
}

/** The message for an explicitly configured browser that is not usable. */
export function configuredBrowserError(path: string): Error {
  return new Error(
    `The configured browser is missing or not executable: ${path}. Check the chromePath plugin option or BUN_CHROME_PATH.`,
  );
}
