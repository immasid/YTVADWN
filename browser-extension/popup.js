document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const sendTabBtn = document.getElementById('sendTabBtn');

  // Check daemon status
  try {
    const res = await fetch('http://127.0.0.1:48125/ping');
    if (res.ok) {
      statusBadge.className = 'status-badge online';
      statusText.textContent = 'Connected';
      sendTabBtn.disabled = false;
    } else {
      statusBadge.className = 'status-badge offline';
      statusText.textContent = 'Offline';
      sendTabBtn.disabled = true;
    }
  } catch (e) {
    statusBadge.className = 'status-badge offline';
    statusText.textContent = 'Offline';
    sendTabBtn.disabled = true;
  }

  // Handle Send Current Tab click
  sendTabBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    sendTabBtn.disabled = true;
    sendTabBtn.textContent = 'Sending...';

    chrome.runtime.sendMessage(
      {
        action: 'handoff',
        url: tab.url,
        title: tab.title,
      },
      (response) => {
        if (response && response.success) {
          sendTabBtn.textContent = '✓ Sent!';
          setTimeout(() => {
            window.close();
          }, 1000);
        } else {
          sendTabBtn.textContent = 'Failed';
          sendTabBtn.disabled = false;
        }
      }
    );
  });
});
