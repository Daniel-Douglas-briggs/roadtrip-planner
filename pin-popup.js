// pin-popup.js
// Rich hover + sticky-click popups for map pins.
// Only activates when the search panel is collapsed.
//
// Public API (attached to window):
//   attachPinPopup(marker, place, map, isCollapsedFn, getDiets)
//     — individual restaurant pin (flight, destination, road-trip pool markers)
//
//   attachStopPopup(marker, stop, map, isCollapsedFn, getDiets)
//     — numbered stop marker on road-trip map; shows top 3 results + pool count

(function () {
  var sharedIW     = null;   // one InfoWindow reused for all popups on the page
  var stickyMarker = null;   // marker the user click-pinned open
  var hoverTimer   = null;

  // ── InfoWindow ─────────────────────────────────────────────────────────────

  function getIW() {
    if (!sharedIW) {
      sharedIW = new google.maps.InfoWindow({ maxWidth: 300 });
      sharedIW.addListener('closeclick', function () { stickyMarker = null; });
    }
    return sharedIW;
  }

  function openFor(map, marker, html) {
    var iw = getIW();
    iw.setContent(html);
    iw.open(map, marker);
  }

  // ── Save button (event delegation — works even after InfoWindow re-renders) ─

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.pp-save');
    if (!btn) return;
    e.stopPropagation();
    if (window.togglePin) {
      window.togglePin({
        placeId: btn.dataset.placeId,
        name:    btn.dataset.name,
        address: btn.dataset.address,
        rating:  btn.dataset.rating ? parseFloat(btn.dataset.rating) : null,
        website: btn.dataset.website || null,
      });
    }
    // Optimistically flip button state
    var nowSaved = btn.classList.toggle('pp-save--saved');
    btn.textContent = nowSaved ? '♥ Saved' : '♡ Save';
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str || '')
      .replace(/&/g,  '&amp;')
      .replace(/"/g,  '&quot;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;');
  }

  // Normalise weekday_text — app.js stores it flat on the place,
  // flight/destination store it nested under opening_hours.
  function weekdayText(place) {
    return place.weekday_text ||
           (place.opening_hours && place.opening_hours.weekday_text) ||
           null;
  }

  function todayHoursStr(place) {
    var wt = weekdayText(place);
    if (!wt || !wt.length) return '';
    var googleDay = (new Date().getDay() + 6) % 7; // Mon=0 … Sun=6
    return (wt[googleDay] || '').replace(/^[^:]+:\s*/, '');
  }

  function allHoursHTML(place) {
    var wt = weekdayText(place);
    if (!wt || !wt.length) return '';
    return '<ul class="pp-hours-list">' +
      wt.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') +
    '</ul>';
  }

  function hasDietMention(place, diets) {
    if (!diets || !diets.length) return false;
    var parts = [place.editorial_summary && place.editorial_summary.overview]
      .concat((place.reviews || []).map(function (r) { return r.text; }))
      .filter(Boolean);
    if (!parts.length) return false;
    var text = parts.join(' ').toLowerCase();
    return diets.some(function (d) { return text.includes(d.toLowerCase()); });
  }

  // ── Restaurant card HTML ───────────────────────────────────────────────────

  function restaurantCardHTML(place, diets) {
    var address  = place.formatted_address || place.vicinity || '';
    var website  = place.website || '';
    var today    = todayHoursStr(place);
    var allHrs   = allHoursHTML(place);
    var isSaved  = window.isPinned && window.isPinned(place.place_id);
    var dietPill = hasDietMention(place, diets)
      ? '<span class="pp-diet-pill">⭐ Mentioned in reviews</span>' : '';

    // Hours: expandable if we have the full week, plain text if only today
    var hoursHTML = '';
    if (today && allHrs) {
      hoursHTML =
        '<details class="pp-hours-details">' +
          '<summary>Today: ' + esc(today) + ' ▸</summary>' +
          allHrs +
        '</details>';
    } else if (today) {
      hoursHTML = '<div class="pp-meta">Today: ' + esc(today) + '</div>';
    }

    var saveBtn = place.place_id
      ? '<button class="pp-save' + (isSaved ? ' pp-save--saved' : '') + '" ' +
          'data-place-id="'  + esc(place.place_id) + '" ' +
          'data-name="'      + esc(place.name)     + '" ' +
          'data-address="'   + esc(address)         + '" ' +
          'data-rating="'    + (place.rating || '') + '" ' +
          'data-website="'   + esc(website)         + '">' +
          (isSaved ? '♥ Saved' : '♡ Save') +
        '</button>'
      : '';

    return (
      '<div class="pp-card">' +
        '<div class="pp-card-top">' +
          '<span class="pp-name">' + esc(place.name || '') + '</span>' +
          saveBtn +
        '</div>' +
        (place.rating
          ? '<div class="pp-rating">★ ' + place.rating.toFixed(1) + dietPill + '</div>'
          : dietPill ? '<div class="pp-rating">' + dietPill + '</div>' : '') +
        (address ? '<div class="pp-meta pp-address">' + esc(address) + '</div>' : '') +
        hoursHTML +
        (website
          ? '<a href="' + website + '" target="_blank" rel="noopener" class="pp-link">Website ↗</a>'
          : '') +
      '</div>'
    );
  }

  // ── Stop popup HTML (road-trip numbered markers) ───────────────────────────

  function stopPopupHTML(stop, diets) {
    var count    = stop.pool ? stop.pool.length : 0;
    var display  = count >= 20 ? '20+' : count;
    var suffix   = count === 1 ? 'option' : 'options';
    var countStr = '';
    if (count) {
      if (diets && diets.length === 1) {
        countStr = '🍴 ' + display + ' ' + diets[0] + ' ' + suffix;
      } else if (diets && diets.length > 1) {
        countStr = '🍴 ' + display + ' ' + suffix + ' matching your preferences';
      } else {
        countStr = '🍴 ' + display + ' ' + suffix + ' nearby';
      }
    }

    var cards = (stop.restaurants || []).slice(0, 3)
      .map(function (p) { return restaurantCardHTML(p, diets); })
      .join('<div class="pp-sep"></div>');

    return (
      '<div class="pp-stop">' +
        '<div class="pp-stop-header">' +
          '<span class="pp-stop-num">Stop ' + stop.number + '</span>' +
          '<span class="pp-stop-city">' + esc(stop.locationName) + '</span>' +
        '</div>' +
        (countStr ? '<div class="pp-count">' + countStr + '</div>' : '') +
        cards +
      '</div>'
    );
  }

  // ── Shared hover / click logic ─────────────────────────────────────────────

  function attachEvents(marker, map, isCollapsedFn, getContent) {
    marker.addListener('mouseover', function () {
      if (!isCollapsedFn()) return;
      if (stickyMarker === marker) return;
      clearTimeout(hoverTimer);
      openFor(map, marker, getContent());
    });

    marker.addListener('mouseout', function () {
      if (stickyMarker === marker) return;
      hoverTimer = setTimeout(function () {
        if (!stickyMarker) getIW().close();
      }, 250);
    });

    marker.addListener('click', function () {
      if (!isCollapsedFn()) return;
      clearTimeout(hoverTimer);
      if (stickyMarker === marker) {
        getIW().close();
        stickyMarker = null;
      } else {
        stickyMarker = marker;
        openFor(map, marker, getContent());
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  window.attachPinPopup = function (marker, place, map, isCollapsedFn, getDiets) {
    attachEvents(marker, map, isCollapsedFn, function () {
      return restaurantCardHTML(place, getDiets ? getDiets() : []);
    });
  };

  window.attachStopPopup = function (marker, stop, map, isCollapsedFn, getDiets) {
    attachEvents(marker, map, isCollapsedFn, function () {
      return stopPopupHTML(stop, getDiets ? getDiets() : []);
    });
  };

}());
