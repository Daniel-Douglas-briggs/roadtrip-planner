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

  // Attach city autocomplete to the destination input
  new google.maps.places.Autocomplete(document.getElementById("dest-city"), { types: ["(cities)"] });

  // Replay a saved trip search if URL params are present
  const urlParams    = new URLSearchParams(window.location.search);
  const replayCity   = urlParams.get("city");
  if (replayCity) {
    const replayDiets = urlParams.get("diets") ? urlParams.get("diets").split(",").filter(Boolean) : [];
    document.getElementById("dest-city").value = replayCity;
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
    destSearchBtn.click();
  }

  // Show a default U.S. map before any search is run
  new google.maps.Map(document.getElementById("dest-preview-map"), {
    center:            { lat: 39.5, lng: -98.35 },
    zoom:              4,
    zoomControl:       true,
    streetViewControl: false,
    mapTypeControl:    false,
    fullscreenControl: false,
  });
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

// Update the toggle button label to reflect what's selected, and auto-save if logged in
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

  const values = Array.from(dietMenu.querySelectorAll("input:checked"))
    .map(function (cb) { return cb.value; });
  if (window.savePreferences) window.savePreferences(values);
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

destSearchBtn.addEventListener("click", async function () {
  clearDestError();

  const cityInput = document.getElementById("dest-city").value.trim();
  if (!cityInput) {
    showDestError("Please enter a destination city.");
    return;
  }

  // ── Phase 4: check search limit before doing anything ─────────────────────
  if (window.checkSearchLimit && !await window.checkSearchLimit()) return;
  if (window.recordSearch) window.recordSearch();

  // Collect selected dietary preferences
  const selectedDiets = Array.from(dietMenu.querySelectorAll("input:checked"))
    .map(function (cb) { return cb.value; });
  const dietQuery = selectedDiets.join(" ");

  if (window.setCurrentTrip) window.setCurrentTrip(
    "Restaurants in " + cityInput,
    "destination",
    { city: cityInput, diets: selectedDiets }
  );

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
    setupDestLogoFade();

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
      { placeId: place.place_id, fields: ["website", "opening_hours", "formatted_address", "reviews", "editorial_summary"] },
      function (details, status) {
        if (status === google.maps.places.PlacesServiceStatus.OK && details) {
          if (details.website)            place.website            = details.website;
          if (details.opening_hours)      place.opening_hours      = details.opening_hours;
          if (details.formatted_address)  place.formatted_address  = details.formatted_address;
          if (details.reviews)            place.reviews            = details.reviews;
          if (details.editorial_summary)  place.editorial_summary  = details.editorial_summary;
        }
        enriched.push(place);
        index++;
        fetchNext();
      }
    );
  }

  fetchNext();
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


// ── Render the restaurant results ─────────────────────────────────────────────

