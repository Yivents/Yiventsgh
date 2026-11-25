export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function safeText<T extends string | undefined>(value: T): T {
  // React escapes by default; this helper makes the plain-text policy explicit.
  return value?.replace(/[\u0000-\u001F]/g, ' ') as T;
}

export function makeGmailBccLink(subject: string, body: string, emails: string[], account = ''): string {
  const params = new URLSearchParams({
    view: 'cm',
    su: subject,
    body,
    bcc: emails.join(','),
  });
  if (account) params.set('tf', '1');
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function makeMailtoBccLink(subject: string, body: string, emails: string[]): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}&bcc=${emails.join(',')}`;
}
