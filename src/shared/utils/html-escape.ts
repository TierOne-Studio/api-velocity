const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_RE = /[&<>"']/g;

/**
 * Escape HTML special characters to prevent XSS in email templates.
 * Returns empty string for nullish input.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}
