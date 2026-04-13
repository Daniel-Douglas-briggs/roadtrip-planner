// =============================================
// app.js — Road Trip Planner  (Phase 2)
//
// How it works, top to bottom:
//   1. initMap()         — Google calls this automatically when Maps loads
//   2. form "submit"     — user clicks the button
//   3. planRoute()       — asks Google for the driving directions
//   4. getWaypoints()    — finds GPS coordinates every N miles along the route
//   5. searchAllWaypoints() — loops through each waypoint
//   6. searchRestaurantsAtWaypoint() — asks Places API for a nearby restaurant
//   7. displayResults()  — builds the cards and map pins
// =============================================


// ── Google Maps objects ───────────────────────────────────────────────────────
// These are declared here but created inside initMap() once the API loads.

let map;
let directionsService;   // calculates the route
let directionsRenderer;  // draws the route line on the map
let placesService;       // searches for nearby restaurants
let geocoder;            // converts GPS coordinates → city names
let markers           = []; // numbered stop pins (green circles)
let restaurantMarkers = []; // selected restaurant pins (orange, used by custom stops)
let poolMarkers       = []; // { marker, placeId, isDisplayed } — all results for the open card
let selectedPoolMarker = null; // the entry whose marker is currently a yellow star
let currentSelectedDiets = []; // dietary preferences from the most recent search


// ── API load error handlers ───────────────────────────────────────────────────
// showMapError() swaps out the blank map for a friendly message.
// It is called in two situations:
//   1. The <script> tag itself fails (network down, URL wrong) — via onerror=
//   2. The API key is rejected by Google — via gm_authFailure() below

function showMapError() {
  document.getElementById("map").classList.add("hidden");
  document.getElementById("map-error").classList.remove("hidden");
  // Disable the search button so users aren't confused by a form with no map
  searchBtn.disabled    = true;
  searchBtn.textContent = "Map unavailable";
}

// Google calls this automatically when the API key is invalid or restricted
function gm_authFailure() {
  showMapError();
}


// ── Step 1: initialise the map ───────────────────────────────────────────────
// Google Maps calls this function automatically after it finishes loading
// (because we wrote "callback=initMap" in the script tag in index.html).

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 39.5, lng: -98.35 }, // roughly the centre of the USA
    zoom: 4,
    mapTypeControl: false,    // hide the Map/Satellite toggle (keeps it clean)
    streetViewControl: false, // hide the little orange pegman
    fullscreenControlOptions: {
      position: google.maps.ControlPosition.BOTTOM_RIGHT,
    },
  });

  directionsService = new google.maps.DirectionsService();

  // suppressMarkers: true — we'll draw our own numbered green pins
  directionsRenderer = new google.maps.DirectionsRenderer({ suppressMarkers: true });
  directionsRenderer.setMap(map);

  // PlacesService must be attached to a live Map object
  placesService = new google.maps.places.PlacesService(map);

  geocoder = new google.maps.Geocoder();

  // Attach city autocomplete to the start and end inputs
  new google.maps.places.Autocomplete(document.getElementById("start"), { types: ["(cities)"] });
  new google.maps.places.Autocomplete(document.getElementById("end"),   { types: ["(cities)"] });

  // Attach autocomplete to the "Your Stops" input on page load
  // (it's visible by default, so we set it up immediately)
  setupWaypointAutocomplete();

  // Replay a saved trip search if URL params are present
  const urlParams = new URLSearchParams(window.location.search);
  const replayStart = urlParams.get("start");
  const replayEnd   = urlParams.get("end");
  if (replayStart && replayEnd) {
    const replayMode     = urlParams.get("mode") || "custom";
    const replayDiets    = urlParams.get("diets") ? urlParams.get("diets").split(",").filter(Boolean) : [];
    const replayInterval = urlParams.get("interval");
    const replayWaypoints = urlParams.get("waypoints") ? urlParams.get("waypoints").split("|").filter(Boolean) : [];

    document.getElementById("start").value = replayStart;
    document.getElementById("end").value   = replayEnd;

    // Set mode
    if (replayMode === "interval") {
      modeIntervalBtn.click();
      if (replayInterval) document.getElementById("interval").value = replayInterval;
    } else {
      modeCustomBtn.click();
      customWaypoints = replayWaypoints;
      renderWaypointsList();
    }

    // Check diet boxes
    replayDiets.forEach(function (diet) {
      const cb = dietMenu.querySelector('input[value="' + diet + '"]');
      if (cb) cb.checked = true;
    });
    if (replayDiets.length === 0) {
      dietToggleLabel.textContent = "None selected";
    } else if (replayDiets.length <= 2) {
      dietToggleLabel.textContent = replayDiets.map(function (d) {
        return d.charAt(0).toUpperCase() + d.slice(1);
      }).join(", ");
    } else {
      dietToggleLabel.textContent = replayDiets.length + " selected";
    }

    searchBtn.click();
  }
}


// ── Form elements ─────────────────────────────────────────────────────────────

const form      = document.getElementById("trip-form");
const resultBox = document.getElementById("results");
const stopsList = document.getElementById("stops-list");
const searchBtn = document.getElementById("search-btn");


// ── Stop mode toggle ──────────────────────────────────────────────────────────
// Tracks whether the user wants auto interval stops or their own custom cities.

let currentMode    = "custom"; // "interval" or "custom"
let customWaypoints = [];        // city strings the user has added in custom mode
let waypointAutocomplete = null; // Google Places Autocomplete for the waypoint input

const modeIntervalBtn   = document.getElementById("mode-interval-btn");
const modeCustomBtn     = document.getElementById("mode-custom-btn");
const intervalSection   = document.getElementById("interval-section");
const waypointsSection  = document.getElementById("waypoints-section");
const waypointCityInput = document.getElementById("waypoint-city-input");
const addWaypointBtn    = document.getElementById("add-waypoint-btn");
const waypointsList     = document.getElementById("waypoints-list");

modeIntervalBtn.addEventListener("click", function () {
  currentMode = "interval";
  modeIntervalBtn.classList.add("mode-tab--active");
  modeCustomBtn.classList.remove("mode-tab--active");
  intervalSection.classList.remove("hidden");
  waypointsSection.classList.add("hidden");
});

