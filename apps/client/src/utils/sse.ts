/**
 * SSE 兼容层
 *
 * 目标：
 * - H5：优先用浏览器原生 `EventSource`；不支持时降级为 `fetch` + ReadableStream。
 * - App/小程序：当前阶段提供函数签名与最小占位实现，由后续单元按平台补齐。
 *
 * 设计要点：
 * - 暴露 `useSSE()` composable，返回 `connect / close / status`。
 * - 解析后端 `event: <type>\ndata: <json>\n\n` 协议，匹配 `@xiaoyu/api-types` 的 `SSEEventType`。
 * - 内置指数退避重连（默认 1s -> 2s -> 4s ... 上限 30s）。
 * - messageId 去重：同一 `messageId` 只回调一次。
 * - 提供 `onMessage / onError / onOpen / onClose` 回调。
 */

import type { ChatSSEData, SSEChunk, SSEEventType } from '@xiaoyu/api-types';

export type SSECallbacks<T = unknown> = {
  onOpen?: () => void;
  onMessage?: (chunk: SSEChunk<T>) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
};

export type SSEStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface SSEHandle {
  close: () => void;
  status: SSEStatus;
}

export interface SSEOptions extends SSECallbacks {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  /** 最大重试次数，默认 5。设 0 关闭自动重连。 */
  maxRetries?: number;
  /** 初始退避毫秒，默认 1000。 */
  initialBackoffMs?: number;
  /** 最大退避毫秒，默认 30000。 */
  maxBackoffMs?: number;
}

// #ifdef H5
declare const EventSource: {
  new (url: string, opts?: { withCredentials?: boolean }): EventSourceLike;
};
interface EventSourceLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close(): void;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
}
// #endif

function isH5(): boolean {
  // #ifdef H5
  return true;
  // #endif
  // #ifndef H5
  return false;
  // #endif
}

function parseSSEBlock(block: string): SSEChunk | null {
  // 协议：event: <type>\ndata: <json>\n\n
  const lines = block.split(/\r?\n/);
  let event: SSEEventType | null = null;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() as SSEEventType;
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (!event) return null;
  const dataStr = dataLines.join('\n');
  let data: unknown = dataStr;
  try {
    data = dataStr ? JSON.parse(dataStr) : null;
  } catch {
    // 保持为字符串
  }
  return { event, data };
}

/**
 * 打开一个 SSE 连接；返回 handle 用于关闭。
 *
 * 该函数是"裸"连接，不绑定 Vue 组件生命周期。Composable 形式见 `useSSE`。
 */
