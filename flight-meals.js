// =============================================
// flight-meals.js — Flight Meals page
//
// Two-step flow:
//   Step 1 — user fills in the flight route form
//   Step 2 — for each layover, the Places API is queried and
//             restaurant results are rendered grouped by airport
//
// API call chain per layover:
//   1. geocoder.geocode()       — convert "ORD airport" → GPS coordinates
//   2. placesService.textSearch() — find restaurants at/near that airport
//   3. placesService.getDetails() — fetch website for each result
// =============================================


// ── Google Maps API objects ───────────────────────────────────────────────────
// Declared here, created inside initFlightMeals() once the API loads.

let geocoder;
let placesService;

// Shared results map — one instance reused across searches
let flightMap     = null;
let flightMarkers = [];       // tracks all markers so we can clear them on re-search
let flightBounds  = null;     // expands as each airport's results arrive
let currentMode   = "airport"; // "airport" | "route" — which tab is active

// Cache keyed by "AIRPORTCODE|dietquery" (e.g. "ORD|keto gluten free").
// Stores the full callback result so repeated searches for the same
// airport + diet combination skip all three API calls entirely.
const airportSearchCache = {};

// Tracks the active search's diet settings and card count so the
// "Add an additional airport" feature can search with the same preferences.
let currentDietQuery    = "";
let currentSelectedDiets = [];
let cardCount           = 0;


// ── Called automatically by Google when the Maps API finishes loading ─────────

function initFlightMeals() {
  geocoder     = new google.maps.Geocoder();
  placesService = new google.maps.places.PlacesService(
    document.getElementById("places-service-target")
  );
}

// Called if the Maps API script fails to load (network error, bad key, etc.)
function showFlightApiError() {
  flightSearchBtn.disabled    = true;
  flightSearchBtn.textContent = "Map service unavailable";
  const div = document.createElement("div");
  div.className = "error-message";
  div.textContent = "The map service couldn't load. Check your internet connection and refresh the page.";
  flightForm.after(div);
}


// ── Cuisine type lookup ───────────────────────────────────────────────────────
// Google Places returns types like "italian_restaurant". This maps them to
// readable labels we show on each result card.

const CUISINE_LABELS = {
  american_restaurant:      "American",
  bakery:                   "Bakery",
  bar:                      "Bar",
  barbecue_restaurant:      "Barbecue",
  brazilian_restaurant:     "Brazilian",
  breakfast_restaurant:     "Breakfast",
  brunch_restaurant:        "Brunch",
  cafe:                     "Café",
  chinese_restaurant:       "Chinese",
  coffee_shop:              "Coffee",
  fast_food_restaurant:     "Fast Food",
  french_restaurant:        "French",
  greek_restaurant:         "Greek",
  hamburger_restaurant:     "Burgers",
  ice_cream_shop:           "Ice Cream",
  indian_restaurant:        "Indian",
  italian_restaurant:       "Italian",
  japanese_restaurant:      "Japanese",
  korean_restaurant:        "Korean",
  mediterranean_restaurant: "Mediterranean",
  mexican_restaurant:       "Mexican",
  middle_eastern_restaurant:"Middle Eastern",
  pizza_restaurant:         "Pizza",
  ramen_restaurant:         "Ramen",
  sandwich_shop:            "Sandwiches",
  seafood_restaurant:       "Seafood",
  spanish_restaurant:       "Spanish",
  steak_house:              "Steakhouse",
  sushi_restaurant:         "Sushi",
  thai_restaurant:          "Thai",
  turkish_restaurant:       "Turkish",
  vegan_restaurant:         "Vegan",
  vegetarian_restaurant:    "Vegetarian",
  vietnamese_restaurant:    "Vietnamese",
};

// Scans a place's types array and returns the first recognisable cuisine label,
// or null if none is found.
function getCuisineLabel(types) {
  for (let i = 0; i < types.length; i++) {
    if (CUISINE_LABELS[types[i]]) return CUISINE_LABELS[types[i]];
  }
  return null;
}

// Capitalises the first letter of a string — used for dietary tag labels.
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}


// ── Major US airport coordinates ─────────────────────────────────────────────
// This list powers the "suggested connecting airports" feature.
// When the user enters a departure and arrival that are both in this list,
// we calculate which airports fall geographically between them and offer
// them as one-click suggestions.

