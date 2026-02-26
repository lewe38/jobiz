---
id: wtj
title: Welcome to the Jungle Extractor
description: Fetches job listings from Welcome to the Jungle using their public jobs search API.
sidebar_position: 8
---

## What it is

Original website: [welcometothejungle.com](https://www.welcometothejungle.com)

Welcome to the Jungle (WTJ) is a job board primarily used in Europe. This extractor queries the WTJ public jobs search API and maps results into the orchestrator `CreateJobInput` shape.

Implementation split:

1. `extractors/wtj/src/main.ts` builds paginated API requests for each search term and writes per-job JSON files to the dataset directory.
2. `extractors/wtj/src/run.ts` spawns the main process, streams progress events, reads the dataset, and de-duplicates results for pipeline import.

## Why it exists

WTJ adds a European-focused job board source that can be enabled from the existing source picker, without requiring credentials.

It supports term-by-term search and optional country-code filtering using the same pipeline knobs already configured for automatic runs.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. WTJ is **not enabled by default** in **Sources** — toggle it on if you want it for this run.
3. Set your existing automatic run knobs:
   - `searchTerms` drive per-term WTJ `query`.
   - Run budget path (`jobspyResultsWanted`) is reused as the max jobs-per-term cap (default `100`). This is a shared run budget setting used by several extractors including Hiring Cafe.
   - Optional `wtjCountryCode` setting narrows results by ISO-2 country code (e.g. `GB`, `FR`).
4. Start the run and watch progress in the pipeline progress card.

Defaults and constraints:

- No credentials required.
- WTJ is **not** enabled by default in source selection.
- `WTJ_MAX_JOBS_PER_TERM` controls the per-term cap when running the extractor directly (default `100`).
- `WTJ_COUNTRY_CODE` is optional; omitting it returns results across all countries.

Local run example:

```bash
WTJ_SEARCH_TERMS='["backend engineer"]' \
WTJ_MAX_JOBS_PER_TERM='50' \
WTJ_COUNTRY_CODE='GB' \
npm --workspace wtj-extractor run start
```

## Common problems

### WTJ returns no results

- Verify your search terms are not too specific. Try broader terms like `"engineer"` or `"developer"`.
- Check that `WTJ_COUNTRY_CODE` is a valid ISO-2 code (e.g. `GB`, `FR`, `DE`). An invalid code may produce empty results.

### WTJ does not appear in sources

- Check that the client is running on the latest build containing the new source list.
- WTJ does not require credentials, so it should appear once the new build is loaded.

### Results are lower than expected

- The cap is tied to `WTJ_MAX_JOBS_PER_TERM` / the run budget (`jobspyResultsWanted`).
- Country filtering can significantly narrow available results.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Settings](/docs/next/features/settings)
