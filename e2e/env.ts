import { join } from "node:path";

/** Shared by the config, the DB prep script and the tests. */
export const E2E_PORT = 3199;
export const E2E_DB_PATH = join(process.cwd(), ".e2e", "e2e.sqlite");
export const DEMO_PIN = "123456";
export const MARI_PIN = "482916";
