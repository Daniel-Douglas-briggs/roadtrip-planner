// trips.js — Phase 3: save & pin restaurants to user trips
//
// Loaded as <script type="module"> on every page.
//
// Exposes on window:
//   window.setCurrentTrip(title, type)  — call when a search starts
//   window.togglePin(placeData)          — pin or unpin a restaurant
//   window.isPinned(placeId)             — returns true/false
//   window.openTripsPanel()             — open the My Trips slide-in panel
//
// Firestore structure:
//   users/{uid}/trips/{tripId}
//     { title, type, createdAt, restaurants: [{ placeId, name, address, rating, website, pinnedAt }] }

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";


// ── Trip context ──────────────────────────────────────────────────────────────
// Set when the user runs a search on any page. All pins made during this
// session are grouped under this trip.

let currentTripId       = null;
let currentTripTitle    = null;
let currentTripType     = null;
let currentSearchParams = null;

window.setCurrentTrip = function (title, type, searchParams) {
  currentTripId       = "trip_" + Date.now();
  currentTripTitle    = title;
  currentTripType     = type;
  currentSearchParams = searchParams || null;
};


// ── In-memory mirror of Firestore ─────────────────────────────────────────────
// Kept in sync by onSnapshot. Lets isPinned() run instantly without a network call.

let tripsData        = {};  // { tripId: { title, type, createdAt, restaurants: [] } }
let pinnedPlaceIds   = new Set();
let unsubscribeTrips = null;


// ── Toggle pin ────────────────────────────────────────────────────────────────

window.togglePin = async function (placeData) {
  const user = auth.currentUser;

  if (!user) {
    // Not signed in — open the auth modal with an explanation
    if (window.openAuthModal) window.openAuthModal("signin", "Sign in to save restaurants to your trips.");
    return;
  }

  if (!currentTripId) return; // no search has been run yet on this page

  if (pinnedPlaceIds.has(placeData.placeId)) {
    await unpinRestaurant(user.uid, placeData.placeId);
  } else {
    await pinRestaurant(user.uid, placeData);
  }
};

window.isPinned = function (placeId) {
  return pinnedPlaceIds.has(placeId);
};


// ── Pin ───────────────────────────────────────────────────────────────────────

async function pinRestaurant(uid, placeData) {
  const tripRef    = doc(db, "users", uid, "trips", currentTripId);
  const restaurant = {
    placeId:  placeData.placeId,
    name:     placeData.name,
    address:  placeData.address || "",
    rating:   placeData.rating  || null,
    website:  placeData.website || null,
    pinnedAt: new Date().toISOString(),
  };

  const existing = tripsData[currentTripId];
  if (existing) {
    // Trip already exists in Firestore — append the new restaurant
    await updateDoc(tripRef, {
      restaurants: [...existing.restaurants, restaurant],
    });
  } else {
    // First pin for this trip — create the trip document
    await setDoc(tripRef, {
      title:        currentTripTitle,
      type:         currentTripType,
      searchParams: currentSearchParams,
      createdAt:    new Date().toISOString(),
      restaurants:  [restaurant],
    });
  }
}


// ── Unpin ─────────────────────────────────────────────────────────────────────

async function unpinRestaurant(uid, placeId) {
  for (const [tripId, trip] of Object.entries(tripsData)) {
    if (!trip.restaurants.some(function (r) { return r.placeId === placeId; })) continue;

    const tripRef        = doc(db, "users", uid, "trips", tripId);
    const newRestaurants = trip.restaurants.filter(function (r) { return r.placeId !== placeId; });

    if (newRestaurants.length === 0) {
      await deleteDoc(tripRef);  // delete the whole trip if it's now empty
    } else {
      await updateDoc(tripRef, { restaurants: newRestaurants });
    }
    break;
  }
}


// ── Auth state ────────────────────────────────────────────────────────────────
// When a user signs in, subscribe to their trips in real time.
// When they sign out, clear everything and re-render the empty panel.

onAuthStateChanged(auth, function (user) {
  if (user) {
    subscribeToTrips(user.uid);
  } else {
    if (unsubscribeTrips) unsubscribeTrips();
    tripsData      = {};
    pinnedPlaceIds = new Set();
    refreshPinButtons();
    renderTripsPanel();
  }
});


// ── Real-time Firestore sync ──────────────────────────────────────────────────

function subscribeToTrips(uid) {
  if (unsubscribeTrips) unsubscribeTrips();

  unsubscribeTrips = onSnapshot(
    collection(db, "users", uid, "trips"),
    function (snapshot) {
      tripsData      = {};
      pinnedPlaceIds = new Set();

      snapshot.forEach(function (docSnap) {
        const data = docSnap.data();
        tripsData[docSnap.id] = data;
        (data.restaurants || []).forEach(function (r) {
          pinnedPlaceIds.add(r.placeId);
        });
      });

      refreshPinButtons();
      renderTripsPanel();
    }
  );
}

