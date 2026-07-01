# GHF Grant Knowledge API

Secure read-only middleware API for Grant Halliburton Foundation grant-writing source material stored in Dropbox. It is designed for GPT Actions: the API returns short excerpts with source metadata, and the Custom GPT drafts the final grant answer.

Last deployment verification: July 1, 2026.

## Project overview

The API searches approved Dropbox grant folders for prior proposal language, Copy folder language, grant reports, summaries, and program material. It does not expose Dropbox as a general file browser and does not return full documents.

Core endpoints:

- `GET /health`
- `POST /search_grant_language`
- `POST /search_by_funder`
- `POST /search_answer_category`
- `POST /fetch_source_excerpt`
- `GET /debug/dropbox` for protected local Dropbox diagnostics

## Architecture

- Express + TypeScript API
- Zod request validation
- Bearer API-key authentication for every non-health endpoint
- Direct Dropbox HTTP API calls for read-only search and download
- Text extraction for `.docx`, `.pdf`, `.txt`, `.md`, `.csv`, `.xlsx`, and `.xls`
- Keyword scoring for Version 1 excerpt search
- Vitest + Supertest tests with a mocked Dropbox repository

## Local setup

1. Install Node.js 20+.
2. Install dependencies:

```bash
pnpm install
```

3. Create a local env file:

```bash
cp .env.example .env
```

4. Fill in `.env` with the API key and Dropbox OAuth values.
5. Start local development:

```bash
pnpm dev
```

The API runs on `http://localhost:3000` unless `PORT` is changed.

## Environment variables

See `.env.example` for the full list.

Important values:

- `GHF_ACTION_API_KEY`: long random secret used by GPT Actions as a bearer token.
- `DROPBOX_CLIENT_ID`: Dropbox app key.
- `DROPBOX_CLIENT_SECRET`: Dropbox app secret.
- `DROPBOX_REFRESH_TOKEN`: server-side refresh token.
- `DROPBOX_NAMESPACE_ID`: optional shared/team namespace ID. For GHF, this may be `5698749680`.
- `DROPBOX_ALLOWED_ROOT`: defaults to `/4 - Development/1 - Grants`.
- `MAX_RESULTS_LIMIT`: hard cap for returned search results.
- `MAX_EXCERPT_CHARS`: hard cap for returned excerpts.

Never commit `.env`, Dropbox tokens, app secrets, or real API keys.

For GHF's shared grant archive, set `DROPBOX_NAMESPACE_ID` and keep `DROPBOX_ALLOWED_ROOT` as the path inside that namespace. Do not include `/D` and do not add a trailing slash.

## Dropbox setup

1. Create a Dropbox app in the Dropbox App Console.
2. Use the minimum scopes needed to search/list and download files.
3. Configure the app for read-only access where Dropbox permissions allow it.
4. Generate an OAuth refresh token for the account that can access the approved grant folders.
5. Store the app key, app secret, and refresh token as environment variables on the server.

The code only calls Dropbox search, OAuth refresh, and file download endpoints. It does not write, move, delete, or upload Dropbox files.

## Local Dropbox diagnostics

After starting the local server, call the protected diagnostic endpoint with the same bearer API key used by the search endpoints:

```bash
curl -H "Authorization: Bearer <GHF_ACTION_API_KEY>" http://localhost:3000/debug/dropbox
```

The response only reports sanitized checks: whether Dropbox credentials and namespace ID are configured, whether account/root checks worked, and whether a small `Lyda Hill` search found files.

## Running tests

```bash
pnpm test
```

The tests use `tests/mockDropboxRepository.ts`, so no real Dropbox credentials are required.

Build check:

```bash
pnpm run build
```

## Local Dropbox archive indexing

To scan the full approved grant archive and build a local report:

```bash
pnpm run index:dropbox
```

The indexer scans:

- `/4 - Development/1 - Grants/2023 Grants`
- `/4 - Development/1 - Grants/2024 Grants`
- `/4 - Development/1 - Grants/2025 Grants`
- `/4 - Development/1 - Grants/_2026 Grants`
- `/4 - Development/1 - Grants/Grantwriting Resources`

