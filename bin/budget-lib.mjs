// Shared plumbing for the family budget: SimpleFIN feed in, Actual as the
// engine, a JSON snapshot out for the HomeRun UI. Secrets live in
// ~/Tools/actual-data/budget-sync.env (mode 600, sourced from Bitwarden).
import fs from "node:fs";
import path from "node:path";
import api from "@actual-app/api";

export const DATA_DIR = process.env.HOMERUN_BUDGET_DATA ?? `${process.env.HOME}/homerun-budget-data`;
export const MAP_FILE = path.join(DATA_DIR, "budget-map.json");
export const SNAPSHOT_FILE = path.join(DATA_DIR, "budget-snapshot.json");
export const API_CACHE = path.join(DATA_DIR, "api-cache");

export function loadEnv() {
  const raw = fs.readFileSync(path.join(DATA_DIR, "budget-sync.env"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  for (const k of ["SIMPLEFIN_ACCESS_URL", "ACTUAL_SERVER_URL", "ACTUAL_PASSWORD"])
    if (!env[k]) throw new Error(`missing ${k} in budget-sync.env`);
  return env;
}

export async function simplefinAccounts(accessUrl, startDate) {
  const url = new URL(accessUrl + "/accounts");
  if (startDate) url.searchParams.set("start-date", String(startDate));
  url.searchParams.set("pending", "1");
  const auth = Buffer.from(url.username + ":" + url.password).toString("base64");
  const bare = url.origin + url.pathname + url.search;
  const res = await fetch(bare, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`SimpleFIN ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.errors?.length) console.error("SimpleFIN warnings:", data.errors);
  return data.accounts;
}

export async function initActual(env) {
  fs.mkdirSync(API_CACHE, { recursive: true });
  await api.init({
    dataDir: API_CACHE,
    serverURL: env.ACTUAL_SERVER_URL,
    password: env.ACTUAL_PASSWORD,
  });
  return api;
}

export function readMap() {
  return JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
}

export function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}
