// Выбор хранилища и перенос заметок между ними.
import { FileStore } from "./file-store.js";
import { SqliteStore } from "./sqlite-store.js";

const KEY = "notes.storage";

export function currentMode() {
  try { return localStorage.getItem(KEY) || "sqlite"; } catch { return "sqlite"; }
}

export async function openStore(mode = currentMode()) {
  const store = mode === "files" ? new FileStore() : new SqliteStore();
  await store.init();
  try { localStorage.setItem(KEY, store.name); } catch { /* приватный режим */ }
  return store;
}

/** Перейти на другое хранилище; при migrate=true заметки копируются. */
export async function switchStore(from, toMode, migrate) {
  const to = await openStore(toMode);
  if (migrate) {
    const existing = new Set((await to.list()).map((n) => n.id));
    for (const n of await from.list()) if (!existing.has(n.id)) await to.save(n);
  }
  return to;
}

export { FileStore, SqliteStore };