modeCustomBtn.addEventListener("click", function () {
  currentMode = "custom";
  modeCustomBtn.classList.add("mode-tab--active");
  modeIntervalBtn.classList.remove("mode-tab--active");
  waypointsSection.classList.remove("hidden");
  intervalSection.classList.add("hidden");
  setupWaypointAutocomplete();
});

// Attach Google Places Autocomplete to the waypoint input, biased toward the
// geographic area between the user's start and end cities.
function setupWaypointAutocomplete() {
  // Only set up once
  if (waypointAutocomplete) return;

  waypointAutocomplete = new google.maps.places.Autocomplete(waypointCityInput, {
    types: ["(cities)"],  // cities only — no street addresses or businesses
  });

  // Bias the suggestions toward the route area if start/end are filled in
  const startVal = document.getElementById("start").value.trim();
  const endVal   = document.getElementById("end").value.trim();

  if (startVal && endVal) {
    // Geocode both cities and use their coordinates to set a bounding box
    const bounds = new google.maps.LatLngBounds();
    let resolved = 0;
    [startVal, endVal].forEach(function (city) {
      geocoder.geocode({ address: city }, function (results, status) {
        if (status === "OK" && results[0]) {
          bounds.extend(results[0].geometry.location);
        }
        resolved++;
        if (resolved === 2) {
          waypointAutocomplete.setBounds(bounds);
        }
      });
    });
  }

  // When the user picks a city from the dropdown, add it to the list automatically
  waypointAutocomplete.addListener("place_changed", function () {
    const place = waypointAutocomplete.getPlace();
    const cityName = place.name || waypointCityInput.value.trim();
    if (!cityName) return;
    customWaypoints.push(cityName);
    waypointCityInput.value = "";
    renderWaypointsList();
  });
}

// Add a city to the list when the button is clicked …
addWaypointBtn.addEventListener("click", function () {
  const city = waypointCityInput.value.trim();
  if (!city) return;
  customWaypoints.push(city);
  waypointCityInput.value = "";
  renderWaypointsList();
});

// … or when the user presses Enter in the input field
waypointCityInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    addWaypointBtn.click();
  }
});

// Re-draw the list every time a city is added or removed
function renderWaypointsList() {
  waypointsList.innerHTML = "";
  customWaypoints.forEach(function (city, i) {
    const li = document.createElement("li");
    li.className = "waypoint-item";
    li.innerHTML =
      city +
      ' <button type="button" class="waypoint-remove-btn" data-index="' + i + '">×</button>';
    waypointsList.appendChild(li);
  });
}

// Remove a city when its × button is clicked
waypointsList.addEventListener("click", function (e) {
  if (e.target.classList.contains("waypoint-remove-btn")) {
    const index = parseInt(e.target.getAttribute("data-index"), 10);
    customWaypoints.splice(index, 1);
    renderWaypointsList();
  }
});

// ── Dietary preference checkboxes ────────────────────────────────────────────
// Dropdown toggle — clicking the bar opens/closes the checkbox list.

const dietMenu        = document.getElementById("diet-dropdown-menu");
const dietDropdown    = document.getElementById("diet-dropdown");
const dietToggleBtn   = document.getElementById("diet-toggle-btn");
const dietToggleLabel = document.getElementById("diet-toggle-label");

// Open / close on toggle click
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

// Close when clicking anywhere outside the dropdown
document.addEventListener("click", function (e) {
  if (!dietDropdown.contains(e.target)) {
    dietMenu.setAttribute("hidden", "");
    dietDropdown.classList.remove("open");
  }
});

// Update the summary label whenever a checkbox changes, and auto-save if logged in
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

  // Save the raw values (not display names) to Firestore for the logged-in user
  const values = Array.from(dietMenu.querySelectorAll("input:checked"))
    .map(function (cb) { return cb.value; });
  if (window.savePreferences) window.savePreferences(values);
});


// ── Step 2: react to the button being clicked ────────────────────────────────
// The button is type="button" (not type="submit") so the browser never
// tries to submit the form or reload the page — no preventDefault needed.

searchBtn.addEventListener("click", async function () {
  const start = document.getElementById("start").value.trim();
  const end   = document.getElementById("end").value.trim();

  // Collect every checked dietary option into one search string
  // e.g. ["gluten free", "vegan"] → "gluten free vegan"
  const checkedDiets = Array.from(
    dietMenu.querySelectorAll("input:checked")
  ).map(function (cb) { return cb.value; });
  const diet = checkedDiets.join(" ");
  currentSelectedDiets = checkedDiets;

  if (!start || !end) {
    showError("Please enter both a starting city and a destination.");
    return;
  }

  // ── Phase 4: check search limit before doing anything ─────────────────────
  if (window.checkSearchLimit && !await window.checkSearchLimit()) return;

  // Set trip context for Phase 3 pinning
  const searchParams = {
    start: start,
    end:   end,
    mode:  currentMode,
    diets: checkedDiets,
  };
  if (currentMode === "interval") {
    searchParams.interval = parseInt(document.getElementById("interval").value, 10);
  } else {
    searchParams.waypoints = customWaypoints.slice();
  }
  if (window.setCurrentTrip) window.setCurrentTrip("Road trip from " + start + " to " + end, "roadtrip", searchParams);

  // Record the search now that it's confirmed allowed
  if (window.recordSearch) window.recordSearch();

  if (currentMode === "interval") {
    // ── Interval mode ──────────────────────────────────────────────────────
    const interval = parseInt(document.getElementById("interval").value, 10);
    if (!interval || interval < 50) {
      showError("Please enter a stop interval of at least 50 miles.");
      return;
    }
    clearResults();
    clearMarkers();
    clearRestaurantMarkers();
    clearPoolMarkers();
    showLoading();
    planRoute(start, end, interval, diet);

  } else {
    // ── Custom stops mode ──────────────────────────────────────────────────
    if (customWaypoints.length === 0) {
      showError("Please add at least one stop before searching.");
      return;
    }
    clearResults();
    clearMarkers();
    clearRestaurantMarkers();
    clearPoolMarkers();
    showLoading();
    planRouteWithWaypoints(start, end, customWaypoints, diet);
  }
});


