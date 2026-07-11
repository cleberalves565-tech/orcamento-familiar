// Módulo de criptografia local — PBKDF2 (derivação de chave) + AES-256-GCM (cifra)
// Nada aqui envia dados para fora do dispositivo. Testado em Node com globalThis.crypto.subtle
// e funciona de forma idêntica no navegador (window.crypto.subtle).
const AppCrypto = (function () {
  const subtle = crypto.subtle;

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function randomSaltB64() {
    return bufToB64(crypto.getRandomValues(new Uint8Array(16)));
  }

  async function deriveKey(pin, saltB64) {
    const salt = b64ToBuf(saltB64);
    const enc = new TextEncoder();
    const baseKey = await subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJSON(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const data = enc.encode(JSON.stringify(obj));
    const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv: bufToB64(iv), data: bufToB64(cipher) };
  }

  async function decryptJSON(key, payload) {
    const iv = b64ToBuf(payload.iv);
    const data = b64ToBuf(payload.data);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  return { randomSaltB64, deriveKey, encryptJSON, decryptJSON, bufToB64, b64ToBuf };
})();
