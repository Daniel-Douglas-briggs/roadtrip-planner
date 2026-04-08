// preferences.js — saves and loads dietary preferences for logged-in users.
//
// Loaded as a <script type="module"> on every page alongside auth.js.
//
// Firestore structure:
//   users/{uid}  →  { diets: ["vegan", "gluten free", ...] }
//
// Because app.js / flight-meals.js / destination-meals.js are plain scripts
// (not modules), they can't import directly. Instead this file exposes one
// function on window:
//
//   window.savePreferences(diets)
//     — call this whenever checkboxes change (only does work if logged in)
//
// Everything else (loading + applying on sign-in) runs automatically.

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";


// ── Save ──────────────────────────────────────────────────────────────────────
// Writes the selected diet values to Firestore under the current user's uid.
// Safe to call even when logged out — it just does nothing.

window.savePreferences = async function (diets) {
  const user = auth.currentUser;
  if (!user) return;

  await setDoc(
    doc(db, "users", user.uid),
    { diets: diets },
    { merge: true }  // keeps any other fields we add in later phases
  );
};


// ── Apply ─────────────────────────────────────────────────────────────────────
// Ticks the matching checkboxes on the page and updates the dropdown label.

function applyPreferences(diets) {
  const dietMenu        = document.getElementById("diet-dropdown-menu");
  const dietToggleLabel = document.getElementById("diet-toggle-label");
  if (!dietMenu || !dietToggleLabel) return;

  // Tick / untick every checkbox
  dietMenu.querySelectorAll("input[type='checkbox']").forEach(function (cb) {
    cb.checked = diets.includes(cb.value);
  });

  // Update the summary label, e.g. "Vegan, Gluten Free" or "3 selected"
  const names = diets.map(function (v) {
    return v.split(" ").map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  });

  if (names.length === 0) {
    dietToggleLabel.textContent = "None selected";
  } else if (names.length <= 2) {
    dietToggleLabel.textContent = names.join(", ");
  } else {
    dietToggleLabel.textContent = names.length + " selected";
  }
}


// ── Auto-load on sign-in ──────────────────────────────────────────────────────
// Whenever auth state changes (page load, sign in, sign out), either load
// and apply saved preferences or clear the checkboxes back to defaults.

onAuthStateChanged(auth, async function (user) {
  if (!user) return; // signed out — leave checkboxes as-is

  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists() && Array.isArray(snap.data().diets)) {
    applyPreferences(snap.data().diets);
  }
  // If no saved preferences yet, leave the checkboxes alone
});
