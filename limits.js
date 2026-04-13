// limits.js — Phase 4: Search limits and tier gating
//
// Loaded as <script type="module"> on every page.
//
// Tiers:
//   guest  — no account, 5 searches tracked in localStorage
//   free   — account, 25 searches + 2 saved trips tracked in Firestore
//   paid   — future Stripe tier, unlimited everything
//
// Exposes on window:
//   window.checkSearchLimit()   — async, returns true if OK, false + shows modal if not
//   window.recordSearch()       — call once a search is allowed; increments the count
//   window.getUserTier()        — returns null (guest), 'free', or 'paid'
//   window.getSaveLimit()       — returns max saved trips for free tier (2)
//   window.showSaveLimitModal() — called by trips.js when save cap is hit

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";


// ── Limits ────────────────────────────────────────────────────────────────────

const GUEST_LIMIT = 5;
const FREE_LIMIT  = 25;
const SAVE_LIMIT  = 2;
const WEEK_MS     = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const GUEST_KEY   = "noorish-guest-searches";


// ── Cached user state ─────────────────────────────────────────────────────────

let cachedTier         = null; // null = guest, 'free', or 'paid'
let cachedSearchesUsed = 0;    // searches used in the current week
let cachedWeekStart    = null; // timestamp when the current week began

onAuthStateChanged(auth, async function (user) {
  if (user) {
    const snap        = await getDoc(doc(db, "users", user.uid));
    const data        = snap.exists() ? snap.data() : {};
    const now         = Date.now();
    const storedStart = data.searchWeekStart || now;
    const isNewWeek   = (now - storedStart) > WEEK_MS;

    cachedTier         = data.tier || "free";
    cachedWeekStart    = isNewWeek ? now : storedStart;
    cachedSearchesUsed = isNewWeek ? 0 : (data.searchesUsed || 0);
  } else {
    cachedTier         = null;
    cachedSearchesUsed = 0;
    cachedWeekStart    = null;
  }
});


// ── Guest helpers ─────────────────────────────────────────────────────────────
// Guest data is stored as JSON: { count, weekStart }

function getGuestData() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return { count: 0, weekStart: Date.now() };
    const data = JSON.parse(raw);
    if (Date.now() - data.weekStart > WEEK_MS) {
      return { count: 0, weekStart: Date.now() };
    }
    return data;
  } catch (e) {
    return { count: 0, weekStart: Date.now() };
  }
}

function saveGuestData(count, weekStart) {
  localStorage.setItem(GUEST_KEY, JSON.stringify({ count: count, weekStart: weekStart }));
}


// ── Public API ────────────────────────────────────────────────────────────────

// Check whether a search is allowed. Shows the appropriate modal and returns
// false if the user is over their limit; returns true if they can proceed.
window.checkSearchLimit = async function () {
  const user = auth.currentUser;

  if (!user) {
    // Guest: check weekly localStorage count
    const guestData = getGuestData();
    if (guestData.count >= GUEST_LIMIT) {
      showLimitModal("guest", guestData.weekStart);
      return false;
    }
    return true;
  }

  // Signed-in user: fetch latest count from Firestore
  const snap        = await getDoc(doc(db, "users", user.uid));
  const data        = snap.exists() ? snap.data() : {};
  const now         = Date.now();
  const storedStart = data.searchWeekStart || now;
  const isNewWeek   = (now - storedStart) > WEEK_MS;

  cachedTier         = data.tier || "free";
  cachedWeekStart    = isNewWeek ? now : storedStart;
  cachedSearchesUsed = isNewWeek ? 0 : (data.searchesUsed || 0);

  if (cachedTier === "paid") return true;

  if (cachedSearchesUsed >= FREE_LIMIT) {
    showLimitModal("free", cachedWeekStart);
    return false;
  }

  return true;
};

