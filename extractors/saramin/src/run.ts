/**
 * Saramin (사람인) – official OpenAPI
 * Docs: https://oapi.saramin.co.kr/guide/overview
 *
 * Required env: SARAMIN_ACCESS_KEY
 * Optional env:
 *   SARAMIN_MAX_JOBS_PER_TERM  (default: 110, max per request)
 *   SARAMIN_LOCATION_CODE      (e.g. "101000" = Seoul)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseSearchTerms } from "job-ops-shared/utils/search-terms";
import { toNumberOrNull, toStringOrNull } from "job-ops-shared/utils/type-conversion";

const PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const API_BASE = "https://oapi.saramin.co.kr";
const DEFAULT_SEARCH_TERM = "개발자";
const DEFAULT_MAX = 110;

// ─── Raw API types ────────────────────────────────────────────────────────────

type SaraminPosition = {
  title?: unknown;
  "job-mid-cd"?: { code?: unknown }[];
  location?: { code?: unknown; name?: unknown };
  "job-type"?: { code?: unknown; name?: unknown };
  "salary-type"?: { code?: unknown; name?: unknown };
  salary?: { code?: unknown; name?: unknown };
};

type SaraminCompany = {
  "detail"?: {
    name?: unknown;
    href?: unknown;
    "logo-src"?: unknown;
  };
};

type SaraminJob = {
  id?: unknown;
  url?: unknown;
  "active-posting-timestamp"?: unknown;
  "expiration-date"?: unknown;
  position?: SaraminPosition;
  company?: SaraminCompany;
  salary?: { code?: unknown; name?: unknown };
  "posting-timestamp"?: unknown;
};

type SaraminResponse = {
  jobs?: {
    count?: number;
    total?: number;
    "job"?: SaraminJob[];
  };
};

// ─── Output type ──────────────────────────────────────────────────────────────

export type SaraminExtractedJob = {
  source: "saramin";
  sourceJobId?: string;
  title: string;
  employer: string;
  jobUrl: string;
  applicationLink: string;
  location?: string;
  salary?: string;
  datePosted?: string;
  deadline?: string;
  jobType?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitProgress(payload: Record<string, unknown>): void {
  if (process.env.JOBOPS_EMIT_PROGRESS !== "1") return;
  console.log(`${PROGRESS_PREFIX}${JSON.stringify(payload)}`);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function mapJob(raw: SaraminJob): SaraminExtractedJob | null {
  const id = toStringOrNull(raw.id);
  const url = toStringOrNull(raw.url);
  if (!url) return null;

  const companyName =
    toStringOrNull(raw.company?.["detail"]?.name) ?? "Unknown Employer";
  const title =
    toStringOrNull(raw.position?.title) ?? "Unknown Title";
  const location =
    toStringOrNull(raw.position?.location?.name) ?? undefined;
  const salary =
    toStringOrNull(raw.salary?.name) ?? undefined;
  const jobType =
    toStringOrNull(raw.position?.["job-type"]?.name) ?? undefined;
  const datePosted = raw["posting-timestamp"]
    ? new Date(Number(raw["posting-timestamp"]) * 1000).toISOString().split("T")[0]
    : undefined;
  const deadline = toStringOrNull(raw["expiration-date"]) ?? undefined;

  return {
    source: "saramin",
    sourceJobId: id ?? undefined,
    title,
    employer: companyName,
    jobUrl: url,
    applicationLink: url,
    location,
    salary,
    datePosted,
    deadline,
    jobType,
  };
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchPage(args: {
  accessKey: string;
  keyword: string;
  start: number;
  count: number;
  locMcd?: string;
}): Promise<SaraminJob[]> {
  const url = new URL(`${API_BASE}/job-search`);
  url.searchParams.set("access-key", args.accessKey);
  url.searchParams.set("keywords", args.keyword);
  url.searchParams.set("start", String(args.start));
  url.searchParams.set("count", String(args.count));
  url.searchParams.set("fields", "base,salary,job-type,expiration-date");
  if (args.locMcd) url.searchParams.set("loc_mcd", args.locMcd);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "job-ops/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Saramin API error: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as SaraminResponse;
  return body.jobs?.job ?? [];
}

// ─── Exported run function ────────────────────────────────────────────────────

export interface RunSaraminOptions {
  accessKey: string;
  searchTerms: string[];
  maxJobsPerTerm: number;
  locMcd?: string;
  onProgress?: (event: {
    type: "term_start" | "term_complete";
    termIndex: number;
    termTotal: number;
    searchTerm: string;
    jobsFoundTerm?: number;
  }) => void;
}

export interface RunSaraminResult {
  success: boolean;
  jobs: SaraminExtractedJob[];
  error?: string;
}

export async function runSaramin(opts: RunSaraminOptions): Promise<RunSaraminResult> {
  const jobs: SaraminExtractedJob[] = [];

  for (let i = 0; i < opts.searchTerms.length; i++) {
    const term = opts.searchTerms[i];
    const termIndex = i + 1;

    opts.onProgress?.({
      type: "term_start",
      termIndex,
      termTotal: opts.searchTerms.length,
      searchTerm: term,
    });

    try {
      let start = 0;
      let termCount = 0;
      const pageSize = Math.min(opts.maxJobsPerTerm, 110);

      while (termCount < opts.maxJobsPerTerm) {
        const rawJobs = await fetchPage({
          accessKey: opts.accessKey,
          keyword: term,
          start,
          count: Math.min(pageSize, opts.maxJobsPerTerm - termCount),
          locMcd: opts.locMcd,
        });

        if (rawJobs.length === 0) break;

        for (const raw of rawJobs) {
          if (termCount >= opts.maxJobsPerTerm) break;
          const mapped = mapJob(raw);
          if (!mapped) continue;
          jobs.push(mapped);
          termCount++;
        }

        if (rawJobs.length < pageSize) break;
        start += rawJobs.length;
      }

      opts.onProgress?.({
        type: "term_complete",
        termIndex,
        termTotal: opts.searchTerms.length,
        searchTerm: term,
        jobsFoundTerm: termCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Saramin] Error for term "${term}": ${msg}`);
    }
  }

  return { success: true, jobs };
}

// ─── Standalone entry-point (tsx src/run.ts) ──────────────────────────────────

if (process.env.SARAMIN_STANDALONE === "1") {
  const accessKey = requireEnv("SARAMIN_ACCESS_KEY");
  const searchTerms = parseSearchTerms(process.env.SARAMIN_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const maxJobsPerTerm = parsePositiveInt(process.env.SARAMIN_MAX_JOBS_PER_TERM, DEFAULT_MAX);
  const locMcd = process.env.SARAMIN_LOCATION_CODE?.trim() || undefined;
  const outputJson =
    process.env.SARAMIN_OUTPUT_JSON ?? join(process.cwd(), "storage/datasets/default/jobs.json");

  emitProgress({ event: "start", searchTerms });

  const result = await runSaramin({
    accessKey,
    searchTerms,
    maxJobsPerTerm,
    locMcd,
    onProgress: (e) => emitProgress({ event: e.type, ...e }),
  });

  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(result.jobs, null, 2)}\n`, "utf-8");
  console.log(`[Saramin] Wrote ${result.jobs.length} jobs to ${outputJson}`);
}