It writes a private searchable index and report to `work/index/`. These files are intentionally ignored by Git because they can contain real grant excerpts. The script is read-only against Dropbox: it lists and downloads files but never edits, moves, or deletes them.

The report includes scanned/indexed/skipped/failed counts, file-level skip or parse reasons, counts by year/funder/document type, and sample search confirmations.

## Free Deployment to Vercel

This repo includes `vercel.json` so it can run on Vercel's free Hobby plan for personal/small projects.

1. Sign in at https://vercel.com with GitHub.
2. Choose Add New Project.
3. Import this GitHub repository.
4. Add these environment variables:
   - `GHF_ACTION_API_KEY`
   - `DROPBOX_CLIENT_ID`
   - `DROPBOX_CLIENT_SECRET`
   - `DROPBOX_REFRESH_TOKEN`
   - `DROPBOX_NAMESPACE_ID=5698749680`
   - `DROPBOX_ALLOWED_ROOT=/4 - Development/1 - Grants`
   - `NODE_ENV=production`
5. Deploy.
6. Confirm `/health` works on the Vercel URL.

## Deployment to Render

This repo includes `render.yaml`.

1. Push the project to a private Git repository.
2. Create a Render Web Service from that repository.
3. Use the included build command:

```bash
corepack enable && pnpm install && pnpm run build
```

4. Use the start command:

```bash
pnpm start
```

5. Add all required environment variables in Render.
6. Confirm `GET /health` returns the expected JSON.

## GPT Builder Action setup

1. Deploy the API.
2. Open `openapi/ghf-grant-knowledge-api.yaml`.
3. Replace the placeholder server URL with the deployed Vercel or Render URL.
4. Paste the schema into GPT Builder Actions.
5. Configure authentication as bearer token auth using the same value as `GHF_ACTION_API_KEY`.
6. Test actions from GPT Builder with a safe prompt such as: "Find previous language about demographics."

The Custom GPT should call this API to retrieve excerpts, then draft the final answer itself while honoring any character limit.

## Security notes

- `/health` is public; all other endpoints require `Authorization: Bearer <GHF_ACTION_API_KEY>`.
- Only paths inside the configured `DROPBOX_ALLOWED_ROOT` are accepted.
- Blocked terms are enforced in code, case-insensitively: W-9, W9, Audit, 990, Insurance, Board, Donor, Bank, HR, Personnel, Payroll, Tax, Check, ACH, Account, Routing, Staff Contact, Personal, Confidential.
- Blocked paths return `blocked_path` and are not downloaded.
- Results are capped at `MAX_RESULTS_LIMIT`.
- Excerpts are capped at `MAX_EXCERPT_CHARS`.
- Logs omit excerpts, file contents, secrets, API keys, and restricted paths.
- Rate limiting is included by API key or IP.
- Errors are intentionally generic to avoid exposing internals.

## Troubleshooting

- If Dropbox searches return `{}` or no matches with no obvious error, check that `DROPBOX_NAMESPACE_ID` is set for the shared/team namespace.
- If Dropbox returns `files/search_v2 invalid_argument`, remove any trailing slash from `DROPBOX_ALLOWED_ROOT`.
- If authentication works but no files appear, run `GET /debug/dropbox` locally.
- If secrets were exposed in screenshots or logs, rotate the Dropbox App secret and refresh token before deployment.

## Known limitations

- Dropbox search may miss content in some file types.
- Legacy `.doc` files are scanned and reported, but should be converted to `.docx` or PDF before they can be indexed safely.
- PDF extraction quality may vary.
- Image-only PDFs may need OCR before useful text can be indexed.
- This API returns excerpts, not final grant answers.
- Human review is still required for numbers, budgets, deadlines, and funder submission.
- The API intentionally blocks sensitive folder patterns.
- Version 1 uses keyword search; vector/semantic search can be added later.

## Future improvements

- Vector search cache
- Nightly indexing job
- Supabase or Postgres storage
- Admin dashboard for approved files
- Manual answer-bank curation
- Funder history summaries
- Report due-date extraction
- Source ranking by funded/successful grants
- User feedback loop for good answer examples