// Each entry has:
//   city — the city the user would type to find this airport
//   name — the full official airport name shown in the dropdown
//   lat/lng — coordinates used for the geographic layover suggestions
//
// Covers the top 100 U.S. airports by passenger volume.
const AIRPORTS = {

  // ── Tier 1: top 25 by passenger volume ───────────────────────────────────────
  ATL: { city: "Atlanta",            name: "Hartsfield-Jackson Atlanta International",    lat: 33.6407,  lng: -84.4277  },
  DFW: { city: "Dallas",             name: "Dallas/Fort Worth International",              lat: 32.8998,  lng: -97.0403  },
  DEN: { city: "Denver",             name: "Denver International",                         lat: 39.8561,  lng: -104.6737 },
  ORD: { city: "Chicago",            name: "O'Hare International",                         lat: 41.9742,  lng: -87.9073  },
  LAX: { city: "Los Angeles",        name: "Los Angeles International",                    lat: 33.9425,  lng: -118.4081 },
  CLT: { city: "Charlotte",          name: "Charlotte Douglas International",              lat: 35.2140,  lng: -80.9431  },
  MCO: { city: "Orlando",            name: "Orlando International",                        lat: 28.4312,  lng: -81.3081  },
  LAS: { city: "Las Vegas",          name: "Harry Reid International",                     lat: 36.0840,  lng: -115.1537 },
  PHX: { city: "Phoenix",            name: "Phoenix Sky Harbor International",             lat: 33.4373,  lng: -112.0078 },
  MIA: { city: "Miami",              name: "Miami International",                          lat: 25.7959,  lng: -80.2870  },
  SEA: { city: "Seattle",            name: "Seattle-Tacoma International",                 lat: 47.4502,  lng: -122.3088 },
  IAH: { city: "Houston",            name: "George Bush Intercontinental",                 lat: 29.9902,  lng: -95.3368  },
  JFK: { city: "New York",           name: "John F. Kennedy International",                lat: 40.6413,  lng: -73.7781  },
  SFO: { city: "San Francisco",      name: "San Francisco International",                  lat: 37.6213,  lng: -122.3790 },
  EWR: { city: "Newark / New York",  name: "Newark Liberty International",                 lat: 40.6895,  lng: -74.1745  },
  BOS: { city: "Boston",             name: "Logan International",                          lat: 42.3656,  lng: -71.0096  },
  MSP: { city: "Minneapolis",        name: "Minneapolis-Saint Paul International",         lat: 44.8820,  lng: -93.2218  },
  DTW: { city: "Detroit",            name: "Detroit Metropolitan Wayne County",            lat: 42.2124,  lng: -83.3534  },
  FLL: { city: "Fort Lauderdale",    name: "Fort Lauderdale-Hollywood International",      lat: 26.0742,  lng: -80.1506  },
  PHL: { city: "Philadelphia",       name: "Philadelphia International",                   lat: 39.8744,  lng: -75.2424  },
  BWI: { city: "Baltimore",          name: "Baltimore/Washington International",           lat: 39.1754,  lng: -76.6684  },
  SLC: { city: "Salt Lake City",     name: "Salt Lake City International",                 lat: 40.7899,  lng: -111.9791 },
  DCA: { city: "Washington D.C.",    name: "Reagan National",                              lat: 38.8521,  lng: -77.0377  },
  MDW: { city: "Chicago",            name: "Midway International",                         lat: 41.7868,  lng: -87.7522  },
  TPA: { city: "Tampa",              name: "Tampa International",                          lat: 27.9756,  lng: -82.5333  },

  // ── Tier 2: 26–50 ────────────────────────────────────────────────────────────
  HNL: { city: "Honolulu",           name: "Daniel K. Inouye International",               lat: 21.3245,  lng: -157.9251 },
  SAN: { city: "San Diego",          name: "San Diego International",                      lat: 32.7338,  lng: -117.1933 },
  IAD: { city: "Washington D.C.",    name: "Dulles International",                         lat: 38.9531,  lng: -77.4565  },
  LGA: { city: "New York",           name: "LaGuardia",                                    lat: 40.7769,  lng: -73.8740  },
  BNA: { city: "Nashville",          name: "Nashville International",                      lat: 36.1263,  lng: -86.6774  },
  AUS: { city: "Austin",             name: "Austin-Bergstrom International",               lat: 30.1945,  lng: -97.6699  },
  PDX: { city: "Portland",           name: "Portland International",                       lat: 45.5898,  lng: -122.5951 },
  RDU: { city: "Raleigh",            name: "Raleigh-Durham International",                 lat: 35.8776,  lng: -78.7875  },
  STL: { city: "St. Louis",          name: "Lambert-St. Louis International",              lat: 38.7487,  lng: -90.3700  },
  SMF: { city: "Sacramento",         name: "Sacramento International",                     lat: 38.6954,  lng: -121.5908 },
  MCI: { city: "Kansas City",        name: "Kansas City International",                    lat: 39.2976,  lng: -94.7139  },
  MSY: { city: "New Orleans",        name: "Louis Armstrong New Orleans International",    lat: 29.9934,  lng: -90.2580  },
  OAK: { city: "Oakland",            name: "Oakland International",                        lat: 37.7213,  lng: -122.2208 },
  SJC: { city: "San Jose",           name: "Mineta San Jose International",                lat: 37.3626,  lng: -121.9290 },
  PBI: { city: "West Palm Beach",    name: "Palm Beach International",                     lat: 26.6832,  lng: -80.0956  },
  RSW: { city: "Fort Myers",         name: "Southwest Florida International",              lat: 26.5362,  lng: -81.7552  },
  OGG: { city: "Maui",               name: "Kahului Airport",                              lat: 20.8986,  lng: -156.4305 },
  HOU: { city: "Houston",            name: "William P. Hobby",                             lat: 29.6454,  lng: -95.2789  },
  SAT: { city: "San Antonio",        name: "San Antonio International",                    lat: 29.5337,  lng: -98.4698  },
  ABQ: { city: "Albuquerque",        name: "Albuquerque International Sunport",            lat: 35.0402,  lng: -106.6090 },
  BDL: { city: "Hartford",           name: "Bradley International",                        lat: 41.9389,  lng: -72.6832  },
  JAX: { city: "Jacksonville",       name: "Jacksonville International",                   lat: 30.4941,  lng: -81.6879  },
  DAL: { city: "Dallas",             name: "Dallas Love Field",                            lat: 32.8470,  lng: -96.8518  },
  SNA: { city: "Orange County",      name: "John Wayne Airport",                           lat: 33.6757,  lng: -117.8682 },
  CVG: { city: "Cincinnati",         name: "Cincinnati/Northern Kentucky International",   lat: 39.0488,  lng: -84.6678  },

  // ── Tier 3: 51–75 ────────────────────────────────────────────────────────────
  BUR: { city: "Burbank",            name: "Hollywood Burbank Airport",                    lat: 34.2007,  lng: -118.3585 },
  IND: { city: "Indianapolis",       name: "Indianapolis International",                   lat: 39.7173,  lng: -86.2944  },
  CMH: { city: "Columbus",           name: "John Glenn Columbus International",            lat: 39.9980,  lng: -82.8919  },
  MKE: { city: "Milwaukee",          name: "Mitchell International",                       lat: 42.9472,  lng: -87.8966  },
  BOI: { city: "Boise",              name: "Boise Airport",                                lat: 43.5644,  lng: -116.2228 },
  TUS: { city: "Tucson",             name: "Tucson International",                         lat: 32.1161,  lng: -110.9410 },
  ELP: { city: "El Paso",            name: "El Paso International",                        lat: 31.8072,  lng: -106.3779 },
  MEM: { city: "Memphis",            name: "Memphis International",                        lat: 35.0424,  lng: -89.9767  },
  SDF: { city: "Louisville",         name: "Muhammad Ali International",                   lat: 38.1744,  lng: -85.7360  },
  CLE: { city: "Cleveland",          name: "Cleveland Hopkins International",              lat: 41.4117,  lng: -81.8498  },
  PIT: { city: "Pittsburgh",         name: "Pittsburgh International",                     lat: 40.4915,  lng: -80.2329  },
  ONT: { city: "Ontario",            name: "Ontario International",                        lat: 34.0560,  lng: -117.6009 },
  BHM: { city: "Birmingham",         name: "Birmingham-Shuttlesworth International",       lat: 33.5629,  lng: -86.7535  },
  ORF: { city: "Norfolk",            name: "Norfolk International",                        lat: 36.8976,  lng: -76.0132  },
  RIC: { city: "Richmond",           name: "Richmond International",                       lat: 37.5052,  lng: -77.3197  },
  SAV: { city: "Savannah",           name: "Savannah/Hilton Head International",           lat: 32.1276,  lng: -81.2021  },
  CHS: { city: "Charleston",         name: "Charleston International",                     lat: 32.8986,  lng: -80.0405  },
  GSP: { city: "Greenville",         name: "Greenville-Spartanburg International",         lat: 34.8957,  lng: -82.2189  },
  LGB: { city: "Long Beach",         name: "Long Beach Airport",                           lat: 33.8177,  lng: -118.1516 },
  PSP: { city: "Palm Springs",       name: "Palm Springs International",                   lat: 33.8297,  lng: -116.5067 },
  BUF: { city: "Buffalo",            name: "Buffalo Niagara International",                lat: 42.9405,  lng: -78.7322  },
  OMA: { city: "Omaha",              name: "Eppley Airfield",                              lat: 41.3032,  lng: -95.8941  },
  TUL: { city: "Tulsa",              name: "Tulsa International",                          lat: 36.1984,  lng: -95.8881  },
  GRR: { city: "Grand Rapids",       name: "Gerald R. Ford International",                 lat: 42.8808,  lng: -85.5228  },
  GSO: { city: "Greensboro",         name: "Piedmont Triad International",                 lat: 36.0978,  lng: -79.9373  },

  // ── Tier 4: 76–100 ───────────────────────────────────────────────────────────
  FAT: { city: "Fresno",             name: "Fresno Yosemite International",                lat: 36.7762,  lng: -119.7181 },
  LIT: { city: "Little Rock",        name: "Bill and Hillary Clinton National",            lat: 34.7294,  lng: -92.2243  },
  SRQ: { city: "Sarasota",           name: "Sarasota Bradenton International",             lat: 27.3954,  lng: -82.5544  },
  PIE: { city: "St. Petersburg",     name: "St. Pete-Clearwater International",            lat: 27.9102,  lng: -82.6874  },
  XNA: { city: "Northwest Arkansas", name: "Northwest Arkansas National",                  lat: 36.2819,  lng: -94.3068  },
  BZN: { city: "Bozeman",            name: "Bozeman Yellowstone International",            lat: 45.7775,  lng: -111.1603 },
  FSD: { city: "Sioux Falls",        name: "Joe Foss Field",                               lat: 43.5820,  lng: -96.7419  },
  PWM: { city: "Portland",           name: "Portland International Jetport",               lat: 43.6462,  lng: -70.3093  },
  HPN: { city: "White Plains",       name: "Westchester County Airport",                   lat: 41.0670,  lng: -73.7076  },
  COS: { city: "Colorado Springs",   name: "Colorado Springs Airport",                     lat: 38.8058,  lng: -104.7008 },
  HSV: { city: "Huntsville",         name: "Huntsville International",                     lat: 34.6372,  lng: -86.7751  },
  PNS: { city: "Pensacola",          name: "Pensacola International",                      lat: 30.4734,  lng: -87.1866  },
  SBN: { city: "South Bend",         name: "South Bend International",                     lat: 41.7087,  lng: -86.3173  },
  GEG: { city: "Spokane",            name: "Spokane International",                        lat: 47.6199,  lng: -117.5339 },
  DSM: { city: "Des Moines",         name: "Des Moines International",                     lat: 41.5340,  lng: -93.6631  },
  ICT: { city: "Wichita",            name: "Dwight D. Eisenhower National",                lat: 37.6499,  lng: -97.4331  },
  ROC: { city: "Rochester",          name: "Greater Rochester International",               lat: 43.1189,  lng: -77.6724  },
  SYR: { city: "Syracuse",           name: "Syracuse Hancock International",               lat: 43.1112,  lng: -76.1063  },
  ALB: { city: "Albany",             name: "Albany International",                         lat: 42.7483,  lng: -73.8020  },
  PVD: { city: "Providence",         name: "T.F. Green International",                     lat: 41.7244,  lng: -71.4283  },
  MHT: { city: "Manchester",         name: "Manchester-Boston Regional",                   lat: 42.9326,  lng: -71.4357  },
  TYS: { city: "Knoxville",          name: "McGhee Tyson Airport",                         lat: 35.8110,  lng: -83.9940  },
  KOA: { city: "Kona",               name: "Ellison Onizuka Kona International",           lat: 19.7388,  lng: -156.0456 },
  MDT: { city: "Harrisburg",         name: "Harrisburg International",                     lat: 40.1935,  lng: -76.7634  },
  SGF: { city: "Springfield",        name: "Springfield-Branson National",                 lat: 37.2457,  lng: -93.3886  },
};