// ── Step 3: get the driving route from Google ─────────────────────────────────

function planRoute(start, end, intervalMiles, diet) {
  directionsService.route(
    {
      origin: start,
      destination: end,
      travelMode: google.maps.TravelMode.DRIVING,
    },
    function (result, status) {
      if (status !== "OK") {
        resetButton();
        showError(
          "Could not find a route between those cities. " +
          "Please check the city names and try again."
        );
        return;
      }

      // Draw the blue route line on the map
      directionsRenderer.setDirections(result);

      // Calculate total distance in miles
      const route       = result.routes[0];
      const totalMeters = route.legs.reduce(function (sum, leg) {
        return sum + leg.distance.value;
      }, 0);
      const totalMiles = Math.round(totalMeters / 1609.34);

      if (totalMiles < intervalMiles) {
        resetButton();
        showError(
          "Your route is only " + totalMiles + " miles. " +
          "Try a shorter stop interval."
        );
        return;
      }

      // Find GPS coordinates every N miles along the route
      const waypoints = getWaypointsAlongRoute(route.overview_path, intervalMiles);

      if (waypoints.length === 0) {
        resetButton();
        showError("Could not calculate stops. Try a shorter interval.");
        return;
      }

      // Search for restaurants at each waypoint
      searchAllWaypoints(waypoints, diet, totalMiles);
    }
  );
}


// ── Step 3b: plan a route through user-specified cities ───────────────────────
// Used when the user is in "Add My Own Stops" mode.
// Instead of calculating stops every N miles, we pass the user's cities
// directly to the Directions API as waypoints and search for restaurants there.

function planRouteWithWaypoints(start, end, stopCities, diet) {
  directionsService.route(
    {
      origin:            start,
      destination:       end,
      waypoints:         stopCities.map(function (city) {
        return { location: city, stopover: true };
      }),
      optimizeWaypoints: true,   // reorder stops into actual drive order
      travelMode:        google.maps.TravelMode.DRIVING,
    },
    function (result, status) {
      if (status !== "OK") {
        resetButton();
        showError(
          "Could not find a route between those cities. " +
          "Please check the city names and try again."
        );
        return;
      }

      directionsRenderer.setDirections(result);

      const route       = result.routes[0];
      const totalMeters = route.legs.reduce(function (sum, leg) {
        return sum + leg.distance.value;
      }, 0);
      const totalMiles = Math.round(totalMeters / 1609.34);

      // Google may have reordered the stops — update the list to show drive order
      if (route.waypoint_order && route.waypoint_order.length > 0) {
        customWaypoints = route.waypoint_order.map(function (i) { return stopCities[i]; });
        renderWaypointsList();
      }

      // Each leg ends at one of the user's waypoint cities.
      // We skip the last leg because it ends at the destination, not a stop.
      const waypoints = route.legs.slice(0, -1).map(function (leg) {
        return {
          point:        leg.end_location,
          windowPoints: [leg.end_location],
        };
      });

      searchAllWaypoints(waypoints, diet, totalMiles);
    }
  );
}


// ── Step 4: calculate waypoint coordinates every N miles ─────────────────────
// Returns an array of { point, windowPoints } objects.
//   point        — the exact GPS coordinate at the N-mile mark
//   windowPoints — a sample of route points within ±25 miles of that mark,
//                  used to check whether a restaurant is close to the route
//                  (not just close to a single dot on the road)

function getWaypointsAlongRoute(overviewPath, intervalMiles) {
  const intervalMeters = intervalMiles * 1609.34;
  const windowMeters   = 25 * 1609.34; // ±25 miles along the route

  // Build a cumulative-distance array so we can look up any position by mileage
  const cumDist = [0];
  for (let i = 1; i < overviewPath.length; i++) {
    const d = google.maps.geometry.spherical.computeDistanceBetween(
      overviewPath[i - 1], overviewPath[i]
    );
    cumDist.push(cumDist[i - 1] + d);
  }
  const totalDist = cumDist[cumDist.length - 1];

  const waypoints  = [];
  let   targetDist = intervalMeters;

  while (targetDist < totalDist - intervalMeters * 0.25) {
    // Find the path index whose cumulative distance is closest to targetDist
    let idx = 0;
    for (let i = 0; i < cumDist.length; i++) {
      if (cumDist[i] <= targetDist) idx = i;
      else break;
    }

    // Collect all route points within ±25 miles of this stop
    const windowPoints = [];
    for (let i = 0; i < overviewPath.length; i++) {
      if (
        cumDist[i] >= targetDist - windowMeters &&
        cumDist[i] <= targetDist + windowMeters
      ) {
        windowPoints.push(overviewPath[i]);
      }
    }

    // Sub-sample to ~10 points so distance checks stay fast
    const step          = Math.max(1, Math.floor(windowPoints.length / 10));
    const sampledWindow = windowPoints.filter(function (_, i) {
      return i % step === 0;
    });

    waypoints.push({ point: overviewPath[idx], windowPoints: sampledWindow });
    targetDist += intervalMeters;
  }

  return waypoints;
}


// ── Step 5: search each waypoint one at a time ───────────────────────────────
// We search one at a time (not all at once) to avoid overwhelming the API.
// This function calls itself repeatedly until every waypoint is done.

function searchAllWaypoints(waypoints, diet, totalMiles) {
  const results = [];
  let   index   = 0;

  function searchNext() {
    if (index >= waypoints.length) {
      // All waypoints searched — show everything
      displayResults(results, totalMiles);
      return;
    }

    // First get the city name, then search for restaurants
    const currentIndex       = index;
    const currentPoint       = waypoints[index].point;
    const currentWindowPoints = waypoints[index].windowPoints;

    getCityName(currentPoint, function (cityName) {
      searchRestaurantsAtWaypoint(currentPoint, currentWindowPoints, cityName, diet, function (data) {
        results.push({
          stopNumber:   currentIndex + 1,
          locationName: cityName,
          location:     currentPoint,
          windowPoints: currentWindowPoints,
          restaurants:  data.restaurants,
          pool:         data.pool,
        });
        index++;
        searchNext();
      });
    });
  }

  searchNext(); // kick off the first search
}


