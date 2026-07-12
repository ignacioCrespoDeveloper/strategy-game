// Local development server — serves static files only.
// In production, deploy the root folder to Netlify / Vercel / GitHub Pages (no server needed).

import express       from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app       = express();
const PORT      = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.static(join(__dirname, '..')));

app.listen(PORT, () => {
  console.log(`\n⚔  Hexfront dev server → http://localhost:${PORT}\n`);
});
