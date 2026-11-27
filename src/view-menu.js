/*
 * View menu: the toolbar's secondary controls in one dropdown next to Compose. On/off controls
 * (Surroundings, Glass, Market valuations, Market valuation trend) show as switches and leave the menu open;
 * actions (Hand mode, Walk a home, Level view, Reset view) run and close it. The existing buttons are moved
 * in, so their own handlers, labels and states keep working.
 */
const $ = (s, r = document) => r.querySelector(s);

export function createViewMenu() {
  const tools = $('.tools'); if (!tools) return;
  const wrap = document.createElement('div');
  wrap.className = 'viewmenu';
  wrap.innerHTML = `
    <button type="button" class="pill" id="viewMenuBtn" aria-haspopup="true" aria-expanded="false" aria-controls="viewMenu" title="View options: surroundings, glass, market panels and more">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/><circle cx="5.5" cy="4.5" r="1.4" fill="currentColor"/><circle cx="10.5" cy="8" r="1.4" fill="currentColor"/><circle cx="7" cy="11.5" r="1.4" fill="currentColor"/></svg>
      <span class="lbl">View</span><span class="vm-caret" aria-hidden="true"></span>
    </button>
    <div class="vm-panel" id="viewMenu" role="menu" aria-label="View options" hidden>
      <p class="vm-title">Show</p><div class="vm-group" data-group="show"></div>
      <div class="vm-group" data-group="market"></div>
      <p class="vm-title">Go to</p><div class="vm-group" data-group="go"></div>
    </div>`;
  tools.appendChild(wrap);
  const panel = $('.vm-panel', wrap), btn = $('#viewMenuBtn', wrap);
  const move = (sel, group) => { const el = $(sel); if (el) $(`[data-group="${group}"]`, panel).appendChild(el); return el; };

  move('#surroundBtn', 'show'); move('#glassBtn', 'show');
  const market = move('#valButtons', 'market');                 // hidden by the page outside developments
  if (market) market.insertAdjacentHTML('afterbegin', '<p class="vm-title">Market</p>');
  move('#handModeLink', 'go'); move('#homeTourLink', 'go'); move('#levelBtn', 'go');
  const reset = move('#resetBtn', 'go');
  if (reset && !reset.querySelector('.lbl')) { reset.insertAdjacentHTML('beforeend', '<span class="lbl">Reset view</span>'); reset.classList.remove('icon'); }
  panel.querySelectorAll('.pill').forEach((p) => p.setAttribute('role', p.hasAttribute('aria-pressed') || p.closest('#valButtons') ? 'menuitemcheckbox' : 'menuitem'));

  const setOpen = (on) => { panel.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) panel.querySelector('.pill:not([disabled])')?.focus({ preventScroll: true }); };
  btn.addEventListener('click', () => setOpen(panel.hidden));
  // actions close the menu; switches leave it open so several can be flipped
  panel.addEventListener('click', (e) => { const item = e.target.closest('.pill'); if (item && item.closest('[data-group="go"]')) setOpen(false); });
  document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !wrap.contains(e.target)) setOpen(false); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
}
