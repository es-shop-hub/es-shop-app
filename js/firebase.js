// firebase.js offline 
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,

  collection,
  addDoc,
  getDocs,
  setDoc,
  updateDoc,
  orderBy,
  deleteDoc,
  doc,
  getDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
  runTransaction,
  writeBatch,
  increment,
  arrayUnion,
  limit,
  onSnapshot

} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD8_86DgCqPdwVNy1ww6PPz0TM5lVMWm_s",
  authDomain: "es-shop-db.firebaseapp.com",
  projectId: "es-shop-db",
  storageBucket: "es-shop-db.firebasestorage.app",
  messagingSenderId: "750093706451",
  appId: "1:750093706451:web:62f0aa0891d0ed0ed96026",
  measurementId: "G-TM3YYR5ZH7"
};
 
const app = initializeApp(firebaseConfig);

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

const enableIndexedDbPersistence = async () => true;

async function writeLog(entry = {}) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  try {
    const docRef = await addDoc(collection(db, "logs"), {
      createdAt: Timestamp.now(),
      ...entry
    });
    return docRef.id;
  } catch (err) {
    console.error("writeLog failed:", err?.code || err?.message || err, entry?.action);
    try {
      const failed = JSON.parse(sessionStorage.getItem("failed_logs_v1") || "[]");
      failed.push({
        at: Date.now(),
        action: entry?.action || null,
        message: err?.message || String(err)
      });
      sessionStorage.setItem(
        "failed_logs_v1",
        JSON.stringify(failed.slice(-20))
      );
    } catch (_) {
      /* ignore storage errors */
    }
    return null;
  }
}

export {
  app,
  db,
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
  runTransaction,
  limit,
  orderBy,
  onSnapshot,
  writeBatch,
  increment,
  arrayUnion,
  enableIndexedDbPersistence,
  writeLog
};