// ── Step 5b: convert a GPS coordinate into a "City, ST" label ────────────────
// The Geocoder takes a LatLng and returns a full address breakdown.
// We pick out the city (locality) and state abbreviation (administrative_area_level_1).

function getCityName(location, callback) {
  geocoder.geocode({ location: location }, function (results, status) {
    if (status !== "OK" || results.length === 0) {
      callback("Unknown area");
      return;
    }

    let city  = "";
    let state = "";

    results[0].address_components.forEach(function (component) {
      if (component.types.includes("locality")) {
        city = component.long_name;
      }
      if (component.types.includes("administrative_area_level_1")) {
        state = component.short_name; // e.g. "TN" instead of "Tennessee"
      }
    });

    if (city) {
      callback(city + (state ? ", " + state : ""));
    } else {
      // Fallback: use the county or the first readable part of the address
      const fallback = results[0].address_components.find(function (c) {
        return c.types.includes("administrative_area_level_2");
      });
      callback(fallback ? fallback.long_name : "Unknown area");
    }
  });
}


// ── Step 6: search the Places API at one location ────────────────────────────
// textSearch understands full natural-language queries like
// "gluten free vegan restaurant near Memphis, TN" and ranks results
// by relevance — much better than nearbySearch's keyword-in-name matching.

function searchRestaurantsAtWaypoint(location, windowPoints, cityName, diet, callback) {
  const dietPhrase = diet ? diet + " " : "";
  const query      = dietPhrase + "restaurant near " + cityName;

  placesService.textSearch(
    {
      query:    query,
      location: location,
      radius:   40000,
    },
    function (results, status) {
      if (
        status === google.maps.places.PlacesServiceStatus.OK &&
        results.length > 0
      ) {
        // Keep only restaurants within 5 miles of ANY route point in the
        // ±25-mile window. This filters out results that are technically
        // "near the search centre" but are far from the actual road.
        const MAX_METERS = 5 * 1609.34;
        const nearby = results.filter(function (place) {
          if (!place.geometry || !place.geometry.location) return false;
          return windowPoints.some(function (routePoint) {
            return google.maps.geometry.spherical.computeDistanceBetween(
              routePoint,
              place.geometry.location
            ) <= MAX_METERS;
          });
        });
        enrichWithHours(nearby.slice(0, 3), function (enriched) {
          callback({ restaurants: enriched, pool: nearby });
        });
      } else {
        callback({ restaurants: [], pool: [] });
      }
    }
  );
}


// ── Step 6b: fetch full opening hours for each place ─────────────────────────
// nearbySearch only gives us open_now (true/false).
// getDetails gives us weekday_text: ["Monday: 9 AM – 5 PM", "Tuesday: …", …]
// We attach that to the place object as place.weekday_text before displaying.

function enrichWithHours(places, callback) {
  const enriched = [];
  let index = 0;

  function fetchNext() {
    if (index >= places.length) {
      callback(enriched);
      return;
    }

    const place = places[index];

    placesService.getDetails(
      {
        placeId: place.place_id,
        fields:  ["opening_hours", "website", "reviews", "editorial_summary"],
      },
      function (details, status) {
        if (
          status === google.maps.places.PlacesServiceStatus.OK &&
          details.opening_hours &&
          details.opening_hours.weekday_text
        ) {
          place.weekday_text = details.opening_hours.weekday_text;
        }
        if (status === google.maps.places.PlacesServiceStatus.OK && details.website) {
          place.website = details.website;
        }
        if (status === google.maps.places.PlacesServiceStatus.OK && details.reviews) {
          place.reviews = details.reviews;
        }
        if (status === google.maps.places.PlacesServiceStatus.OK && details.editorial_summary) {
          place.editorial_summary = details.editorial_summary;
        }
        enriched.push(place);
        index++;
        fetchNext();
      }
    );
  }

  fetchNext(); // kick off the first getDetails call
}


// Returns true if the place's reviews or editorial summary mention any of the
// selected dietary preferences. Used to show a "Mentioned in reviews" badge.
function hasDietaryMention(place, diets) {
  if (!diets || diets.length === 0) return false;
  const text = [
    place.editorial_summary && place.editorial_summary.overview,
    ...(place.reviews || []).map(function (r) { return r.text; }),
  ].filter(Boolean).join(" ").toLowerCase();
  return diets.some(function (d) { return text.includes(d.toLowerCase()); });
}


// Returns a short label like "8 gluten free options" or "12 options".
// Used in stop card headers so users can gauge options before opening.
function buildCountLabel(count, selectedDiets) {
  if (!count) return "";
  const display = count >= 20 ? "20+" : count;
  const suffix  = count === 1 ? "option" : "options";
  if (selectedDiets.length === 1) {
    return "🍴 " + display + " " + selectedDiets[0] + " " + suffix;
  } else if (selectedDiets.length > 1) {
    return "🍴 " + display + " " + suffix + " matching your preferences";
  }
  return "🍴 " + display + " " + suffix;
}


// ── Step 7: build the results list and map pins ───────────────────────────────

function displayResults(results, totalMiles) {
  resetButton();
  resultBox.classList.remove("hidden");
  stopsList.innerHTML = "";

  // Summary line at the top of the list
  const summary      = document.createElement("p");
  summary.className  = "route-summary";
  summary.textContent =
    totalMiles + " mile route · " +
    results.length + " stop" + (results.length !== 1 ? "s" : "");
  stopsList.appendChild(summary);

  results.forEach(function (stop) {
    if (stop.restaurants.length > 0) {
      addStopCard(stop.stopNumber, stop.locationName, stop.restaurants, stop.location, stop.windowPoints, stop.pool);
    } else {
      addNoResultCard(stop.stopNumber, stop.locationName);
    }
  });
}

