(function () {
  const groups = [
    {
      label: 'Smoke Alarms', color: '#0073ea', icon: '<ellipse cx="12" cy="9" rx="9" ry="4"/><path d="M3 9v4a9 4 0 0 0 18 0V9"/><path d="M12 3v2M8 4.5l1 1.5M16 4.5l-1 1.5"/>',
      items: [['Sales App', '/smoke-alarms/smoke-alarm.html'], ['Quote Tracker', '/smoke-alarms/quote-tracker.html']]
    },
    {
      label: 'Aircons', color: '#a25ddc', icon: '<path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07"/>',
      items: [['Quote Builder', '/aircons/quote.html'], ['Quote Tracker', '/aircons/quote-tracker.html'], ['Job Tracker', '/aircons/job-tracker.html']]
    },
    {
      label: 'Hot Water Systems', color: '#00c875', icon: '<path d="M12 2s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/>',
      items: [['Quote Builder', '/hotwater/quote.html'], ['Quote Tracker', '/hotwater/quote-tracker.html'], ['Photo Tracker', '/hotwater/photo-tracker.html']]
    },
    {
      label: 'NSW Hot Water', color: '#fdab3d', icon: '<path d="M12 2s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/>',
      items: [['Quote Builder', '/hotwater-nsw/quote-builder.html'], ['Quote Tracker', '/hotwater-nsw/quote-tracker.html']]
    }
  ];

  const normalize = path => path.replace(/\/+$/, '') || '/';
  const currentPath = normalize(window.location.pathname);
  const icon = paths => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const chevron = icon('<polyline points="9 18 15 12 9 6"/>').replace('<svg ', '<svg class="internal-nav-chevron" ');

  const groupMarkup = groups.map((group, index) => {
    const items = group.items.map(([label, href]) => {
      const active = normalize(href) === currentPath;
      return `<a class="internal-nav-item${active ? ' active' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
    }).join('');
    return `<div class="internal-nav-group" style="--internal-group-color:${group.color}">
      <button class="internal-nav-trigger" type="button" aria-expanded="true" aria-controls="internalNavGroup${index}">
        ${icon(group.icon)}<span>${group.label}</span>${chevron}
      </button>
      <div class="internal-nav-children open" id="internalNavGroup${index}"><div class="internal-nav-children-inner">${items}</div></div>
    </div>`;
  }).join('');

  document.body.classList.add('has-internal-sidebar');
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
      </div>
      <nav class="internal-sidebar-nav" aria-label="Quote and tracker systems">${groupMarkup}</nav>
      <div class="internal-sidebar-footer"><div class="internal-sidebar-status"><span class="internal-sidebar-status-dot"></span><span>Systems Online</span><strong>Internal</strong></div></div>
    </aside>`);

  const sidebar = document.querySelector('.internal-sidebar');
  const toggle = document.querySelector('.internal-sidebar-toggle');
  const scrim = document.querySelector('.internal-sidebar-scrim');

  function setOpen(open) {
    sidebar.classList.toggle('open', open);
    scrim.classList.toggle('show', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close internal systems menu' : 'Open internal systems menu');
  }

  toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
  scrim.addEventListener('click', () => setOpen(false));
  sidebar.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
  sidebar.querySelectorAll('.internal-nav-trigger').forEach(button => {
    button.addEventListener('click', () => {
      const children = document.getElementById(button.getAttribute('aria-controls'));
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      children.classList.toggle('open', open);
    });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
  window.addEventListener('resize', () => { if (window.innerWidth > 860) setOpen(false); });
})();