function renderDestResults(restaurants, selectedDiets, pool, cityLocation) {
  const card = document.getElementById("dest-results-card");
  if (!card || restaurants.length === 0) return;

  // ── Teardrop pin factory (shared shape for all markers) ─────────────────
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
      inner + "</svg>";
    return {
      url:        "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(w, h),
      anchor:     new google.maps.Point(w / 2, h),
    };
  }

  // Drop a pin on the map for each restaurant
  restaurants.forEach(function (place) {
    if (!place.geometry || !place.geometry.location) return;

    const marker = new google.maps.Marker({
      position: place.geometry.location,
      map:      destMap,
      title:    place.name,
      icon:     makeTeardropIcon("#D4870A", { scale: 1 }),
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

  // Show total results count
  if (pool && pool.length > 0) {
    const countEl = document.createElement("div");
    countEl.className = "stop-options-count";
    const n       = pool.length;
    const display = n >= 20 ? "20+" : n;
    const suffix  = n === 1 ? "result" : "results";
    if (selectedDiets.length === 1) {
      countEl.textContent = "🍴 " + display + " " + selectedDiets[0] + " " + suffix + " found";
    } else if (selectedDiets.length > 1) {
      countEl.textContent = "🍴 " + display + " " + suffix + " matching your preferences";
    } else {
      countEl.textContent = "🍴 " + display + " " + suffix + " found";
    }
    card.appendChild(countEl);
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

      const pinned    = window.isPinned && window.isPinned(place.place_id);
      const pinTitle  = pinned ? "Remove from My Trips" : "Save to My Trips";
      const pinClass  = "pin-btn" + (pinned ? " pin-btn--pinned" : "");
      const pinSvg    = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';

      item.innerHTML =
        '<button class="' + pinClass + '" data-place-id="' + place.place_id + '" title="' + pinTitle + '">' + pinSvg + '</button>' +
        '<div class="option-label">Option ' + String.fromCharCode(65 + startLabel + i) + '</div>' +
        '<div class="flight-restaurant-name">' + name + '</div>' +
        (hasDietaryMention(place, selectedDiets) ? '<span class="diet-mention-badge">⭐ Mentioned in reviews</span>' : '') +
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

      const itemPinBtn = item.querySelector(".pin-btn");
      if (itemPinBtn) {
        itemPinBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (window.togglePin) window.togglePin({
            placeId: place.place_id,
            name:    place.name,
            address: address || "",
            rating:  place.rating  || null,
            website: place.website || null,
          });
        });
      }

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
            icon:     makeTeardropIcon("#D4870A", { scale: 1 }),
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


// ── Logo fade on results scroll ───────────────────────────────────────────────

const destResultsScroller = document.getElementById("flight-results-list");
const navBrandDest        = document.querySelector(".nav-brand");

function onDestResultsScroll() {
  // Start fading after 60 px, fully gone by 160 px
  var t = Math.max(0, Math.min(1, (destResultsScroller.scrollTop - 60) / 100));
  navBrandDest.style.opacity = 1 - t;
}

function setupDestLogoFade() {
  destResultsScroller.scrollTop = 0;
  navBrandDest.style.opacity = 1;
  destResultsScroller.addEventListener("scroll", onDestResultsScroll);
}

function resetDestLogoFade() {
  destResultsScroller.removeEventListener("scroll", onDestResultsScroll);
  navBrandDest.style.opacity = 1;
}

// ── Step 2 → Step 1: back button ─────────────────────────────────────────────

destBackBtn.addEventListener("click", function () {
  resetDestLogoFade();
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


// ── Animated placeholder typewriter ──────────────────────────────────────────

const DEST_PLACEHOLDER_CITIES = [
  "Austin, Texas", "Savannah, Georgia", "Asheville, North Carolina", "Santa Fe, New Mexico",
  "Sedona, Arizona", "Charleston, South Carolina", "New Orleans, Louisiana", "Portland, Oregon",
  "Marfa, Texas", "Carmel, California"
];

function startDestPlaceholderCycle() {
  const inputEl = document.getElementById("dest-city");
  if (!inputEl) return;

  const cities      = DEST_PLACEHOLDER_CITIES;
  let cityIndex  = 0;
  let charIndex  = 0;
  let isDeleting = false;

  const TYPE_SPEED   = 70;
  const DELETE_SPEED = 35;
  const PAUSE_AFTER  = 6000;

  function tick() {
    if (inputEl.value !== "") {
      setTimeout(tick, 500);
      return;
    }

    const currentCity = cities[cityIndex];

    if (!isDeleting) {
      charIndex++;
      inputEl.placeholder = currentCity.slice(0, charIndex);

      if (charIndex === currentCity.length) {
        isDeleting = true;
        setTimeout(tick, PAUSE_AFTER);
        return;
      }
      setTimeout(tick, TYPE_SPEED);
    } else {
      charIndex--;
      inputEl.placeholder = currentCity.slice(0, charIndex);

      if (charIndex === 0) {
        isDeleting = false;
        cityIndex = (cityIndex + 1) % cities.length;
        setTimeout(tick, TYPE_SPEED);
        return;
      }
      setTimeout(tick, DELETE_SPEED);
    }
  }

  setTimeout(tick, 0);
}

document.addEventListener("DOMContentLoaded", startDestPlaceholderCycle);
