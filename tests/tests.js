// Мини-фреймворк тестов без зависимостей: модель заметки и оба хранилища.
import { matches, normalize, validate, humanDate, toMarkdown } from "../js/model.js";
import { SqliteStore } from "../js/stores/sqlite-store.js";
import { FileStore } from "../js/stores/file-store.js";
import { switchStore } from "../js/stores/index.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg || "условие не выполнено"); };

const sample = (over = {}) => validate({ title: "Планерка", date: "2026-07-14", time: "09:30", kind: "meeting",
  participants: "Иванов, Петрова", content: "Обсудили релиз СИЗАР 2.4", ...over }).note;

// ---- модель ----
test("validate: обязательные поля и формат времени", () => {
  const r = validate({ title: "", date: "2026-13-40", time: "25:00" });
  ok(!r.ok); eq(Object.keys(r.errors).sort(), ["date", "time", "title"]);
});
test("validate: корректная заметка получает id и метки времени", () => {
  const r = validate({ title: "Встреча", date: "2026-07-01", time: "10:00", kind: "business" });
  ok(r.ok); ok(r.note.id && r.note.created_at && r.note.updated_at);
});
test("validate: неизвестный тип превращается в «Другое»", () => eq(sample({ kind: "party" }).kind, "other"));
test("normalize: регистр кириллицы и ё", () => eq(normalize("  ЁЛКА  Совещание "), "елка совещание"));
test("matches: все слова, без учета регистра", () => {
  const n = sample();
  ok(matches(n, { words: "релиз сизар" })); ok(!matches(n, { words: "релиз бюджет" }));
});
test("matches: диапазон дат, времени и тип", () => {
  const n = sample();
  ok(matches(n, { dateFrom: "2026-07-01", dateTo: "2026-07-31", timeFrom: "09:00", timeTo: "10:00", kind: "meeting" }));
  ok(!matches(n, { timeFrom: "10:00" })); ok(!matches(n, { kind: "conference" })); ok(!matches(n, { dateTo: "2026-07-13" }));
});
test("humanDate: сегодня, вчера, дата", () => {
  eq(humanDate("2026-07-14", "2026-07-14"), "Сегодня"); eq(humanDate("2026-07-13", "2026-07-14"), "Вчера");
  eq(humanDate("2026-07-01", "2026-07-14"), "1 июля");
});
test("toMarkdown: заголовок и поля", () => { const md = toMarkdown(sample()); ok(md.startsWith("# Планерка")); ok(md.includes("Участники: Иванов")); });

// ---- общие проверки хранилищ ----
function storeSuite(label, make) {
  test(`${label}: создание, чтение, изменение, удаление`, async () => {
    const s = await make(); await s.clear();
    const n = sample(); await s.save(n);
    eq((await s.get(n.id)).title, "Планерка");
    await s.save({ ...n, title: "Планерка (изм.)" });
    eq((await s.list()).length, 1); eq((await s.get(n.id)).title, "Планерка (изм.)");
    await s.remove(n.id); eq(await s.get(n.id), null);
  });
  test(`${label}: поиск по словам с кириллицей и по времени`, async () => {
    const s = await make(); await s.clear();
    await s.save(sample({ title: "ДЕМО спринта", time: "12:00", content: "Показали Дашборд" }));
    await s.save(sample({ title: "Звонок заказчику", time: "16:00", kind: "business", content: "CRM" }));
    eq((await s.search({ words: "дашборд" })).length, 1, "слово в другом регистре");
    eq((await s.search({ timeFrom: "13:00" })).map((n) => n.title), ["Звонок заказчику"]);
    eq((await s.search({ kind: "business", words: "crm" })).length, 1);
  });
  test(`${label}: сортировка — новые сверху`, async () => {
    const s = await make(); await s.clear();
    await s.save(sample({ title: "A", date: "2026-07-01" })); await s.save(sample({ title: "B", date: "2026-07-03" }));
    eq((await s.list()).map((n) => n.title), ["B", "A"]);
  });
  test(`${label}: данные сохраняются после «перезапуска»`, async () => {
    const s = await make(); await s.clear();
    await s.save(sample({ title: "Сохранится" }));
    const again = await make();
    eq((await again.list()).map((n) => n.title), ["Сохранится"]);
  });
}
storeSuite("SQLite", () => new SqliteStore().init());
storeSuite("Файлы (OPFS)", () => new FileStore().init());

test("Перенос заметок из SQLite в файлы без дублей", async () => {
  const a = await new SqliteStore().init(); await a.clear();
  const f = await new FileStore().init(); await f.clear();
  await a.save(sample({ title: "Перенос 1" })); await a.save(sample({ title: "Перенос 2" }));
  const to = await switchStore(a, "files", true);
  await switchStore(a, "files", true);
  eq((await to.list()).length, 2);
});
test("FileStore: защита от «../» в идентификаторе", async () => {
  const f = await new FileStore().init();
  let failed = false;
  try { await f.save(sample({ id: "../../x" })); } catch { failed = true; }
  ok(failed, "ожидалась ошибка");
});

const log = document.getElementById("log");
let passed = 0;
const results = [];
for (const t of tests) {
  const li = document.createElement("li");
  try { await t.fn(); li.className = "ok"; li.textContent = `✔ ${t.name}`; passed++; results.push([t.name, true]); }
  catch (e) { li.className = "fail"; li.textContent = `✘ ${t.name}: ${e.message}`; results.push([t.name, false, e.message]); }
  log.append(li);
}
const res = document.getElementById("result");
res.textContent = `Пройдено ${passed} из ${tests.length}`;
res.className = passed === tests.length ? "ok" : "fail";
window.__TEST_RESULTS__ = { passed, total: tests.length, results };
