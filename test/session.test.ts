import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  createSession,
  exportSession,
  exportSessionText,
  importSession,
  importSessionText,
  listSessions,
  type StorageState,
  saveSession,
  sweepIncompleteProfiles,
} from "../src/session.ts";

const state: StorageState = {
  cookies: [
    {
      name: "SAPISID",
      value: "fixture-signing",
      domain: ".google.com",
      path: "/",
      secure: true,
      sameSite: "None",
      expires: 1900000000,
      sourceScheme: "Secure",
      sourcePort: 443,
    },
    {
      name: "SID",
      value: "fixture-httponly",
      domain: ".google.com",
      path: "/",
      httpOnly: true,
      priority: "High",
    },
    {
      name: "partitioned",
      value: "fixture-partition",
      domain: "aistudio.google.com",
      path: "/",
      secure: true,
      partitionKey: { topLevelSite: "https://google.com", hasCrossSiteAncestor: true },
    },
    { name: "unrelated", value: "do-not-export", domain: "not-google.com", path: "/" },
  ],
  origins: [
    {
      origin: "https://aistudio.google.com",
      localStorage: [{ name: "account-index", value: "2" }],
      sessionStorage: [{ name: "context", value: "fixture" }],
    },
    { origin: "https://unrelated.example", localStorage: [{ name: "unrelated", value: "do-not-export" }] },
  ],
};

