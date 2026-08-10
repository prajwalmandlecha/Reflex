"use client";

import { useEffect, useRef, useState } from "react";

function getWsBase(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === 'undefined') return '';
  // Derive from NEXT_PUBLIC_API_URL if set, otherwise use same-origin
  // (nginx proxies /ws/ paths to the backend).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl) {
    const url = new URL(apiUrl);
    const protocol = url.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${url.host}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}`;
}

export function useWebSocket<T>(path: string, maxHistory = 100) {
  const [data, setData] = useState<T | null>(null);
  const [history, setHistory] = useState<T[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // When true, the close was deliberate (unmount / dep change) — do NOT reconnect (G9).
    let closedIntentionally = false;

    const connect = () => {
      if (closedIntentionally) return;
      const url = `${getWsBase()}${path}`;
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
        // Only reconnect if this wasn't a deliberate close.
        if (!closedIntentionally) {
          timer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closedIntentionally = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // Close the socket created by THIS effect instance (not just the latest ref),
      // so a prior reconnect's socket can't leak (G9).
      if (ws) {
        ws.onclose = null; // prevent reconnect logic from firing on this close
        ws.close();
        ws = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [path, maxHistory]);

  return { data, history, isConnected };
}