// Increment the search count. Call this once after checkSearchLimit returns true.
window.recordSearch = function () {
  const user = auth.currentUser;

  if (!user) {
    const guestData = getGuestData();
    saveGuestData(guestData.count + 1, guestData.weekStart);
    return;
  }

  if (cachedTier === "paid") return;

  cachedSearchesUsed += 1;
  setDoc(doc(db, "users", user.uid), {
    searchesUsed:    cachedSearchesUsed,
    searchWeekStart: cachedWeekStart,
  }, { merge: true });
};

// Returns null (guest), 'free', or 'paid'.
window.getUserTier = function () {
  return cachedTier;
};

// Maximum number of saved trips allowed for a free user.
window.getSaveLimit = function () {
  return SAVE_LIMIT;
};

// Called by trips.js when a free user tries to save a third trip.
window.showSaveLimitModal = function () {
  showLimitModal("save");
};


// ── Modal ─────────────────────────────────────────────────────────────────────
// Injected into the page once the DOM is ready. Reuses the existing auth modal
// CSS so it looks identical in both light and dark mode with no extra styles.

function buildModal() {
  const overlay = document.createElement("div");
  overlay.id = "limit-overlay";
  overlay.className = "auth-overlay hidden";

  const modal = document.createElement("div");
  modal.id = "limit-modal";
  modal.className = "auth-modal hidden";
  modal.innerHTML =
    '<button id="limit-close-btn" class="auth-close-btn">&#x2715;</button>' +
    '<div id="limit-content"></div>';

  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  overlay.addEventListener("click", closeLimitModal);
  modal.querySelector("#limit-close-btn").addEventListener("click", closeLimitModal);
}

function daysUntilReset(weekStart) {
  const msLeft   = (weekStart + WEEK_MS) - Date.now();
  const days     = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  return Math.max(1, days); // always show at least 1 day
}

function showLimitModal(type, weekStart) {
  const overlay = document.getElementById("limit-overlay");
  const modal   = document.getElementById("limit-modal");
  const content = document.getElementById("limit-content");
  const days    = weekStart ? daysUntilReset(weekStart) : 7;
  const resetMsg = days === 1 ? "Your limit resets tomorrow." : "Your limit resets in " + days + " days.";

  if (type === "guest") {
    content.innerHTML =
      '<h2 class="auth-title">Weekly search limit reached</h2>' +
      '<p class="auth-subtitle">You\'ve used your 5 free searches for this week. ' + resetMsg + '</p>' +
      '<p class="auth-subtitle">Create a free account to get 25 searches per week and save your favourite restaurants.</p>' +
      '<button id="limit-create-btn" class="auth-submit-btn">Create a free account</button>' +
      '<div class="auth-footer"><button id="limit-signin-btn" class="auth-link-btn">Already have an account? Sign in</button></div>';

    document.getElementById("limit-create-btn").addEventListener("click", function () {
      closeLimitModal();
      if (window.openAuthModal) window.openAuthModal("signup");
    });
    document.getElementById("limit-signin-btn").addEventListener("click", function () {
      closeLimitModal();
      if (window.openAuthModal) window.openAuthModal("signin");
    });

  } else if (type === "free") {
    content.innerHTML =
      '<h2 class="auth-title">Weekly search limit reached</h2>' +
      '<p class="auth-subtitle">You\'ve used all 25 of your searches for this week. ' + resetMsg + '</p>' +
      '<p class="auth-subtitle">Upgrade to Noorish Premium for unlimited searches every week and unlimited saved routes.</p>' +
      '<button class="auth-submit-btn auth-submit-btn--disabled" disabled>Upgrade to Premium &mdash; Coming Soon</button>';

  } else if (type === "save") {
    content.innerHTML =
      '<h2 class="auth-title">Saved trips limit reached</h2>' +
      '<p class="auth-subtitle">Free accounts can save up to 2 trips. Upgrade to Noorish Premium for unlimited saved routes.</p>' +
      '<button class="auth-submit-btn auth-submit-btn--disabled" disabled>Upgrade to Premium &mdash; Coming Soon</button>';
  }

  overlay.classList.remove("hidden");
  modal.classList.remove("hidden");
}

function closeLimitModal() {
  document.getElementById("limit-overlay").classList.add("hidden");
  document.getElementById("limit-modal").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", buildModal);