// Builds one stop card containing up to 3 restaurant options.
// Each option row is clickable to pan the map.
// pool — the full list of Places results for this stop, used to power the refresh button.
function addStopCard(number, locationName, places, location, windowPoints, pool) {
  const li     = document.createElement("li");
  li.className = "stop-card";

  // Header row — city name, stop badge, collapse arrow, and options count
  const header     = document.createElement("div");
  header.className = "stop-number stop-number--toggle stop-number--collapsed";

  const countLabel = buildCountLabel(pool ? pool.length : 0, currentSelectedDiets);
  header.innerHTML =
    '<div class="stop-header-top">' +
      locationName +
      ' <span class="stop-badge">#' + number + '</span>' +
      '<span class="stop-toggle-arrow">▾</span>' +
    '</div>' +
    (countLabel ? '<div class="stop-options-count">' + countLabel + '</div>' : '');
  li.appendChild(header);

  // Wrapper div for the restaurant rows — collapsed by default
  const optionsContainer = document.createElement("div");
  optionsContainer.className = "stop-options-container stop-options-container--collapsed";
  li.appendChild(optionsContainer);

  // Tracks where we are in the pool so each refresh shows the next set of options
  let poolOffset = 3;

  // Tracks which restaurants are currently displayed (updated on every renderOptions call)
  let currentDisplayed = places;

  // Builds (or rebuilds) the restaurant rows inside optionsContainer
  function renderOptions(restaurantsToShow) {
    currentDisplayed = restaurantsToShow;
    optionsContainer.innerHTML = "";
    // If this card is already open, refresh the pool markers to reflect new green/orange split
    if (!optionsContainer.classList.contains("stop-options-container--collapsed")) {
      showPoolMarkers(pool, currentDisplayed);
    }

    restaurantsToShow.forEach(function (place, i) {
      const name    = place.name;
      const address = place.formatted_address || place.vicinity || "Address unavailable";
      const rating  = place.rating ? place.rating.toFixed(1) : "No rating";

      // Shortest distance from the restaurant to any sampled point on the route
      const distanceMeters = Math.min.apply(null, windowPoints.map(function (wp) {
        return google.maps.geometry.spherical.computeDistanceBetween(
          wp,
          place.geometry.location
        );
      }));
      const distanceMiles = (distanceMeters / 1609.34).toFixed(1);

      // Today's hours: Google indexes Mon=0 … Sun=6
      // JavaScript's getDay() returns Sun=0 … Sat=6, so we convert
      const jsDayIndex     = new Date().getDay();
      const googleDayIndex = (jsDayIndex + 6) % 7;
      const todayHours     = place.weekday_text
        ? place.weekday_text[googleDayIndex].replace(/^[^:]+:\s*/, "")
        : null;

      const allHoursHTML = place.weekday_text
        ? place.weekday_text.map(function (line) {
            return "<li>" + line + "</li>";
          }).join("")
        : "";

      const mapLat  = place.geometry.location.lat();
      const mapLng  = place.geometry.location.lng();
      const mapName = encodeURIComponent(name);

      const row     = document.createElement("div");
      row.className = "restaurant-option" + (i < restaurantsToShow.length - 1 ? " restaurant-option--divider" : "");
      row.style.cursor = "pointer";
      row.innerHTML = `
        <button class="pin-btn${window.isPinned && window.isPinned(place.place_id) ? ' pin-btn--pinned' : ''}"
                data-place-id="${place.place_id}"
                title="${window.isPinned && window.isPinned(place.place_id) ? 'Remove from My Trips' : 'Save to My Trips'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
        <div class="option-label">Option ${String.fromCharCode(65 + i)}</div>
        <div class="restaurant-name">${name}</div>
        ${hasDietaryMention(place, currentSelectedDiets) ? '<span class="diet-mention-badge">⭐ Mentioned in reviews</span>' : ''}
        <div class="restaurant-address">${address}</div>
        <div class="restaurant-meta">
          <span class="rating">★ ${rating}</span>
          · <span class="distance-from-route">${distanceMiles} mi from your route</span>
          ${todayHours ? "· <span class='today-hours'>Today: " + todayHours + "</span>" : ""}
        </div>
        ${allHoursHTML ? `
          <details class="all-hours">
            <summary>See all hours</summary>
            <ul>${allHoursHTML}</ul>
          </details>` : ""}
        ${place.website ? `<a class="restaurant-website" href="${place.website}" target="_blank" rel="noopener">Visit website ↗</a>` : ""}
        <div class="maps-links">
          <span class="maps-links-label">Open in maps:</span>
          <a href="https://www.google.com/maps/place/?q=place_id:${place.place_id}" target="_blank" rel="noopener" class="maps-link">Google Maps</a>
          <a href="https://maps.apple.com/?q=${mapName}&ll=${mapLat},${mapLng}" target="_blank" rel="noopener" class="maps-link">Apple Maps</a>
          <a href="https://waze.com/ul?ll=${mapLat},${mapLng}&navigate=yes" target="_blank" rel="noopener" class="maps-link">Waze</a>
        </div>
        <div class="maps-links">
          <span class="maps-links-label">Order online:</span>
          <a href="https://www.doordash.com/search/store/${mapName}/" target="_blank" rel="noopener" class="maps-link order-link">DoorDash</a>
          <a href="https://www.ubereats.com/search?q=${mapName}" target="_blank" rel="noopener" class="maps-link order-link">Uber Eats</a>
        </div>
      `;

      // Pin button — stop propagation so clicking it doesn't also trigger the row click
      const pinBtn = row.querySelector(".pin-btn");
      if (pinBtn) {
        pinBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (window.togglePin) window.togglePin({
            placeId: place.place_id,
            name:    place.name,
            address: address,
            rating:  place.rating  || null,
            website: place.website || null,
          });
        });
      }

      const restaurantLocation = place.geometry.location;
      row.addEventListener("click", function () {
        // Reset the previously starred marker back to its normal color
        if (selectedPoolMarker) {
          selectedPoolMarker.marker.setIcon(
            selectedPoolMarker.isDisplayed ? greenRestaurantIcon() : orangeRestaurantIcon()
          );
        }
        // Turn this place's pool marker into a yellow star
        const entry = poolMarkers.find(function (m) { return m.placeId === place.place_id; });
        if (entry) {
          entry.marker.setIcon(yellowStarIcon());
          selectedPoolMarker = entry;
        }
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(restaurantLocation);
        bounds.extend(location);
        map.fitBounds(bounds, 80);
        const siblings = row.parentElement.querySelectorAll(".restaurant-option");
        siblings.forEach(function (s) { s.classList.remove("selected"); });
        row.classList.add("selected");
      });

      optionsContainer.appendChild(row);
    });
  }

  renderOptions(places);

  // Refresh link — only shown when the pool has more than 3 results to cycle through
  if (pool && pool.length > 3) {
    const refreshRow = document.createElement("div");
    refreshRow.className = "refresh-options-row";

    const refreshBtn = document.createElement("button");
    refreshBtn.type      = "button";
    refreshBtn.className = "refresh-options-btn";
    refreshBtn.textContent = "Show different options";
    refreshRow.appendChild(refreshBtn);
    optionsContainer.appendChild(refreshRow);

    refreshBtn.addEventListener("click", function () {
      refreshBtn.disabled    = true;
      refreshBtn.textContent = "Loading…";

      // Take the next 3 from the pool, wrapping around if we reach the end
      const nextBatch = [];
      for (let i = 0; i < 3; i++) {
        nextBatch.push(pool[(poolOffset + i) % pool.length]);
      }
      poolOffset = (poolOffset + 3) % pool.length;

      enrichWithHours(nextBatch, function (enriched) {
        renderOptions(enriched);
        refreshBtn.disabled    = false;
        refreshBtn.textContent = "Show different options";
      });
    });
  }

  // Toggle open/close when the header is clicked — closes all other open cards first
  header.addEventListener("click", function () {
    const isCurrentlyCollapsed = optionsContainer.classList.contains("stop-options-container--collapsed");
    if (isCurrentlyCollapsed) {
      // Close every other open card
      stopsList.querySelectorAll(".stop-options-container").forEach(function (c) {
        c.classList.add("stop-options-container--collapsed");
      });
      stopsList.querySelectorAll(".stop-number--toggle").forEach(function (h) {
        h.classList.add("stop-number--collapsed");
      });
      // Open this one
      optionsContainer.classList.remove("stop-options-container--collapsed");
      header.classList.remove("stop-number--collapsed");
      // Show pins for all pool results
      showPoolMarkers(pool, currentDisplayed);
      // Zoom the map into this city
      map.panTo(location);
      map.setZoom(12);
    } else {
      // Just close this one
      optionsContainer.classList.add("stop-options-container--collapsed");
      header.classList.add("stop-number--collapsed");
      clearPoolMarkers();
    }
  });

  stopsList.appendChild(li);

  // Drop a numbered green pin at the waypoint (one pin per stop)
  addMarker(location, number, places[0].name);
}