test("portable export imports into a new data directory after the source profile is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "magpie-portable-"));
  const previous = process.env.MAGPIE_AISTUDIO_DATA_DIR;
  try {
    process.env.MAGPIE_AISTUDIO_DATA_DIR = join(root, "source");
    const source = await createSession("source-account");
    const descriptor = await saveSession(source);
    expect(await importSession(descriptor)).toEqual(source);
    expect(await listSessions()).toEqual([source]);
    const output = await exportSession(source, state, join(root, "exports/account.aistudio.json"));
    const portable = await Bun.file(output).json();
    expect(portable.profile).toBeUndefined();
    expect(await Bun.file(output).text()).not.toContain(source.profile);
    expect(portable.cookies).toEqual(state.cookies.slice(0, 3));
    expect(portable.origins).toEqual(state.origins.slice(0, 1));
    if (process.platform !== "win32") expect((await stat(output)).mode & 0o777).toBe(0o600);
    await rm(join(root, "source"), { recursive: true });

    process.env.MAGPIE_AISTUDIO_DATA_DIR = join(root, "destination");
    const destination = await importSession(output);
    expect(destination.accountId).toBe("source-account");
    expect(destination.profile).toStartWith(join(root, "destination"));
    expect(destination.profile).not.toBe(source.profile);
    expect(await Bun.file(join(destination.profile, "storage-state.json")).json()).toEqual({
      cookies: state.cookies.slice(0, 3),
      origins: state.origins.slice(0, 1),
    });
    expect(await importSession(join(destination.profile, "account.session.json"))).toEqual(destination);
    expect((await importSession(output, "renamed-account")).accountId).toBe("renamed-account");
    await expect(exportSession(destination, state, output)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await Bun.file(output).json()).toEqual(portable);
  } finally {
    if (previous === undefined) delete process.env.MAGPIE_AISTUDIO_DATA_DIR;
    else process.env.MAGPIE_AISTUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("portable import rejects malformed credentials and unknown versions without creating profiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "magpie-portable-invalid-"));
  const previous = process.env.MAGPIE_AISTUDIO_DATA_DIR;
  process.env.MAGPIE_AISTUDIO_DATA_DIR = root;
  try {
    const path = join(root, "input.json");
    for (const value of [
      { format: "magpie-google-ai-studio/session", version: 2, ...state },
      { format: "something-else", version: 1, ...state },
      { cookies: [{ name: "SAPISID", value: "x", domain: "google.com.evil.example", path: "/" }] },
      { cookies: [{ ...state.cookies[0], value: null }] },
      {
        cookies: state.cookies,
        origins: [{ origin: "https://aistudio.google.com", localStorage: [{ name: "x", value: 42 }] }],
      },
    ]) {
      await Bun.write(path, JSON.stringify(value));
      await expect(importSession(path)).rejects.toThrow();
      expect(await readdir(root)).toEqual(["input.json"]);
    }
    await Bun.write(path, '{"cookies":[{"value":"must-not-appear-in-errors"');
    await expect(importSession(path)).rejects.toThrow("Invalid session JSON file");
    await Bun.write(path, JSON.stringify(state));
    expect((await importSession(path)).accountId).toBe("Google AI Studio");
  } finally {
    if (previous === undefined) delete process.env.MAGPIE_AISTUDIO_DATA_DIR;
    else process.env.MAGPIE_AISTUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("migration text preserves portable state and Unicode accounts across data directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "magpie-transfer-text-"));
  const previous = process.env.MAGPIE_AISTUDIO_DATA_DIR;
  try {
    process.env.MAGPIE_AISTUDIO_DATA_DIR = join(root, "source");
    const source = await createSession("迁移账号@example.invalid");
    const unicodeState = structuredClone(state);
    unicodeState.origins[0].sessionStorage!.push({ name: "中文", value: "🙂\n非对称数据" });
    const text = exportSessionText(source, unicodeState);
    expect(text).toStartWith("aistudio-session:v1-");
    expect(text).not.toContain(source.profile);
    await rm(source.profile, { recursive: true });
    process.env.MAGPIE_AISTUDIO_DATA_DIR = join(root, "destination");
    const imported = await importSessionText(`\n${text}\n`);
    expect(imported.accountId).toBe(source.accountId);
    expect(imported.profile).toStartWith(join(root, "destination"));
    expect(await Bun.file(join(imported.profile, "storage-state.json")).json()).toEqual({
      cookies: unicodeState.cookies.slice(0, 3),
      origins: unicodeState.origins.slice(0, 1),
    });
    expect(await importSession(join(imported.profile, "account.session.json"))).toEqual(imported);

    const noise = (bytes: number) => ({
      cookies: [
        {
          ...state.cookies[0],
          value: Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64"),
        },
      ],
      origins: [],
    });
    const large = exportSessionText(imported, noise(29_000));
    expect(large.length).toBeLessThanOrEqual(60 * 1024);
    expect((await importSessionText(large)).accountId).toBe(source.accountId);
    expect(() => exportSessionText(imported, noise(32_000))).toThrow(
      "longer than the Magpie Web form allows",
    );
    expect(() =>
      exportSessionText(imported, {
        cookies: [{ ...state.cookies[0], value: "x".repeat(1024 * 1024) }],
        origins: [],
      }),
    ).toThrow("too large for transfer text");
  } finally {
    if (previous === undefined) delete process.env.MAGPIE_AISTUDIO_DATA_DIR;
    else process.env.MAGPIE_AISTUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("migration text rejects corruption, unsupported formats, and oversized expansion without creating profiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "magpie-transfer-invalid-"));
  const previous = process.env.MAGPIE_AISTUDIO_DATA_DIR;
  process.env.MAGPIE_AISTUDIO_DATA_DIR = root;
  try {
    const prefix = "aistudio-session:v1-";
    const encode = (value: unknown) => prefix + gzipSync(JSON.stringify(value)).toString("hex");
    const text = exportSessionText({ version: 1, profile: "/unused", accountId: "fixture" }, state);
    for (const invalid of [
      text.slice(0, -2),
      text.slice(0, -8) + (text.slice(-8, -6) === "00" ? "FF" : "00") + text.slice(-6),
      text.slice(0, -1),
      `${text}GG`,
      text.replace("v1-", "v2-"),
      prefix + "00".repeat(31_000),
      encode({ format: "magpie-google-ai-studio/session", version: 2, ...state }),
      encode({ version: 1, profile: "/must-not-use-source-profile", accountId: "fixture" }),
      encode({ format: "magpie-google-ai-studio/session", version: 1, accountId: "fixture", cookies: [] }),
      encode({ padding: "x".repeat(1024 * 1024 + 1) }),
      prefix + gzipSync('{"private-cookie":"must-not-appear-in-errors"').toString("hex"),
    ]) {
      let message = "";
      try {
        await importSessionText(invalid);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("must-not-appear-in-errors");
      expect(await readdir(root)).toEqual([]);
    }
  } finally {
    if (previous === undefined) delete process.env.MAGPIE_AISTUDIO_DATA_DIR;
    else process.env.MAGPIE_AISTUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a damaged account descriptor is skipped instead of hiding every other account", async () => {
  const root = await mkdtemp(join(tmpdir(), "magpie-damaged-session-"));
  const previous = process.env.MAGPIE_AISTUDIO_DATA_DIR;
  process.env.MAGPIE_AISTUDIO_DATA_DIR = root;
  try {
    const healthy = await createSession("healthy-account");
    await saveSession(healthy);
    for (const [profile, body] of [
      ["truncated", '{"version":1,"profile":'],
      ["wrong-version", JSON.stringify({ version: 2, profile: join(root, "x"), accountId: "x" })],
    ] as const) {
      await Bun.write(join(root, profile, "account.session.json"), body);
    }
    expect(await listSessions()).toEqual([healthy]);
  } finally {
    if (previous === undefined) delete process.env.MAGPIE_AISTUDIO_DATA_DIR;
    else process.env.MAGPIE_AISTUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("export refuses a relative path instead of hiding credentials in the working directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "magpie-export-path-"));
  const previous = process.env.MAGPIE_AISTUDIO_DATA_DIR;
  process.env.MAGPIE_AISTUDIO_DATA_DIR = root;
  try {
    const source = await createSession("export-account");
    for (const path of ["account.aistudio.json", "~/account.aistudio.json", "./nested/account.json"])
      await expect(exportSession(source, state, path)).rejects.toThrow("Use an absolute export path");
    // Only the profile created by createSession, and no stray export file.
    expect(await readdir(root)).toEqual([basename(source.profile)]);
  } finally {
    if (previous === undefined) delete process.env.MAGPIE_AISTUDIO_DATA_DIR;
    else process.env.MAGPIE_AISTUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("abandoned sign-in profiles are swept once they are older than the login window", async () => {
  const root = await mkdtemp(join(tmpdir(), "magpie-sweep-"));
  const previous = process.env.MAGPIE_AISTUDIO_DATA_DIR;
  process.env.MAGPIE_AISTUDIO_DATA_DIR = root;
  try {
    const account = await createSession("kept-account");
    await saveSession(account);
    const abandoned = await createSession("abandoned");
    await Bun.write(join(abandoned.profile, "Local State"), "browser state");
    const fresh = await createSession("still-signing-in");
    await Bun.write(join(fresh.profile, "Local State"), "browser state");
    const now = Date.now();
    // Backdate only the abandoned profile; the other is mid-sign-in right now.
    const stale = new Date(now - 20 * 60 * 1000);
    await utimes(abandoned.profile, stale, stale);
    const removed = await sweepIncompleteProfiles(now);
    expect(removed).toEqual([abandoned.profile]);
    expect(await listSessions()).toEqual([account]);
    expect((await readdir(root)).sort()).toEqual([basename(account.profile), basename(fresh.profile)].sort());
    // A profile that still has its descriptor survives any age.
    await utimes(account.profile, stale, stale);
    expect(await sweepIncompleteProfiles(now)).toEqual([]);
    expect(await listSessions()).toEqual([account]);
  } finally {
    if (previous === undefined) delete process.env.MAGPIE_AISTUDIO_DATA_DIR;
    else process.env.MAGPIE_AISTUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("import rejects an oversized session file before parsing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "magpie-import-size-"));
  const previous = process.env.MAGPIE_AISTUDIO_DATA_DIR;
  process.env.MAGPIE_AISTUDIO_DATA_DIR = root;
  try {
    const path = join(root, "oversized.json");
    await Bun.write(path, `"${"x".repeat(1024 * 1024)}"`);
    await expect(importSession(path)).rejects.toThrow("too large to import");
  } finally {
    if (previous === undefined) delete process.env.MAGPIE_AISTUDIO_DATA_DIR;
    else process.env.MAGPIE_AISTUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
