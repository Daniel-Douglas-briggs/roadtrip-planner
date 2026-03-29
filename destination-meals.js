// =============================================
// destination-meals.js — Destination Meals page
//
// Two-step flow:
//   Step 1 — user enters a destination city and dietary preferences
//   Step 2 — Places API is queried and restaurant results are shown
//             on cards alongside a Google Map
//
// API call chain:
//   1. geocoder.geocode()          — convert city name → GPS coordinates
//   2. placesService.textSearch()  — find restaurants in that city
//   3. placesService.getDetails()  — fetch website/hours for each result
// =============================================


// ── Google Maps API objects ───────────────────────────────────────────────────
// Declared here, created inside initDestMeals() once the API loads.

let geocoder;
let placesService;

// Shared map and marker state — reset on each new search
let destMap     = null;
let destMarkers = [];
let destBounds  = null;


// ── Called automatically by Google when the Maps API finishes loading ─────────

function initDestMeals() {
  geocoder      = new google.maps.Geocoder();
  placesService = new google.maps.places.PlacesService(
    document.getElementById("places-service-target")
  );
}

// Called if the Maps API script fails to load (network error, bad key, etc.)
function showDestApiError() {
  destSearchBtn.disabled    = true;
  destSearchBtn.textContent = "Map service unavailable";
  const div = document.createElement("div");
  div.className = "error-message";
  div.textContent = "The map service couldn't load. Check your internet connection and refresh the page.";
  destForm.after(div);
}


// ── Cuisine type lookup ───────────────────────────────────────────────────────
// Maps Google Places type strings to human-readable cuisine labels.

const CUISINE_LABELS = {
  american_restaurant:       "American",
  bakery:                    "Bakery",
  bar:                       "Bar",
  barbecue_restaurant:       "Barbecue",
  brazilian_restaurant:      "Brazilian",
  breakfast_restaurant:      "Breakfast",
  brunch_restaurant:         "Brunch",
  cafe:                      "Café",
  chinese_restaurant:        "Chinese",
  coffee_shop:               "Coffee",
  fast_food_restaurant:      "Fast Food",
  french_restaurant:         "French",
  greek_restaurant:          "Greek",
  hamburger_restaurant:      "Burgers",
  ice_cream_shop:            "Ice Cream",
  indian_restaurant:         "Indian",
  italian_restaurant:        "Italian",
  japanese_restaurant:       "Japanese",
  korean_restaurant:         "Korean",
  mediterranean_restaurant:  "Mediterranean",
  mexican_restaurant:        "Mexican",
  middle_eastern_restaurant: "Middle Eastern",
  pizza_restaurant:          "Pizza",
  ramen_restaurant:          "Ramen",
  sandwich_shop:             "Sandwiches",
  seafood_restaurant:        "Seafood",
  spanish_restaurant:        "Spanish",
  steak_house:               "Steakhouse",
  sushi_restaurant:          "Sushi",
  thai_restaurant:           "Thai",
  turkish_restaurant:        "Turkish",
  vegan_restaurant:          "Vegan",
  vegetarian_restaurant:     "Vegetarian",
  vietnamese_restaurant:     "Vietnamese",
};

// Returns the first recognisable cuisine label from a place's types array.
function getCuisineLabel(types) {
  for (let i = 0; i < types.length; i++) {
    if (CUISINE_LABELS[types[i]]) return CUISINE_LABELS[types[i]];
  }
  return null;
}

// Capitalises the first letter of a string.
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}


// ── Dietary preference dropdown ───────────────────────────────────────────────

const dietMenu        = document.getElementById("diet-dropdown-menu");
const dietDropdown    = document.getElementById("diet-dropdown");
const dietToggleBtn   = document.getElementById("diet-toggle-btn");
const dietToggleLabel = document.getElementById("diet-toggle-label");

// Open / close the dropdown when the toggle button is clicked
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

// Close the dropdown when the user clicks anywhere outside it
document.addEventListener("click", function (e) {
  if (!dietDropdown.contains(e.target)) {
    dietMenu.setAttribute("hidden", "");
    dietDropdown.classList.remove("open");
  }
});

// Collapsible dietary group sections (the + / − button next to each heading)
document.querySelectorAll(".diet-group-label").forEach(function (label) {
  label.addEventListener("click", function () {
    const options = label.nextElementSibling;
    const btn     = label.querySelector(".diet-group-toggle");
    const isOpen  = !options.classList.contains("collapsed");
    options.classList.toggle("collapsed", isOpen);
    btn.textContent = isOpen ? "+" : "−";
  });
});

// Update the toggle button label to reflect what's selected
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

const destForm          = document.getElementById("dest-form");
const destMain          = document.getElementById("dest-main");
const destResultSection = document.getElementById("flight-results-section");
const destSearchBtn     = document.getElementById("dest-search-btn");
const destBackBtn       = document.getElementById("dest-back-btn");
const destCitySummary   = document.getElementById("dest-city-summary");
const destResultsList   = document.getElementById("flight-results-list");


