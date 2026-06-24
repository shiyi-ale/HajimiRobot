import type { FrontendSocketMessage } from '@/src/types';

export function connectFrontendSocket(onMessage: (message: FrontendSocketMessage) => void) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/frontend`);

  socket.addEventListener('message', (event) => {
    try {
      onMessage(JSON.parse(event.data) as FrontendSocketMessage);
    } catch {
      // Ignore malformed messages from development backends.
    }
  });

  return socket;
}
