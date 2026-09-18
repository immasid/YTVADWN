import { describe, it, expect } from 'vitest';
import {
  listenBrowserHandoff,
  triggerMockHandoff,
  formatBytes,
  formatDuration,
  formatSpeed,
} from '../tauriBridge';
import { HandoffPayload } from '../../types/media';

describe('tauriBridge browser handoff listeners', () => {
  it('delivers handoff payload to registered listener in web environment', async () => {
    const received: HandoffPayload[] = [];
    const unlisten = await listenBrowserHandoff((payload) => {
      received.push(payload);
    });

    const testPayload: HandoffPayload = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      cookies: 'SID=test_cookie',
    };

    triggerMockHandoff(testPayload);

    expect(received.length).toBe(1);
    expect(received[0].url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(received[0].title).toBe('Rick Astley - Never Gonna Give You Up');
    expect(received[0].cookies).toBe('SID=test_cookie');

    unlisten();
    triggerMockHandoff({ url: 'https://www.youtube.com/watch?v=second' });
    expect(received.length).toBe(1); // No new events after unlisten
  });

  it('formats bytes, speeds, and durations correctly', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(0)).toBe('Unknown size');
    expect(formatSpeed(5242880)).toBe('5.0 MB/s');
    expect(formatDuration(213)).toBe('3:33');
    expect(formatDuration(3665)).toBe('1:01:05');
  });
});
