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

// Módulo de sincronização pela INTERNET, usando um Gist privado da própria
// conta do GitHub do usuário como intermediário. Diferente da rede local, não
// depende de estar na mesma Wi-Fi nem de um servidor rodando no notebook —
// troca dados com o GitHub por HTTPS comum, do mesmo jeito que o navegador já
// carrega o site do GitHub Pages (funciona de qualquer lugar, não só em casa).
// O conteúdo salvo é sempre o mesmo pacote criptografado dos outros métodos
// de sincronização — o GitHub nunca vê os dados em texto claro, só quem tem
// o PIN consegue abrir. O único segredo novo é o token de acesso, guardado
// só neste aparelho (localStorage), nunca dentro do cofre sincronizado.
const AppGithubSync = (function () {
  const TOKEN_KEY = 'of_gh_token_v1';
  const GISTID_KEY = 'of_gh_gistid_v1';
  const GIST_DESC = 'orcamento-familiar-sync-nao-apagar';
  const FILE_NAME = 'dados-sincronizados.json';
  const API = 'https://api.github.com';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t.trim());
      else localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(GISTID_KEY);
    } catch (e) { /* navegador sem localStorage — recurso fica indisponível */ }
  }
  function getGistId() {
    try { return localStorage.getItem(GISTID_KEY) || ''; } catch (e) { return ''; }
  }
  function setGistId(id) {
    try { localStorage.setItem(GISTID_KEY, id); } catch (e) { /* ignora */ }
  }

  function isConfigured() { return !!getToken(); }
  function isAvailable() { return isConfigured(); }

  function authHeaders(token) {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    };
  }

  // Acha o Gist já usado por este app (identificado pela descrição fixa
  // abaixo, não pelo nome — assim qualquer aparelho com o mesmo token acha o
  // mesmo Gist sozinho, sem precisar copiar nenhum ID entre os aparelhos).
  // Se não existir ainda, cria um novo automaticamente.
  async function resolveGistId(token) {
    let id = getGistId();
    if (id) {
      const r = await fetch(API + '/gists/' + id, { headers: authHeaders(token) });
      if (r.ok) return id;
      // o gist salvo não existe mais (ex.: apagado manualmente) — esquece e procura de novo
    }
    const listResp = await fetch(API + '/gists?per_page=100', { headers: authHeaders(token) });
    if (!listResp.ok) {
      if (listResp.status === 401) throw new Error('Token do GitHub inválido ou expirado.');
      throw new Error('Não foi possível acessar sua conta do GitHub.');
    }
    const list = await listResp.json();
    const found = Array.isArray(list) ? list.find(g => g.description === GIST_DESC) : null;
    if (found) { setGistId(found.id); return found.id; }
    const createResp = await fetch(API + '/gists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        description: GIST_DESC,
        public: false,
        files: { [FILE_NAME]: { content: JSON.stringify({ atualizadoEm: null }) } },
      }),
    });
    if (!createResp.ok) throw new Error('Não foi possível criar o espaço de sincronização no GitHub.');
    const created = await createResp.json();
    setGistId(created.id);
    return created.id;
  }

  // Valida o token e já resolve/cria o Gist, para dar erro na hora se algo
  // estiver errado (token digitado errado, sem permissão, etc.) em vez de só
  // falhar silenciosamente depois.
  async function testToken(token) {
    const t = (token || '').trim();
    if (!t) throw new Error('Cole o token antes de continuar.');
    const check = await fetch(API + '/user', { headers: authHeaders(t) });
    if (!check.ok) throw new Error('Token inválido — confira se copiou certo e se deu a permissão de Gists.');
    setToken(t);
    await resolveGistId(t);
    return true;
  }

  async function pull() {
    const token = getToken();
    if (!token) return null;
    const id = await resolveGistId(token);
    const r = await fetch(API + '/gists/' + id, { headers: authHeaders(token) });
    if (!r.ok) throw new Error('Não foi possível buscar os dados no GitHub.');
    const data = await r.json();
    const file = data.files && data.files[FILE_NAME];
    if (!file || !file.content) return null;
    try {
      const parsed = JSON.parse(file.content);
      if (!parsed || !parsed.atualizadoEm) return null;
      return parsed;
    } catch (e) { return null; }
  }

  async function push(rawObj) {
    const token = getToken();
    if (!token) return false;
    const id = await resolveGistId(token);
    const r = await fetch(API + '/gists/' + id, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ files: { [FILE_NAME]: { content: JSON.stringify(rawObj) } } }),
    });
    if (!r.ok) throw new Error('Não foi possível salvar os dados no GitHub.');
    return true;
  }

  function desconectar() { setToken(''); }

  return { getToken, setToken, isConfigured, isAvailable, testToken, pull, push, desconectar };
})();
