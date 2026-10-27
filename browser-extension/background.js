// PulseStream Background Service Worker (Manifest V3)
// Queue-first IDM-style integration for PulseStream desktop app

const DESKTOP_DAEMON_URL = 'http://127.0.0.1:48125';
const CONTEXT_MENU_ID = 'add-to-pulsestream-queue';

/**
 * Normalizes YouTube video links, thumbnails, search results, and Shorts
 * into a clean canonical watch URL.
 */
function normalizeYouTubeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (!hostname.includes('youtube.com') && !hostname.includes('youtu.be')) {
      return null;
    }

    // Handle youtu.be/ID
    if (hostname.includes('youtu.be')) {
      const videoId = parsed.pathname.replace(/^\//, '').split('/')[0];
      if (videoId && videoId.length >= 6) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // Handle youtube.com/shorts/ID
    if (parsed.pathname.startsWith('/shorts/')) {
      const parts = parsed.pathname.split('/');
      const videoId = parts[2] || parts[1];
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // Handle youtube.com/watch?v=ID
    if (parsed.searchParams.has('v')) {
      const videoId = parsed.searchParams.get('v');
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // Generic fallback if watch URL
    if (parsed.pathname === '/watch') {
      return parsed.toString();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Reads YouTube session cookies only if user explicitly opted in.
 */
async function getFormattedCookies() {
  try {
    const { shareCookiesEnabled } = await chrome.storage.local.get(['shareCookiesEnabled']);
    if (!shareCookiesEnabled) {
      return '';
    }

    const hasPermission = await chrome.permissions.contains({ permissions: ['cookies'] });
    if (!hasPermission) {
      return '';
    }

    const cookies = await chrome.cookies.getAll({ domain: '.youtube.com' });
    if (!cookies || cookies.length === 0) {
      return '';
    }

    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    console.warn('[PulseStream] Cookie extraction bypassed or unavailable:', e);
    return '';
  }
}

/**
 * Sends a notification to desktop/browser without stealing window focus.
 */
function showNotification(title, message) {
  if (chrome.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 1,
    });
  }
}

/**
 * Updates extension action badge temporarily.
 */
function flashBadge(text, color) {
  if (chrome.action) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 2500);
  }
}

/**
 * Sends video handoff payload to PulseStream desktop daemon.
 */
async function sendHandoff(videoUrl, title) {
  try {
    const cookies = await getFormattedCookies();
    const payload = {
      url: videoUrl,
      title: title || null,
      cookies: cookies || null,
      focusWindow: false,
      client: 'browser-extension',
    };

    const res = await fetch(`${DESKTOP_DAEMON_URL}/handoff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PulseStream-Client': 'browser-extension',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      flashBadge('✓', '#06b6d4'); // Cyan check
      return { success: true };
    } else {
      flashBadge('!', '#ef4444');
      return { success: false, error: `Daemon returned ${res.status}` };
    }
  } catch (err) {
    console.error('[PulseStream] Failed to connect to desktop daemon:', err);
    flashBadge('!', '#ef4444');
    showNotification(
      'PulseStream App Offline',
      'Please launch the PulseStream desktop app to receive downloads.'
    );
    return { success: false, error: 'PulseStream desktop app is not running' };
  }
}

// 1. Context Menu Registration
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Add to PulseStream Queue',
    contexts: ['link', 'video', 'page'],
    targetUrlPatterns: ['*://*.youtube.com/*', '*://youtube.com/*'],
  });
});

// 2. Context Menu Click Handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    const rawUrl = info.linkUrl || info.srcUrl || info.pageUrl || tab?.url;
    const resolvedUrl = normalizeYouTubeUrl(rawUrl);

    if (!resolvedUrl) {
      showNotification(
        'Invalid YouTube Link',
        'Right-clicked link does not appear to be a recognized YouTube video or Shorts.'
      );
      return;
    }

    await sendHandoff(resolvedUrl, tab?.title);
  }
});

// 3. Message Listener for Popup and Content Scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'handoff') {
    (async () => {
      const resolved = normalizeYouTubeUrl(message.url) || message.url;
      const result = await sendHandoff(resolved, message.title);
      sendResponse(result);
    })();
    return true; // Keep channel open for async response
  }

  if (message.action === 'ping') {
    (async () => {
      try {
        const res = await fetch(`${DESKTOP_DAEMON_URL}/ping`, {
          headers: {
            'X-PulseStream-Client': 'browser-extension',
          },
        });
        if (res.ok) {
          const data = await res.json();
          sendResponse({ success: true, data });
        } else {
          sendResponse({ success: false });
        }
      } catch {
        sendResponse({ success: false });
      }
    })();
    return true;
  }
});