// Calculates the straight-line distance between two GPS coordinates in kilometres.
// We use this instead of the Google Maps API so suggestions work instantly,
// without waiting for a network call.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Returns up to 6 airports that fall geographically "between" the departure
// and arrival, sorted by how directly on-route they are.
//
// The filter is an ellipse: we only include an airport if flying
// dep → airport → arr adds less than 50% extra distance compared to flying
// direct. This naturally captures reasonable connecting cities.
function getSuggestedLayovers(depCode, arrCode) {
  const dep = AIRPORTS[depCode];
  const arr = AIRPORTS[arrCode];
  if (!dep || !arr) return []; // one or both codes not in our list

  const directDist = haversineKm(dep.lat, dep.lng, arr.lat, arr.lng);
  const suggestions = [];

  // Collect the currently selected layovers so we don't suggest them again
  const alreadyAdded = Array.from(layoversList.querySelectorAll(".layover-input"))
    .map(function (input) { return input.value.trim().toUpperCase(); });

  Object.keys(AIRPORTS).forEach(function (code) {
    if (code === depCode || code === arrCode) return;
    if (alreadyAdded.indexOf(code) !== -1) return;

    const airport = AIRPORTS[code];
    const dA = haversineKm(dep.lat, dep.lng, airport.lat, airport.lng);
    const dB = haversineKm(airport.lat, airport.lng, arr.lat, arr.lng);

    if (dA + dB < directDist * 1.5) {
      suggestions.push({ code: code, city: airport.city, sum: dA + dB });
    }
  });

  // Sort so the most "on the way" airports appear first
  suggestions.sort(function (a, b) { return a.sum - b.sum; });
  return suggestions.slice(0, 6);
}

