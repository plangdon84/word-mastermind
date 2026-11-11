// Vite (and Vitest) import a file's contents as a string with the `?raw` suffix.
// One virtual module per first letter, made by a plugin in vite.config.ts (Dev Plan item 19zn).
declare module 'virtual:definitions-*' {
  const json: string;
  export default json;
}

declare module '*?raw' {
  const content: string;
  export default content;
}
