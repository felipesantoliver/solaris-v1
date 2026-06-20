// Shim opcional: só é necessário se você adicionar um tsconfig.json com
// checagem de tipos ativada. Sem isso, o Vite/esbuild já builda .jsx dentro
// de .tsx normalmente (ele só faz strip de tipos, não type-checking).
declare module '*.jsx' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component: any;
  export default Component;
}