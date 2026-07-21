# GHF Grant Knowledge API

Version 1 is intentionally simple:

Kevin pastes a grant question or full grant application into the Custom GPT. The GPT calls this API. The API searches only approved past grant and grantwriting folders in Dropbox, prioritizes relevant and newer material, and returns short source excerpts. The GPT uses those excerpts to fill out the grant with no extra commentary.

Dropbox is the live master database for v1. This API does not use Supabase, Postgres, a private database, a vector database, a separate document store, a copied grant database, or a background ingestion pipeline for v1 search.

## How It Works

1. Kevin pastes one grant question or a full grant application into the Custom GPT.
2. The Custom GPT sends one authenticated request to `POST /search` with `{ "query": "..." }`.
3. This middleware searches Dropbox directly, using only the approved server-side folder allowlist.
4. The API returns compact source excerpts with file name, safe path, folder/category, year, rank, and excerpt.
5. The Custom GPT writes the final paste-ready grant answers.

The API retrieves and ranks source excerpts only. The Custom GPT is responsible for the final wording.

## Approved Dropbox Folders

The server always searches only these folders:

- `/4 - Development/1 - Grants/_2026 Grants`
- `/4 - Development/1 - Grants/2025 Grants`
- `/4 - Development/1 - Grants/2024 Grants`
- `/4 - Development/1 - Grants/Grantwriting Resources`

Kevin and the GPT do not choose folders, years, paths, Dropbox roots, namespaces, search locations, databases, or source systems. If a request includes those fields, v1 ignores them for search scope. The allowlist is enforced in middleware, and results outside the approved folders are filtered out.

Restricted-folder blocking and path safety checks still apply.

## Authentication

- `/health` is public.
- All search and debug endpoints require `Authorization: Bearer <GHF_ACTION_API_KEY>`.
- The Custom GPT Action stores and sends that bearer token.
- Kevin does not authenticate with Dropbox.
- Dropbox app key, app secret, refresh token, and optional namespace ID live only in server environment variables.
- If ChatGPT asks Kevin to allow the Action call, that should be the only user-facing permission step.

## Environment Variables

Copy `.env.example` to `.env` for local development.

Required:

```bash
GHF_ACTION_API_KEY=replace_with_long_random_secret
DROPBOX_APP_KEY=replace_with_dropbox_app_key
DROPBOX_APP_SECRET=replace_with_dropbox_app_secret
DROPBOX_REFRESH_TOKEN=replace_with_refresh_token
DROPBOX_ALLOWED_ROOTS="/4 - Development/1 - Grants/_2026 Grants|/4 - Development/1 - Grants/2025 Grants|/4 - Development/1 - Grants/2024 Grants|/4 - Development/1 - Grants/Grantwriting Resources"
```

Optional shared/team namespace:

```bash
DROPBOX_PATH_ROOT_NAMESPACE_ID=5698749680
```

Limits:

```bash
MAX_RESULTS_DEFAULT=5
MAX_RESULTS_LIMIT=10
MAX_EXCERPT_CHARS=2000
REQUEST_TIMEOUT_MS=20000
```

The app also accepts older Dropbox env names as fallbacks, but v1 docs and deployment config use the names above.

Do not put real secrets in Git.

## Namespace Setup

For GHF's shared Dropbox grants namespace, set:

```bash
DROPBOX_PATH_ROOT_NAMESPACE_ID=5698749680
```

Do not include `/D` in the approved folder paths. The API normalizes leading/trailing slashes and avoids trailing-slash search bugs.

If this variable is not set, the app still works for a normal Dropbox account where the approved folders are visible.

## Run Locally

Install dependencies:

```bash
pnpm install
```

Start the API:

```bash
pnpm dev
```

Default local URL:

```text
http://localhost:3000
```

## Test

```bash
pnpm test
pnpm run build
```

There is no v1 database setup step. Tests use a mocked Dropbox repository and do not require real Dropbox credentials.

## Example Requests

Health:

```bash
curl http://localhost:3000/health
```

Search with one grant question:

```bash
curl -X POST http://localhost:3000/search \
  -H "Authorization: Bearer <GHF_ACTION_API_KEY>" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"Describe Grant Halliburton Foundation's youth mental health education programming.\"}"
```