// Re-evaluates and redraws suggestions whenever departure, arrival,
// or the layover list changes.
function updateSuggestions() {
  const depCode = document.getElementById("departure").value.trim().toUpperCase();
  const arrCode = document.getElementById("arrival").value.trim().toUpperCase();
  const suggestionsBox   = document.getElementById("layover-suggestions");
  const suggestionsChips = document.getElementById("suggestions-chips");

  if (depCode.length !== 3 || arrCode.length !== 3) {
    suggestionsBox.classList.add("hidden");
    return;
  }

  const suggestions = getSuggestedLayovers(depCode, arrCode);

  if (suggestions.length === 0) {
    suggestionsBox.classList.add("hidden");
    return;
  }

  // Build one clickable chip per suggestion
  suggestionsChips.innerHTML = "";
  suggestions.forEach(function (airport) {
    const chip = document.createElement("button");
    chip.type      = "button";
    chip.className = "suggestion-chip";

    // Disabled when the layover list is full
    if (layoverCount >= MAX_LAYOVERS) {
      chip.disabled = true;
    }

    chip.innerHTML =
      '<span class="chip-code">' + airport.code + '</span>' +
      '<span class="chip-name">' + airport.city + '</span>';

    chip.addEventListener("click", function () {
      if (layoverCount >= MAX_LAYOVERS) return;

      // Reuse the existing "add layover" logic by creating a new row
      // and filling in the code automatically
      layoverCount++;
      const li = document.createElement("li");
      li.className = "layover-row";
      li.innerHTML =
        '<span class="layover-label">Layover ' + layoverCount + '</span>' +
        '<input class="airport-input layover-input" type="text" maxlength="3" value="' + airport.code + '" />' +
        '<button type="button" class="layover-remove-btn" aria-label="Remove layover">×</button>';
      layoversList.appendChild(li);

      updateAddLayoverBtn();
      updateSuggestions(); // refresh chips (removes this airport, disables if full)
    });

    suggestionsChips.appendChild(chip);
  });

  suggestionsBox.classList.remove("hidden");
}


// ── Dietary preference dropdown ───────────────────────────────────────────────
// Same behaviour as the road trip page.

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
const flightMain          = document.getElementById("flight-main");
const flightFormSection   = document.getElementById("flight-form-section");
const flightResultSection = document.getElementById("flight-results-section");
const flightSearchBtn     = document.getElementById("flight-search-btn");
const flightBackBtn       = document.getElementById("flight-back-btn");
const flightRouteSummary  = document.getElementById("flight-route-summary");
const flightResultsList   = document.getElementById("flight-results-list");
const addLayoverBtn       = document.getElementById("add-layover-btn");
const layoversList        = document.getElementById("layovers-list");

const MAX_LAYOVERS = 3;
let layoverCount = 0;


// ── Layover rows ──────────────────────────────────────────────────────────────

addLayoverBtn.addEventListener("click", function () {
  if (layoverCount >= MAX_LAYOVERS) return;
  layoverCount++;

  const li = document.createElement("li");
  li.className = "layover-row";

  li.innerHTML =
    '<span class="layover-label">Layover ' + layoverCount + '</span>' +
    '<input class="airport-input layover-input" type="text" maxlength="3" placeholder="ORD" />' +
    '<button type="button" class="layover-remove-btn" aria-label="Remove layover">×</button>';

  layoversList.appendChild(li);
  updateAddLayoverBtn();
  li.querySelector("input").focus();
});

layoversList.addEventListener("click", function (e) {
  if (!e.target.classList.contains("layover-remove-btn")) return;
  e.target.closest(".layover-row").remove();
  layoverCount--;
  renumberLayovers();
  updateAddLayoverBtn();
  updateSuggestions(); // removed airport can now reappear as a suggestion
});

function renumberLayovers() {
  layoversList.querySelectorAll(".layover-row").forEach(function (row, i) {
    row.querySelector(".layover-label").textContent = "Layover " + (i + 1);
  });
}

function updateAddLayoverBtn() {
  addLayoverBtn.style.display = layoverCount >= MAX_LAYOVERS ? "none" : "inline-block";
}

// Auto-uppercase layover code inputs as the user types.
// Departure and arrival are handled separately by setupAirportField() below,
// since they accept city names (not just codes) while the user is typing.
document.addEventListener("input", function (e) {
  if (e.target.classList.contains("airport-input")) {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
  }
});


// ── Airport search typeahead ──────────────────────────────────────────────────
// Searches the AIRPORTS list by city name, airport name, or 3-letter code.
// Returns up to 5 matches, with exact code matches shown first.

function searchAirports(query) {
  if (query.length < 2) return [];
  const q = query.toLowerCase().trim();

  const results = Object.keys(AIRPORTS).filter(function (code) {
    const a = AIRPORTS[code];
    return code.toLowerCase().startsWith(q) ||
           a.city.toLowerCase().includes(q) ||
           a.name.toLowerCase().includes(q);
  });

  // Exact code match floats to the top (e.g. typing "ORD" shows ORD first)
  results.sort(function (a, b) {
    return (a.toLowerCase() === q ? 0 : 1) - (b.toLowerCase() === q ? 0 : 1);
  });

  return results.slice(0, 5).map(function (code) {
    return { code: code, city: AIRPORTS[code].city, name: AIRPORTS[code].name };
  });
}

// Wires up the city-name search typeahead for one airport input field.
//   inputId    — id of the <input> element
//   dropdownId — id of the <ul> that appears beneath it

function setupAirportField(inputId, dropdownId) {
  const input    = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  // Show/update dropdown as the user types
  input.addEventListener("input", function () {
    const results = searchAirports(input.value);

    if (results.length === 0) {
      dropdown.classList.add("hidden");
      return;
    }

    dropdown.innerHTML = "";
    results.forEach(function (airport) {
      const li = document.createElement("li");
      li.className = "airport-dropdown-item";
      li.innerHTML =
        '<span class="dropdown-code">' + airport.code + '</span>' +
        '<span class="dropdown-info">' + airport.city + ' · ' + airport.name + '</span>';

      // mousedown fires before blur, so the selection registers before the
      // dropdown closes — preventDefault keeps focus on the input
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();
        input.value = airport.code;
        dropdown.classList.add("hidden");
        updateSuggestions();
      });

      dropdown.appendChild(li);
    });

    dropdown.classList.remove("hidden");
  });

  // Close dropdown when focus leaves the field
  input.addEventListener("blur", function () {
    setTimeout(function () {
      dropdown.classList.add("hidden");
      // If the user typed a bare 3-letter code, uppercase it and refresh suggestions
      if (/^[a-zA-Z]{3}$/.test(input.value.trim())) {
        input.value = input.value.trim().toUpperCase();
        updateSuggestions();
      }
    }, 150);
  });
}

// Wire up all three typeahead fields
setupAirportField("departure",          "departure-dropdown");
setupAirportField("arrival",            "arrival-dropdown");
setupAirportField("airport-quick-input","airport-quick-dropdown");


// ── Mode tab switching ────────────────────────────────────────────────────────

