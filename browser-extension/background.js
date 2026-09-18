// PulseStream Background Service Worker (Manifest V3)

const DESKTOP_DAEMON_URL = 'http://127.0.0.1:48125';

async function getFormattedCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.youtube.com' });
    if (!cookies || cookies.length === 0) {
      return '';
    }
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    console.warn('[PulseStream] Failed to read cookies:', e);
    return '';
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'handoff') {
    (async () => {
      try {
        const cookies = await getFormattedCookies();
        const payload = {
          url: message.url,
          title: message.title || null,
          cookies: cookies || null,
        };

        const res = await fetch(`${DESKTOP_DAEMON_URL}/handoff`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: `Daemon returned status ${res.status}` });
        }
      } catch (err) {
        console.error('[PulseStream] Failed to connect to desktop daemon:', err);

        // Show desktop browser notification
        if (chrome.notifications) {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'PulseStream Desktop Offline',
            message: 'PulseStream is not running. Please launch the desktop app to receive downloads.',
            priority: 2,
          });
        }

        sendResponse({ success: false, error: 'PulseStream desktop app is not running' });
      }
    })();

    return true; // Keep message channel open for async response
  }

  if (message.action === 'ping') {
    (async () => {
      try {
        const res = await fetch(`${DESKTOP_DAEMON_URL}/ping`);
        if (res.ok) {
          const data = await res.json();
          sendResponse({ success: true, data });
        } else {
          sendResponse({ success: false });
        }
      } catch (e) {
        sendResponse({ success: false });
      }
    })();
    return true;
  }
});
