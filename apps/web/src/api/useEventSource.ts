import { useEffect, useRef, useCallback, useState } from "react";

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

interface UseEventSourceOptions {
  readonly url: string;
  readonly enabled?: boolean;
}

interface UseEventSourceReturn<T> {
  readonly events: readonly T[];
  readonly status: ConnectionStatus;
  readonly clearEvents: () => void;
}

function tryParseJson<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function useEventSource<T = unknown>({
  url,
  enabled = true,
}: UseEventSourceOptions): UseEventSourceReturn<T> {
  const [events, setEvents] = useState<readonly T[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("closed");
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectDelayRef = useRef(1000);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const handleOpen = useCallback(() => {
    setStatus("open");
    reconnectDelayRef.current = 1000;
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    const parsed = tryParseJson<T>(event.data);
    if (parsed !== null) {
      setEvents((prev) => [...prev, parsed]);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      return;
    }

    function scheduleReconnect() {
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
        connect();
      }, reconnectDelayRef.current);
    }

    function connect() {
      setStatus("connecting");

      const source = new EventSource(url);
      eventSourceRef.current = source;

      source.onopen = handleOpen;
      source.onmessage = handleMessage;
      source.onerror = () => {
        setStatus("error");
        source.close();
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [url, enabled, handleOpen, handleMessage]);

  return { events, status, clearEvents };
}
