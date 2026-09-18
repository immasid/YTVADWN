// PulseStream YouTube Content Script
(function () {
  const BUTTON_ID = 'pulsestream-download-button';

  function createButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'pulsestream-yt-btn';
    btn.title = 'Send authentic stream to PulseStream Desktop App';
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>⬇ PulseStream</span>
    `;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const originalHtml = btn.innerHTML;
      btn.className = 'pulsestream-yt-btn sending';
      btn.innerHTML = `<span class="pulsestream-spinner"></span> <span>Sending...</span>`;

      try {
        const title = document.title.replace(/ - YouTube$/, '').trim();
        const url = window.location.href;

        const response = await chrome.runtime.sendMessage({
          action: 'handoff',
          url,
          title,
        });

        if (response && response.success) {
          btn.className = 'pulsestream-yt-btn success';
          btn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>✓ Sent</span>
          `;
        } else {
          btn.className = 'pulsestream-yt-btn error';
          btn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <span>✗ App Offline</span>
          `;
        }
      } catch (err) {
        btn.className = 'pulsestream-yt-btn error';
        btn.innerHTML = `<span>✗ Error</span>`;
      }

      setTimeout(() => {
        btn.className = 'pulsestream-yt-btn';
        btn.innerHTML = originalHtml;
      }, 2500);
    });

    return btn;
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) {
      return; // Already present
    }

    // Try finding YouTube player action buttons container
    const targets = [
      '#top-level-buttons-computed',
      '#actions #actions-inner #top-level-buttons-computed',
      'ytd-watch-metadata #actions',
      '#actions.ytd-watch-metadata',
      '#owner',
    ];

    let container = null;
    for (const selector of targets) {
      const el = document.querySelector(selector);
      if (el) {
        container = el;
        break;
      }
    }

    if (container) {
      const btn = createButton();
      // Insert as first button in the actions bar
      if (container.firstChild) {
        container.insertBefore(btn, container.firstChild);
      } else {
        container.appendChild(btn);
      }
    }
  }

  // Run on initial load
  injectButton();

  // Handle YouTube SPA Navigation events
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(injectButton, 400);
  });

  // Backup observer for dynamic DOM hydration
  const observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) {
      injectButton();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
