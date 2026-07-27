export function toIsoTime(value: string): string {
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new Error('Data source returned an invalid timestamp');
  return date.toISOString();
}
