// Camada de armazenamento local — guarda um único blob criptografado (AES-256-GCM)
// em IndexedDB, com fallback automático para localStorage se IndexedDB não estiver disponível.
// Nada é salvo em texto puro; nada sai do dispositivo por esta camada.
const AppStorage = (function () {
  const DB_NAME = 'orcamento_familiar_db';
  const STORE = 'vault';
  const KEY = 'vault_v1';
  let cachedKey = null;

  function hasIndexedDB() {
    return typeof indexedDB !== 'undefined';
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

  async function idbGet(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(db, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function readRaw() {
    if (hasIndexedDB()) {
      try {
        const db = await openDB();
        const val = await idbGet(db);
        if (val) return val;
      } catch (e) { /* cai para localStorage */ }
    }
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  }

  async function writeRaw(value) {
    if (hasIndexedDB()) {
      try {
        const db = await openDB();
        await idbSet(db, value);
        return;
      } catch (e) { /* cai para localStorage */ }
    }
    localStorage.setItem(KEY, JSON.stringify(value));
  }

  async function hasVault() {
    const raw = await readRaw();
    return !!(raw && raw.salt && raw.payload);
  }

  async function createVault(pin, initialState) {
    const salt = AppCrypto.randomSaltB64();
    const key = await AppCrypto.deriveKey(pin, salt);
    const payload = await AppCrypto.encryptJSON(key, initialState);
    await writeRaw({ salt, payload, verificador: await AppCrypto.encryptJSON(key, { ok: true }), atualizadoEm: new Date().toISOString() });
    cachedKey = key;
    return initialState;
  }

  async function unlockVault(pin) {
    const raw = await readRaw();
    if (!raw) throw new Error('Nenhum cofre encontrado — é preciso configurar o app primeiro.');
    return unlockVaultFromRaw(pin, raw);
  }

  async function unlockVaultFromRaw(pin, raw) {
    const key = await AppCrypto.deriveKey(pin, raw.salt);
    try {
      await AppCrypto.decryptJSON(key, raw.verificador);
    } catch (e) {
      throw new Error('PIN incorreto.');
    }
    const state = await AppCrypto.decryptJSON(key, raw.payload);
    cachedKey = key;
    return state;
  }

  async function saveState(state) {
    if (!cachedKey) throw new Error('Cofre bloqueado — não é possível salvar sem desbloquear.');
    const raw = await readRaw();
    const payload = await AppCrypto.encryptJSON(cachedKey, state);
    await writeRaw(Object.assign({}, raw, { payload, atualizadoEm: new Date().toISOString() }));
  }

  async function getRaw() { return readRaw(); }
  async function adoptRaw(rawObj) { await writeRaw(rawObj); }

  function lock() { cachedKey = null; }
  function isUnlocked() { return !!cachedKey; }

  async function exportBackup(pin) {
    const raw = await readRaw();
    if (!raw) throw new Error('Nada para exportar ainda.');
    return JSON.stringify({ tipo: 'orcamento_familiar_backup', versao: 1, dados: raw });
  }

  async function importBackup(jsonText) {
    const parsed = JSON.parse(jsonText);
    if (!parsed || parsed.tipo !== 'orcamento_familiar_backup' || !parsed.dados) {
      throw new Error('Arquivo de backup inválido.');
    }
    await writeRaw(parsed.dados);
  }

  return { hasVault, createVault, unlockVault, unlockVaultFromRaw, saveState, lock, isUnlocked, exportBackup, importBackup, getRaw, adoptRaw };
})();