Search with a full pasted grant document:

```bash
curl -X POST http://localhost:3000/search \
  -H "Authorization: Bearer <GHF_ACTION_API_KEY>" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"Paste the full grant application text here, including all questions and instructions.\"}"
```

Optional result limit:

```json
{
  "query": "Paste grant question or full grant application text here",
  "max_results": 5
}
```

The server ignores request-supplied `folder`, `path`, `root`, `year`, `database`, `source`, and similar fields for search scope.

## Response Shape

`POST /search` returns compact source excerpts:

```json
{
  "query": "Describe Grant Halliburton Foundation's youth mental health education programming.",
  "query_characters": 78,
  "source": "dropbox",
  "searched_folders": [
    "/4 - Development/1 - Grants/_2026 Grants",
    "/4 - Development/1 - Grants/2025 Grants",
    "/4 - Development/1 - Grants/2024 Grants",
    "/4 - Development/1 - Grants/Grantwriting Resources"
  ],
  "results": [
    {
      "rank": 1,
      "title": "Example Grant Application",
      "source_file": "Example Grant Application.docx",
      "path": "/4 - Development/1 - Grants/2025 Grants/Example/Example Grant Application.docx",
      "source_path": "/4 - Development/1 - Grants/2025 Grants/Example/Example Grant Application.docx",
      "source_folder": "2025 Grants",
      "source_category": "approved_grant_folder",
      "year": "2025",
      "excerpt": "Short relevant Dropbox excerpt...",
      "confidence": "medium"
    }
  ]
}
```

Ranking is relevance-first. When relevance is similar, `_2026 Grants` is boosted first, then `2025 Grants`, then `2024 Grants`, then `Grantwriting Resources`.

## Custom GPT Action Setup

1. Deploy this API.
2. Open `openapi/ghf-grant-knowledge-api.yaml`.
3. Replace the placeholder server URL with the deployed API URL.
4. Paste the schema into GPT Builder Actions.
5. Configure Action authentication as bearer token auth.
6. Use the same value as `GHF_ACTION_API_KEY`.

The Action should call only `POST /search` for source retrieval. Kevin should not see Dropbox OAuth, Dropbox folder choices, API keys, database settings, paths, roots, namespaces, or troubleshooting prompts.

## Deployment Notes

For Render, `render.yaml` uses the v1 env var names.

For Vercel, add these environment variables manually:

- `NODE_ENV=production`
- `GHF_ACTION_API_KEY`
- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `DROPBOX_PATH_ROOT_NAMESPACE_ID=5698749680`
- `DROPBOX_ALLOWED_ROOTS=/4 - Development/1 - Grants/_2026 Grants|/4 - Development/1 - Grants/2025 Grants|/4 - Development/1 - Grants/2024 Grants|/4 - Development/1 - Grants/Grantwriting Resources`
- `MAX_RESULTS_DEFAULT=5`
- `MAX_RESULTS_LIMIT=10`
- `MAX_EXCERPT_CHARS=2000`
- `REQUEST_TIMEOUT_MS=20000`

Do not add Supabase, Postgres, vector database, private database, or background index refresh settings for v1.

## Security Notes

- Dropbox is read-only from this API.
- The API never uploads, edits, moves, or deletes Dropbox files.
- The folder allowlist cannot be changed by request body fields.
- Results outside the approved folders are excluded.
- Blocked path terms are enforced case-insensitively.
- Full documents are not returned, only excerpts.
- Logs omit excerpts, file contents, secrets, API keys, and restricted paths.
- Errors are intentionally generic to avoid exposing internals.

## Troubleshooting

- If shared/team Dropbox folders are not visible, check `DROPBOX_PATH_ROOT_NAMESPACE_ID`.
- If Dropbox search reports invalid path arguments, remove trailing slashes from `DROPBOX_ALLOWED_ROOTS`.
- If authentication fails, confirm the Action bearer token matches `GHF_ACTION_API_KEY`.
- If `/search` returns no results, call protected `GET /debug/dropbox` with the same bearer token and confirm the approved folders are reachable.