// Shown when the Places search returned nothing for a stop
function addNoResultCard(number, locationName) {
  const li     = document.createElement("li");
  li.className = "stop-card stop-card--empty";
  li.innerHTML = `
    <div class="stop-number">${locationName} <span class="stop-badge">#${number}</span></div>
    <div class="restaurant-name">No results found nearby</div>
    <div class="restaurant-address">
      Try a different dietary filter or a slightly different interval.
    </div>
  `;
  stopsList.appendChild(li);
}


// ── Teardrop pin icon factory ─────────────────────────────────────────────────
// Returns a Google Maps icon object using a classic teardrop SVG so every
// marker on every page shares the same familiar pin shape.
//
// fillColor — hex string  e.g. "#D4870A"
// opts.scale — size multiplier (default 1)
// opts.label — short string drawn inside the pin (e.g. "1", "2")

function makeTeardropIcon(fillColor, opts) {
  opts = opts || {};
  var scale = opts.scale || 1;
  var label = opts.label || "";
  var w = Math.round(24 * scale);
  var h = Math.round(34 * scale);

  var inner = label
    ? '<text x="12" y="15" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="11" font-weight="700" font-family="Arial,sans-serif">' + label + "</text>"
    : '<circle cx="12" cy="11" r="3.5" fill="white" opacity="0.85"/>';

  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 24 34">' +
    '<path d="M12 1C6.477 1 2 5.477 2 11c0 7 10 22 10 22s10-15 10-22C22 5.477 17.523 1 12 1z"' +
    ' fill="' + fillColor + '" stroke="white" stroke-width="1.5"/>' +
    inner +
    "</svg>";

  return {
    url:        "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(w, h),
    anchor:     new google.maps.Point(w / 2, h),
  };
}


// ── Map marker helpers ────────────────────────────────────────────────────────

function addMarker(location, number, title) {
  const marker = new google.maps.Marker({
    position: location,
    map:      map,
    title:    title,
    icon:     makeTeardropIcon("#1A1A2E", { scale: 1.15, label: String(number) }),
  });
  markers.push(marker);
}

function clearMarkers() {
  markers.forEach(function (m) { m.setMap(null); });
  markers = [];
}

// Drops an orange pin at the selected restaurant's real coordinates.
// Only one pin per stop — replaces the previous selection for that stop.
function addRestaurantMarker(location, title, stopNumber) {
  // Remove any existing restaurant pin for this stop number
  restaurantMarkers = restaurantMarkers.filter(function (m) {
    if (m.stopNumber === stopNumber) {
      m.setMap(null);
      return false;
    }
    return true;
  });

  const marker = new google.maps.Marker({
    position: location,
    map:      map,
    title:    title,
    icon:     makeTeardropIcon("#D4870A", { scale: 1 }),
  });

  marker.stopNumber = stopNumber; // tag it so we can replace it later
  restaurantMarkers.push(marker);
}

function clearRestaurantMarkers() {
  restaurantMarkers.forEach(function (m) { m.setMap(null); });
  restaurantMarkers = [];
}

// ── Pool marker helpers ───────────────────────────────────────────────────────
// Shows a pin for every result in the pool when a stop card is opened.
// Green = one of the 3 displayed options. Orange = everything else.
// Clicking a row turns that pin into a yellow star.

