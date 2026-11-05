import { auth } from './firebase.js';
import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebase/9.6.1/firebase-auth.js';

const resetPasswordForm = document.getElementById('resetPasswordForm');
const emailInput = document.getElementById('email');

if (resetPasswordForm) {
  resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();

    if (!email) {
      alert('Veuillez entrer votre adresse email.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      alert('Un lien de réinitialisation de mot de passe a été envoyé à votre adresse email.');
      window.location.href = 'login.html';
    } catch (error) {
      console.error('Erreur lors de l'envoi du lien de réinitialisation:', error);
      let errorMessage = 'Erreur lors de l'envoi du lien de réinitialisation.';
      switch (error.code) {
        case 'auth/invalid-email':
          errorMessage = 'L'adresse email est mal formatée.';
          break;
        case 'auth/user-not-found':
          errorMessage = 'Aucun utilisateur trouvé avec cette adresse email.';
          break;
        case 'auth/missing-email':
          errorMessage = 'Veuillez entrer une adresse email.';
          break;
        default:
          errorMessage = error.message;
          break;
      }
      alert(errorMessage);
    }
  });
}