// Update every pin button on the page to reflect the current pinned state
function refreshPinButtons() {
  document.querySelectorAll(".pin-btn").forEach(function (btn) {
    const pinned = pinnedPlaceIds.has(btn.dataset.placeId);
    btn.classList.toggle("pin-btn--pinned", pinned);
    btn.title = pinned ? "Remove from My Trips" : "Save to My Trips";
  });
}


// ── My Trips panel ────────────────────────────────────────────────────────────

window.openTripsPanel = function () {
  const panel   = document.getElementById("trips-panel");
  const overlay = document.getElementById("trips-overlay");
  if (panel)   panel.classList.remove("hidden");
  if (overlay) overlay.classList.remove("hidden");
};

function closeTripsPanel() {
  const panel   = document.getElementById("trips-panel");
  const overlay = document.getElementById("trips-overlay");
  if (panel)   panel.classList.add("hidden");
  if (overlay) overlay.classList.add("hidden");
}

// Wire up the close button and overlay click (elements exist in DOM by the time module runs)
const closePanelBtn = document.getElementById("trips-panel-close");
const tripsOverlay  = document.getElementById("trips-overlay");
if (closePanelBtn) closePanelBtn.addEventListener("click", closeTripsPanel);
if (tripsOverlay)  tripsOverlay.addEventListener("click",  closeTripsPanel);

// Wire up the My Trips header button and hamburger menu item
document.querySelectorAll(".my-trips-open-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    window.openTripsPanel();
    // Close the hamburger menu if it's open
    const menu = document.getElementById("auth-user-menu");
    if (menu) menu.classList.add("hidden");
  });
});


// ── Render the My Trips panel content ─────────────────────────────────────────

// Tracks which trips the user has collapsed — persists while the panel is open
const collapsedTrips = new Set();

// Tracks which restaurant review boxes are open — persists across re-renders
const expandedReviews = new Set();

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}


// Saves userRating / userReview changes for one restaurant inside a trip document.
async function saveRestaurantUserData(uid, tripId, placeId, updates) {
  const trip = tripsData[tripId];
  if (!trip) return;
  const newRestaurants = trip.restaurants.map(function (r) {
    return r.placeId === placeId ? Object.assign({}, r, updates) : r;
  });
  await updateDoc(doc(db, "users", uid, "trips", tripId), { restaurants: newRestaurants });
}


// Builds a URL to replay a saved trip's original search.
// Returns null for old trips that pre-date searchParams storage.
function buildSearchUrl(trip) {
  if (!trip.searchParams) return null;
  const p = trip.searchParams;

  if (trip.type === "destination") {
    return "destination-meals.html?" + new URLSearchParams({
      city:  p.city  || "",
      diets: (p.diets || []).join(","),
    });
  }

  if (trip.type === "roadtrip") {
    const params = { start: p.start || "", end: p.end || "", mode: p.mode || "custom" };
    if (p.mode === "interval") params.interval = p.interval || "";
    if (p.mode === "custom" && p.waypoints && p.waypoints.length) {
      params.waypoints = p.waypoints.join("|");
    }
    params.diets = (p.diets || []).join(",");
    return "index.html?" + new URLSearchParams(params);
  }

  if (trip.type === "flight") {
    if (p.flightMode === "airport") {
      return "flight-meals.html?" + new URLSearchParams({
        flightMode: "airport",
        airport:    p.airport || "",
        diets:      (p.diets || []).join(","),
      });
    }
    if (p.flightMode === "route") {
      return "flight-meals.html?" + new URLSearchParams({
        flightMode: "route",
        departure:  p.departure || "",
        arrival:    p.arrival   || "",
        layovers:   (p.layovers || []).join(","),
        diets:      (p.diets   || []).join(","),
      });
    }
  }

  return null;
}

