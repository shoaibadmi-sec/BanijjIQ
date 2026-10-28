export type ToastType = 'success' | 'error' | 'warning' | 'info';

export type ToastPayload = {
  type: ToastType;
  message: string;
  duration?: number;
};

const EVENT_NAME = 'shererp:toast';

export function notify(type: ToastType, message: string, duration?: number): void {
  if (!message?.trim()) return;
  window.dispatchEvent(new CustomEvent<ToastPayload>(EVENT_NAME, {
    detail: { type, message: message.trim(), duration }
  }));
}

export function notifySuccess(message: string, duration = 3200): void {
  notify('success', message, duration);
}

export function notifyError(message: string, duration = 4500): void {
  notify('error', message, duration);
}

export function notifyWarning(message: string, duration = 4000): void {
  notify('warning', message, duration);
}

export function notifyInfo(message: string, duration = 3200): void {
  notify('info', message, duration);
}

export function onToast(listener: (payload: ToastPayload) => void): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<ToastPayload>;
    if (custom.detail) listener(custom.detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
