(function () {
  const groups = [
    {
      key: 'smoke', label: 'Smoke Alarms', color: '#0073ea', icon: '<ellipse cx="12" cy="9" rx="9" ry="4"/><path d="M3 9v4a9 4 0 0 0 18 0V9"/><path d="M12 3v2M8 4.5l1 1.5M16 4.5l-1 1.5"/>',
      items: [['Sales App', '/smoke-alarms/smoke-alarm.html'], ['Quote Tracker', '/smoke-alarms/quote-tracker.html']]
    },
    {
      key: 'vic-aircon', label: 'VIC Aircons', color: '#a25ddc', icon: '<path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07"/>',
      items: [['VIC Aircon Quote Builder', '/aircons/quote.html'], ['Quote Tracker', '/aircons/quote-tracker.html'], ['Job Tracker', '/aircons/job-tracker.html']]
    },
    {
      key: 'vic-hws', label: 'VIC Hot Water Systems', color: '#00c875', icon: '<path d="M12 2s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/>',
      items: [['VIC HWS Quote Builder', '/hotwater/quote.html'], ['Quote Tracker', '/hotwater/quote-tracker.html'], ['Photo Tracker', '/hotwater/photo-tracker.html']]
    },
    {
      key: 'nsw-hws', label: 'NSW Hot Water', color: '#fdab3d', icon: '<path d="M12 2s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/>',
      items: [['NSW HWS Quote Builder', '/hotwater-nsw/quote-builder.html'], ['Quote Tracker', '/hotwater-nsw/quote-tracker.html']]
    }
  ];

  const groupStorageKey = 'goldsure_internal_nav_groups';
  const pinStorageKey = 'goldsure_internal_nav_pinned';
  const normalize = path => path.replace(/\/+$/, '') || '/';
  const currentPath = normalize(window.location.pathname);
  const icon = paths => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const chevron = icon('<polyline points="9 18 15 12 9 6"/>').replace('<svg ', '<svg class="internal-nav-chevron" ');
  const readStorage = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
  };
  const writeStorage = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  };
  const savedGroups = readStorage(groupStorageKey, {});

  const groupMarkup = groups.map((group, index) => {
    const hasActiveItem = group.items.some(([, href]) => normalize(href) === currentPath);
    const isOpen = hasActiveItem || savedGroups[group.key] === true;
    const items = group.items.map(([label, href]) => {
      const active = normalize(href) === currentPath;
      return `<a class="internal-nav-item${active ? ' active' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
    }).join('');
    return `<div class="internal-nav-group" data-group-key="${group.key}" style="--internal-group-color:${group.color}">
      <button class="internal-nav-trigger" type="button" aria-expanded="${isOpen}" aria-controls="internalNavGroup${index}">
        ${icon(group.icon)}<span>${group.label}</span>${chevron}
      </button>
      <div class="internal-nav-children${isOpen ? ' open' : ''}" id="internalNavGroup${index}"><div class="internal-nav-children-inner">${items}</div></div>
    </div>`;
  }).join('');

  document.body.classList.add('has-internal-sidebar');
  if (document.body.dataset.internalSidebarMode === 'hover') {
    document.body.classList.add('internal-sidebar-hover-mode');
    if (readStorage(pinStorageKey, false) === true) document.body.classList.add('internal-sidebar-pinned');
  }
  document.body.insertAdjacentHTML('afterbegin', `
    <button class="internal-sidebar-toggle" type="button" aria-label="Open internal systems menu" aria-expanded="false" aria-controls="internalSystemsSidebar">
      ${icon('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>')}
    </button>
    <div class="internal-sidebar-scrim" aria-hidden="true"></div>
    <aside class="internal-sidebar" id="internalSystemsSidebar" aria-label="Internal Systems">
      <div class="internal-sidebar-brand">
        <a class="internal-sidebar-brand-link" href="/">
          <img src="/assets/gs-favicon-96px.png" alt=""><span class="internal-sidebar-brand-name">Goldsure</span>
        </a>
        <div class="internal-sidebar-brand-tag">Internal Systems</div>
        <button class="internal-sidebar-pin" type="button" aria-pressed="${document.body.classList.contains('internal-sidebar-pinned')}" aria-label="Keep sidebar expanded" title="Keep sidebar expanded">
          ${icon('<path d="M7 3h10l-1 7 3 4H5l3-4-1-7z"/><path d="M12 14v7"/>')}
        </button>
      </div>
      <nav class="internal-sidebar-nav" aria-label="Quote and tracker systems">
        <a class="internal-nav-home" href="/">
          ${icon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>')}
          <span>Main Portal</span>
        </a>
        ${groupMarkup}
      </nav>
      <div class="internal-sidebar-footer"><div class="internal-sidebar-status"><span class="internal-sidebar-status-dot"></span><span>Systems Online</span><strong>Internal</strong></div></div>
    </aside>`);

  const sidebar = document.querySelector('.internal-sidebar');
  const toggle = document.querySelector('.internal-sidebar-toggle');
  const scrim = document.querySelector('.internal-sidebar-scrim');
  const pin = document.querySelector('.internal-sidebar-pin');

  function setOpen(open) {
    sidebar.classList.toggle('open', open);
    scrim.classList.toggle('show', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close internal systems menu' : 'Open internal systems menu');
  }

  toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
  pin.addEventListener('click', () => {
    const pinned = !document.body.classList.contains('internal-sidebar-pinned');
    document.body.classList.toggle('internal-sidebar-pinned', pinned);
    pin.setAttribute('aria-pressed', String(pinned));
    pin.setAttribute('aria-label', pinned ? 'Allow sidebar to collapse' : 'Keep sidebar expanded');
    pin.setAttribute('title', pinned ? 'Allow sidebar to collapse' : 'Keep sidebar expanded');
    writeStorage(pinStorageKey, pinned);
  });
  scrim.addEventListener('click', () => setOpen(false));
  sidebar.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
  sidebar.querySelectorAll('.internal-nav-trigger').forEach(button => {
    button.addEventListener('click', () => {
      const children = document.getElementById(button.getAttribute('aria-controls'));
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      children.classList.toggle('open', open);
      const state = {};
      sidebar.querySelectorAll('.internal-nav-group').forEach(group => {
        state[group.dataset.groupKey] = group.querySelector('.internal-nav-trigger').getAttribute('aria-expanded') === 'true';
      });
      writeStorage(groupStorageKey, state);
    });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
  window.addEventListener('resize', () => { if (window.innerWidth > 860) setOpen(false); });
})();
