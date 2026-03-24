/**
 * Jumpit (점핏) – Saramin's tech job platform
 * API: https://jumpit.saramin.co.kr/api/position
 *
 * Optional env:
 *   JUMPIT_MAX_JOBS_PER_TERM  (default: 100)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseSearchTerms } from "job-ops-shared/utils/search-terms";
import { toStringOrNull } from "job-ops-shared/utils/type-conversion";

const PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const API_BASE = "https://jumpit.saramin.co.kr/api/position";
const DEFAULT_SEARCH_TERM = "백엔드 개발자";
const DEFAULT_MAX = 100;

// ─── Raw types ────────────────────────────────────────────────────────────────

type JumpitPosition = {
  id?: unknown;
  title?: unknown;
  companyName?: unknown;
  locations?: unknown[];
  techStacks?: { title?: unknown }[];
  salary?: unknown;
  career?: unknown;
  dueDate?: unknown;
  alwaysOpen?: unknown;
  employType?: unknown;
};

type JumpitResponse = {
  result?: {
    positions?: JumpitPosition[];
    totalCount?: number;
  };
};

// ─── Output type ──────────────────────────────────────────────────────────────

export type JumpitExtractedJob = {
  source: "jumpit";
  sourceJobId?: string;
  title: string;
  employer: string;
  jobUrl: string;
  applicationLink: string;
  location?: string;
  salary?: string;
  deadline?: string;
  jobType?: string;
  skills?: string;
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

function mapJob(raw: JumpitPosition): JumpitExtractedJob | null {
  const id = toStringOrNull(raw.id);
  if (!id) return null;

  const title = toStringOrNull(raw.title) ?? "Unknown Title";
  const employer = toStringOrNull(raw.companyName) ?? "Unknown Employer";
  const jobUrl = `https://jumpit.saramin.co.kr/position/${id}`;

  const locations = Array.isArray(raw.locations)
    ? (raw.locations as unknown[]).map((l) => toStringOrNull(l)).filter(Boolean).join(", ")
    : undefined;

  const techStacks = Array.isArray(raw.techStacks)
    ? raw.techStacks.map((t) => toStringOrNull(t.title)).filter(Boolean).join(", ")
    : undefined;

  const salary = toStringOrNull(raw.salary) ?? undefined;
  const career = toStringOrNull(raw.career) ?? undefined;
  const dueDate = raw.alwaysOpen ? "상시채용" : (toStringOrNull(raw.dueDate) ?? undefined);
  const employType = toStringOrNull(raw.employType) ?? undefined;

  return {
    source: "jumpit",
    sourceJobId: id,
    title,
    employer,
    jobUrl,
    applicationLink: jobUrl,
    location: locations ?? undefined,
    salary,
    deadline: dueDate,
    jobType: employType ?? career,
    skills: techStacks ?? undefined,
  };
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchPage(args: {
  keyword: string;
  page: number;
  size: number;
}): Promise<{ positions: JumpitPosition[]; total: number }> {
  const url = new URL(API_BASE);
  url.searchParams.set("keyword", args.keyword);
  url.searchParams.set("sort", "relation");
  url.searchParams.set("page", String(args.page));
  url.searchParams.set("size", String(args.size));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://jumpit.saramin.co.kr/",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Jumpit API error: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as JumpitResponse;
  return {
    positions: body.result?.positions ?? [],
    total: body.result?.totalCount ?? 0,
  };
}

// ─── Exported run function ────────────────────────────────────────────────────

export interface RunJumpitOptions {
  searchTerms: string[];
  maxJobsPerTerm: number;
  onProgress?: (event: {
    type: "term_start" | "term_complete";
    termIndex: number;
    termTotal: number;
    searchTerm: string;
    jobsFoundTerm?: number;
  }) => void;
}

export interface RunJumpitResult {
  success: boolean;
  jobs: JumpitExtractedJob[];
  error?: string;
}

export async function runJumpit(opts: RunJumpitOptions): Promise<RunJumpitResult> {
  const jobs: JumpitExtractedJob[] = [];

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
      let page = 1;
      let termCount = 0;
      const pageSize = 20;

      while (termCount < opts.maxJobsPerTerm) {
        const { positions, total } = await fetchPage({ keyword: term, page, size: pageSize });

        if (positions.length === 0) break;

        for (const raw of positions) {
          if (termCount >= opts.maxJobsPerTerm) break;
          const mapped = mapJob(raw);
          if (!mapped) continue;
          jobs.push(mapped);
          termCount++;
        }

        if (termCount >= total || positions.length < pageSize) break;
        page++;
      }

      opts.onProgress?.({
        type: "term_complete",
        termIndex,
        termTotal: opts.searchTerms.length,
        searchTerm: term,
        jobsFoundTerm: termCount,
      });
    } catch (err) {
      console.error(`[Jumpit] Error for term "${term}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return { success: true, jobs };
}

// ─── Standalone ───────────────────────────────────────────────────────────────

if (process.env.JUMPIT_STANDALONE === "1") {
  const searchTerms = parseSearchTerms(process.env.JUMPIT_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const maxJobsPerTerm = parsePositiveInt(process.env.JUMPIT_MAX_JOBS_PER_TERM, DEFAULT_MAX);
  const outputJson =
    process.env.JUMPIT_OUTPUT_JSON ?? join(process.cwd(), "storage/datasets/default/jobs.json");

  emitProgress({ event: "start", searchTerms });

  const result = await runJumpit({
    searchTerms,
    maxJobsPerTerm,
    onProgress: (e) => emitProgress({ event: e.type, ...e }),
  });

  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(result.jobs, null, 2)}\n`, "utf-8");
  console.log(`[Jumpit] Wrote ${result.jobs.length} jobs to ${outputJson}`);
}