// ── Step 1 → Step 2: search and show results ──────────────────────────────────

destSearchBtn.addEventListener("click", function () {
  clearDestError();

  const cityInput = document.getElementById("dest-city").value.trim();
  if (!cityInput) {
    showDestError("Please enter a destination city.");
    return;
  }

  // Collect selected dietary preferences
  const selectedDiets = Array.from(dietMenu.querySelectorAll("input:checked"))
    .map(function (cb) { return cb.value; });
  const dietQuery = selectedDiets.join(" ");

  // Show loading state on the button while we wait for the geocoder
  destSearchBtn.disabled    = true;
  destSearchBtn.textContent = "Searching…";

  // Step 1: turn the city name into GPS coordinates
  geocoder.geocode({ address: cityInput }, function (geoResults, geoStatus) {
    destSearchBtn.disabled    = false;
    destSearchBtn.textContent = "Find Meal Options";

    if (geoStatus !== "OK" || !geoResults.length) {
      showDestError('Could not find "' + cityInput + '". Try being more specific, e.g. "Austin, TX".');
      return;
    }

    const cityLocation = geoResults[0].geometry.location;
    // Use the geocoder's formatted address as the display name (e.g. "Austin, TX, USA")
    const cityName     = geoResults[0].formatted_address;

    // Fill in the header summary and clear any previous results
    destCitySummary.textContent = cityName;
    destResultsList.innerHTML   = "";

    // Switch to Step 2: hide the form, show the results layout
    destMain.classList.add("hidden");
    destResultSection.classList.remove("hidden");

    // Reset the map state for this search
    destBounds = new google.maps.LatLngBounds();
    destMarkers.forEach(function (m) { m.setMap(null); });
    destMarkers = [];

    // Create or re-centre the map on the destination city
    if (!destMap) {
      destMap = new google.maps.Map(document.getElementById("flight-map"), {
        center:            cityLocation,
        zoom:              13,
        zoomControl:       true,
        streetViewControl: false,
        mapTypeControl:    false,
        fullscreenControl: false,
      });
    } else {
      destMap.setCenter(cityLocation);
      destMap.setZoom(13);
    }

    // Show a loading card while we wait for the Places API
    const loadingCard = document.createElement("div");
    loadingCard.className = "flight-airport-card";
    loadingCard.id        = "dest-results-card";
    loadingCard.innerHTML =
      '<div class="flight-airport-header">' +
        '<span class="flight-airport-code">' + cityName + '</span>' +
      '</div>' +
      '<div class="flight-airport-loading" id="dest-loading">🔍 Finding restaurants…</div>';
    destResultsList.appendChild(loadingCard);

    // Step 2: search for restaurants matching the dietary preferences in this city.
    // Combining the diet keywords with the city name in the query text gives
    // Google the best chance of returning relevant results.
    const dietPhrase = dietQuery ? dietQuery + " " : "";
    const query      = dietPhrase + "restaurant in " + cityInput;

    placesService.textSearch(
      {
        query:    query,
        location: cityLocation,
        radius:   5000,   // 5 km — covers most city-centre areas
      },
      function (results, status) {
        const loader = document.getElementById("dest-loading");
        if (loader) loader.remove();

        if (status === google.maps.places.PlacesServiceStatus.OK && results.length > 0) {
          // Enrich the first 3 results with website/hours, keep the rest in the pool
          // for the "Show additional options" button
          enrichWithWebsite(results.slice(0, 3), cityLocation, results, function (data) {
            renderDestResults(data.restaurants, selectedDiets, data.pool, cityLocation);
          });
        } else {
          const card  = document.getElementById("dest-results-card");
          const empty = document.createElement("div");
          empty.className   = "flight-airport-placeholder";
          empty.textContent = "No matching restaurants found in " + cityInput + ". Try adjusting your dietary preferences.";
          card.appendChild(empty);
        }
      }
    );
  });
});


// ── Enrich results with website and hours ────────────────────────────────────
// Calls getDetails for each place to fetch its website URL and opening hours,
// then hands back the enriched array via the callback.

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
          if (details.website)           place.website           = details.website;
          if (details.opening_hours)     place.opening_hours     = details.opening_hours;
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


// ── Render the restaurant results ─────────────────────────────────────────────

