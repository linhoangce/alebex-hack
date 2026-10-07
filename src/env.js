// Read-modify-write of one KEY=value line in .env, shared by the setup scripts and the server
// (the webhook signing secret is shown once, at boot, and must be stored then).
// Also sets process.env so the running process sees the value at once.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

// Replace the KEY= line if present, append otherwise. The replacer is a function so a value
// containing "$" is written literally.
export function setEnv(key, value) {
  process.env[key] = String(value);
  const line = `${key}=${value}`;
  try {
    let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
    fs.writeFileSync(ENV_PATH, text, "utf8");
  } catch (err) {
    console.warn(`[env] could not write ${key} to .env (${err.code ?? err.message}); set it in the host environment`);
  }
}
