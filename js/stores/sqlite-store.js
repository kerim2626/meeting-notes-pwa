// Хранилище 1: база SQLite в браузере (sql.js, WebAssembly). Файл базы сохраняется в IndexedDB устройства.
import { matches, searchText, sortNotes } from "../model.js";
import { idbGet, idbSet } from "./idb.js";

// sql.js 1.10.3 (MIT) хранится в репозитории: приложение не зависит от доступности CDN
const SQLJS = new URL("../../vendor/sql.js/", import.meta.url).href;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  date         TEXT NOT NULL,           -- ГГГГ-ММ-ДД
  time         TEXT NOT NULL,           -- ЧЧ:ММ
  kind         TEXT NOT NULL,
  place        TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  search_text  TEXT NOT NULL DEFAULT '', -- нижний регистр: LIKE в SQLite не понижает кириллицу
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_dt ON notes (date, time);`;

const COLS = ["id", "title", "date", "time", "kind", "place", "participants", "content", "created_at", "updated_at"];

async function loadSqlJs() {
  if (!window.initSqlJs) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SQLJS + "sql-wasm.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Не удалось загрузить модуль SQLite."));
      document.head.append(s);
    });
  }
  return window.initSqlJs({ locateFile: (f) => SQLJS + f });
}

export class SqliteStore {
  /** ns — пространство хранения: у приложения «notes», у браузерных тестов отдельное. */
  constructor(ns = "notes") { this.name = "sqlite"; this.title = "База данных SQLite"; this.key = `${ns}.sqlite`; }

  async init() {
    const SQL = await loadSqlJs();
    const bytes = await idbGet(this.key);
    this.db = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
    this.db.run(SCHEMA);
    return this;
  }

  async persist() {
    await idbSet(this.key, this.db.export());   // запись файла базы после каждого изменения
  }

  rows(sql, params = []) {
    const st = this.db.prepare(sql);
    st.bind(params);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
  }

  async list() {
    return this.rows(`SELECT ${COLS.join(", ")} FROM notes ORDER BY date DESC, time DESC, updated_at DESC`);
  }

  async get(id) {
    return this.rows(`SELECT ${COLS.join(", ")} FROM notes WHERE id = ?`, [id])[0] || null;
  }

  async save(note) {
    this.db.run(`INSERT INTO notes (${COLS.join(", ")}, search_text) VALUES (${COLS.map(() => "?").join(", ")}, ?)
                 ON CONFLICT(id) DO UPDATE SET ${COLS.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")},
                 search_text = excluded.search_text`,
                [...COLS.map((c) => note[c] ?? ""), searchText(note)]);
    await this.persist();
    return note;
  }

  async remove(id) {
    this.db.run("DELETE FROM notes WHERE id = ?", [id]);
    await this.persist();
  }

  async search(q) {
    // фильтр по дате, времени и типу выполняет SQL, проверку всех слов — общая функция matches()
    const where = [], params = [];
    if (q.dateFrom) { where.push("date >= ?"); params.push(q.dateFrom); }
    if (q.dateTo) { where.push("date <= ?"); params.push(q.dateTo); }
    if (q.timeFrom) { where.push("time >= ?"); params.push(q.timeFrom); }
    if (q.timeTo) { where.push("time <= ?"); params.push(q.timeTo); }
    if (q.kind) { where.push("kind = ?"); params.push(q.kind); }
    const sql = `SELECT ${COLS.join(", ")} FROM notes ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
    return sortNotes(this.rows(sql, params).filter((n) => matches(n, { words: q.words })));
  }

  async clear() {
    this.db.run("DELETE FROM notes");
    await this.persist();
  }

  exportFile() {
    return new Blob([this.db.export()], { type: "application/vnd.sqlite3" });
  }
}
