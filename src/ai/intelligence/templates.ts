export function templateVariables(requestText: string) {
  const names: string[] = [];
  const pattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(requestText))) names.push(match[1].toLowerCase());
  return Array.from(new Set(names));
}
