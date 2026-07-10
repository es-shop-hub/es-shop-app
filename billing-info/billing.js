import { db, doc, getDoc } from "../js/firebase.js";
import { getAuth, onAuthStateChanged } from "../js/auth.js";
import { bindActionButton } from "../js/utils/buttonManager.js";

const FIREBASE_PROJECT_ID = "es-shop-db";

const USAGE_URL = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/usage`;
const BILLING_URL = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/usage/billing`;

const accessDenied = document.getElementById("accessDenied");
const pageContent = document.getElementById("pageContent");
const btnUsageStats = document.getElementById("btnUsageStats");
const btnSecureBilling = document.getElementById("btnSecureBilling");

const auth = getAuth();

function showAccessDenied() {
  if (pageContent) pageContent.classList.add("hidden");
  if (accessDenied) accessDenied.classList.add("show");
}

function openExternal(url) {
  if (!url || typeof url !== "string") return;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function checkAdmin(uid) {
  if (!uid) return false;

  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) return false;

  const userData = userSnap.data();
  if (!userData?.isActive) return false;

  return userData.role === "admin";
}

bindActionButton(btnUsageStats, () => {
  openExternal(USAGE_URL);
});

bindActionButton(btnSecureBilling, () => {
  openExternal(BILLING_URL);
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  try {
    const isAdmin = await checkAdmin(user.uid);
    if (!isAdmin) {
      showAccessDenied();
      return;
    }
  } catch (err) {
    console.error(err);
    showAccessDenied();
  }
});
