// auth.js — handles sign up, sign in, Google sign-in, sign out, and the
// auth modal UI. Loaded as a module script on every page.

import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";


// ── Modal open / close ────────────────────────────────────────────────────────

const modal    = document.getElementById("auth-modal");
const overlay  = document.getElementById("auth-overlay");

function openModal(view, infoMessage) {
  showView(view || "signin");
  modal.classList.remove("hidden");
  overlay.classList.remove("hidden");
  clearErrors();
  if (infoMessage) {
    const infoEl = document.getElementById("auth-signin-info");
    if (infoEl) { infoEl.textContent = infoMessage; infoEl.classList.remove("hidden"); }
  }
}

// Exposed so other modules (e.g. trips.js) can open the auth modal
window.openAuthModal = openModal;

function closeModal() {
  modal.classList.add("hidden");
  overlay.classList.add("hidden");
  clearErrors();
  clearInputs();
}

overlay.addEventListener("click", closeModal);
document.getElementById("auth-close-btn").addEventListener("click", closeModal);


// ── View switching (sign in ↔ sign up ↔ reset password) ──────────────────────

function showView(name) {
  document.querySelectorAll(".auth-view").forEach(function (v) {
    v.classList.add("hidden");
  });
  document.getElementById("auth-view-" + name).classList.remove("hidden");
  clearErrors();
}

document.getElementById("auth-goto-signup").addEventListener("click",  function () { showView("signup"); });
document.getElementById("auth-goto-signin").addEventListener("click",  function () { showView("signin"); });
document.getElementById("auth-goto-reset").addEventListener("click",   function () { showView("reset"); });
document.getElementById("auth-back-signin").addEventListener("click",  function () { showView("signin"); });


// ── Error / success display ───────────────────────────────────────────────────

function showError(viewId, message) {
  const el = document.getElementById("auth-error-" + viewId);
  if (el) { el.textContent = message; el.classList.remove("hidden"); }
}

function showSuccess(viewId, message) {
  const el = document.getElementById("auth-success-" + viewId);
  if (el) { el.textContent = message; el.classList.remove("hidden"); }
}

function clearErrors() {
  document.querySelectorAll(".auth-error, .auth-success").forEach(function (el) {
    el.textContent = "";
    el.classList.add("hidden");
  });
  const infoEl = document.getElementById("auth-signin-info");
  if (infoEl) { infoEl.textContent = ""; infoEl.classList.add("hidden"); }
}

function clearInputs() {
  document.querySelectorAll(".auth-input").forEach(function (el) { el.value = ""; });
}

// Maps Firebase error codes to plain-English messages
function friendlyError(code) {
  const map = {
    "auth/email-already-in-use":    "An account with that email already exists.",
    "auth/invalid-email":           "Please enter a valid email address.",
    "auth/weak-password":           "Password must be at least 6 characters.",
    "auth/user-not-found":          "No account found with that email.",
    "auth/wrong-password":          "Incorrect password. Try again.",
    "auth/invalid-credential":      "Incorrect email or password. Try again.",
    "auth/too-many-requests":       "Too many attempts. Please wait a moment.",
    "auth/popup-closed-by-user":    "Sign-in popup was closed. Please try again.",
  };
  return map[code] || "Something went wrong. Please try again.";
}


// ── Sign Up ───────────────────────────────────────────────────────────────────

document.getElementById("auth-signup-btn").addEventListener("click", async function () {
  const name     = document.getElementById("auth-signup-name").value.trim();
  const email    = document.getElementById("auth-signup-email").value.trim();
  const password = document.getElementById("auth-signup-password").value;

  if (!email || !password) { showError("signup", "Please fill in all fields."); return; }

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(credential.user, { displayName: name });
    closeModal();
  } catch (e) {
    showError("signup", friendlyError(e.code));
  }
});


// ── Sign In ───────────────────────────────────────────────────────────────────

document.getElementById("auth-signin-btn").addEventListener("click", async function () {
  const email    = document.getElementById("auth-signin-email").value.trim();
  const password = document.getElementById("auth-signin-password").value;

  if (!email || !password) { showError("signin", "Please fill in all fields."); return; }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeModal();
  } catch (e) {
    showError("signin", friendlyError(e.code));
  }
});

// Allow pressing Enter in the password field to submit
document.getElementById("auth-signin-password").addEventListener("keydown", function (e) {
  if (e.key === "Enter") document.getElementById("auth-signin-btn").click();
});


// ── Google Sign In ────────────────────────────────────────────────────────────

const googleProvider = new GoogleAuthProvider();

document.querySelectorAll(".auth-google-btn").forEach(function (btn) {
  btn.addEventListener("click", async function () {
    try {
      await signInWithPopup(auth, googleProvider);
      closeModal();
    } catch (e) {
      const viewId = btn.closest(".auth-view").id.replace("auth-view-", "");
      showError(viewId, friendlyError(e.code));
    }
  });
});


// ── Password Reset ────────────────────────────────────────────────────────────

document.getElementById("auth-reset-btn").addEventListener("click", async function () {
  const email = document.getElementById("auth-reset-email").value.trim();
  if (!email) { showError("reset", "Please enter your email address."); return; }

  try {
    await sendPasswordResetEmail(auth, email);
    showSuccess("reset", "Reset email sent! Check your inbox.");
  } catch (e) {
    showError("reset", friendlyError(e.code));
  }
});


// ── Sign Out ──────────────────────────────────────────────────────────────────

document.getElementById("auth-signout-btn").addEventListener("click", async function () {
  await signOut(auth);
  document.getElementById("auth-user-menu").classList.add("hidden");
});


// ── Hamburger menu toggle ─────────────────────────────────────────────────────

document.getElementById("auth-menu-btn").addEventListener("click", function (e) {
  e.stopPropagation();
  document.getElementById("auth-user-menu").classList.toggle("hidden");
});

document.addEventListener("click", function () {
  const menu = document.getElementById("auth-user-menu");
  if (menu) menu.classList.add("hidden");
});


// ── Auth state listener — updates the header on every page ───────────────────

const authMenu    = document.getElementById("auth-user-menu");
const authNameEl  = document.getElementById("auth-user-name");

onAuthStateChanged(auth, function (user) {
  if (user) {
    // Logged in — show hamburger, hide signed-out widget
    document.getElementById("auth-signed-out").classList.add("hidden");
    document.getElementById("auth-signed-in").classList.remove("hidden");
    if (authNameEl) authNameEl.textContent = user.displayName || user.email;
  } else {
    // Logged out — show sign-in widget, hide hamburger
    document.getElementById("auth-signed-out").classList.remove("hidden");
    document.getElementById("auth-signed-in").classList.add("hidden");
    authMenu.classList.add("hidden");
  }
});


// ── Header button click handlers ─────────────────────────────────────────────

document.getElementById("auth-btn").addEventListener("click",        function () { openModal("signin");  });
document.getElementById("auth-create-btn").addEventListener("click", function () { openModal("signup"); });
