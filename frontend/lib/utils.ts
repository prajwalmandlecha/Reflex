import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Copy text to clipboard. Works on both HTTPS and HTTP. Returns true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern Clipboard API first (requires secure context)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy method
    }
  }

  // Legacy fallback for HTTP
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Prevent scrolling to bottom
    ta.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();

    // For mobile devices
    ta.setSelectionRange(0, ta.value.length);

    const successful = document.execCommand('copy');
    document.body.removeChild(ta);

    if (!successful) {
      // Last resort: prompt user to manually copy
      window.prompt('Copy to clipboard: Ctrl+C, Enter', text);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Copy failed:', err);
    // Last resort: prompt user to manually copy
    window.prompt('Copy to clipboard: Ctrl+C, Enter', text);
    return false;
  }
}
