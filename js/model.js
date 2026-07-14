// Модель заметки: проверка полей, нормализация текста для поиска, фильтрация и сортировка.

export const KINDS = {
  meeting: "Совещание",
  assembly: "Собрание",
  conference: "Конференция",
  business: "Деловая встреча",
  other: "Другое",
};

const pad = (n) => String(n).padStart(2, "0");

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowHM(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Строка для поиска: нижний регистр с учетом кириллицы, ё → е. */
export function normalize(text) {
  return String(text || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function searchText(note) {
  return normalize([note.title, note.content, note.place, note.participants, KINDS[note.kind]].join(" "));
}

/** Проверка и приведение полей. Возвращает {note, errors}. */
export function validate(input, existing = null) {
  const errors = {};
  const title = String(input.title || "").trim();
  const date = String(input.date || "");
  const time = String(input.time || "");
  if (!title) errors.title = "Укажите заголовок";
  else if (title.length > 120) errors.title = "Не длиннее 120 символов";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) errors.date = "Укажите дату";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = "Время в формате ЧЧ:ММ";
  const kind = KINDS[input.kind] ? input.kind : "other";
  const content = String(input.content || "");
  if (content.length > 20000) errors.content = "Текст не длиннее 20 000 символов";
  const stamp = new Date().toISOString();
  const note = {
    id: existing?.id || input.id || uuid(),
    title, date, time, kind,
    place: String(input.place || "").trim().slice(0, 120),
    participants: String(input.participants || "").trim().slice(0, 300),
    content,
    created_at: existing?.created_at || input.created_at || stamp,
    updated_at: stamp,
  };
  return { note, errors, ok: Object.keys(errors).length === 0 };
}

/** Критерии поиска: слова (все должны встретиться), диапазон дат, диапазон времени, тип мероприятия. */
export function matches(note, q = {}) {
  if (q.words) {
    const hay = searchText(note);
    for (const w of normalize(q.words).split(" ").filter(Boolean)) if (!hay.includes(w)) return false;
  }
  if (q.dateFrom && note.date < q.dateFrom) return false;
  if (q.dateTo && note.date > q.dateTo) return false;
  if (q.timeFrom && note.time < q.timeFrom) return false;
  if (q.timeTo && note.time > q.timeTo) return false;
  if (q.kind && note.kind !== q.kind) return false;
  return true;
}

export function sortNotes(list) {
  return list.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time) || b.updated_at.localeCompare(a.updated_at));
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
  "ноября", "декабря"];

export function humanDate(iso, today = todayISO()) {
  if (iso === today) return "Сегодня";
  const t = new Date(today); t.setDate(t.getDate() - 1);
  if (iso === todayISO(t)) return "Вчера";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${String(y) === today.slice(0, 4) ? "" : " " + y}`;
}

export function toMarkdown(n) {
  const lines = [`# ${n.title}`, "", `- Дата и время: ${n.date} ${n.time}`, `- Тип: ${KINDS[n.kind]}`];
  if (n.place) lines.push(`- Место: ${n.place}`);
  if (n.participants) lines.push(`- Участники: ${n.participants}`);
  lines.push("", n.content, "");
  return lines.join("\n");
}
