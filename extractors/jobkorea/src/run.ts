/**
 * JobKorea (잡코리아) – HTML scraper
 * Search URL: https://www.jobkorea.co.kr/Search/?stext={term}&tabType=recruit&Page_No={page}
 *
 * Optional env:
 *   JOBKOREA_MAX_JOBS_PER_TERM  (default: 50)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseSearchTerms } from "job-ops-shared/utils/search-terms";
import { toStringOrNull } from "job-ops-shared/utils/type-conversion";

const PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const BASE_URL = "https://www.jobkorea.co.kr";
const DEFAULT_SEARCH_TERM = "개발자";
const DEFAULT_MAX = 50;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
  Referer: "https://www.jobkorea.co.kr/",
};

// ─── Output type ──────────────────────────────────────────────────────────────

export type JobKoreaExtractedJob = {
  source: "jobkorea";
  sourceJobId?: string;
  title: string;
  employer: string;
  jobUrl: string;
  applicationLink: string;
  location?: string;
  salary?: string;
  deadline?: string;
  jobType?: string;
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

/**
 * Minimal regex-based HTML parser – avoids a DOM dependency.
 * Extracts job listing cards from the JobKorea search results page.
 */
function parseJobCards(html: string): JobKoreaExtractedJob[] {
  const jobs: JobKoreaExtractedJob[] = [];

  // JobKorea wraps each listing in <div class="list-default">…</div>
  // We extract blocks and then pick fields with targeted regexes.
  const cardPattern = /<div[^>]+class="[^"]*list-item[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let cardMatch: RegExpExecArray | null;

  // fallback: parse <li> blocks in the recruit list
  const liPattern = /<li[^>]+class="[^"]*recruit-list[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;

  const titleLinkPattern = /<a[^>]+class="[^"]*tit[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const companyPattern = /<a[^>]+class="[^"]*corp-name[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  const locationPattern = /<span[^>]+class="[^"]*loc[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const salaryPattern = /<span[^>]+class="[^"]*salary[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const deadlinePattern = /<span[^>]+class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const idPattern = /data-gno="(\d+)"/i;
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").trim();

  // Try article-based pattern first, fall back to li-based
  let blocks: string[] = [];
  const articlePattern = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let m: RegExpExecArray | null;
  while ((m = articlePattern.exec(html)) !== null) {
    blocks.push(m[0]);
  }
  if (blocks.length === 0) {
    while ((m = liPattern.exec(html)) !== null) {
      blocks.push(m[0]);
    }
  }

  for (const block of blocks) {
    const idM = idPattern.exec(block);
    const titleM = titleLinkPattern.exec(block);
    const companyM = companyPattern.exec(block);
    const locationM = locationPattern.exec(block);
    const salaryM = salaryPattern.exec(block);
    const deadlineM = deadlinePattern.exec(block);

    const rawHref = titleM?.[1] ?? "";
    const title = titleM ? stripTags(titleM[2]) : "";
    const employer = companyM ? stripTags(companyM[1]) : "";

    if (!title || !employer) continue;

    const href = rawHref.startsWith("http") ? rawHref : `${BASE_URL}${rawHref}`;
    const id = idM?.[1] ?? undefined;

    jobs.push({
      source: "jobkorea",
      sourceJobId: id,
      title,
      employer,
      jobUrl: href,
      applicationLink: href,
      location: locationM ? stripTags(locationM[1]) : undefined,
      salary: salaryM ? stripTags(salaryM[1]) : undefined,
      deadline: deadlineM ? stripTags(deadlineM[1]) : undefined,
    });
  }

  return jobs;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchPage(keyword: string, page: number): Promise<string> {
  const url = new URL(`${BASE_URL}/Search/`);
  url.searchParams.set("stext", keyword);
  url.searchParams.set("tabType", "recruit");
  url.searchParams.set("Page_No", String(page));

  const response = await fetch(url.toString(), { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`JobKorea fetch error: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

// ─── Exported run function ────────────────────────────────────────────────────

export interface RunJobKoreaOptions {
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

export interface RunJobKoreaResult {
  success: boolean;
  jobs: JobKoreaExtractedJob[];
  error?: string;
}

export async function runJobKorea(opts: RunJobKoreaOptions): Promise<RunJobKoreaResult> {
  const jobs: JobKoreaExtractedJob[] = [];

  for (let i = 0; i < opts.searchTerms.length; i++) {
    const term = opts.searchTerms[i];
    const termIndex = i + 1;

    opts.onProgress?.({ type: "term_start", termIndex, termTotal: opts.searchTerms.length, searchTerm: term });

    try {
      let page = 1;
      let termCount = 0;

      while (termCount < opts.maxJobsPerTerm) {
        const html = await fetchPage(term, page);
        const cards = parseJobCards(html);
        if (cards.length === 0) break;

        for (const card of cards) {
          if (termCount >= opts.maxJobsPerTerm) break;
          jobs.push(card);
          termCount++;
        }

        // JobKorea typically shows 30 results per page
        if (cards.length < 20) break;
        page++;
        if (page > 10) break;
      }

      opts.onProgress?.({ type: "term_complete", termIndex, termTotal: opts.searchTerms.length, searchTerm: term, jobsFoundTerm: termCount });
    } catch (err) {
      console.error(`[JobKorea] Error for "${term}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return { success: true, jobs };
}

// ─── Standalone ───────────────────────────────────────────────────────────────

if (process.env.JOBKOREA_STANDALONE === "1") {
  const searchTerms = parseSearchTerms(process.env.JOBKOREA_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const maxJobsPerTerm = parsePositiveInt(process.env.JOBKOREA_MAX_JOBS_PER_TERM, DEFAULT_MAX);
  const outputJson = process.env.JOBKOREA_OUTPUT_JSON ?? join(process.cwd(), "storage/datasets/default/jobs.json");

  emitProgress({ event: "start", searchTerms });

  const result = await runJobKorea({ searchTerms, maxJobsPerTerm, onProgress: (e) => emitProgress({ event: e.type, ...e }) });

  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(result.jobs, null, 2)}\n`, "utf-8");
  console.log(`[JobKorea] Wrote ${result.jobs.length} jobs to ${outputJson}`);
}