function greenRestaurantIcon() {
  return makeTeardropIcon("#D4870A", { scale: 0.9 });
}

function orangeRestaurantIcon() {
  return makeTeardropIcon("#C8705A", { scale: 0.75 });
}

function yellowStarIcon() {
  return {
    path: "M 0 -1 L 0.224 -0.309 L 0.951 -0.309 L 0.363 0.118 L 0.588 0.809 L 0 0.382 L -0.588 0.809 L -0.363 0.118 L -0.951 -0.309 L -0.224 -0.309 Z",
    scale: 14,
    fillColor: "#FFD700",
    fillOpacity: 1,
    strokeColor: "#b8860b",
    strokeWeight: 1,
  };
}

function clearPoolMarkers() {
  poolMarkers.forEach(function (entry) { entry.marker.setMap(null); });
  poolMarkers = [];
  selectedPoolMarker = null;
}

function showPoolMarkers(pool, displayedPlaces) {
  clearPoolMarkers();
  const displayedIds = new Set(displayedPlaces.map(function (p) { return p.place_id; }));
  pool.forEach(function (place) {
    if (!place.geometry || !place.geometry.location) return;
    const isDisplayed = displayedIds.has(place.place_id);
    const marker = new google.maps.Marker({
      position: place.geometry.location,
      map:      map,
      title:    place.name,
      icon:     isDisplayed ? greenRestaurantIcon() : orangeRestaurantIcon(),
    });
    poolMarkers.push({ marker: marker, placeId: place.place_id, isDisplayed: isDisplayed });
  });
}


// ── UI helpers ────────────────────────────────────────────────────────────────

function showLoading() {
  resultBox.classList.remove("hidden");
  stopsList.innerHTML = '<li class="loading-message">🔍 Calculating route and finding stops…</li>';
  searchBtn.disabled    = true;
  searchBtn.textContent = "Searching…";
}

function clearResults() {
  stopsList.innerHTML = "";
  const oldError = document.querySelector(".error-message");
  if (oldError) oldError.remove();
}

function showError(message) {
  clearResults();
  resultBox.classList.add("hidden");
  const div     = document.createElement("div");
  div.className = "error-message";
  div.textContent = message;
  form.after(div);
}

function resetButton() {
  searchBtn.disabled    = false;
  searchBtn.textContent = "Find My Stops";
}


// ── Custom stop feature ───────────────────────────────────────────────────────

const customCityInput  = document.getElementById("custom-city");
const addStopBtn       = document.getElementById("add-stop-btn");
const customStopError  = document.getElementById("custom-stop-error");

addStopBtn.addEventListener("click", function () {
  const cityName = customCityInput.value.trim();
  if (!cityName) return;

  // Read whichever dietary preferences are currently checked
  const checkedDiets = Array.from(
    dietMenu.querySelectorAll("input:checked")
  ).map(function (cb) { return cb.value; });
  const diet = checkedDiets.join(" ");

  customStopError.classList.add("hidden");
  addStopBtn.disabled    = true;
  addStopBtn.textContent = "Searching…";

  searchCustomStop(cityName, diet, function (result) {
    addStopBtn.disabled    = false;
    addStopBtn.textContent = "Add Stop";

    if (!result) {
      customStopError.textContent = "No results found for \"" + cityName + "\". Try adding a state, e.g. \"Joplin, MO\".";
      customStopError.classList.remove("hidden");
      return;
    }

    customStopError.classList.add("hidden");
    addCustomStopCard(result.locationName, result.restaurants, result.location);
    customCityInput.value = "";
  });
});

// Geocodes a city name, then searches for restaurants there
function searchCustomStop(cityName, diet, callback) {
  geocoder.geocode({ address: cityName }, function (geoResults, geoStatus) {
    if (geoStatus !== "OK" || geoResults.length === 0) {
      callback(null);
      return;
    }

    const location = geoResults[0].geometry.location;

    // Extract a clean "City, ST" label from the geocode result
    let city = "", state = "";
    geoResults[0].address_components.forEach(function (comp) {
      if (comp.types.includes("locality"))                    city  = comp.long_name;
      if (comp.types.includes("administrative_area_level_1")) state = comp.short_name;
    });
    const locationName = city
      ? city + (state ? ", " + state : "")
      : geoResults[0].formatted_address;

    const dietPhrase = diet ? diet + " " : "";
    const query      = dietPhrase + "restaurant near " + locationName;

    placesService.textSearch(
      { query: query, location: location, radius: 16000 },
      function (places, placeStatus) {
        if (
          placeStatus !== google.maps.places.PlacesServiceStatus.OK ||
          !places.length
        ) {
          callback(null);
          return;
        }

        // Filter to restaurants within 10 miles of the city centre
        const MAX_METERS = 10 * 1609.34;
        const nearby = places.filter(function (place) {
          if (!place.geometry) return false;
          return google.maps.geometry.spherical.computeDistanceBetween(
            location, place.geometry.location
          ) <= MAX_METERS;
        });

        if (nearby.length === 0) { callback(null); return; }

        enrichWithHours(nearby.slice(0, 3), function (enriched) {
          callback({ locationName: locationName, location: location, restaurants: enriched });
        });
      }
    );
  });
}

