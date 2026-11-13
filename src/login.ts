import { StudioClient } from "./client.ts";
import { createSession, saveSession } from "./session.ts";

if (process.argv.includes("--help")) {
  console.log(
    "Usage: bun run login [account-name]\nOpens a Chromium-family browser for Google login and prints the local session descriptor path.",
  );
} else {
  const session = await createSession(process.argv[2] || "Google AI Studio");
  const client = new StudioClient(session, {});
  try {
    console.error(
      "Sign in to Google AI Studio in the browser window that just opened, finish the first-run setup, then close that window. The sign-in is checked and saved automatically; it waits up to 10 minutes.",
    );
    await client.login();
    console.log(await saveSession(session));
  } finally {
    await client.close();
  }
}
