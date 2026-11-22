// Vite `?raw` imports (cors.test.ts reads the production wrangler.toml as text).
declare module '*?raw' {
  const text: string;
  export default text;
}
