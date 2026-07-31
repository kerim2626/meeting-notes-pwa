// Интерфейс «Блокнота встреч»: список, просмотр, редактор, поиск, настройки.
import { KINDS, humanDate, nowHM, todayISO, toMarkdown, validate } from "./model.js";
import { FileStore, currentMode, openStore, switchStore } from "./stores/index.js";
import { DEMO_NOTES } from "./demo.js";

const $view = document.getElementById("view");
const $title = document.getElementById("title");
const $badge = document.getElementById("storage-badge");
let store = null;
let lastDeleted = null;

// ---------- утилиты DOM (текст пользователя только через textContent) ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

function toast(text, action) {
  const t = document.getElementById("toast");
  // replaceChildren превращает undefined в текст «undefined», поэтому пустые элементы отфильтровываются
  t.replaceChildren(...[h("span", {}, text),
    action && h("button", { onclick: () => { t.className = ""; action.fn(); } }, action.label)].filter(Boolean));
  t.className = "show";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ""), action ? 6000 : 2800);
}

function download(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function setHeader(title, back) {
  $title.replaceChildren(back ? h("a", { class: "back", href: back, "aria-label": "Назад" }, "‹") : "", title);
  $badge.textContent = store ? (store.name === "sqlite" ? "SQLite" : "Файлы") : "";
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("on", location.hash.startsWith(a.dataset.match)));
}

const draftKey = (id) => `notes.draft.${id || "new"}`;

// ---------- экраны ----------
function noteCard(n) {
  return h("a", { class: "note", href: `#/note/${encodeURIComponent(n.id)}` },
    h("div", { class: "note__top" }, h("span", { class: "time" }, n.time), h("span", { class: `chip chip--${n.kind}` }, KINDS[n.kind])),
    h("div", { class: "note__title" }, n.title),
    n.content && h("div", { class: "note__text" }, n.content.slice(0, 140)),
    n.participants && h("div", { class: "note__meta" }, "👥 ", n.participants));
}

function grouped(list) {
  const out = [];
  let day = null;
  for (const n of list) {
    if (n.date !== day) { day = n.date; out.push(h("h2", { class: "day" }, humanDate(day))); }
    out.push(noteCard(n));
  }
  return out;
}

async function listView() {
  setHeader("Блокнот встреч");
  const notes = await store.list();
  $view.replaceChildren(
    notes.length ? h("div", { class: "list" }, grouped(notes))
      : h("div", { class: "empty" }, h("div", { class: "empty__ico" }, "🗒"), h("p", {}, "Заметок пока нет."),
          h("p", { class: "muted" }, "Нажмите «+», чтобы записать итоги совещания или встречи.")),
    h("a", { class: "fab", href: "#/new", "aria-label": "Новая заметка" }, "+"));
}

async function noteView(id) {
  const n = await store.get(id);
  if (!n) { setHeader("Не найдено", "#/"); $view.replaceChildren(h("p", { class: "empty" }, "Заметка удалена или не существует.")); return; }
  setHeader("Заметка", "#/");
  $view.replaceChildren(h("article", { class: "card view" },
    h("div", { class: "note__top" }, h("span", { class: `chip chip--${n.kind}` }, KINDS[n.kind]),
      h("span", { class: "muted" }, `${humanDate(n.date)}, ${n.time}`)),
    h("h1", {}, n.title),
    n.place && h("p", { class: "meta" }, "📍 ", n.place),
    n.participants && h("p", { class: "meta" }, "👥 ", n.participants),
    h("div", { class: "content" }, n.content.split("\n").map((line) => h("p", {}, line))),
    h("p", { class: "muted small" }, "Изменено: ", new Date(n.updated_at).toLocaleString("ru-RU"))),
    h("div", { class: "actions" },
      h("a", { class: "btn", href: `#/edit/${encodeURIComponent(n.id)}` }, "✎ Изменить"),
      h("button", { class: "btn btn--ghost", onclick: () => share(n) }, "Поделиться"),
      h("button", { class: "btn btn--ghost", onclick: () => download(new Blob([toMarkdown(n)], { type: "text/markdown" }), `${n.date}_${n.title.slice(0, 40)}.md`) }, "Файл .md"),
      h("button", { class: "btn btn--danger", onclick: () => removeNote(n) }, "Удалить")));
}

async function share(n) {
  const text = toMarkdown(n);
  if (navigator.share) { try { await navigator.share({ title: n.title, text }); return; } catch { return; } }
  await navigator.clipboard?.writeText(text);
  toast("Текст заметки скопирован");
}

async function removeNote(n) {
  if (!confirm(`Удалить заметку «${n.title}»?`)) return;
  await store.remove(n.id);
  lastDeleted = n;
  location.hash = "#/";
  toast("Заметка удалена", { label: "Отменить", fn: async () => { await store.save(lastDeleted); lastDeleted = null; route(); } });
}

