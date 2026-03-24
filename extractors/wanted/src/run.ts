/**
 * Wanted (원티드) – public JSON API
 * Base URL: https://www.wanted.co.kr/api/v4/jobs
 *
 * Optional env:
 *   WANTED_MAX_JOBS_PER_TERM  (default: 100)
 *   WANTED_COUNTRY            (default: "kr")
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseSearchTerms } from "job-ops-shared/utils/search-terms";
import { toNumberOrNull, toStringOrNull } from "job-ops-shared/utils/type-conversion";

const PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const API_BASE = "https://www.wanted.co.kr/api/v4/jobs";
const DEFAULT_SEARCH_TERM = "개발자";
const DEFAULT_MAX = 100;

// ─── Raw types ────────────────────────────────────────────────────────────────

type WantedJobDetail = {
  id?: unknown;
  position?: unknown;
  company_name?: unknown;
  company_logo_url?: unknown;
  logo_img?: { thumb?: unknown };
  address?: { location?: unknown; country?: unknown };
  salary?: { type?: unknown };
  experience?: unknown;
  due_time?: unknown;
};

type WantedJob = {
  id?: unknown;
  position?: unknown;
  company?: { name?: unknown; logo_img?: { thumb?: unknown } };
  address?: { location?: unknown };
  salary?: { type?: unknown };
  due_time?: unknown;
};

type WantedResponse = {
  data?: WantedJob[];
  links?: { next_url?: unknown };
  meta?: { total?: number };
};

// ─── Output type ──────────────────────────────────────────────────────────────

export type WantedExtractedJob = {
  source: "wanted";
  sourceJobId?: string;
  title: string;
  employer: string;
  jobUrl: string;
  applicationLink: string;
  location?: string;
  salary?: string;
  deadline?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitProgress(payload: Record<string, unknown>): void {
  if (process.env.JOBOPS_EMIT_PROGRESS !== "1") return;
  console.log(`${PROGRESS_PREFIX}${JSON.stringify(payload)}`);
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function mapJob(raw: WantedJob): WantedExtractedJob | null {
  const id = toStringOrNull(raw.id);
  if (!id) return null;

  const title = toStringOrNull(raw.position) ?? "Unknown Title";
  const employer = toStringOrNull(raw.company?.name) ?? "Unknown Employer";
  const jobUrl = `https://www.wanted.co.kr/wd/${id}`;
  const location = toStringOrNull(raw.address?.location) ?? undefined;
  const salary = toStringOrNull(raw.salary?.type) ?? undefined;
  const deadline = toStringOrNull(raw.due_time) ?? undefined;

  return {
    source: "wanted",
    sourceJobId: id,
    title,
    employer,
    jobUrl,
    applicationLink: jobUrl,
    location,
    salary,
    deadline,
  };
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchPage(args: {
  keyword: string;
  country: string;
  offset: number;
  limit: number;
}): Promise<{ jobs: WantedJob[]; hasMore: boolean }> {
  const url = new URL(API_BASE);
  url.searchParams.set("country", args.country);
  url.searchParams.set("job_sort", "job.latest_order");
  url.searchParams.set("years", "-1");
  url.searchParams.set("keyword", args.keyword);
  url.searchParams.set("limit", String(args.limit));
  url.searchParams.set("offset", String(args.offset));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.wanted.co.kr/",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Wanted API error: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as WantedResponse;
  const jobs = body.data ?? [];
  const hasMore = !!body.links?.next_url && jobs.length === args.limit;

  return { jobs, hasMore };
}

// ─── Exported run function ────────────────────────────────────────────────────

export interface RunWantedOptions {
  searchTerms: string[];
  maxJobsPerTerm: number;
  country?: string;
  onProgress?: (event: {
    type: "term_start" | "term_complete";
    termIndex: number;
    termTotal: number;
    searchTerm: string;
    jobsFoundTerm?: number;
  }) => void;
}

export interface RunWantedResult {
  success: boolean;
  jobs: WantedExtractedJob[];
  error?: string;
}

export async function runWanted(opts: RunWantedOptions): Promise<RunWantedResult> {
  const country = opts.country ?? "kr";
  const jobs: WantedExtractedJob[] = [];

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
      let offset = 0;
      let termCount = 0;
      const pageSize = 100;

      while (termCount < opts.maxJobsPerTerm) {
        const take = Math.min(pageSize, opts.maxJobsPerTerm - termCount);
        const { jobs: rawJobs, hasMore } = await fetchPage({
          keyword: term,
          country,
          offset,
          limit: take,
        });

        for (const raw of rawJobs) {
          if (termCount >= opts.maxJobsPerTerm) break;
          const mapped = mapJob(raw);
          if (!mapped) continue;
          jobs.push(mapped);
          termCount++;
        }

        if (!hasMore || rawJobs.length === 0) break;
        offset += rawJobs.length;
      }

      opts.onProgress?.({
        type: "term_complete",
        termIndex,
        termTotal: opts.searchTerms.length,
        searchTerm: term,
        jobsFoundTerm: termCount,
      });
    } catch (err) {
      console.error(`[Wanted] Error for term "${term}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return { success: true, jobs };
}

// ─── Standalone ───────────────────────────────────────────────────────────────

if (process.env.WANTED_STANDALONE === "1") {
  const searchTerms = parseSearchTerms(process.env.WANTED_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const maxJobsPerTerm = parsePositiveInt(process.env.WANTED_MAX_JOBS_PER_TERM, DEFAULT_MAX);
  const country = process.env.WANTED_COUNTRY?.trim() || "kr";
  const outputJson =
    process.env.WANTED_OUTPUT_JSON ?? join(process.cwd(), "storage/datasets/default/jobs.json");

  emitProgress({ event: "start", searchTerms });

  const result = await runWanted({
    searchTerms,
    maxJobsPerTerm,
    country,
    onProgress: (e) => emitProgress({ event: e.type, ...e }),
  });

  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(result.jobs, null, 2)}\n`, "utf-8");
  console.log(`[Wanted] Wrote ${result.jobs.length} jobs to ${outputJson}`);
}