// Builds a stop card for a custom city — same layout as a regular stop card
// but with a teal "custom" badge and no "distance from route" label
function addCustomStopCard(locationName, places, location) {
  const li     = document.createElement("li");
  li.className = "stop-card";

  const header     = document.createElement("div");
  header.className = "stop-number";
  header.innerHTML = locationName + ' <span class="stop-badge stop-badge--custom">custom</span>';
  li.appendChild(header);

  places.forEach(function (place, i) {
    const name    = place.name;
    const address = place.formatted_address || place.vicinity || "Address unavailable";
    const rating  = place.rating ? place.rating.toFixed(1) : "No rating";
    const open    = place.opening_hours
      ? (place.opening_hours.isOpen() ? "Open now" : "Closed now")
      : "";

    const jsDayIndex     = new Date().getDay();
    const googleDayIndex = (jsDayIndex + 6) % 7;
    const todayHours     = place.weekday_text
      ? place.weekday_text[googleDayIndex].replace(/^[^:]+:\s*/, "")
      : null;
    const allHoursHTML = place.weekday_text
      ? place.weekday_text.map(function (l) { return "<li>" + l + "</li>"; }).join("")
      : "";

    const mapLat  = place.geometry.location.lat();
    const mapLng  = place.geometry.location.lng();
    const mapName = encodeURIComponent(name);

    const row     = document.createElement("div");
    row.className = "restaurant-option" + (i < places.length - 1 ? " restaurant-option--divider" : "");
    row.style.cursor = "pointer";
    row.innerHTML = `
      <div class="option-label">Option ${String.fromCharCode(65 + i)}</div>
      <div class="restaurant-name">${name}</div>
      <div class="restaurant-address">${address}</div>
      <div class="restaurant-meta">
        <span class="rating">★ ${rating}</span>
        ${open ? "· " + open : ""}
        ${todayHours ? "· <span class='today-hours'>Today: " + todayHours + "</span>" : ""}
      </div>
      ${allHoursHTML ? `<details class="all-hours"><summary>See all hours</summary><ul>${allHoursHTML}</ul></details>` : ""}
      ${place.website ? `<a class="restaurant-website" href="${place.website}" target="_blank" rel="noopener">Visit website ↗</a>` : ""}
      <div class="maps-links">
        <span class="maps-links-label">Open in maps:</span>
        <a href="https://www.google.com/maps/place/?q=place_id:${place.place_id}" target="_blank" rel="noopener" class="maps-link">Google Maps</a>
        <a href="https://maps.apple.com/?q=${mapName}&ll=${mapLat},${mapLng}" target="_blank" rel="noopener" class="maps-link">Apple Maps</a>
        <a href="https://waze.com/ul?ll=${mapLat},${mapLng}&navigate=yes" target="_blank" rel="noopener" class="maps-link">Waze</a>
      </div>
      <div class="maps-links">
        <span class="maps-links-label">Order online:</span>
        <a href="https://www.doordash.com/search/store/${mapName}/" target="_blank" rel="noopener" class="maps-link order-link">DoorDash</a>
        <a href="https://www.ubereats.com/search?q=${mapName}" target="_blank" rel="noopener" class="maps-link order-link">Uber Eats</a>
      </div>
    `;

    const restaurantLocation = place.geometry.location;
    row.addEventListener("click", function () {
      addRestaurantMarker(restaurantLocation, name, "custom-" + i);
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(restaurantLocation);
      bounds.extend(location);
      map.fitBounds(bounds, 80);

      const siblings = row.parentElement.querySelectorAll(".restaurant-option");
      siblings.forEach(function (s) { s.classList.remove("selected"); });
      row.classList.add("selected");
    });

    li.appendChild(row);
  });

  stopsList.appendChild(li);
  addMarker(location, "★", locationName);
}


// ── Animated placeholder typewriter ──────────────────────────────────────────
// A single coordinator fires every CYCLE_TIME ms.
// Bar 1 changes immediately, bar 2 changes STAGGER ms later, bar 3 STAGGER*2 ms later.
// This keeps the 3-second gap permanently — it never drifts.

const PLACEHOLDER_CITIES = {
  start: [
    "Nashville, Tennessee", "Atlanta, Georgia", "Denver, Colorado", "Dallas, Texas",
    "Chicago, Illinois", "Phoenix, Arizona", "Houston, Texas", "Miami, Florida",
    "Seattle, Washington", "Charlotte, North Carolina", "Austin, Texas", "Portland, Oregon"
  ],
  end: [
    "Lake Tahoe, California", "Savannah, Georgia", "Yellowstone, Wyoming", "Sedona, Arizona",
    "Asheville, North Carolina", "Santa Fe, New Mexico", "Moab, Utah", "Bar Harbor, Maine",
    "Napa Valley, California", "Telluride, Colorado", "Key West, Florida", "Glacier, Montana"
  ],
  waypoint: [
    "Memphis, Tennessee", "Chattanooga, Tennessee", "Flagstaff, Arizona", "Boise, Idaho",
    "Tulsa, Oklahoma", "Knoxville, Tennessee", "Springfield, Missouri", "El Paso, Texas",
    "Albuquerque, New Mexico", "Shreveport, Louisiana", "Columbia, South Carolina", "Reno, Nevada"
  ]
};

const TYPE_SPEED   = 70;    // ms per character when typing
const DELETE_SPEED = 35;    // ms per character when deleting
const STAGGER      = 3000;  // ms between each bar's turn
const CYCLE_TIME   = 12000; // ms between each bar's own successive changes

function animatePlaceholderChange(inputEl, newText) {
  if (inputEl.value !== "") return; // user is typing — leave it alone

  let pos = inputEl.placeholder.length;

  function erase() {
    if (inputEl.value !== "") return;
    if (pos > 0) {
      pos--;
      inputEl.placeholder = inputEl.placeholder.slice(0, pos);
      setTimeout(erase, DELETE_SPEED);
    } else {
      typeIn(0);
    }
  }

  function typeIn(i) {
    if (inputEl.value !== "") return;
    if (i < newText.length) {
      inputEl.placeholder = newText.slice(0, i + 1);
      setTimeout(() => typeIn(i + 1), TYPE_SPEED);
    }
  }

  pos > 0 ? erase() : typeIn(0);
}

function startCoordinatedCycle() {
  const bars = [
    { el: document.getElementById("start"),               cities: PLACEHOLDER_CITIES.start,    index: 0 },
    { el: document.getElementById("end"),                 cities: PLACEHOLDER_CITIES.end,      index: 0 },
    { el: document.getElementById("waypoint-city-input"), cities: PLACEHOLDER_CITIES.waypoint, index: 0 },
  ];

  function runCycle() {
    bars.forEach((bar, i) => {
      setTimeout(() => {
        animatePlaceholderChange(bar.el, bar.cities[bar.index % bar.cities.length]);
        bar.index++;
      }, i * STAGGER);
    });
  }

  runCycle();
  setInterval(runCycle, CYCLE_TIME);
}

document.addEventListener("DOMContentLoaded", startCoordinatedCycle);