function renderTripsPanel() {
  const body = document.getElementById("trips-panel-body");
  if (!body) return;
  body.innerHTML = "";

  // Sort trips newest first
  const tripIds = Object.keys(tripsData).sort(function (a, b) {
    return new Date(tripsData[b].createdAt) - new Date(tripsData[a].createdAt);
  });

  if (tripIds.length === 0) {
    body.innerHTML =
      '<p class="trips-empty">No saved restaurants yet.<br>' +
      'Pin a restaurant from your search results to get started.</p>';
    return;
  }

  tripIds.forEach(function (tripId) {
    const trip   = tripsData[tripId];
    const tripEl = document.createElement("div");
    tripEl.className = "trips-trip";

    // ── Title row ──────────────────────────────────────────────────────────
    const titleRow  = document.createElement("div");
    titleRow.className = "trips-title-row";

    const isCollapsed = collapsedTrips.has(tripId);

    // Collapse/expand chevron button
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "trips-toggle-btn";
    toggleBtn.title     = isCollapsed ? "Expand" : "Collapse";
    toggleBtn.innerHTML =
      '<svg class="trips-chevron' + (isCollapsed ? " trips-chevron--collapsed" : "") + '" ' +
      'xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<polyline points="6 9 12 15 18 9"/></svg>';

    const titleSpan = document.createElement("span");
    titleSpan.className   = "trips-title";
    titleSpan.textContent = trip.title;

    // Edit (pencil) button — clicking it turns the title into an input
    const editBtn = document.createElement("button");
    editBtn.className = "trips-edit-btn";
    editBtn.title     = "Rename trip";
    editBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
      '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
      '</svg>';

    editBtn.addEventListener("click", function () {
      const input = document.createElement("input");
      input.type      = "text";
      input.className = "trips-title-input";
      input.value     = trip.title;
      titleRow.replaceChild(input, titleSpan);
      editBtn.remove();
      input.focus();
      input.select();

      async function saveTitle() {
        const newTitle = input.value.trim() || trip.title;
        const uid      = auth.currentUser && auth.currentUser.uid;
        if (uid && newTitle !== trip.title) {
          await updateDoc(doc(db, "users", uid, "trips", tripId), { title: newTitle });
          // onSnapshot fires → re-renders the panel automatically
        }
      }

      input.addEventListener("blur",    saveTitle);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter")  input.blur();
        if (e.key === "Escape") { input.value = trip.title; input.blur(); }
      });
    });

    titleRow.appendChild(toggleBtn);
    titleRow.appendChild(titleSpan);
    titleRow.appendChild(editBtn);
    tripEl.appendChild(titleRow);

    // ── Restaurant cards (collapsible container) ────────────────────────────
    const cardsContainer = document.createElement("div");
    cardsContainer.className = "trips-cards" + (isCollapsed ? " trips-cards--collapsed" : "");

    (trip.restaurants || []).forEach(function (r) {
      const card = document.createElement("div");
      card.className = "trips-restaurant-card";

      // Unpin button (✕ in the top-right corner of the card)
      const unpinBtn = document.createElement("button");
      unpinBtn.className   = "trips-unpin-btn";
      unpinBtn.title       = "Remove from My Trips";
      unpinBtn.textContent = "✕";
      unpinBtn.addEventListener("click", async function () {
        const uid = auth.currentUser && auth.currentUser.uid;
        if (uid) await unpinRestaurant(uid, r.placeId);
      });

      card.innerHTML =
        '<div class="trips-restaurant-name">' + r.name + '</div>' +
        (r.address ? '<div class="trips-restaurant-address">' + r.address + '</div>' : '') +
        (r.rating  ? '<div class="trips-restaurant-meta">★ ' + r.rating + '</div>'   : '') +
        (r.website
          ? '<a class="trips-restaurant-link" href="' + r.website + '" target="_blank" rel="noopener">Visit website ↗</a>'
          : '');

      card.appendChild(unpinBtn);

      // ── User star rating ──────────────────────────────────────────────────
      const starsRow = document.createElement("div");
      starsRow.className = "trips-user-rating";

      const starEls = [];
      for (let v = 1; v <= 5; v++) {
        const star = document.createElement("button");
        star.type        = "button";
        star.className   = "trips-star" + (v <= (r.userRating || 0) ? " trips-star--filled" : "");
        star.textContent = "★";
        star.title       = v + " star" + (v > 1 ? "s" : "");

        // Hover: light up stars up to this value
        star.addEventListener("mouseenter", (function (val) {
          return function () {
            starEls.forEach(function (s, i) {
              s.classList.toggle("trips-star--hover", i < val);
            });
          };
        })(v));

        star.addEventListener("mouseleave", function () {
          starEls.forEach(function (s) { s.classList.remove("trips-star--hover"); });
        });

        star.addEventListener("click", (function (val) {
          return function () {
            const uid = auth.currentUser && auth.currentUser.uid;
            if (!uid) return;
            // Clicking the current rating clears it
            const newRating = (val === r.userRating) ? null : val;
            saveRestaurantUserData(uid, tripId, r.placeId, { userRating: newRating });
          };
        })(v));

        starEls.push(star);
        starsRow.appendChild(star);
      }

      const ratingLabel = document.createElement("span");
      ratingLabel.className   = "trips-rating-label";
      ratingLabel.textContent = r.userRating ? "Your rating" : "Rate this";
      starsRow.appendChild(ratingLabel);

      card.appendChild(starsRow);

      // ── Dietary certification ─────────────────────────────────────────────
      const tripDiets = trip.searchParams && trip.searchParams.diets;
      if (tripDiets && tripDiets.length > 0) {
        const certRow = document.createElement("div");
        certRow.className = "trips-cert-row";

        tripDiets.forEach(function (diet) {
          const certified = (r.certifiedDiets || []).includes(diet);
          const btn = document.createElement("button");
          btn.type      = "button";
          btn.className = "trips-cert-btn" + (certified ? " trips-cert-btn--confirmed" : "");
          btn.textContent = certified
            ? "✓ " + capitalize(diet)
            : capitalize(diet) + "?";
          btn.title = certified
            ? "Click to undo — mark as not confirmed"
            : "Confirm this place had " + diet + " options";

          btn.addEventListener("click", function () {
            const uid = auth.currentUser && auth.currentUser.uid;
            if (!uid) return;
            const current = r.certifiedDiets || [];
            const updated = certified
              ? current.filter(function (d) { return d !== diet; })
              : current.concat(diet);
            saveRestaurantUserData(uid, tripId, r.placeId, { certifiedDiets: updated });
          });

          certRow.appendChild(btn);
        });

        card.appendChild(certRow);
      }

      // ── User review ───────────────────────────────────────────────────────
      if (r.userReview) {
        const reviewDisplay = document.createElement("div");
        reviewDisplay.className   = "trips-review-display";
        reviewDisplay.textContent = r.userReview;
        card.appendChild(reviewDisplay);
      }

      const reviewToggle = document.createElement("button");
      reviewToggle.type      = "button";
      reviewToggle.className = "trips-review-toggle";
      reviewToggle.textContent = r.userReview ? "Edit review" : "Write a review";

      const reviewSection    = document.createElement("div");
      const isReviewOpen     = expandedReviews.has(r.placeId);
      reviewSection.className = "trips-review-section" + (isReviewOpen ? "" : " hidden");

      const textarea = document.createElement("textarea");
      textarea.className   = "trips-review-textarea";
      textarea.placeholder = "Share your experience…";
      textarea.value       = r.userReview || "";
      textarea.rows        = 3;

      // Prevent clicks inside the textarea from bubbling up (e.g. collapsing the trip)
      textarea.addEventListener("click", function (e) { e.stopPropagation(); });

      const saveReviewBtn = document.createElement("button");
      saveReviewBtn.type        = "button";
      saveReviewBtn.className   = "trips-review-save-btn";
      saveReviewBtn.textContent = "Save";

      saveReviewBtn.addEventListener("click", async function () {
        const uid = auth.currentUser && auth.currentUser.uid;
        if (!uid) return;
        await saveRestaurantUserData(uid, tripId, r.placeId, {
          userReview: textarea.value.trim() || null,
        });
        expandedReviews.delete(r.placeId);
      });

      reviewSection.appendChild(textarea);
      reviewSection.appendChild(saveReviewBtn);

      reviewToggle.addEventListener("click", function () {
        if (expandedReviews.has(r.placeId)) {
          expandedReviews.delete(r.placeId);
          reviewSection.classList.add("hidden");
        } else {
          expandedReviews.add(r.placeId);
          reviewSection.classList.remove("hidden");
          textarea.focus();
        }
      });

      card.appendChild(reviewToggle);
      card.appendChild(reviewSection);

      cardsContainer.appendChild(card);
    });

    // Toggle collapse when the chevron or title is clicked
    function toggleCollapse() {
      const collapsed = collapsedTrips.has(tripId);
      if (collapsed) {
        collapsedTrips.delete(tripId);
        cardsContainer.classList.remove("trips-cards--collapsed");
        toggleBtn.title = "Collapse";
        toggleBtn.querySelector(".trips-chevron").classList.remove("trips-chevron--collapsed");
      } else {
        collapsedTrips.add(tripId);
        cardsContainer.classList.add("trips-cards--collapsed");
        toggleBtn.title = "Expand";
        toggleBtn.querySelector(".trips-chevron").classList.add("trips-chevron--collapsed");
      }
    }

    toggleBtn.addEventListener("click", toggleCollapse);

    const searchUrl = buildSearchUrl(trip);
    if (searchUrl) {
      titleSpan.classList.add("trips-title--link");
      titleSpan.title = "Replay this search";
      titleSpan.addEventListener("click", function () {
        window.location.href = searchUrl;
      });
    } else {
      // Old trips without searchParams — clicking title collapses instead
      titleSpan.addEventListener("click", toggleCollapse);
    }

    tripEl.appendChild(cardsContainer);
    body.appendChild(tripEl);
  });
}
