// =============================================
// flight-meals.js — Flight Meals UI shell
//
// This file handles the two-step flow:
//   Step 1 — the user fills in the flight route form
//   Step 2 — placeholder result cards appear, grouped by layover airport
//
// No API calls are made yet — this is just the interface skeleton.
// =============================================


// ── Dietary preference dropdown ───────────────────────────────────────────────
// Same behaviour as the road trip page: clicking the bar opens/closes the list,
// clicking outside closes it, and the label updates to show what's selected.

const dietMenu        = document.getElementById("diet-dropdown-menu");
const dietDropdown    = document.getElementById("diet-dropdown");
const dietToggleBtn   = document.getElementById("diet-toggle-btn");
const dietToggleLabel = document.getElementById("diet-toggle-label");

dietToggleBtn.addEventListener("click", function () {
  const isOpen = !dietMenu.hasAttribute("hidden");
  if (isOpen) {
    dietMenu.setAttribute("hidden", "");
    dietDropdown.classList.remove("open");
  } else {
    dietMenu.removeAttribute("hidden");
    dietDropdown.classList.add("open");
  }
});

document.addEventListener("click", function (e) {
  if (!dietDropdown.contains(e.target)) {
    dietMenu.setAttribute("hidden", "");
    dietDropdown.classList.remove("open");
  }
});

dietMenu.addEventListener("change", function () {
  const checked = Array.from(dietMenu.querySelectorAll("input:checked"))
    .map(function (cb) { return cb.parentElement.textContent.trim(); });
  if (checked.length === 0) {
    dietToggleLabel.textContent = "None selected";
  } else if (checked.length <= 2) {
    dietToggleLabel.textContent = checked.join(", ");
  } else {
    dietToggleLabel.textContent = checked.length + " selected";
  }
});


// ── Elements ──────────────────────────────────────────────────────────────────

const flightForm          = document.getElementById("flight-form");
const flightFormSection   = document.getElementById("flight-form-section");
const flightResultSection = document.getElementById("flight-results-section");
const flightSearchBtn     = document.getElementById("flight-search-btn");
const flightBackBtn       = document.getElementById("flight-back-btn");
const flightRouteSummary  = document.getElementById("flight-route-summary");
const flightResultsList   = document.getElementById("flight-results-list");
const addLayoverBtn       = document.getElementById("add-layover-btn");
const layoversList        = document.getElementById("layovers-list");

const MAX_LAYOVERS = 3;
let layoverCount = 0; // tracks how many layover rows are currently shown


// ── Layover rows ──────────────────────────────────────────────────────────────
// Each time the user clicks "+ Add layover" we create a new input row.
// Clicking × on a row removes it and re-numbers the remaining rows.

addLayoverBtn.addEventListener("click", function () {
  if (layoverCount >= MAX_LAYOVERS) return;

  layoverCount++;

  const li = document.createElement("li");
  li.className = "layover-row";
  li.dataset.index = layoverCount;

  li.innerHTML =
    '<span class="layover-label">Layover ' + layoverCount + '</span>' +
    '<input class="airport-input layover-input" type="text" maxlength="3" placeholder="ORD" />' +
    '<button type="button" class="layover-remove-btn" aria-label="Remove layover">×</button>';

  layoversList.appendChild(li);
  updateAddLayoverBtn();

  // Auto-focus the new input so the user can type right away
  li.querySelector("input").focus();
});

// Remove a layover row when its × is clicked, then re-number the remaining ones
layoversList.addEventListener("click", function (e) {
  if (!e.target.classList.contains("layover-remove-btn")) return;

  e.target.closest(".layover-row").remove();
  layoverCount--;
  renumberLayovers();
  updateAddLayoverBtn();
});

// Keep the "Layover 1 / 2 / 3" labels accurate after a row is removed
function renumberLayovers() {
  const rows = layoversList.querySelectorAll(".layover-row");
  rows.forEach(function (row, i) {
    row.querySelector(".layover-label").textContent = "Layover " + (i + 1);
  });
}

// Hide the "+ Add layover" button once the maximum is reached
function updateAddLayoverBtn() {
  addLayoverBtn.style.display = layoverCount >= MAX_LAYOVERS ? "none" : "inline-block";
}

// Auto-uppercase airport code inputs as the user types (LAX, not lax)
document.addEventListener("input", function (e) {
  if (e.target.classList.contains("airport-input")) {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
  }
});


// ── Step 1 → Step 2: show results ─────────────────────────────────────────────

flightSearchBtn.addEventListener("click", function () {
  const departure = document.getElementById("departure").value.trim().toUpperCase();
  const arrival   = document.getElementById("arrival").value.trim().toUpperCase();

  if (!departure || !arrival) {
    showFlightError("Please enter both a departure and an arrival airport code.");
    return;
  }

  // Collect whatever layover codes the user typed (skip empty ones)
  const layoverInputs = layoversList.querySelectorAll(".layover-input");
  const layovers = Array.from(layoverInputs)
    .map(function (input) { return input.value.trim().toUpperCase(); })
    .filter(function (code) { return code.length > 0; });

  // Build the route summary label, e.g. "LAX → ORD → DFW → JFK"
  const allAirports = [departure].concat(layovers).concat([arrival]);
  flightRouteSummary.textContent = allAirports.join("  →  ");

  // Build one placeholder card per layover
  flightResultsList.innerHTML = "";

  if (layovers.length === 0) {
    // No layovers — show a gentle message
    const empty = document.createElement("div");
    empty.className = "flight-no-layovers";
    empty.textContent = "No layovers on this route. Add a layover airport to see meal options.";
    flightResultsList.appendChild(empty);
  } else {
    layovers.forEach(function (code) {
      const card = document.createElement("div");
      card.className = "flight-airport-card";
      card.innerHTML =
        '<div class="flight-airport-header">' +
          '<span class="flight-airport-code">' + code + '</span>' +
        '</div>' +
        '<div class="flight-airport-placeholder">' +
          'Meal options at ' + code + ' will appear here once data is connected.' +
        '</div>';
      flightResultsList.appendChild(card);
    });
  }

  // Switch from step 1 to step 2
  clearFlightError();
  flightFormSection.classList.add("hidden");
  flightResultSection.classList.remove("hidden");
});


// ── Step 2 → Step 1: back button ─────────────────────────────────────────────

flightBackBtn.addEventListener("click", function () {
  flightResultSection.classList.add("hidden");
  flightFormSection.classList.remove("hidden");
});


// ── Error handling ────────────────────────────────────────────────────────────

function showFlightError(message) {
  clearFlightError();
  const div = document.createElement("div");
  div.className = "error-message";
  div.id = "flight-error";
  div.textContent = message;
  flightForm.after(div);
}

function clearFlightError() {
  const existing = document.getElementById("flight-error");
  if (existing) existing.remove();
}
