# PatternJSON C2C Importer

PatternJSON converts written C2C and row-by-row colorwork PDFs into the JSON
formats used by the interactive crochet tool. It uses deterministic parsing,
not AI.

## What it does

- Lets you choose C2C or colorwork.
- Accepts multiple size PDFs for one C2C pattern.
- Uses one PDF and one finished size for a typical colorwork pattern.
- Extracts every row, color run, and block total.
- Detects rectangular C2C corner markers.
- Rejects missing rows and rows whose color counts do not match the stated total.
- Generates graph paths as `graphImages/{slug}-{variant}-graph.png`.
- Generates colorwork graph paths as `graphImages/{slug}-graph.png`.
- Calculates 200-yard skeins per color, always rounding up:
  - C2C: one skein per 1,000 blocks.
  - Colorwork: one skein per 5,000 stitches.
- Downloads a local JSON copy.
- Uploads the JSON to Supabase Storage and upserts its database record.

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create `.env` from `.env.example`.

3. Add the server-only Supabase values:

   ```text
   APP_ADMIN_PASSWORD=choose_a_long_private_password
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   SUPABASE_PATTERN_BUCKET=interactive-patterns
   PORT=3001
   ```

   Find the project URL and service role key in the Supabase project settings.
   Never put the service role key in browser code or commit `.env`.

4. Open the Supabase SQL Editor and run:

   ```text
   supabase-patterns.sql
   ```

5. Start the importer:

   ```powershell
   npm run dev
   ```

6. Open `http://localhost:5173`.

## Deploy on Render

This importer uses a full Node server so uploaded PDFs are not constrained by a
small serverless request-body limit.

1. Put the contents of this `shapejson` folder in a private GitHub repository.
2. In Render, choose **New > Blueprint** and connect that repository.
3. Render reads `render.yaml`.
4. Enter these secret environment variables when prompted:

   ```text
   APP_ADMIN_PASSWORD
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   ```

5. Deploy and open the generated Render URL.

The owner password protects PDF parsing and all Supabase writes. Keep the
repository private and never commit `.env`.

## Saved location

Each completed pattern is saved to:

```text
interactive-patterns/{slug}/{slug}.json
```

The `interactive_patterns` table stores the same JSON in `pattern_data` and
records its bucket/path so another app can load it by slug.

## Expected PDF format

The parser expects written C2C rows in this form:

```text
Row 1 [RS]: (Dark Teal) x 1 (1 block)
Row 2 [WS]: (Dark Teal) x 2 (2 blocks)
```

Rectangular corner lines such as `Corner: Start decreasing on RS` are detected
and converted into the special turn instructions used by the interactive tool.
