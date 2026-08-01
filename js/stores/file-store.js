// Хранилище 2: файловая система устройства (Origin Private File System).
// Каждая заметка — отдельный файл notes/<id>.json. Если браузер не поддерживает createWritable
// (Safari до 26 версии), запись выполняется в Web Worker через createSyncAccessHandle.
import { matches, sortNotes } from "../model.js";

export class FileStore {
  /** dir — каталог в OPFS: у приложения «notes», у браузерных тестов отдельный. */
  constructor(dir = "notes") { this.name = "files"; this.title = "Файлы на устройстве"; this.dirName = dir; }

  static supported() {
    return !!(navigator.storage && navigator.storage.getDirectory);
  }

  async init() {
    if (!FileStore.supported()) throw new Error("Браузер не поддерживает файловое хранилище (OPFS)");
    const root = await navigator.storage.getDirectory();
    this.dir = await root.getDirectoryHandle(this.dirName, { create: true });
    return this;
  }

  fileName(id) {
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error("Недопустимый идентификатор заметки");
    return `${id}.json`;
  }

  async writeText(name, text) {
    const handle = await this.dir.getFileHandle(name, { create: true });
    if (handle.createWritable) {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return;
    }
    await workerWrite(this.dirName, name, text);
  }

  async list() {
    const notes = [];
    for await (const [name, handle] of this.dir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      try {
        notes.push(JSON.parse(await (await handle.getFile()).text()));
      } catch {
        console.warn("Поврежденный файл заметки пропущен:", name);
      }
    }
    return sortNotes(notes);
  }

  async get(id) {
    try {
      const h = await this.dir.getFileHandle(this.fileName(id));
      return JSON.parse(await (await h.getFile()).text());
    } catch {
      return null;
    }
  }

  async save(note) {
    await this.writeText(this.fileName(note.id), JSON.stringify(note, null, 2));
    return note;
  }

  async remove(id) {
    await this.dir.removeEntry(this.fileName(id)).catch(() => {});
  }

  async search(q) {
    return (await this.list()).filter((n) => matches(n, q));
  }

  async clear() {
    for (const n of await this.list()) await this.remove(n.id);
  }
}

let worker;
function workerWrite(dir, name, text) {
  worker ||= new Worker(new URL("./opfs-worker.js", import.meta.url));
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener("message", onMsg);
      e.data.ok ? resolve() : reject(new Error(e.data.error));
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage({ id, dir, name, text });
  });
}
