import { rm } from "node:fs/promises";
import { StudioClient } from "./src/client.ts";
import { prepareBrowser } from "./src/dependencies.ts";
import { providerFetch, providerModels } from "./src/provider.ts";
import {
  createSession,
  importSession,
  importSessionText,
  listSessions,
  optionsFrom,
  readSession,
  type Session,
  saveSession,
} from "./src/session.ts";

const ID = "google-ai-studio";

function authSuccess(session: Session) {
  return {
    type: "success" as const,
    key: JSON.stringify(session),
    metadata: { email: session.accountId },
  };
}

export default {
  id: "magpie-google-ai-studio",
  async server(_input: unknown, rawOptions: Record<string, unknown> = {}) {
    const options = optionsFrom(rawOptions);
    // Downloads can exceed Magpie's host-init deadline. Start now and let
    // browser operations await the same preparation without blocking init.
    void prepareBrowser(options).catch((error) => {
      console.error(
        "[google-ai-studio]",
        error instanceof Error ? error.message : "Browser dependency setup failed",
      );
    });
    const clients = new Map<string, StudioClient>();
    const clientFor = (session: Session) => {
      let client = clients.get(session.profile);
      if (!client) {
        client = new StudioClient(session, options);
        clients.set(session.profile, client);
      }
      return client;
    };
    process.once("exit", () => {
      for (const client of clients.values()) client.close();
    });
    return {
      config(config: { provider?: Record<string, unknown> }) {
        config.provider ??= {};
        config.provider[ID] = {
          name: "Google AI Studio",
          npm: "@ai-sdk/google",
          api: "https://generativelanguage.googleapis.com/v1beta",
          models: {},
          ...(config.provider[ID] as Record<string, unknown> | undefined),
        };
      },
      auth: {
        provider: ID,
        maxConcurrency: 1,
        methods: [
          {
            type: "oauth" as const,
            label: "Sign in to Google AI Studio (opens your browser)",
            labels: {
              en: "Sign in to Google AI Studio (opens your browser)",
              zh: "登录 Google AI Studio（打开本机浏览器）",
              "zh-Hans": "登录 Google AI Studio（打开本机浏览器）",
              ja: "Google AI Studio にログイン（このコンピュータのブラウザを開く）",
            },
            prompts: [
              {
                type: "text",
                key: "account",
                message: "Account name (tells accounts apart)",
                messages: {
                  en: "Account name (tells accounts apart)",
                  zh: "账号名称（用于区分多个账号）",
                  "zh-Hans": "账号名称（用于区分多个账号）",
                  ja: "アカウント名（複数のアカウントを区別するため）",
                },
                placeholder: "you@gmail.com",
              },
              {
                type: "text",
                key: "exportPath",
                message: "Path to also export a portable session file (leave empty to skip)",
                messages: {
                  en: "Path to also export a portable session file (leave empty to skip)",
                  zh: "可迁移会话包导出路径（留空跳过）",
                  "zh-Hans": "可迁移会话包导出路径（留空跳过）",
                  ja: "持ち運べるセッションファイルの書き出し先（空欄なら省略）",
                },
                placeholder: "/path/to/account.aistudio.json",
              },
            ],
            async authorize(inputs: Record<string, string> = {}) {
              const session = await createSession(inputs.account || "Google AI Studio");
              const client = new StudioClient(session, options);
              const result = (async () => {
                try {
                  await client.login();
                  await saveSession(session);
                  if (inputs.exportPath?.trim()) await client.export(inputs.exportPath.trim());
                  return authSuccess(session);
                } catch (error) {
                  return {
                    type: "failed" as const,
                    error: error instanceof Error ? error.message : "Sign-in failed",
                  };
                } finally {
                  await client.close();
                }
              })();
              return {
                url: "https://aistudio.google.com/",
                opened: true,
                instructions:
                  "Sign in to Google AI Studio in the browser window that just opened, finish the first-run setup, then close that window. The sign-in is checked and saved automatically; it waits up to 10 minutes.",
                method: "auto" as const,
                callback: () => result,
              };
            },
          },
          {
            type: "oauth" as const,
            label: "Import a Google AI Studio session, or export this machine's session",
            labels: {
              en: "Import a Google AI Studio session, or export this machine's session",
              zh: "导入 Google AI Studio 会话／导出本机会话",
              "zh-Hans": "导入 Google AI Studio 会话／导出本机会话",
              ja: "Google AI Studio セッションを読み込む／このコンピュータのセッションを書き出す",
            },
            prompts: [
              {
                type: "text",
                key: "path",
                message:
                  "Absolute path to a portable session file, a local account.session.json, or a storage-state JSON",
                messages: {
                  en: "Absolute path to a portable session file, a local account.session.json, or a storage-state JSON",
                  zh: "跨机器会话包、本机 account.session.json 或 storage-state JSON 的绝对路径",
                  "zh-Hans": "跨机器会话包、本机 account.session.json 或 storage-state JSON 的绝对路径",
                  ja: "持ち運び用セッションファイル、このコンピュータの account.session.json、または storage-state JSON への絶対パス",
                },
              },
              {
                type: "text",
                key: "account",
                message: "Account name (leave empty to keep the name in the session file)",
                messages: {
                  en: "Account name (leave empty to keep the name in the session file)",
                  zh: "账号名称（留空保留会话包中的名称）",
                  "zh-Hans": "账号名称（留空保留会话包中的名称）",
                  ja: "アカウント名（空欄ならセッションファイルの名前を使う）",
                },
                placeholder: "you@gmail.com",
              },
              {
                type: "text",
                key: "exportPath",
                message: "Also export a portable session file to this path (leave empty to skip)",
                messages: {
                  en: "Also export a portable session file to this path (leave empty to skip)",
                  zh: "同时导出可迁移会话包到此路径（留空跳过）",
                  "zh-Hans": "同时导出可迁移会话包到此路径（留空跳过）",
                  ja: "持ち運べるセッションファイルをこのパスにも書き出す（空欄なら省略）",
                },
                placeholder: "/path/to/account.aistudio.json",
              },
            ],
            async authorize(inputs: Record<string, string> = {}) {
              const result = (async () => {
                try {
                  const session = await importSession(inputs.path, inputs.account);
                  // Reuse an active account when exporting its local session.
                  const client = clientFor(session);
                  await client.models();
                  if (inputs.exportPath?.trim()) await client.export(inputs.exportPath.trim());
                  return authSuccess(session);
                } catch (error) {
                  return {
                    type: "failed" as const,
                    error: error instanceof Error ? error.message : "Import failed",
                  };
                }
              })();
              // The automatic flow avoids Magpie's API-key prompt, which is
              // always shown for API methods even when authorize reads a file.
              return {
                url: "",
                opened: true,
                instructions:
                  "Checking the session. If an export path was given, a portable session file is written there once it checks out.",
                method: "auto" as const,
                callback: () => result,
              };
            },
          },
          {
            type: "oauth" as const,
            label: "Export portable session text for the Web",
            labels: {
              en: "Export portable session text for the Web",
              zh: "导出可复制的会话迁移文本（Web）",
              "zh-Hans": "导出可复制的会话迁移文本（Web）",
              ja: "持ち運べるセッションテキストを書き出す（Web）",
            },
            prompts: [
              {
                type: "text",
                key: "account",
                message:
                  "Account name to export (same as at sign-in; leave empty when only one local session exists)",
                messages: {
                  en: "Account name to export (same as at sign-in; leave empty when only one local session exists)",
                  zh: "要导出的账号名称（与登录时填写的一致，仅有一个本机会话时可留空）",
                  "zh-Hans": "要导出的账号名称（与登录时填写的一致，仅有一个本机会话时可留空）",
                  ja: "書き出すアカウント名（ログイン時と同じもの。ローカルに 1 件だけなら空欄可）",
                },
              },
            ],
            async authorize(inputs: Record<string, string> = {}) {
              const account = inputs.account?.trim();
              const sessions = (await listSessions()).filter((s) => !account || s.accountId === account);
              if (sessions.length === 0)
                throw new Error("No local session found. Check the account name, or sign in first.");
              if (sessions.length !== 1)
                throw new Error(
                  "Several local sessions matched. Enter one exact account name, or export a file instead.",
                );
              const session = sessions[0];
              const text = await clientFor(session).export();
              return {
                // Magpie's bounded sign-in-link row has a copy button that
                // copies the entire value. Never put credentials in an HTTP URL.
                url: text,
                opened: true,
                instructions:
                  "Copy the whole text with the copy button beside it and pass it privately to the other machine. It contains sign-in credentials: do not open it as a link. When the copy is done, enter DONE in the Code field, or just close this window.",
                method: "code" as const,
                async callback(code = "") {
                  if (code.trim() !== "DONE")
                    return {
                      type: "failed" as const,
                      error: "Enter DONE to confirm the transfer text was copied",
                    };
                  return authSuccess(session);
                },
              };
            },
          },
          {
            type: "oauth" as const,
            label: "Paste portable session text to import (Web)",
            labels: {
              en: "Paste portable session text to import (Web)",
              zh: "粘贴会话迁移文本导入（Web）",
              "zh-Hans": "粘贴会话迁移文本导入（Web）",
              ja: "持ち運べるセッションテキストを貼り付けて読み込む（Web）",
            },
            prompts: [
              {
                type: "password",
                key: "payload",
                message:
                  "Paste the whole aistudio-session:v1- transfer text (it contains sign-in credentials)",
                messages: {
                  en: "Paste the whole aistudio-session:v1- transfer text (it contains sign-in credentials)",
                  zh: "粘贴完整的 aistudio-session:v1- 迁移文本（包含登录凭据）",
                  "zh-Hans": "粘贴完整的 aistudio-session:v1- 迁移文本（包含登录凭据）",
                  ja: "aistudio-session:v1- で始まる移行テキスト全体を貼り付け（ログイン情報を含む）",
                },
              },
            ],
            async authorize(inputs: Record<string, string> = {}) {
              const result = (async () => {
                let session: Session | undefined;
                let client: StudioClient | undefined;
                try {
                  session = await importSessionText(inputs.payload || "");
                  client = clientFor(session);
                  await client.models();
                  return authSuccess(session);
                } catch (error) {
                  // A failed import must not leave an exportable local account.
                  if (session) {
                    await client?.close();
                    clients.delete(session.profile);
                    await rm(session.profile, { recursive: true, force: true });
                  }
                  return {
                    type: "failed" as const,
                    error: error instanceof Error ? error.message : "Import failed",
                  };
                }
              })();
              return {
                url: "",
                opened: true,
                instructions:
                  "Checking and restoring the session. When it checks out the account is saved and its models are read.",
                method: "auto" as const,
                callback: () => result,
              };
            },
          },
        ],
        async loader(getAuth: () => Promise<{ key?: unknown }>) {
          const session = readSession((await getAuth())?.key);
          return {
            apiKey: "aistudio-browser-session",
            fetch: providerFetch(clientFor(session)),
          };
        },
      },
      provider: {
        id: ID,
        async models(_provider: unknown, context: { auth?: { key?: unknown } } = {}) {
          return providerModels(clientFor(readSession(context.auth?.key)));
        },
      },
    };
  },
};