export function openSSE<T = unknown>(options: SSEOptions): SSEHandle {
  const {
    url,
    method = 'GET',
    headers = {},
    body,
    maxRetries = 5,
    initialBackoffMs = 1000,
    maxBackoffMs = 30000,
    onOpen,
    onMessage,
    onError,
    onClose,
  } = options;

  let status: SSEStatus = 'idle';
  let retries = 0;
  let closedByUser = false;
  let seenMessageIds = new Set<string>();
  let es: EventSourceLike | null = null;
  let abortCtrl: AbortController | null = null;

  function setStatus(s: SSEStatus) {
    status = s;
  }

  function scheduleReconnect(connect: () => void) {
    if (closedByUser || maxRetries <= 0) return;
    if (retries >= maxRetries) {
      setStatus('error');
      onError?.(new Error('SSE: exceeded max retries'));
      onClose?.();
      return;
    }
    const wait = Math.min(initialBackoffMs * Math.pow(2, retries), maxBackoffMs);
    retries += 1;
    setTimeout(connect, wait);
  }

  function dispatch(chunk: SSEChunk<T>) {
    const data = chunk.data as Partial<ChatSSEData> | null;
    if (data && typeof data === 'object' && typeof data.messageId === 'string') {
      if (seenMessageIds.has(data.messageId)) return;
      seenMessageIds.add(data.messageId);
    }
    onMessage?.(chunk);
  }

  function connectWithEventSource() {
    setStatus('connecting');
    es = new EventSource(url, { withCredentials: false });
    es.onopen = () => {
      retries = 0;
      setStatus('open');
      onOpen?.();
    };
    const handle = (ev: MessageEvent) => {
      // 后端若用 `event: <type>` 推送，会进 addEventListener 通道；裸 message 走 onmessage。
      const text = typeof ev.data === 'string' ? ev.data : '';
      if (!text) return;
      // 兼容：若没有 event 字段，默认按 data 直接解析为 message_delta。
      try {
        const json = JSON.parse(text);
        if (json && typeof json === 'object' && 'event' in json) {
          dispatch({ event: json.event, data: json.data } as SSEChunk<T>);
        } else {
          dispatch({ event: 'message_delta', data: json } as SSEChunk<T>);
        }
      } catch {
        // ignore
      }
    };
    es.onmessage = handle as unknown as ((ev: MessageEvent) => void);
    // 同时监听命名事件
    (['message_start', 'message_delta', 'message_end', 'error'] as SSEEventType[]).forEach((evt) => {
      es!.addEventListener(evt, (ev: MessageEvent) => {
        const block = `event: ${evt}\ndata: ${typeof ev.data === 'string' ? ev.data : ''}`;
        const parsed = parseSSEBlock(block);
        if (parsed) dispatch(parsed as SSEChunk<T>);
      });
    });
    es.onerror = () => {
      es?.close();
      es = null;
      setStatus('error');
      onError?.(new Error('SSE: connection error'));
      scheduleReconnect(connectWithEventSource);
    };
  }

  async function connectWithFetch() {
    setStatus('connecting');
    abortCtrl = new AbortController();
    try {
      const resp = await fetch(url, {
        method,
        headers: { Accept: 'text/event-stream', ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: abortCtrl.signal,
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`SSE: HTTP ${resp.status}`);
      }
      setStatus('open');
      onOpen?.();
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        // SSE 帧以 `\n\n` 结束
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseSSEBlock(block);
          if (parsed) dispatch(parsed as SSEChunk<T>);
        }
      }
      setStatus('closed');
      onClose?.();
    } catch (err) {
      if (closedByUser) return;
      setStatus('error');
      onError?.(err);
      scheduleReconnect(connectWithFetch);
    }
  }

  function close() {
    closedByUser = true;
    try {
      es?.close();
    } catch {
      // ignore
    }
    try {
      abortCtrl?.abort();
    } catch {
      // ignore
    }
    setStatus('closed');
    onClose?.();
  }

  // 启动连接
  if (isH5() && typeof EventSource !== 'undefined') {
    connectWithEventSource();
  } else if (isH5() && typeof fetch !== 'undefined') {
    connectWithFetch();
  } else {
    // 非 H5：本期占位实现，触发 error 让上层感知。
    setStatus('error');
    queueMicrotask(() => {
      onError?.(new Error('SSE: platform not supported in U8, to be implemented in later unit'));
      onClose?.();
    });
  }

  return {
    close,
    get status() {
      return status;
    },
  };
}

/**
 * Vue 3 composable 包装
 *
 * 示例：
 * ```ts
 * const { connect, close, status } = useSSE<ChatSSEData>();
 * onMounted(() => connect({ url: '/api/chat/stream', onMessage: (c) => ... }));
 * onUnmounted(() => close());
 * ```
 */
export function useSSE<T = unknown>() {
  let handle: SSEHandle | null = null;
  return {
    connect(options: Omit<SSEOptions, 'onMessage' | 'onError' | 'onOpen' | 'onClose'> & Partial<SSECallbacks<T>>) {
      handle?.close();
      handle = openSSE<T>(options as SSEOptions);
      return handle;
    },
    close() {
      handle?.close();
      handle = null;
    },
    get status(): SSEStatus {
      return handle?.status ?? 'idle';
    },
  };
}
