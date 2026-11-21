import {
  getAuth,
  sendPasswordResetEmail
} from "./auth.js";
import { authErrorMessage } from "./auth-flow.js";
import { bindFormAction } from "./utils/buttonManager.js";

const auth = getAuth();
const resetPasswordForm = document.getElementById("resetPasswordForm");
const emailInput = document.getElementById("email");

function buildActionCodeSettings() {
  const origin = window.location.origin;
  // file:// ou origine invalide → laisser Firebase gérer le lien par défaut
  if (!origin || origin === "null" || origin.startsWith("file:")) {
    return undefined;
  }

  return {
    url: `${origin}/login.html`,
    handleCodeInApp: false
  };
}

bindFormAction(resetPasswordForm, async () => {
  const email = emailInput?.value.trim().toLowerCase() || "";

  if (!email) {
    alert("Veuillez entrer votre adresse email.");
    return;
  }

  if (window.location.protocol === "file:") {
    alert("Ouvre l'app via HTTPS (Firebase Hosting), pas en fichier local.");
    return;
  }

  try {
    const actionCodeSettings = buildActionCodeSettings();

    if (actionCodeSettings) {
      await sendPasswordResetEmail(auth, email, actionCodeSettings);
    } else {
      await sendPasswordResetEmail(auth, email);
    }

    alert(
      "Si un compte Email/Password existe pour cet email, un lien de réinitialisation a été envoyé. Vérifie aussi les spams."
    );
    window.location.replace("login.html");
  } catch (error) {
    console.error("[reset-password]", error?.code || error?.message, error);
    alert(
      authErrorMessage(
        error,
        error?.message || "Erreur lors de l'envoi du lien de réinitialisation."
      )
    );
  }
});
