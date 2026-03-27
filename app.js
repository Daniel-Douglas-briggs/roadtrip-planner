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
let restaurantMarkers = []; // selected restaurant pins (orange)


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
  });

  directionsService = new google.maps.DirectionsService();

  // suppressMarkers: true — we'll draw our own numbered green pins
  directionsRenderer = new google.maps.DirectionsRenderer({ suppressMarkers: true });
  directionsRenderer.setMap(map);

  // PlacesService must be attached to a live Map object
  placesService = new google.maps.places.PlacesService(map);

  geocoder = new google.maps.Geocoder();
}


// ── Form elements ─────────────────────────────────────────────────────────────

const form      = document.getElementById("trip-form");
const resultBox = document.getElementById("results");
const stopsList = document.getElementById("stops-list");
const searchBtn = document.getElementById("search-btn");

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

// Update the summary label whenever a checkbox changes
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


// ── Step 2: react to the button being clicked ────────────────────────────────
// The button is type="button" (not type="submit") so the browser never
// tries to submit the form or reload the page — no preventDefault needed.

searchBtn.addEventListener("click", function () {
  // Read values from each input field
  const start    = document.getElementById("start").value.trim();
  const end      = document.getElementById("end").value.trim();
  const interval = parseInt(document.getElementById("interval").value, 10);

  // Collect every checked option into an array, then join into one search string
  // e.g. ["gluten free", "vegan"] → "gluten free vegan"
  const checkedDiets = Array.from(
    dietMenu.querySelectorAll("input:checked")
  ).map(function (cb) { return cb.value; });
  const diet = checkedDiets.join(" ");

  // Validate — tell the user if something is missing
  if (!start || !end) {
    showError("Please enter both a starting city and a destination.");
    return;
  }
  if (!interval || interval < 50) {
    showError("Please enter a stop interval of at least 50 miles.");
    return;
  }

  // Clear old results and markers, show loading state
  clearResults();
  clearMarkers();
  clearRestaurantMarkers();
  showLoading();

  // Hand off to the route planner
  planRoute(start, end, interval, diet);
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
      searchRestaurantsAtWaypoint(currentPoint, currentWindowPoints, cityName, diet, function (restaurants) {
        results.push({
          stopNumber:   currentIndex + 1,
          locationName: cityName,
          location:     currentPoint,
          windowPoints: currentWindowPoints,
          restaurants:  restaurants,
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
        enrichWithHours(nearby.slice(0, 3), callback);
      } else {
        callback([]);
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
        fields:  ["opening_hours", "website"],
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
        enriched.push(place);
        index++;
        fetchNext();
      }
    );
  }

  fetchNext(); // kick off the first getDetails call
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
      addStopCard(stop.stopNumber, stop.locationName, stop.restaurants, stop.location, stop.windowPoints);
    } else {
      addNoResultCard(stop.stopNumber, stop.locationName);
    }
  });
}

// Builds one stop card containing up to 3 restaurant options.
// Each option row is clickable to pan the map.
function addStopCard(number, locationName, places, location, windowPoints) {
  const li     = document.createElement("li");
  li.className = "stop-card";

  // Header row — city name with stop number as a small badge
  const header     = document.createElement("div");
  header.className = "stop-number";
  header.innerHTML = locationName + ' <span class="stop-badge">#' + number + '</span>';
  li.appendChild(header);

  // One row per restaurant
  places.forEach(function (place, i) {
    const name    = place.name;
    const address = place.formatted_address || place.vicinity || "Address unavailable";
    const rating  = place.rating ? place.rating.toFixed(1) : "No rating";

    // Shortest distance from the restaurant to any sampled point on the route
    // (more accurate than distance from a single waypoint dot)
    const distanceMeters = Math.min.apply(null, windowPoints.map(function (wp) {
      return google.maps.geometry.spherical.computeDistanceBetween(
        wp,
        place.geometry.location
      );
    }));
    const distanceMiles = (distanceMeters / 1609.34).toFixed(1);

    // Today's hours: Google indexes Mon=0 … Sun=6
    // JavaScript's getDay() returns Sun=0 … Sat=6, so we convert
    const jsDayIndex     = new Date().getDay();               // 0=Sun, 1=Mon …
    const googleDayIndex = (jsDayIndex + 6) % 7;             // 0=Mon … 6=Sun
    const todayHours     = place.weekday_text
      ? place.weekday_text[googleDayIndex].replace(/^[^:]+:\s*/, "") // strip "Monday: "
      : null;

    // Build the "all hours" list for the expandable section
    const allHoursHTML = place.weekday_text
      ? place.weekday_text.map(function (line) {
          return "<li>" + line + "</li>";
        }).join("")
      : "";

    const row     = document.createElement("div");
    row.className = "restaurant-option" + (i < places.length - 1 ? " restaurant-option--divider" : "");
    row.style.cursor = "pointer";
    row.innerHTML = `
      <div class="option-label">Option ${String.fromCharCode(65 + i)}</div>
      <div class="restaurant-name">${name}</div>
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
    `;

    // Click the option row → pin the restaurant and fit the map to show
    // both the restaurant and the waypoint on the route
    const restaurantLocation = place.geometry.location;
    row.addEventListener("click", function () {
      addRestaurantMarker(restaurantLocation, name, number);

      // Build a bounding box that contains both points so the route stays visible
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(restaurantLocation); // the restaurant
      bounds.extend(location);           // the waypoint on the route
      map.fitBounds(bounds, 80);         // 80px padding so pins aren't at the edge

      // Highlight the selected row and deselect siblings
      const siblings = row.parentElement.querySelectorAll(".restaurant-option");
      siblings.forEach(function (s) { s.classList.remove("selected"); });
      row.classList.add("selected");
    });

    li.appendChild(row);
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


// ── Map marker helpers ────────────────────────────────────────────────────────

function addMarker(location, number, title) {
  const marker = new google.maps.Marker({
    position: location,
    map:      map,
    title:    title,
    label: {
      text:       String(number),
      color:      "white",
      fontWeight: "bold",
    },
    icon: {
      path:        google.maps.SymbolPath.CIRCLE,
      scale:       16,
      fillColor:   "#2c5f2e",
      fillOpacity: 1,
      strokeColor: "white",
      strokeWeight: 2,
    },
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
    icon: {
      path:        google.maps.SymbolPath.CIRCLE,
      scale:       10,
      fillColor:   "#f4a261",  // orange — distinct from the green stop pins
      fillOpacity: 1,
      strokeColor: "white",
      strokeWeight: 2,
    },
  });

  marker.stopNumber = stopNumber; // tag it so we can replace it later
  restaurantMarkers.push(marker);
}

function clearRestaurantMarkers() {
  restaurantMarkers.forEach(function (m) { m.setMap(null); });
  restaurantMarkers = [];
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
