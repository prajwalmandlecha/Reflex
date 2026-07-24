export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function formatCurrencyPrecise(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n || 0);
}

export function formatTimestamp(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Never';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'Just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function pct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, (used / cap) * 100);
}

export function capStatus(
  used: number,
  cap: number
): 'healthy' | 'caution' | 'stopped' {
  const p = pct(used, cap);
  if (p >= 100) return 'stopped';
  if (p >= 80) return 'caution';
  return 'healthy';
}

export function classNames(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