function field(label, input, error) {
  return h("label", { class: "field" }, h("span", {}, label), input, h("small", { class: "err", "data-for": input.name }, error || ""));
}

async function editView(id) {
  const existing = id ? await store.get(id) : null;
  if (id && !existing) { location.hash = "#/"; return; }
  setHeader(existing ? "Изменение" : "Новая заметка", existing ? `#/note/${encodeURIComponent(id)}` : "#/");
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(draftKey(id)) || "null"); } catch { /* нет черновика */ }
  const v = draft || existing || { title: "", date: todayISO(), time: nowHM(), kind: "meeting", place: "", participants: "", content: "" };
  const form = h("form", { class: "card form", novalidate: true },
    draft && h("p", { class: "notice" }, "Восстановлен несохраненный черновик. ",
      h("button", { type: "button", class: "link", onclick: () => { localStorage.removeItem(draftKey(id)); editView(id); } }, "Отбросить")),
    field("Заголовок", h("input", { name: "title", value: v.title, maxlength: 120, placeholder: "Например: Планерка департамента", autocomplete: "off" })),
    h("div", { class: "row" },
      field("Дата", h("input", { type: "date", name: "date", value: v.date })),
      field("Время", h("input", { type: "time", name: "time", value: v.time }))),
    field("Тип мероприятия", h("select", { name: "kind" }, Object.entries(KINDS).map(([k, t]) => h("option", { value: k, selected: k === v.kind }, t)))),
    field("Место", h("input", { name: "place", value: v.place, maxlength: 120, placeholder: "Переговорная, адрес или ссылка" })),
    field("Участники", h("input", { name: "participants", value: v.participants, maxlength: 300, placeholder: "Через запятую" })),
    field("Содержание", h("textarea", { name: "content", rows: 9, placeholder: "Повестка, решения, ответственные и сроки" }, v.content)),
    h("div", { class: "actions sticky" },
      h("button", { class: "btn btn--wide" }, "Сохранить"),
      h("a", { class: "btn btn--ghost", href: existing ? `#/note/${encodeURIComponent(id)}` : "#/",
        onclick: () => localStorage.removeItem(draftKey(id)) }, "Отмена")));
  form.addEventListener("input", (e) => {
    const err = form.querySelector(`.err[data-for="${e.target.name}"]`);
    if (err) err.textContent = "";                       // подсказка об ошибке исчезает при исправлении поля
    try { localStorage.setItem(draftKey(id), JSON.stringify(Object.fromEntries(new FormData(form)))); } catch { /* нет места */ }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { note, errors, ok } = validate(Object.fromEntries(new FormData(form)), existing);
    form.querySelectorAll(".err").forEach((s) => (s.textContent = errors[s.dataset.for] || ""));
    if (!ok) { form.querySelector(`[name=${Object.keys(errors)[0]}]`).focus(); return; }
    await store.save(note);
    localStorage.removeItem(draftKey(id));
    toast(existing ? "Изменения сохранены" : "Заметка сохранена");
    location.hash = `#/note/${encodeURIComponent(note.id)}`;
  });
  $view.replaceChildren(form);
  if (!existing && !draft) form.querySelector("[name=title]").focus();
}

const searchState = { words: "", dateFrom: "", dateTo: "", timeFrom: "", timeTo: "", kind: "" };

async function searchView() {
  setHeader("Поиск");
  const results = h("div", { class: "list" });
  const counter = h("p", { class: "muted small" });
  const form = h("form", { class: "card form search" },
    h("input", { type: "search", name: "words", value: searchState.words, placeholder: "Слова из заголовка, текста или участников", "aria-label": "Ключевые слова" }),
    h("div", { class: "row" },
      field("Дата с", h("input", { type: "date", name: "dateFrom", value: searchState.dateFrom })),
      field("по", h("input", { type: "date", name: "dateTo", value: searchState.dateTo }))),
    h("div", { class: "row" },
      field("Время с", h("input", { type: "time", name: "timeFrom", value: searchState.timeFrom })),
      field("до", h("input", { type: "time", name: "timeTo", value: searchState.timeTo }))),
    field("Тип", h("select", { name: "kind" }, h("option", { value: "" }, "Любой"),
      Object.entries(KINDS).map(([k, t]) => h("option", { value: k, selected: k === searchState.kind }, t)))),
    h("button", { type: "button", class: "link", onclick: () => { Object.keys(searchState).forEach((k) => (searchState[k] = "")); searchView(); } }, "Сбросить фильтры"));
  const run = async () => {
    Object.assign(searchState, Object.fromEntries(new FormData(form)));
    const found = await store.search(searchState);
    const active = Object.values(searchState).some(Boolean);
    counter.textContent = active ? `Найдено: ${found.length}` : `Все заметки: ${found.length}`;
    results.replaceChildren(...(found.length ? grouped(found) : [h("p", { class: "empty" }, "Ничего не найдено. Измените условия поиска.")]));
  };
  form.addEventListener("input", () => { clearTimeout(run.t); run.t = setTimeout(run, 200); });
  form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
  $view.replaceChildren(form, counter, results);
  await run();
}