const tabAirport = document.getElementById("tab-airport");
const tabRoute   = document.getElementById("tab-route");
const flightCard = document.querySelector(".flight-card");

// Switching modes: toggle one class on the card — CSS handles what's visible.
tabAirport.addEventListener("click", function () {
  flightCard.classList.replace("mode-route", "mode-airport");
  tabAirport.classList.add("mode-tab--active");
  tabRoute.classList.remove("mode-tab--active");
});

tabRoute.addEventListener("click", function () {
  flightCard.classList.replace("mode-airport", "mode-route");
  tabRoute.classList.add("mode-tab--active");
  tabAirport.classList.remove("mode-tab--active");
});


// ── Step 1 → Step 2: search and show results ──────────────────────────────────

flightSearchBtn.addEventListener("click", function () {
  clearFlightError();

  // ── Shared: collect dietary preferences ──────────────────────────────────
  const selectedDiets = Array.from(dietMenu.querySelectorAll("input:checked"))
    .map(function (cb) { return cb.value; });
  const dietQuery = selectedDiets.join(" ");

  // ── Airport mode: search a single airport directly ────────────────────────
  if (document.querySelector(".flight-card").classList.contains("mode-airport")) {
    const rawInput = document.getElementById("airport-quick-input").value.trim();
    if (!rawInput) {
      showFlightError("Please enter an airport name or code.");
      return;
    }

    const airportCode  = rawInput.toUpperCase();
    const knownAirport = AIRPORTS[airportCode];

    flightRouteSummary.textContent = knownAirport
      ? airportCode + " — " + knownAirport.name
      : rawInput;

    flightResultsList.innerHTML = "";
    flightMain.classList.add("hidden");
    flightResultSection.classList.remove("hidden");

    flightBounds = new google.maps.LatLngBounds();
    flightMarkers.forEach(function (m) { m.setMap(null); });
    flightMarkers = [];

    currentDietQuery     = dietQuery;
    currentSelectedDiets = selectedDiets;
    cardCount            = 1;

    if (!flightMap) {
      flightMap = new google.maps.Map(document.getElementById("flight-map"), {
        center: { lat: 39.5, lng: -98.35 },
        zoom: 4,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
    }

    const card = document.createElement("div");
    card.className = "flight-airport-card";
    card.id = "airport-card-0";
    card.innerHTML =
      '<div class="flight-airport-header">' +
        '<span class="flight-airport-code">' + (knownAirport ? airportCode : rawInput) + '</span>' +
      '</div>' +
      '<div class="flight-airport-loading" id="airport-loading-0">🔍 Finding restaurants…</div>';
    flightResultsList.appendChild(card);

    searchRestaurantsAtAirport(airportCode, dietQuery, function (data) {
      renderAirportCard(0, airportCode, data.restaurants, selectedDiets, data.error, data.location, data.pool);
      renderAddAirportUI();
    });
    return;
  }

  // ── Route mode: existing departure / arrival / layover logic ──────────────
  const departure = document.getElementById("departure").value.trim().toUpperCase();
  const arrival   = document.getElementById("arrival").value.trim().toUpperCase();

  if (!departure || !arrival) {
    showFlightError("Please enter both a departure and an arrival airport code.");
    return;
  }

  // Collect layover codes, skipping any empty inputs
  const layoverInputs = layoversList.querySelectorAll(".layover-input");
  const layovers = Array.from(layoverInputs)
    .map(function (input) { return input.value.trim().toUpperCase(); })
    .filter(function (code) { return code.length > 0; });

  // Build route summary: "LAX  →  ORD  →  JFK"
  const allAirports = [departure].concat(layovers).concat([arrival]);
  flightRouteSummary.textContent = allAirports.join("  →  ");

  flightResultsList.innerHTML = "";

  // Switch to step 2: hide the form panel, show the two-column results layout
  flightMain.classList.add("hidden");
  flightResultSection.classList.remove("hidden");

  // Reset the shared map for this search
  flightBounds = new google.maps.LatLngBounds();
  flightMarkers.forEach(function (m) { m.setMap(null); });
  flightMarkers = [];

  if (!flightMap) {
    flightMap = new google.maps.Map(document.getElementById("flight-map"), {
      center:           { lat: 39.5, lng: -98.35 }, // centre of the US until markers load
      zoom:             4,
      zoomControl:      true,
      streetViewControl: false,
      mapTypeControl:   false,
      fullscreenControl: false,
    });
  }

  // Build the full list of airports to search:
  // departure first, then layovers, then arrival.
  // Each entry carries a "role" so we can show/hide by type later.
  const airportsToSearch = [];
  airportsToSearch.push({ code: departure, role: "departure" });
  layovers.forEach(function (code) {
    airportsToSearch.push({ code: code, role: "layover" });
  });
  airportsToSearch.push({ code: arrival, role: "arrival" });

  currentDietQuery     = dietQuery;
  currentSelectedDiets = selectedDiets;
  cardCount            = airportsToSearch.length;

  // Render airport filter toggles above the results list
  renderAirportFilterToggles(departure, arrival, layovers.length > 0);

  // Create a loading card for each airport right away, then fill them in one by one
  airportsToSearch.forEach(function (airport, i) {
    const card = document.createElement("div");
    card.className = "flight-airport-card";
    card.id = "airport-card-" + i;
    // Tag each card with its role so the filter toggles can show/hide it
    card.dataset.role = airport.role;
    // Departure and arrival cards start hidden — user must toggle them on
    if (airport.role === "departure" || airport.role === "arrival") {
      card.classList.add("hidden");
    }
    card.innerHTML =
      '<div class="flight-airport-header">' +
        '<span class="flight-airport-code">' + airport.code + '</span>' +
        '<span class="flight-airport-role-badge">' + capitalize(airport.role) + '</span>' +
      '</div>' +
      '<div class="flight-airport-loading" id="airport-loading-' + i + '">' +
        '🔍 Finding restaurants at ' + airport.code + '…' +
      '</div>';
    flightResultsList.appendChild(card);
  });

  // Search all airports one at a time so we don't flood the API
  searchAirportsSequentially(airportsToSearch, 0, dietQuery, selectedDiets);
});

// Searches one airport from the list, renders its card, then moves to the next.
// Works for departure, layover, and arrival cards alike.
function searchAirportsSequentially(airports, index, dietQuery, selectedDiets) {
  if (index >= airports.length) {
    renderAddAirportUI();
    return;
  }

  const code = airports[index].code;
  searchRestaurantsAtAirport(code, dietQuery, function (data) {
    renderAirportCard(index, code, data.restaurants, selectedDiets, data.error, data.location, data.pool);
    searchAirportsSequentially(airports, index + 1, dietQuery, selectedDiets);
  });
}


// ── Airport filter toggles ────────────────────────────────────────────────────
// Renders three buttons above the results list:
//   "Departure"  "All Airports"  "Arrival"
// Clicking one shows/hides the cards tagged with data-role="departure" etc.
// "All Airports" shows every card.
// hasLayovers controls whether the middle button says "Layovers" or "All Airports".

function renderAirportFilterToggles(depCode, arrCode, hasLayovers) {
  // Remove any existing toggle bar from a previous search
  const existing = document.getElementById("airport-filter-bar");
  if (existing) existing.remove();

  const bar = document.createElement("div");
  bar.className = "airport-filter-bar";
  bar.id = "airport-filter-bar";

  // Which filter is currently active — starts on "layovers" (or "all" if no layovers)
  let activeFilter = hasLayovers ? "layover" : "all";

  const buttons = [
    { label: "Departure · " + depCode, filter: "departure" },
    { label: hasLayovers ? "Layovers" : "All Airports", filter: hasLayovers ? "layover" : "all" },
    { label: "Arrival · " + arrCode,   filter: "arrival"   },
  ];

  buttons.forEach(function (def) {
    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "airport-filter-btn" + (def.filter === activeFilter ? " airport-filter-btn--active" : "");
    btn.textContent = def.label;
    btn.dataset.filter = def.filter;

    btn.addEventListener("click", function () {
      activeFilter = def.filter;

      // Update active styling
      bar.querySelectorAll(".airport-filter-btn").forEach(function (b) {
        b.classList.toggle("airport-filter-btn--active", b.dataset.filter === activeFilter);
      });

      // Show / hide cards
      document.querySelectorAll(".flight-airport-card[data-role]").forEach(function (card) {
        const show = activeFilter === "all" || card.dataset.role === activeFilter;
        card.classList.toggle("hidden", !show);
      });
    });

    bar.appendChild(btn);
  });

  // Insert the bar inside the left panel, above the scrollable results list
  const leftPanel = document.getElementById("flight-left-panel");
  leftPanel.insertBefore(bar, flightResultsList);
}


// ── API: search for restaurants at one airport ────────────────────────────────
// 1. Geocode the airport code to get its GPS coordinates
// 2. Run a Places textSearch for restaurants near those coordinates
// 3. Fetch the website for each result via getDetails
// 4. Call back with { restaurants, error }

function searchRestaurantsAtAirport(airportCode, dietQuery, callback) {
  // Return cached result immediately if we've already searched this combination
  const cacheKey = airportCode + "|" + dietQuery;
  if (airportSearchCache[cacheKey]) {
    callback(airportSearchCache[cacheKey]);
    return;
  }

  // Step 1: convert the 3-letter code into GPS coordinates
  geocoder.geocode({ address: airportCode + " airport" }, function (geoResults, geoStatus) {
    if (geoStatus !== "OK" || !geoResults.length) {
      callback({ restaurants: [], location: null, error: 'Could not locate airport "' + airportCode + '". Check the code and try again.' });
      return;
    }

    const airportLocation = geoResults[0].geometry.location;

    // Step 2: search for restaurants at/near the airport
    // The query combines the dietary preferences with the airport code so Google
    // returns the most relevant results, e.g. "keto restaurant ORD airport"
    const dietPhrase = dietQuery ? dietQuery + " " : "";
    const query      = dietPhrase + "restaurant inside " + airportCode + " airport terminal";

    placesService.textSearch(
      {
        query:    query,
        location: airportLocation,
        radius:   3000, // 3 km keeps results within the terminal area
      },
      function (results, status) {
        if (status === google.maps.places.PlacesServiceStatus.OK && results.length > 0) {
          // Step 3: enrich only the first 3 results upfront, but keep the
          // full results array as the pool so the "Show additional options"
          // button can load the next 3 on demand.
          enrichWithWebsite(results.slice(0, 3), airportLocation, results, function (data) {
            airportSearchCache[cacheKey] = data; // save for re-use
            callback(data);
          });
        } else {
          callback({ restaurants: [], pool: [], location: airportLocation });
        }
      }
    );
  });
}

// Fetches the website URL for each place via getDetails, then calls back
// with { restaurants: [...enriched places], pool, location }
// pool — the full unfiltered results array, passed through so callers can
//        offer a "Show additional options" button later.
function enrichWithWebsite(places, location, pool, callback) {
  const enriched = [];
  let index = 0;

  function fetchNext() {
    if (index >= places.length) {
      callback({ restaurants: enriched, pool: pool, location: location });
      return;
    }

    const place = places[index];
    placesService.getDetails(
      { placeId: place.place_id, fields: ["website", "opening_hours", "formatted_address"] },
      function (details, status) {
        if (status === google.maps.places.PlacesServiceStatus.OK && details) {
          if (details.website)         place.website         = details.website;
          if (details.opening_hours)   place.opening_hours   = details.opening_hours;
          if (details.formatted_address) place.formatted_address = details.formatted_address;
        }
        enriched.push(place);
        index++;
        fetchNext();
      }
    );
  }

  fetchNext();
}


// ── Terminal / gate parser ────────────────────────────────────────────────────
// Scans a place's formatted_address for mentions of a terminal or gate number.
// Google Places doesn't return a dedicated terminal field, but airport
// restaurants often have it embedded in their address, e.g.
//   "Terminal B, O'Hare International Airport, ..."
//   "Concourse C, Gate 12, Hartsfield-Jackson Atlanta International, ..."
// Returns { terminal: "Terminal B" | null, gate: "Near Gate 12" | null }

function parseTerminalInfo(address) {
  if (!address) return { terminal: null, gate: null };

  var termMatch      = address.match(/terminal\s+([a-z0-9]+)/i);
  var concourseMatch = address.match(/concourse\s+([a-z0-9]+)/i);
  var gateMatch      = address.match(/\bgate\s+([a-z0-9]+)/i);

  var terminal = termMatch
    ? "Terminal " + termMatch[1].toUpperCase()
    : concourseMatch
      ? "Concourse " + concourseMatch[1].toUpperCase()
      : null;

  var gate = gateMatch ? "Near Gate " + gateMatch[1].toUpperCase() : null;

  return { terminal: terminal, gate: gate };
}


// Returns a short label like "8 gluten free options" or "12 options".
function buildCountLabel(count, selectedDiets) {
  if (!count) return "";
  const suffix = count === 1 ? "option" : "options";
  if (selectedDiets.length === 1) {
    return count + " " + selectedDiets[0] + " " + suffix;
  } else if (selectedDiets.length > 1) {
    return count + " " + suffix + " matching your preferences";
  }
  return count + " " + suffix;
}


// ── Render one airport's results into its card ────────────────────────────────

function renderAirportCard(cardIndex, code, restaurants, selectedDiets, error, location, pool) {
  const card   = document.getElementById("airport-card-" + cardIndex);
  const loader = document.getElementById("airport-loading-" + cardIndex);
  if (!card) return;
  if (loader) loader.remove(); // clear the "Finding restaurants…" message

  if (error) {
    const errDiv = document.createElement("div");
    errDiv.className = "flight-airport-placeholder";
    errDiv.textContent = error;
    card.appendChild(errDiv);
    return;
  }

  if (restaurants.length === 0) {
    const empty = document.createElement("div");
    empty.className = "flight-airport-placeholder";
    empty.textContent = "No matching restaurants found at " + code + ". Try adjusting your dietary preferences.";
    card.appendChild(empty);
    return;
  }

  // ── Add toggle arrow to the header and make it collapsible ──────────────
  const header = card.querySelector(".flight-airport-header");
  header.classList.add("flight-airport-header--toggle", "flight-airport-header--collapsed");

  // Wrap the existing code/badge spans in a top row, then add the arrow
  const topRow = document.createElement("div");
  topRow.className = "flight-airport-header-top";
  Array.from(header.childNodes).forEach(function (node) { topRow.appendChild(node); });
  header.appendChild(topRow);

  const arrow = document.createElement("span");
  arrow.className = "flight-airport-toggle-arrow";
  arrow.textContent = "▾";
  topRow.appendChild(arrow);

  // Options count shown below the airport code, visible even when collapsed
  const countLabel = buildCountLabel(pool ? pool.length : 0, selectedDiets);
  if (countLabel) {
    const countDiv = document.createElement("div");
    countDiv.className = "flight-options-count";
    countDiv.textContent = countLabel;
    header.appendChild(countDiv);
  }

  // All content below the header lives in this collapsible wrapper
  const contentWrapper = document.createElement("div");
  contentWrapper.className = "flight-airport-content flight-airport-content--collapsed";
  card.appendChild(contentWrapper);

  // Accordion toggle: open this card, close all others, zoom map
  header.addEventListener("click", function () {
    const isCollapsed = contentWrapper.classList.contains("flight-airport-content--collapsed");
    if (isCollapsed) {
      // Close every other open card
      document.querySelectorAll(".flight-airport-content").forEach(function (c) {
        c.classList.add("flight-airport-content--collapsed");
      });
      document.querySelectorAll(".flight-airport-header--toggle").forEach(function (h) {
        h.classList.add("flight-airport-header--collapsed");
      });
      // Open this one
      contentWrapper.classList.remove("flight-airport-content--collapsed");
      header.classList.remove("flight-airport-header--collapsed");
      // Zoom the map to this airport
      if (flightMap && location) {
        flightMap.panTo(location);
        flightMap.setZoom(14);
      }
    } else {
      contentWrapper.classList.add("flight-airport-content--collapsed");
      header.classList.add("flight-airport-header--collapsed");
    }
  });

  // ── Shared map: drop a pin for each restaurant ───────────────────────────
  if (flightMap && location) {
    flightBounds.extend(location);

    restaurants.forEach(function (place) {
      if (!place.geometry || !place.geometry.location) return;

      const marker = new google.maps.Marker({
        position: place.geometry.location,
        map:      flightMap,
        title:    place.name,
      });

      const infoWindow = new google.maps.InfoWindow({
        content:
          '<strong>' + place.name + '</strong>' +
          (place.rating ? '<br>★ ' + place.rating.toFixed(1) : ''),
      });

      marker.addListener("click", function () {
        infoWindow.open(flightMap, marker);
      });

      flightMarkers.push(marker);
      flightBounds.extend(place.geometry.location);
    });

    // Fit the map to all markers collected so far
    flightMap.fitBounds(flightBounds);
  }

  // If dietary preferences were selected, show them as tags above the results
  if (selectedDiets.length > 0) {
    const filterRow = document.createElement("div");
    filterRow.className = "flight-filter-row";
    filterRow.innerHTML = "Filtered for: " +
      selectedDiets.map(function (d) {
        return '<span class="diet-tag">' + capitalize(d) + '</span>';
      }).join("");
    contentWrapper.appendChild(filterRow);
  }

  // Container for restaurant rows — replaced when "Show additional options" loads more
  const optionsContainer = document.createElement("div");
  contentWrapper.appendChild(optionsContainer);

  // Tracks how far into the pool we've shown so far
  let poolOffset = 3;

  // Builds restaurant rows for the given batch, labelled Option A, B, C …
  // startLabel controls the letter offset so additional options continue from D, G, etc.
  function renderOptionRows(places, startLabel) {
    places.forEach(function (place, i) {
      const name    = place.name;
      const rating  = place.rating ? place.rating.toFixed(1) : null;
      const cuisine = getCuisineLabel(place.types || []);

      // Terminal / gate — parsed from the formatted_address Google returned
      const loc    = parseTerminalInfo(place.formatted_address || "");
      const hasLoc = loc.terminal || loc.gate;

      // Opening hours — weekday_text is an array like ["Monday: 6:00 AM – 10:00 PM", ...]
      const hoursText = place.opening_hours && place.opening_hours.weekday_text;
      const hasHours  = hoursText && hoursText.length > 0;

      // Today's hours: Google indexes Mon=0 … Sun=6
      // JavaScript's getDay() returns Sun=0 … Sat=6, so we convert
      const jsDayIndex     = new Date().getDay();
      const googleDayIndex = (jsDayIndex + 6) % 7;
      const todayHours     = hasHours
        ? hoursText[googleDayIndex].replace(/^[^:]+:\s*/, "")
        : null;

      const allHoursHTML = hasHours
        ? hoursText.map(function (h) { return '<li>' + h + '</li>'; }).join('')
        : '';

      // Location line: prefer terminal/gate, fall back to formatted address
      const locationLine = hasLoc
        ? (loc.terminal || '') + (loc.terminal && loc.gate ? ' · ' : '') + (loc.gate || '')
        : (place.formatted_address || '');

      const mapLat  = place.geometry && place.geometry.location ? place.geometry.location.lat() : null;
      const mapLng  = place.geometry && place.geometry.location ? place.geometry.location.lng() : null;
      const mapName = encodeURIComponent(name);
      const mapsLinksHTML = (mapLat && mapLng)
        ? '<div class="maps-links">' +
            '<span class="maps-links-label">Open in maps:</span> ' +
            '<a href="https://www.google.com/maps/place/?q=place_id:' + place.place_id + '" target="_blank" rel="noopener" class="maps-link">Google Maps</a>' +
            '<a href="https://maps.apple.com/?q=' + mapName + '&ll=' + mapLat + ',' + mapLng + '" target="_blank" rel="noopener" class="maps-link">Apple Maps</a>' +
            '<a href="https://waze.com/ul?ll=' + mapLat + ',' + mapLng + '&navigate=yes" target="_blank" rel="noopener" class="maps-link">Waze</a>' +
          '</div>' +
          '<div class="maps-links">' +
            '<span class="maps-links-label">Order online:</span> ' +
            '<a href="https://www.doordash.com/search/store/' + mapName + '/" target="_blank" rel="noopener" class="maps-link order-link">DoorDash</a>' +
            '<a href="https://www.ubereats.com/search?q=' + mapName + '" target="_blank" rel="noopener" class="maps-link order-link">Uber Eats</a>' +
          '</div>'
        : '';

      const item = document.createElement("div");
      item.className = "flight-restaurant-item flight-restaurant-item--divider";

      item.innerHTML =
        '<div class="option-label">Option ' + String.fromCharCode(65 + startLabel + i) + '</div>' +
        '<div class="flight-restaurant-name">' + name + '</div>' +
        (hasLoc ? '<div class="restaurant-address">' + locationLine + '</div>' : '') +
        '<div class="restaurant-meta">' +
          (rating ? '<span class="rating">★ ' + rating + '</span>' : '') +
          (rating && cuisine ? ' · ' : '') +
          (cuisine ? '<span>' + cuisine + '</span>' : '') +
          (todayHours ? ' · <span class="today-hours">Today: ' + todayHours + '</span>' : '') +
        '</div>' +
        (allHoursHTML
          ? '<details class="all-hours"><summary>See all hours</summary><ul>' + allHoursHTML + '</ul></details>'
          : '') +
        (place.website
          ? '<a class="restaurant-website" href="' + place.website + '" target="_blank" rel="noopener">Visit website ↗</a>'
          : '') +
        mapsLinksHTML;

      optionsContainer.appendChild(item);
    });
  }

  // Render the initial 3 results
  renderOptionRows(restaurants, 0);

  // "Show additional options" button — only shown when the pool has more results
  if (pool && pool.length > 3) {
    const moreRow = document.createElement("div");
    moreRow.className = "flight-more-options-row";

    const moreBtn = document.createElement("button");
    moreBtn.type      = "button";
    moreBtn.className = "flight-more-options-btn";
    moreBtn.textContent = "Show additional options";
    moreRow.appendChild(moreBtn);
    contentWrapper.appendChild(moreRow);

    moreBtn.addEventListener("click", function () {
      // Hide the button while loading
      moreBtn.disabled    = true;
      moreBtn.textContent = "Loading…";

      // Grab the next 3 from the pool (stop at the end — no wrapping)
      const nextBatch = pool.slice(poolOffset, poolOffset + 3);
      const labelStart = poolOffset; // so letters continue: D, E, F…
      poolOffset += nextBatch.length;

      enrichWithWebsite(nextBatch, location, pool, function (data) {
        renderOptionRows(data.restaurants, labelStart);

        // Hide the button once the pool is exhausted
        if (poolOffset >= pool.length) {
          moreRow.remove();
        } else {
          moreBtn.disabled    = false;
          moreBtn.textContent = "Show additional options";
        }
      });
    });
  }
}


// ── Add additional airport ────────────────────────────────────────────────────
// Renders a button at the bottom of the results panel that lets the user
// search any extra airport and append its card to the current results.

function renderAddAirportUI() {
  // Remove any existing instance so we don't get duplicates on re-render
  const existing = document.getElementById("add-airport-ui");
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.id = "add-airport-ui";
  container.className = "add-airport-container";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "add-airport-toggle-btn";
  toggleBtn.textContent = "+ Add an additional airport?";
  container.appendChild(toggleBtn);

  const form = document.createElement("div");
  form.className = "add-airport-form hidden";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "airport-input add-airport-input";
  input.maxLength = 3;
  input.placeholder = "Airport code (e.g. ORD)";

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "add-airport-search-btn";
  searchBtn.textContent = "Search";

  form.appendChild(input);
  form.appendChild(searchBtn);
  container.appendChild(form);

  // Auto-uppercase as the user types
  input.addEventListener("input", function () {
    const pos = input.selectionStart;
    input.value = input.value.toUpperCase();
    input.setSelectionRange(pos, pos);
  });

  toggleBtn.addEventListener("click", function () {
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) input.focus();
  });

  function doSearch() {
    const code = input.value.trim().toUpperCase();
    if (!code) return;

    const newIndex = cardCount;
    cardCount++;

    // Create a loading card and scroll it into view
    const card = document.createElement("div");
    card.className = "flight-airport-card";
    card.id = "airport-card-" + newIndex;
    card.innerHTML =
      '<div class="flight-airport-header">' +
        '<span class="flight-airport-code">' + code + '</span>' +
      '</div>' +
      '<div class="flight-airport-loading" id="airport-loading-' + newIndex + '">' +
        '🔍 Finding restaurants at ' + code + '…' +
      '</div>';

    // Insert the new card before the add-airport UI so it stays at the bottom
    flightResultsList.appendChild(card);
    card.scrollIntoView({ behavior: "smooth", block: "start" });

    input.value = "";
    form.classList.add("hidden");

    searchRestaurantsAtAirport(code, currentDietQuery, function (data) {
      renderAirportCard(newIndex, code, data.restaurants, currentSelectedDiets, data.error, data.location, data.pool);
    });
  }

  searchBtn.addEventListener("click", doSearch);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") doSearch();
  });

  document.getElementById("flight-left-panel").appendChild(container);
}


// ── Step 2 → Step 1: back button ─────────────────────────────────────────────

flightBackBtn.addEventListener("click", function () {
  flightResultSection.classList.add("hidden");
  flightMain.classList.remove("hidden");
});


// ── Error helpers ─────────────────────────────────────────────────────────────

function showFlightError(message) {
  clearFlightError();
  const div = document.createElement("div");
  div.className = "error-message";
  div.id        = "flight-error";
  div.textContent = message;
  flightForm.after(div);
}

function clearFlightError() {
  const existing = document.getElementById("flight-error");
  if (existing) existing.remove();
}
