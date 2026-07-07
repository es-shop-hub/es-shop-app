import {
  db,
  doc,
  Timestamp,
  writeBatch,
  writeLog
} from "./firebase.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "./auth.js";

import {
  ensureFirestoreUser,
  ensureSystemMeta,
  completeLogin,
  isAllowedRole,
  waitForAuthReady,
  authErrorMessage
} from "./auth-flow.js";

import { initPasswordToggles } from "./password-toggle.js";
import { bindFormAction, bindActionButton } from "./utils/buttonManager.js";

const auth = getAuth();
const signupForm = document.getElementById("signupForm");
const googleSignupBtn = document.getElementById("googleSignupBtn");
const googleProvider = new GoogleAuthProvider();

initPasswordToggles();

bindFormAction(signupForm, async () => {

  const fullName = document.getElementById("fullName")?.value.trim();
  const email = document.getElementById("email")?.value.trim().toLowerCase();
  const password = document.getElementById("password")?.value;
  const isActive = document.getElementById("isActive")?.checked ?? true;

  if (!fullName || !email || !password) {
    alert("Remplis tous les champs");
    return;
  }

  if (password.length < 6) {
    alert("Mot de passe trop court (6 caractères minimum)");
    return;
  }

  try {
    console.log("[signup] createUserWithEmailAndPassword", { email });
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    await waitForAuthReady(auth, uid);
    console.log("[signup] Auth OK, uid:", uid);

    const { metaRef, usersCount, maxUsers } = await ensureSystemMeta();

    if (usersCount >= maxUsers) {
      await signOut(auth);
      throw new Error("user_limit");
    }

    const batch = writeBatch(db);

    console.log("[signup] batch.set users/", uid);
    batch.set(doc(db, "users", uid), {
      userId: uid,
      name: fullName,
      email,
      role: "seller",
      isActive,
      createdAt: Timestamp.now()
    });

    console.log("[signup] batch.update system/meta usersCount:", usersCount + 1);
    batch.update(metaRef, {
      usersCount: usersCount + 1
    });

    await batch.commit();
    console.log("[signup] batch.commit OK");

    await writeLog({
      userId: uid,
      action: "signup",
      details: { email, role: "seller" }
    });

    await signOut(auth);
    alert("Compte créé ! Connectez-vous.");
    window.location.replace("login.html");
  } catch (err) {
    console.error("[signup] erreur:", err?.code || err?.message, err);
    alert(authErrorMessage(err, "Erreur création compte"));
  }
});

bindActionButton(googleSignupBtn, async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);

    console.log("[signup] signInWithPopup Google");
    const result = await signInWithPopup(auth, googleProvider);
    await waitForAuthReady(auth, result.user.uid);
    console.log("[signup] Google OK, uid:", result.user.uid);

    const isActive = document.getElementById("isActive")?.checked ?? true;
    const userData = await ensureFirestoreUser(result.user, { isActive });

    if (!userData?.isActive) {
      await signOut(auth);
      alert("Compte désactivé");
      return;
    }

    if (!isAllowedRole(userData.role)) {
      await signOut(auth);
      alert("Accès refusé : rôle non autorisé");
      return;
    }

    await completeLogin(userData.userId || userData.id, userData.role, "google_signup");
    window.location.replace("index.html");
  } catch (err) {
    console.error("[signup] Google erreur:", err?.code || err?.message, err);
    alert(authErrorMessage(err, "Erreur inscription Google"));
  }
});
