# Welcome to the Jungle (WTJ) Extractor

Fetches job listings from [Welcome to the Jungle](https://www.welcometothejungle.com) using their public jobs search API.

## Environment variables

- `WTJ_SEARCH_TERMS` – JSON array of search terms (default: `["software engineer"]`)
- `WTJ_MAX_JOBS_PER_TERM` – maximum jobs to collect per search term (default: `100`)
- `WTJ_COUNTRY_CODE` – optional ISO-2 country code to narrow results (e.g. `GB`, `FR`; default: no filter)
- `JOBOPS_EMIT_PROGRESS=1` – emit `JOBOPS_PROGRESS` events for pipeline progress tracking

## Local run example

```bash
WTJ_SEARCH_TERMS='["backend engineer","data engineer"]' \
WTJ_MAX_JOBS_PER_TERM='50' \
WTJ_COUNTRY_CODE='GB' \
npm --workspace wtj-extractor run start
```

## Notes

- The extractor calls the WTJ public jobs search API (`/api/v1/jobs_search`) and paginates through results per search term.
- Each job is saved as an individual JSON file in `storage/datasets/default/`.
- Results are de-duplicated by `sourceJobId` (job slug) when loaded back by `run.ts`.
- This extractor is **not enabled by default** in the pipeline source selector.
