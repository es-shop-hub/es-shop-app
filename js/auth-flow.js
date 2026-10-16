import {
  db,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  Timestamp,
  writeLog
} from "./firebase.js";
import { getAuth, signOut, onAuthStateChanged } from "./auth.js";

const MAX_USERS = 5;
const auth = getAuth();

export function isAllowedRole(role) {
  return role === "admin" || role === "seller";
}

export function storeSession(uid, role) {
  localStorage.setItem("userId", uid);
  localStorage.setItem("userRole", role);
}

export function waitForAuthReady(authInstance = auth, expectedUid = null) {
  return new Promise((resolve, reject) => {
    const tryResolve = user => {
      if (!user) {
        return false;
      }
      if (expectedUid && user.uid !== expectedUid) {
        return false;
      }
      resolve(user);
      return true;
    };

    if (tryResolve(authInstance.currentUser)) {
      return;
    }

    const timeoutId = setTimeout(() => {
      unsub();
      reject(new Error("auth_not_ready"));
    }, 15000);

    const unsub = onAuthStateChanged(authInstance, user => {
      if (tryResolve(user)) {
        clearTimeout(timeoutId);
        unsub();
      }
    });
  });
}

export async function ensureSystemMeta() {
  const metaRef = doc(db, "system", "meta");
  console.log("[auth-flow] getDoc system/meta");
  const metaSnap = await getDoc(metaRef);

  if (metaSnap.exists()) {
    const data = metaSnap.data();
    return {
      metaRef,
      usersCount: Number(data.usersCount) || 0,
      maxUsers: Number(data.maxUsers) || MAX_USERS
    };
  }

  console.log("[auth-flow] system/meta absent → création { usersCount: 0, maxUsers: 5 }");
  const initial = { usersCount: 0, maxUsers: MAX_USERS };
  await setDoc(metaRef, initial);
  return { metaRef, usersCount: 0, maxUsers: MAX_USERS };
}

export async function loadUserProfile(uid) {
  console.log("[auth-flow] getDoc users/", uid);
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) {
    console.log("[auth-flow] profil introuvable users/", uid);
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

export async function completeLogin(uid, role, action) {
  storeSession(uid, role);
  await writeLog({
    userId: uid,
    action,
    role
  });
}

export async function ensureFirestoreUser(user, options = {}) {
  const isActive = options.isActive !== false;
  const uid = user.uid;

  await waitForAuthReady(auth, uid);

  const existing = await loadUserProfile(uid);
  if (existing) {
    return existing;
  }

  const { metaRef, usersCount, maxUsers } = await ensureSystemMeta();

  if (usersCount >= maxUsers) {
    await signOut(auth);
    throw new Error("user_limit");
  }

  const batch = writeBatch(db);

  const role = usersCount === 0 ? "admin" : "seller";

  console.log("[auth-flow] batch.set users/", uid, { role });
  batch.set(doc(db, "users", uid), {
    userId: uid,
    name: user.displayName || user.email?.split("@")[0] || "Utilisateur",
    email: (user.email || "").toLowerCase(),
    role,
    isActive,
    createdAt: Timestamp.now()
  });

  batch.update(metaRef, {
    usersCount: usersCount + 1
  });

  console.log("[auth-flow] batch.commit users/", uid);
  await batch.commit();

  return loadUserProfile(uid);
}

export function authErrorMessage(err, fallback = "Erreur") {
  const message = err?.message || "";

  if (message === "meta_missing") {
    return "Configuration system/meta manquante.";
  }

  if (message === "user_limit") {
    return `Limite atteinte : ${MAX_USERS} utilisateurs maximum.`;
  }

  if (message === "auth_not_ready") {
    return "Session non prête après connexion. Réessayez.";
  }

  const code = err?.code || "";

  if (code === "auth/invalid-email") return "Email invalide";
  if (code === "auth/invalid-credential") return "Email ou mot de passe incorrect";
  if (code === "auth/user-disabled") return "Compte désactivé";
  if (code === "auth/email-already-in-use") return "Email déjà utilisé";
  if (code === "auth/weak-password") return "Mot de passe trop faible (6 caractères min.)";
  if (code === "auth/network-request-failed") return "Pas de connexion internet";
  if (code === "auth/too-many-requests") return "Trop de tentatives. Réessayez plus tard";
  if (code === "auth/popup-closed-by-user") return "Connexion Google annulée";
  if (code === "auth/popup-blocked") return "Popup bloquée par le navigateur";
  if (code === "auth/cancelled-popup-request") return "Connexion Google annulée";
  if (code === "permission-denied") return "Accès refusé. Vérifiez les règles Firestore.";
  if (code === "meta_missing") return "Configuration system/meta manquante.";
  if (code === "user_limit") return `Limite atteinte : ${MAX_USERS} utilisateurs maximum.`;

  return fallback;
}