function renderDestResults(restaurants, selectedDiets, pool, cityLocation) {
  const card = document.getElementById("dest-results-card");
  if (!card || restaurants.length === 0) return;

  // Drop a pin on the map for each restaurant
  restaurants.forEach(function (place) {
    if (!place.geometry || !place.geometry.location) return;

    const marker = new google.maps.Marker({
      position: place.geometry.location,
      map:      destMap,
      title:    place.name,
    });

    const infoWindow = new google.maps.InfoWindow({
      content:
        "<strong>" + place.name + "</strong>" +
        (place.rating ? "<br>★ " + place.rating.toFixed(1) : ""),
    });

    marker.addListener("click", function () {
      infoWindow.open(destMap, marker);
    });

    destMarkers.push(marker);
    destBounds.extend(place.geometry.location);
  });

  // Fit the map so all pins are visible
  if (destMarkers.length > 0) {
    destMap.fitBounds(destBounds);
  }

  // Show the dietary filters as small green tags above the results
  if (selectedDiets.length > 0) {
    const filterRow = document.createElement("div");
    filterRow.className = "flight-filter-row";
    filterRow.innerHTML = "Filtered for: " +
      selectedDiets.map(function (d) {
        return '<span class="diet-tag">' + capitalize(d) + '</span>';
      }).join("");
    card.appendChild(filterRow);
  }

  // Container for the restaurant rows — replaced when "Show additional options" loads more
  const optionsContainer = document.createElement("div");
  card.appendChild(optionsContainer);

  // Tracks how far into the pool we've consumed
  let poolOffset = 3;

  // Builds rows for one batch of restaurants, labelled Option A, B, C …
  // startLabel is the letter offset so additional batches continue from D, G, etc.
  function renderOptionRows(places, startLabel) {
    places.forEach(function (place, i) {
      const name    = place.name;
      const rating  = place.rating ? place.rating.toFixed(1) : null;
      const cuisine = getCuisineLabel(place.types || []);
      const address = place.formatted_address || place.vicinity || "";

      // Opening hours — weekday_text is an array like ["Monday: 9:00 AM – 9:00 PM", ...]
      const hoursText = place.opening_hours && place.opening_hours.weekday_text;
      const hasHours  = hoursText && hoursText.length > 0;

      // Today's hours: Google indexes Mon=0 … Sun=6
      // JavaScript's getDay() returns Sun=0 … Sat=6, so convert
      const jsDayIndex     = new Date().getDay();
      const googleDayIndex = (jsDayIndex + 6) % 7;
      const todayHours     = hasHours
        ? hoursText[googleDayIndex].replace(/^[^:]+:\s*/, "")
        : null;

      const allHoursHTML = hasHours
        ? hoursText.map(function (h) { return "<li>" + h + "</li>"; }).join("")
        : "";

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
        (address ? '<div class="restaurant-address">' + address + '</div>' : '') +
        '<div class="restaurant-meta">' +
          (rating  ? '<span class="rating">★ ' + rating + '</span>' : '') +
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

  // Render the first batch
  renderOptionRows(restaurants, 0);

  // "Show additional options" button — only when the pool has more to show
  if (pool && pool.length > 3) {
    const moreRow = document.createElement("div");
    moreRow.className = "flight-more-options-row";

    const moreBtn = document.createElement("button");
    moreBtn.type        = "button";
    moreBtn.className   = "flight-more-options-btn";
    moreBtn.textContent = "Show additional options";
    moreRow.appendChild(moreBtn);
    card.appendChild(moreRow);

    moreBtn.addEventListener("click", function () {
      moreBtn.disabled    = true;
      moreBtn.textContent = "Loading…";

      const nextBatch  = pool.slice(poolOffset, poolOffset + 3);
      const labelStart = poolOffset;
      poolOffset += nextBatch.length;

      enrichWithWebsite(nextBatch, cityLocation, pool, function (data) {
        // Add map pins for the newly loaded restaurants
        data.restaurants.forEach(function (place) {
          if (!place.geometry || !place.geometry.location) return;

          const marker = new google.maps.Marker({
            position: place.geometry.location,
            map:      destMap,
            title:    place.name,
          });

          const infoWindow = new google.maps.InfoWindow({
            content:
              "<strong>" + place.name + "</strong>" +
              (place.rating ? "<br>★ " + place.rating.toFixed(1) : ""),
          });

          marker.addListener("click", function () {
            infoWindow.open(destMap, marker);
          });

          destMarkers.push(marker);
          destBounds.extend(place.geometry.location);
        });

        if (destMarkers.length > 0) {
          destMap.fitBounds(destBounds);
        }

        renderOptionRows(data.restaurants, labelStart);

        // Hide the button when the pool is exhausted
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


// ── Step 2 → Step 1: back button ─────────────────────────────────────────────

destBackBtn.addEventListener("click", function () {
  destResultSection.classList.add("hidden");
  destMain.classList.remove("hidden");
});


// ── Error helpers ─────────────────────────────────────────────────────────────

function showDestError(message) {
  clearDestError();
  const div = document.createElement("div");
  div.className   = "error-message";
  div.id          = "dest-error";
  div.textContent = message;
  destForm.after(div);
}

function clearDestError() {
  const existing = document.getElementById("dest-error");
  if (existing) existing.remove();
}
