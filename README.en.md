# magpie-google-ai-studio

**English** | [简体中文](README.md)

Connects a Google AI Studio web account to [Magpie](https://github.com/yetone/magpie) and converts Gemini JSON and SSE requests into requests against the private AI Studio Playground and Build endpoints.

The plugin uses `Bun.WebView` and needs no Go, Python, Playwright, Puppeteer, or separate API service.

## Installation

### Install the plugin

In Magpie Web, go to "Settings → Plugins → Discover", find "Have one in mind?", enter `magpie-google-ai-studio`, and click `Install`. To install from the command line:

```sh
magpie plugin add magpie-google-ai-studio
```

You can also install it from GitHub:

```sh
magpie plugin add github:XYenon/magpie-google-ai-studio
```

Either method works, you only need one. Run `magpie plugin update` to update all installed plugins.

### Runtime and sign-in

Magpie downloads Bun automatically to run the plugin. The plugin requires `Bun.WebView`, and an ordinary desktop or server also needs a Chromium-family browser installed: Chrome, Chromium, Brave, Edge, Vivaldi, Arc, or Opera. The plugin finds an installed one on its own.

In the official Magpie Docker image, the plugin checks at start-up whether a browser is usable and, when dependencies are missing, downloads Chromium, fonts, and runtime libraries from the Debian software sources configured in the image. Dependencies are unpacked into `/config/cache/magpie-google-ai-studio/dependencies/`, which needs neither root nor changes to the image. Mount `/config` as the official instructions recommend and both the dependencies and the account session persist.

The first installation needs network access, and the container user must be able to write to `/config`. Installation runs in the background; sign-in or requests wait for it to finish, and later starts check for and reuse the existing dependencies. In Docker, `--no-sandbox` and `--disable-dev-shm-usage` are added automatically. If `chromePath` or `BUN_CHROME_PATH` is set, the plugin uses that browser in preference to any other and reports an error when it cannot start.

Once installed, add a Google AI Studio account on the provider page, or run:

```sh
magpie plugin login google-ai-studio
```

Choose "Sign in to Google AI Studio", complete the sign-in and the AI Studio first-use setup in the browser window that opens, then close the window. The plugin verifies and saves the session, and later requests run in the background. Interactive sign-in waits up to 10 minutes.

The sign-in window appears on the machine running Magpie and uses a separate browser profile directory. When a remote server has no desktop, sign in on a machine that has one and migrate the session afterwards.

On Linux outside Docker, you can install the Chromium package your distribution provides, for example on Debian:

```sh
sudo apt-get update
sudo apt-get install -y chromium
```

If no browser is found, set `BUN_CHROME_PATH` or `chromePath`.

## Migrating a session between two machines

With the plugin installed on both machines, you can copy and paste migration text through Magpie Web, or transfer an `account.aistudio.json` file. The target machine does not need a desktop.

Both forms carry the account name, the Google cookies (including HttpOnly cookies), and AI Studio's localStorage and sessionStorage, and neither carries source-machine paths or the browser encryption key. Importing creates a new local browser profile directory. If Google has already invalidated the credentials or asks for extra verification, sign in again on the source machine and export once more.

### Copy and paste migration text in Magpie Web

1. On the source machine, add a Google AI Studio account in Magpie and choose "Export copyable session migration text (Web)". Fill in the account name used at sign-in, or leave it blank when there is only one local session. Sessions that share a name must be exported through the file route.
2. Click the copy button beside the migration text and transfer the complete text to the target machine privately. The text starts with `aistudio-session:v1-`; the ellipsis shown in the display does not affect copying.
3. On the target machine, add a Google AI Studio account in Magpie, choose "Paste session migration text to import (Web)", and paste it into the password input field. After successful verification the account is saved automatically and the model list is read.

The export uses Magpie's sign-in window, so it still shows a "sign-in link", `Code`, and `Open again`. Do not open the link or click `Open again`. After copying, enter `DONE` in `Code` and finish, or simply close the window.

The migration text is not encrypted, only gzip-compressed and hex-encoded, so whoever holds it can use the credentials inside. Transfer it privately, and clear the clipboard and any temporary copies after importing. The plugin does not save pasted content into account metadata.

The migration text is capped at 60 KiB and the decompressed JSON at 1 MiB; beyond either limit, use file migration. The plugin rejects corrupt, incomplete, or unsupported-version text, saves no account when verification fails, and removes the import directory it created. The compression check cannot verify the sender's identity, so import text only from sources you trust.

### Export a file from Magpie

On first sign-in, fill in "Migratable session package export path" and the package is exported automatically once sign-in succeeds. For an existing account, add an account in Magpie and choose "Import Google AI Studio session / export local session", or run:

```sh
magpie plugin login google-ai-studio 2
```

Fill in the prompts in order:

1. The absolute path of `account.session.json` on the source machine.
2. Leave the account name blank to keep the original name.
3. The export path, for example `/config/account.aistudio.json`.

The local session descriptor lives at `~/.local/share/magpie-google-ai-studio/<account-directory>/account.session.json` by default, and at `/config/home/.local/share/magpie-google-ai-studio/<account-directory>/account.session.json` in the official Docker image. When `MAGPIE_AISTUDIO_DATA_DIR` is set, that directory takes precedence. The account directory name is a random ID; read `accountId` in the descriptor to tell accounts apart.

The export reads and verifies the current browser session and needs no Google password or API key. The file contains plaintext credentials, carries Unix mode `0600`, and never overwrites an existing file. Transfer it privately, and use a new export filename each time. Magpie updates an existing record under the same account name.

### Import the file in Magpie on the target machine

Copy the session file to the target server, then choose "Import Google AI Studio session / export local session" in the target Magpie, or run `magpie plugin login google-ai-studio 2`:

1. Enter the absolute path of `account.aistudio.json` on the target machine.
2. Leave the account name blank to inherit the source account name, or give it a new one.
3. Leave the export path blank.

After successful verification the account is saved automatically and the model list is read. The file route also accepts AIStudio2API storage-state JSON in the form `{ "cookies": [...], "origins": [...] }`.

`account.session.json` only references directories on its own machine and cannot be used across machines on its own. To move between machines, transfer the migration text or an `.aistudio.json` file; Magpie's general backup does not include plugin sign-in credentials.

File paths belong to the server running Magpie, so in Docker you should give the path inside the container. Magpie Web has no upload or download entry for plugin session files, so files must move through the server or through the mounted `/config` directory. If you use only the web interface, choose the migration-text route.

## Configuration

Edit the options JSON in Magpie Web under "Settings → Plugins", or change this plugin's `options` in `plugins.json`. For example:

```json
{
  "chromePath": "/usr/bin/chromium",
  "timeoutMs": 180000
}
```

You can also configure it from the command line:

```sh
magpie plugin options magpie-google-ai-studio '{"chromePath":"/usr/bin/chromium","timeoutMs":180000}'
```

### Plugin options

Every field is optional; `{}` uses the defaults.

| Field            | Type                 | Default                                                                                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chromePath`     | String               | Auto-detected                                                                                     | Path to the Chromium-family browser executable on the machine running Magpie (Chrome, Chromium, Brave, Edge, Vivaldi, Arc, Opera, and so on). Takes precedence over `BUN_CHROME_PATH`; when unset, the plugin looks for a managed Chromium, then browsers on `PATH`, then platform install locations (`/Applications` and `~/Applications` on macOS, `Program Files` and `LocalAppData` on Windows). The official Docker image normally needs no value, since the plugin installs missing dependencies itself. |
| `chromeArgs`     | String array         | `[]`                                                                                              | Extra launch arguments for the sign-in window and the background browser. Explicit proxy arguments take precedence over the automatic proxy. Arguments starting with `--user-data-dir`, `--remote-debugging`, or `--headless` are rejected; the plugin manages the account directory, the debugging interface, and the run mode. The official Docker image also adds `--no-sandbox` and `--disable-dev-shm-usage` automatically.                                                                               |
| `bootstrapModel` | String               | First available GenerateContent model in the account catalog                                      | Model used when initializing the page and WAA; it does not change the model an actual generation request names. It must come from the current account's GenerateContent catalog, may contain only letters, digits, underscores, dots, and hyphens, and carries no `models/` prefix. An unavailable value is an error.                                                                                                                                                                                          |
| `timeoutMs`      | Number, milliseconds | `180000` for browser-process communication and generation requests; `120000` for in-page requests | Overrides the configurable timeouts above. It must be a finite number of at least `1000`. It is not an overall time limit for the whole start-up or sign-in process: some page-initialization waits use fixed timeouts, and interactive sign-in waits up to 10 minutes.                                                                                                                                                                                                                                        |

### Environment variables

Environment variables belong in the Magpie process or the Docker container, not in the options JSON.

| Variable                                             | Default                                                  | Description                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUN_CHROME_PATH`                                    | Auto-detected                                            | Path to the browser executable. The `chromePath` plugin option takes higher precedence.                                                                                                                                                                                                                                                              |
| `MAGPIE_AISTUDIO_DATA_DIR`                           | `~/.local/share/magpie-google-ai-studio/`                | Where sessions and the separate browser profile directories are stored when accounts are created and imported. The official Docker image defaults to `/config/home/.local/share/magpie-google-ai-studio/`; if you point it elsewhere, mount that location yourself to persist it. Changing this variable does not move existing account directories. |
| `XDG_CACHE_HOME`                                     | `~/.cache`; `/config/cache` in the official Docker image | Cache root for automatically installed browser dependencies, which are kept in its `magpie-google-ai-studio/dependencies/` subdirectory.                                                                                                                                                                                                             |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | Unset                                                    | HTTP, HTTPS, all-protocol, and no-proxy settings for the process; the matching lowercase variables are also read. When running through Magpie, configure the proxy in Magpie instead, since the host passes the proxy it actually selected to the account process.                                                                                   |

### Proxy

The sign-in window and the background browser automatically use the global, provider, or account proxy Magpie selected, and "direct" is supported as well. After you change the proxy, the next request restarts that account's background browser to apply the configuration; no new sign-in is needed.

Standalone command-line use supports `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and their lowercase forms. HTTP and HTTPS proxies may include a username and password; the plugin handles authentication through a local relay and never writes the automatic proxy password into Chrome launch arguments or a session package. A SOCKS proxy configured in Magpie uses the HTTP bridge the host provides; standalone runs also support SOCKS4 and SOCKS5 proxies without authentication.

To set a browser proxy on its own, put `--proxy-server=http://127.0.0.1:7890` in `chromeArgs`, or specify a PAC file, auto-discovery, or `--no-proxy-server`. Explicit arguments take precedence over the automatic configuration.

## Request flow

1. Magpie converts the client request into Gemini format and calls the plugin's `fetch`.
2. Ordinary chat uses the Playground MakerSuite protocol, while tool, schema, media, and speech requests are forwarded as native Gemini JSON through AI Studio Build. Both paths obtain a fresh WAA proof from the WebView for the account.
3. The WebView sends a native `fetch` with cookies inside the AI Studio page and reads the response as needed.
4. The plugin returns Gemini JSON or SSE. The Build path keeps the tool results, thinking signatures, citation sources, and usage information from the native response.

At initialization the plugin fills in an initialization message in a temporary chat and intercepts the submit request to obtain the page's dynamic request headers and the WAA service. That initialization request is blocked inside the page and is not sent to the generation endpoint. Actual requests regenerate the WAA proof and the SAPISID signature.

During interactive sign-in the plugin does not connect to the browser debugging interface; only after the sign-in window closes does it verify the session through the WebView. The plugin disables the browser's own account sign-in, so restored web cookies are not cleared for lack of a browser OAuth token, and it waits for the browser to exit before reading the session storage.

AI Studio rejects some automation flags: even with the account signed in and the model list readable, the generation endpoint can still return 403. When it starts the browser, the plugin turns off the `AutomationControlled` flag and removes the `HeadlessChrome` prefix from the browser's actual User-Agent, keeping the real platform and version instead of pinning a spoofed version.

## Supported features

The model list comes from the current account's Playground catalog and for now lists only conversational models that output text. Image generation, TTS, and embedding models are not listed yet, pending model-purpose categories in Magpie, see [magpie#3279](https://github.com/yetone/magpie/issues/3279). The underlying endpoints still provide the features in the table below. The plugin declares input and output types from the model family and the catalog capabilities, not from a fixed model list. What tools, schemas, and media each model accepts is still decided by Google's servers.

Plain text chat uses the Playground path. Requests that carry tools or tool configuration, structured output, media input, or speech configuration use the Build proxy path. A model appearing in the Playground catalog does not mean the same account also has permission or quota on the Build path. In testing, `gemini-4-argon` on the same account succeeded in Playground, while the Build streaming request returned 403 and the non-streaming request returned 429 with a quota limit of 0. The plugin keeps these upstream errors and does not switch paths or retry generation automatically.

Both paths check before sending that `temperature` is between 0 and 2 and that `thinkingBudget` and `thinkingLevel` do not appear together. A non-empty `allowedFunctionNames` requires `ANY`, and the plugin will not turn `AUTO` into the forced-tool `ANY` on its own. Validation applies to the request the plugin actually receives, so Magpie may already have removed a conflicting thinking budget or tool allowlist during conversion. Thinking levels expose the tiers the model catalog offers and accept either case when the request is encoded.

The plugin does not query remaining quota yet. The website has a `GetModelQuota` endpoint, but querying `gemini-3.8-flash` and `gemini-4-argon` for the current account returns empty results, which does not show whether the quota is 0 or unlimited. The website code uses that endpoint to show the remaining Veo generations, but querying the corresponding Veo model for the current account returns 404. `ListQuotaModels` returns model categories rather than remaining numbers, and `usageMetadata` in a generation response only describes the current consumption. AIStudio2API infers cooldown from 429 errors and their retry time, and implements no remaining-quota query.

| Feature                            | Endpoint and behavior                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat generation                    | `generateContent` and `streamGenerateContent`, with system instructions, thinking configuration, and signature pass-through. An interrupted stream raises an error and does not fabricate a successful completion frame.                                                                                                        |
| Function calling                   | Supports `AUTO`, `NONE`, `ANY`, `VALIDATED`, and `allowedFunctionNames`; tool parameters reach the server unchanged through `parameters` or `parametersJsonSchema`. `NONE` removes user function declarations.                                                                                                                  |
| Structured output                  | Supports `responseSchema` and `responseJsonSchema`. The latter is converted into the native `responseFormat` the web app accepts, keeping `$defs`, `$ref`, `additionalProperties`, and numeric limits for the server to handle.                                                                                                 |
| Image, audio, video, and PDF input | Gemini chat models support `inlineData`, and Magpie's model capabilities declare the matching input types. `fileData` is passed through unchanged, but the plugin does not upload files for the client or grant access to remote files.                                                                                         |
| Image and speech generation        | Uses the image or TTS models the account has, configured through `responseModalities` and `speechConfig`, and returns native `inlineData`.                                                                                                                                                                                      |
| Built-in tools                     | Passes through `codeExecution`, `googleSearch`, `urlContext`, and `googleMaps`, keeping execution results and citation metadata. Availability depends on the model.                                                                                                                                                             |
| Embeddings                         | Supports Magpie's OpenAI-format `/v1/embeddings` and the plugin's internal Gemini `embedContent` and `batchEmbedContents`. Batching, `dimensions`, `float`, and `base64` are supported, with at most 100 inputs per batch in input order.                                                                                       |
| Token counting                     | The plugin supports Gemini `countTokens`, accepts `contents` or `generateContentRequest`, and calls AI Studio's native counting endpoint.                                                                                                                                                                                       |
| Automatic continuation             | When the Playground model catalog declares continuation, the plugin continues generation with the server's continuation token and merges the JSON or SSE and the usage. Each round produces at most 32768 output tokens and ends when the caller's `maxOutputTokens` is reached. The Build path does not simulate continuation. |

The plugin preserves Google's native `promptFeedback` blocking notes, including the `PROHIBITED_CONTENT` a search may return. When a response has neither candidates nor an explicit blocking reason, the plugin raises an error.

Example native Gemini request; replace the model name with one from the account catalog that supports the feature:

```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "Call lookup for item 7." }] }],
  "tools": [
    {
      "functionDeclarations": [
        {
          "name": "lookup",
          "parametersJsonSchema": {
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"],
            "additionalProperties": false
          }
        }
      ]
    }
  ],
  "toolConfig": { "functionCallingConfig": { "mode": "ANY", "allowedFunctionNames": ["lookup"] } }
}
```

Example Magpie embeddings request body:

```json
{
  "model": "google-ai-studio/gemini-embedding-001",
  "input": ["first passage", "second passage"],
  "dimensions": 128,
  "encoding_format": "float"
}
```

### Endpoints not yet fully available

The plugin does not provide the following endpoints yet. The probe results do not prove that Google has no support for them at all.

| Endpoint         | Observed result and remaining limitation                                                                                                                                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files / Drive    | Listing Files through Build returns 403 for the current account, and obtaining a Drive access token returns 401. Magpie also has no entry point that hands Files upload requests to this plugin, so media can use `inlineData` for now.                                                                                                              |
| Explicit caching | Listing caches returns 403 for the current account and creating a cache returns 404, so no usable cache resource was obtained. Ordinary chat is unaffected.                                                                                                                                                                                          |
| Live             | The web WebChannel handshake response was obtained, but full live generation is not verified yet. Provider plugins in the current Magpie have no bidirectional WebSocket forwarding entry.                                                                                                                                                           |
| Veo              | The private generation endpoint once returned an operation, but polling it returned `401 unauthorized_client` and no video was obtained. Magpie's generic video route does not call this kind of account plugin either.                                                                                                                              |
| Interactions     | The private `CreateInteractionStream` returned the text `OK`, so the web endpoint works. The public-format path on Build returns 404, Magpie has no matching endpoint and event-conversion contract, and the plugin has not implemented this separate protocol. Models that only support Interactions are not listed in the GenerateContent catalog. |

AI Studio's private endpoints change, and the plugin may need updates when the page DOM, the dynamic request headers, or the WAA service change. Permission, rate-limit, and service errors returned by Google are passed to Magpie, and the plugin does not retry generation requests automatically.

## Development and verification

After cloning the repository, install the development dependencies and run the checks:

```sh
git clone https://github.com/XYenon/magpie-google-ai-studio.git
cd magpie-google-ai-studio
bun install --frozen-lockfile
bun run check
AISTUDIO_WEBVIEW_TEST=1 bun test test/webview.test.ts
```

`bun run check` runs the code checks, format checks, markdownlint, type checking, and the default tests, and GitHub CI uses the same command. Biome covers TypeScript and JSON, Prettier covers Markdown and YAML, and the two never format the same kind of file twice.

The code keeps double quotes, semicolons, two-space indentation, and a 110-column width. Biome warnings fail the check; assignments inside conditions and non-null assertions are allowed. markdownlint uses its default rules with only the line-length limit turned off, keeping the existing line breaks of the Chinese paragraphs and configuration tables.

| Command                          | Purpose                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `bun run lint`                   | Checks code, formatting, import order, and Markdown without modifying files.       |
| `bun run lint:markdown`          | Runs markdownlint on its own.                                                      |
| `bun run lint:fix`               | Sorts imports, applies safe code fixes and Markdown fixes, then formats the files. |
| `bun run format`                 | Formats TypeScript, JSON, Markdown, and YAML.                                      |
| `bun run typecheck` / `bun test` | Runs type checking or the default tests on their own.                              |

EditorConfig standardizes UTF-8, LF line endings, and a final newline, and Markdown keeps trailing whitespace. The recommended VS Code extensions are Biome, Prettier, and markdownlint, configured to format and fix on save per file type. All the checking tools honor `.gitignore` and skip session files and artifacts under `.amp/`.

For local development, install the working directory with `magpie plugin add /absolute/path/to/magpie-google-ai-studio`.

The default tests start no browser. The last command uses Chromium and a local mock service to verify transport, signing, streaming reads, cancellation, session migration, and proxy configuration. The migration tests need `openssl` to generate a local HTTPS certificate and need no Google account.

On a Linux environment with access to the Docker daemon, you can verify dependency installation in the official image:

```sh
AISTUDIO_DOCKER_TEST=1 bun test test/dependencies.test.ts
```

The test uses the official image's default non-root user to check dependency installation, recovery from proxy failures, reuse of the `/config` volume with no network after rebuilding the container, and repair of missing runtime libraries, and it verifies the browser through WebView operations. The test uses no Google account and deletes its dedicated test volume when it finishes.

To check real generation with an account that is already signed in:

```sh
bun run smoke /path/to/account.session.json <model-id>
```

The command reads the model list and requests one short streaming answer to verify the real account path. The local mock service can only verify the transport logic; it cannot prove that Google will accept the WAA proof for the current session.

## License

Copyright (C) 2026 XYenon and contributors.

This project is released under the [GNU Affero General Public License, version 3 or any later version](https://www.gnu.org/licenses/agpl-3.0.html) (`AGPL-3.0-or-later`); the full license is in [LICENSE](LICENSE). The MIT copyright and license notices for AIStudio2API are retained in [NOTICE](NOTICE).

## References

The private protocol and the WAA flow follow [AIStudio2API](https://github.com/Mag1cFall/AIStudio2API). Standard endpoints follow the [Google Gemini API](https://ai.google.dev/api/generate-content), and the plugin contract follows the [Magpie documentation](https://github.com/yetone/magpie/blob/main/site/public/docs/plugins.html). Upstream licenses are in [NOTICE](NOTICE).
