// Módulo de sincronização entre aparelhos — usa a File System Access API do
// navegador para ler/escrever um arquivo DENTRO da pasta que o OneDrive já
// sincroniza. Não usa nenhum servidor, nenhuma conta na nuvem nova, nenhuma
// senha de terceiros: o OneDrive já faz o trabalho de levar o arquivo entre
// os aparelhos, do jeito que já faz com qualquer outro arquivo seu.
//
// O conteúdo escrito é sempre o mesmo formato do backup criptografado — nada
// muda na segurança: quem abrir o arquivo sem o PIN não lê nada.
const AppSync = (function () {
  const DB_NAME = 'orcamento_familiar_sync_db';
  const STORE = 'handles';
  const KEY = 'sync_handle_v1';

  function supported() {
    return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getHandle() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return null; }
  }

  async function setHandle(handle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearHandle() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function ensurePermission(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  async function pickNewFile() {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'dados-sincronizados.kfsync',
      types: [{ description: 'Dados sincronizados do app', accept: { 'application/json': ['.kfsync'] } }],
    });
    await setHandle(handle);
    return handle;
  }

  async function pickExistingFile() {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Dados sincronizados do app', accept: { 'application/json': ['.kfsync'] } }],
    });
    await setHandle(handle);
    return handle;
  }

  async function write(rawObj) {
    const handle = await getHandle();
    if (!handle) return false;
    if (!(await ensurePermission(handle))) return false;
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(rawObj));
    await writable.close();
    return true;
  }

  async function read() {
    const handle = await getHandle();
    if (!handle) return null;
    if (!(await ensurePermission(handle))) return null;
    const file = await handle.getFile();
    const text = await file.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  async function readFromHandle(handle) {
    if (!(await ensurePermission(handle))) throw new Error('Permissão negada para ler o arquivo.');
    const file = await handle.getFile();
    const text = await file.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  async function isEnabled() { return !!(await getHandle()); }
  async function disable() { await clearHandle(); }
  async function nomeArquivo() {
    const h = await getHandle();
    return h ? h.name : null;
  }

  return { supported, pickNewFile, pickExistingFile, write, read, readFromHandle, isEnabled, disable, nomeArquivo };
})();

// Módulo de sincronização por REDE LOCAL — usado quando o app é aberto pelo
// endereço do servidor local (sync-servidor.py), em vez de aberto como
// arquivo. Não depende de seletor de arquivo nem de OneDrive: o navegador
// simplesmente conversa com o próprio notebook pela rede Wi-Fi de casa.
// Se o app não estiver sendo servido por esse servidor (uso normal via
// arquivo, ou via GitHub Pages), tudo aqui fica inativo silenciosamente.
const AppLanSync = (function () {
  let available = false;
  let detectPromise = null;

  // Guarda a MESMA promise em andamento para qualquer chamada concorrente —
  // evita que duas telas checando ao mesmo tempo (ex.: onboarding chamando
  // isso duas vezes rapidamente) peguem um resultado errado antes da
  // primeira checagem terminar de verdade.
  function detect() {
    if (!detectPromise) {
      detectPromise = (async () => {
        try {
          const r = await fetch('/api/sync', { cache: 'no-store' });
          available = !!(r && r.ok);
        } catch (e) {
          available = false;
        }
        return available;
      })();
    }
    return detectPromise;
  }

  function isAvailable() { return available; }

  async function pull() {
    try {
      const r = await fetch('/api/sync', { cache: 'no-store' });
      if (!r.ok) return null;
      const data = await r.json();
      if (!data || !data.atualizadoEm) return null;
      return data;
    } catch (e) { return null; }
  }

  async function push(rawObj) {
    try {
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawObj),
      });
      return !!(r && r.ok);
    } catch (e) { return false; }
  }

  return { detect, isAvailable, pull, push };
})();
