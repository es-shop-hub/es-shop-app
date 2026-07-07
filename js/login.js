import "./firebase.js";

import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  getAuth,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "./auth.js";

import {
  isAllowedRole,
  loadUserProfile,
  completeLogin,
  ensureFirestoreUser,
  waitForAuthReady,
  authErrorMessage
} from "./auth-flow.js";

import { initPasswordToggles } from "./password-toggle.js";
import { bindFormAction, bindActionButton } from "./utils/buttonManager.js";

const auth = getAuth();
const googleProvider = new GoogleAuthProvider();

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const rememberMeCheckbox = document.getElementById("rememberMe");
const googleLoginBtn = document.getElementById("googleLoginBtn");

initPasswordToggles();

async function redirectAfterLogin(userData, action) {
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

  await completeLogin(userData.userId || userData.id, userData.role, action);
  window.location.replace("index.html");
}

bindFormAction(loginForm, async () => {

  const email = emailInput?.value.trim().toLowerCase() || "";
  const password = passwordInput?.value || "";

  if (!email || !password) {
    alert("Remplis tous les champs");
    return;
  }

  try {
    await setPersistence(
      auth,
      rememberMeCheckbox?.checked
        ? browserLocalPersistence
        : browserSessionPersistence
    );

    console.log("[login] signInWithEmailAndPassword", { email });
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    await waitForAuthReady(auth, userCredential.user.uid);
    console.log("[login] Auth OK, uid:", userCredential.user.uid);

    console.log("[login] getDoc users/", userCredential.user.uid);
    const userData = await loadUserProfile(userCredential.user.uid);

    if (!userData) {
      await signOut(auth);
      alert("Utilisateur non configuré dans Firestore");
      return;
    }

    await redirectAfterLogin(userData, "login");
  } catch (err) {
    console.error("[login] erreur:", err?.code || err?.message, err);
    alert(authErrorMessage(err, "Erreur de connexion"));
  }
});

async function handleGoogleLogin() {
  try {
    await setPersistence(auth, browserLocalPersistence);

    console.log("[login] signInWithPopup Google");
    const result = await signInWithPopup(auth, googleProvider);
    await waitForAuthReady(auth, result.user.uid);
    console.log("[login] Google OK, uid:", result.user.uid);

    console.log("[login] getDoc users/", result.user.uid);
    let userData = await loadUserProfile(result.user.uid);

    if (!userData) {
      console.log("[login] profil absent → ensureFirestoreUser");
      userData = await ensureFirestoreUser(result.user, { isActive: true });
    }

    await redirectAfterLogin(userData, "google_login");
  } catch (err) {
    console.error("[login] Google erreur:", err?.code || err?.message, err);
    alert(authErrorMessage(err, "Erreur connexion Google"));
  }
}

bindActionButton(googleLoginBtn, handleGoogleLogin);
