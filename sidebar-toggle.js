// Sidebar toggle: collapses the left search panel and lets users drag
// the button up/down to keep it out of the way of the map.
//
// Each .sidebar-toggle-btn lives inside the map panel, absolutely positioned
// on its left edge. btn.parentElement.previousElementSibling is the search panel.

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sidebar-toggle-btn').forEach(btn => {
    let dragging = false;
    let dragStartY = 0;
    let dragStartBtnTop = 0;

    // Convert current CSS position to a pixel top value so we can drag from it.
    function getPixelTop() {
      const parentRect = btn.parentElement.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      return btnRect.top - parentRect.top;
    }

    function startDrag(clientY) {
      dragging = false;
      dragStartY = clientY;
      dragStartBtnTop = getPixelTop();
      // Switch from % to px so we can update smoothly
      btn.style.top = dragStartBtnTop + 'px';
      btn.style.transform = 'none';
    }

    function moveDrag(clientY) {
      const dy = clientY - dragStartY;
      if (Math.abs(dy) > 4) dragging = true;
      if (!dragging) return;
      const parent = btn.parentElement;
      let newTop = dragStartBtnTop + dy;
      newTop = Math.max(0, Math.min(newTop, parent.offsetHeight - btn.offsetHeight));
      btn.style.top = newTop + 'px';
    }

    // Mouse drag
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      startDrag(e.clientY);
      const onMove = e => moveDrag(e.clientY);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Touch drag
    btn.addEventListener('touchstart', e => {
      startDrag(e.touches[0].clientY);
    }, { passive: true });

    btn.addEventListener('touchmove', e => {
      e.preventDefault();
      moveDrag(e.touches[0].clientY);
    }, { passive: false });

    // Toggle collapse — only fires when not dragging
    btn.addEventListener('click', () => {
      if (dragging) { dragging = false; return; }
      const panel = btn.parentElement.previousElementSibling;
      const isCollapsed = panel.classList.toggle('sidebar--collapsed');
      btn.dataset.collapsed = isCollapsed;
      btn.setAttribute('aria-label', isCollapsed ? 'Expand search panel' : 'Collapse search panel');
    });
  });
});
