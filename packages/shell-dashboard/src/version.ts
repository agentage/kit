// The served index.html carries the shell package version in `<meta name="agentage-shell">`.
export const shellVersion = (): string =>
  document.querySelector<HTMLMetaElement>('meta[name="agentage-shell"]')?.content ?? '0.0.0';
