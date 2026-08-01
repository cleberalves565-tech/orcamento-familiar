// Módulo de sincronização via LOGIN COM GOOGLE (Firebase Authentication +
// Cloud Firestore). É a forma mais simples de manter notebook e celular
// atualizados: você entra com a mesma conta Google nos dois aparelhos, e cada
// um encontra os dados sozinho — sem token para copiar, sem arquivo para
// selecionar, sem depender da mesma rede Wi-Fi.
//
// O que é enviado para o Firestore é sempre o mesmo pacote já criptografado
// (o mesmo formato usado no arquivo local e nos outros métodos de
// sincronização) — o Google nunca vê os lançamentos de verdade, só quem tem
// o PIN consegue abrir.
//
// Este arquivo é um módulo ES (type="module") porque o SDK do Firebase é
// distribuído assim para uso direto no navegador, sem precisar de nenhuma
// ferramenta de build (webpack, npm etc.) — o resto do app continua sendo
// JavaScript comum.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Estas informações não são segredo — são feitas para ficar dentro do
// código do site (é assim que o próprio Firebase recomenda usar).
const firebaseConfig = {
  apiKey: "AIzaSyDoqbznzFRW95JGNsG9BxMaj8MT-CY5yoQ",
  authDomain: "budget-familiar-7e3e4.firebaseapp.com",
  projectId: "budget-familiar-7e3e4",
  storageBucket: "budget-familiar-7e3e4.firebasestorage.app",
  messagingSenderId: "687347482594",
  appId: "1:687347482594:web:4e4a529c4e95d6414c83bb",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

let currentUser = null;
let unsubscribeSnapshot = null;

function userDocRef(uid) {
  return doc(db, "users", uid);
}

// Assim que o Firebase confirmar (ou não) que já existe uma sessão salva
// neste navegador (de um login anterior), essa promise resolve — isso
// acontece sozinho, sem precisar clicar em nada de novo.
let resolveAuthReady;
const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });
let authReadyDone = false;
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!authReadyDone) { authReadyDone = true; resolveAuthReady(user); }
});

async function signIn() {
  const result = await signInWithPopup(auth, provider);
  currentUser = result.user;
  return currentUser;
}

async function signOutUser() {
  stopListening();
  await signOut(auth);
  currentUser = null;
}

function isSignedIn() { return !!currentUser; }
function getCurrentUser() { return currentUser; }

async function pull() {
  if (!currentUser) return null;
  const snap = await getDoc(userDocRef(currentUser.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data || !data.atualizadoEm) return null;
  return data;
}

async function push(rawObj) {
  if (!currentUser) return false;
  await setDoc(userDocRef(currentUser.uid), rawObj);
  return true;
}

// Escuta em tempo real — assim que o outro aparelho salvar algo, este
// callback dispara sozinho (sem precisar ficar checando de tempos em
// tempos, como nos outros métodos de sincronização).
function startListening(onChange) {
  stopListening();
  if (!currentUser) return;
  unsubscribeSnapshot = onSnapshot(userDocRef(currentUser.uid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data && data.atualizadoEm) onChange(data);
  }, () => { /* falha silenciosa — não interrompe o uso normal do app */ });
}

function stopListening() {
  if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
}

window.AppGoogleSync = {
  waitReady: () => authReady,
  signIn,
  signOutUser,
  isSignedIn,
  getCurrentUser,
  pull,
  push,
  startListening,
  stopListening,
};
