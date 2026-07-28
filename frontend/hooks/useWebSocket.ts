'use client';

import { useEffect, useRef, useState } from 'react';

// Default to same-origin WebSocket; nginx proxies /ws/ to the backend.
const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : '');

export function useWebSocket<T>(path: string, maxHistory = 100) {
  const [data, setData] = useState<T | null>(null);
  const [history, setHistory] = useState<T[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket;
    let timer: NodeJS.Timeout;

    const connect = () => {
      const url = `${WS_BASE}${path}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as T;
          setData(parsed);
          setHistory((prev) => [parsed, ...prev].slice(0, maxHistory));
        } catch {
          // ignore non-json
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Reconnect after 3 seconds
        timer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      clearTimeout(timer);
    };
  }, [path, maxHistory]);

  return { data, history, isConnected };
}