async function settingsView() {
  setHeader("Настройки");
  const count = (await store.list()).length;
  const filesOk = FileStore.supported();
  const choice = (mode, title, descr, disabled) => h("label", { class: `option ${store.name === mode ? "option--on" : ""}` },
    h("input", { type: "radio", name: "mode", value: mode, checked: store.name === mode, disabled }),
    h("span", {}, h("b", {}, title), h("small", {}, descr)));
  const modeForm = h("form", { class: "card form" },
    h("h2", {}, "Где хранить заметки"),
    choice("sqlite", "База данных SQLite", "Локальная база в браузере (sql.js). Можно выгрузить файл .sqlite.", false),
    choice("files", "Файлы на устройстве", filesOk ? "Каждая заметка — отдельный JSON-файл в хранилище приложения (OPFS)." : "Не поддерживается этим браузером", !filesOk),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "migrate", checked: true }), " Перенести существующие заметки"),
    h("button", { class: "btn" }, "Применить"));
  modeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(modeForm);
    const mode = fd.get("mode");
    if (mode === store.name) return toast("Это хранилище уже выбрано");
    try {
      store = await switchStore(store, mode, fd.get("migrate") === "on");
      toast(`Хранилище: ${store.title}`);
      settingsView();
    } catch (err) { toast(err.message); }
  });
  const importInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        let added = 0;
        for (const raw of data.notes || []) {
          const { note, ok } = validate(raw, raw);
          if (ok) { note.updated_at = raw.updated_at || note.updated_at; await store.save(note); added++; }
        }
        toast(`Импортировано заметок: ${added}`);
        settingsView();
      } catch { toast("Файл не похож на резервную копию заметок"); }
    } });
  $view.replaceChildren(modeForm,
    h("section", { class: "card form" }, h("h2", {}, "Резервная копия и синхронизация"),
      h("p", { class: "muted small" }, `Заметок в текущем хранилище: ${count}. Файл копии можно положить в облачный диск и загрузить на другом устройстве.`),
      h("div", { class: "actions" },
        h("button", { class: "btn btn--ghost", onclick: async () => download(new Blob([JSON.stringify({ app: "meeting-notes", version: 1, exported_at: new Date().toISOString(), notes: await store.list() }, null, 2)], { type: "application/json" }), `notes-backup-${todayISO()}.json`) }, "Выгрузить JSON"),
        h("button", { class: "btn btn--ghost", onclick: () => importInput.click() }, "Загрузить JSON"), importInput,
        store.name === "sqlite" && h("button", { class: "btn btn--ghost", onclick: () => download(store.exportFile(), "notes.sqlite") }, "Файл .sqlite"))),
    h("section", { class: "card form" }, h("h2", {}, "Демонстрация"),
      h("p", { class: "muted small" }, "Добавить 8 примерных заметок, чтобы проверить поиск и фильтры."),
      h("div", { class: "actions" },
        h("button", { class: "btn btn--ghost", onclick: async () => { for (const n of DEMO_NOTES()) await store.save(n); toast("Примеры добавлены"); location.hash = "#/"; } }, "Добавить примеры"),
        h("button", { class: "btn btn--danger", onclick: async () => { if (confirm("Удалить все заметки в текущем хранилище?")) { await store.clear(); toast("Хранилище очищено"); settingsView(); } } }, "Удалить все"))),
    h("p", { class: "muted small center" }, "Блокнот встреч 1.1 · работает офлайн после первого запуска"));
}

// ---------- маршрутизация ----------
async function route() {
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/(note|edit)\/(.+)$/);
  try {
    if (hash === "#/" || hash === "#") await listView();
    else if (hash === "#/new") await editView(null);
    else if (m && m[1] === "note") await noteView(decodeURIComponent(m[2]));
    else if (m && m[1] === "edit") await editView(decodeURIComponent(m[2]));
    else if (hash === "#/search") await searchView();
    else if (hash === "#/settings") await settingsView();
    else location.hash = "#/";
  } catch (err) {
    console.error(err);
    $view.replaceChildren(h("div", { class: "empty" }, h("p", {}, "Ошибка: ", err.message)));
  }
  window.scrollTo(0, 0);
}

async function start() {
  try {
    store = await openStore(currentMode());
  } catch (err) {
    console.warn(err);
    store = await openStore(currentMode() === "files" ? "sqlite" : "files");   // запасное хранилище
    toast(`Основное хранилище недоступно, используется: ${store.title}`);
  }
  navigator.storage?.persist?.();
  window.addEventListener("hashchange", route);
  await route();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
start();
