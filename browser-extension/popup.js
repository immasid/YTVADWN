document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const sendTabBtn = document.getElementById('sendTabBtn');
  const cookieOptIn = document.getElementById('cookieOptIn');

  // Load cookie opt-in preference
  const { shareCookiesEnabled } = await chrome.storage.local.get(['shareCookiesEnabled']);
  cookieOptIn.checked = Boolean(shareCookiesEnabled);

  cookieOptIn.addEventListener('change', async () => {
    if (cookieOptIn.checked) {
      try {
        const granted = await chrome.permissions.request({
          permissions: ['cookies'],
          origins: ['*://*.youtube.com/*'],
        });
        if (granted) {
          await chrome.storage.local.set({ shareCookiesEnabled: true });
        } else {
          cookieOptIn.checked = false;
          await chrome.storage.local.set({ shareCookiesEnabled: false });
        }
      } catch (e) {
        console.warn('Failed to request cookies permission:', e);
        cookieOptIn.checked = false;
        await chrome.storage.local.set({ shareCookiesEnabled: false });
      }
    } else {
      await chrome.storage.local.set({ shareCookiesEnabled: false });
    }
  });

  // Check daemon status via background or direct fetch
  try {
    const res = await fetch('http://127.0.0.1:48125/ping', {
      headers: { 'X-PulseStream-Client': 'browser-extension' }
    });
    if (res.ok) {
      statusBadge.className = 'status-badge online';
      statusText.textContent = 'Connected';
      sendTabBtn.disabled = false;
    } else {
      statusBadge.className = 'status-badge offline';
      statusText.textContent = 'Offline';
      sendTabBtn.disabled = true;
    }
  } catch {
    statusBadge.className = 'status-badge offline';
    statusText.textContent = 'Offline';
    sendTabBtn.disabled = true;
  }

  // Handle Add Current Page to Queue
  sendTabBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    sendTabBtn.disabled = true;
    sendTabBtn.textContent = 'Queueing...';

    chrome.runtime.sendMessage(
      {
        action: 'handoff',
        url: tab.url,
        title: tab.title,
      },
      (response) => {
        if (response && response.success) {
          sendTabBtn.textContent = '✓ Queued!';
          setTimeout(() => {
            window.close();
          }, 800);
        } else {
          sendTabBtn.textContent = response?.error ? 'Failed' : 'Offline';
          sendTabBtn.disabled = false;
        }
      }
    );
  });
});
