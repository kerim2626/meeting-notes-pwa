// Запись файла заметки в OPFS через синхронный дескриптор (резервный путь для Safari).
self.onmessage = async (e) => {
  const { id, name, text } = e.data;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("notes", { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    const access = await handle.createSyncAccessHandle();
    const bytes = new TextEncoder().encode(text);
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.flush();
    access.close();
    self.postMessage({ id, ok: true });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
