/**
 * Fresh database for the end-to-end run: wipes `.e2e/`, seeds it with the
 * dev seed (user "Demo", PIN 123456) and adds a second user "Mari" for the
 * household flow. Runs before the server starts (see playwright.config.ts),
 * so it never sees an open connection.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createUserWithWorkspace, hashPin } from "../lib/auth";
import { E2E_DB_PATH, MARI_PIN } from "./env";

rmSync(join(E2E_DB_PATH, ".."), { recursive: true, force: true });
process.env.DB_PATH = E2E_DB_PATH;

execFileSync("npx", ["tsx", "scripts/seed.ts"], { stdio: "inherit", env: { ...process.env, DB_PATH: E2E_DB_PATH } });

createUserWithWorkspace("Mari", hashPin(MARI_PIN), false);
console.log("Created user Mari");
