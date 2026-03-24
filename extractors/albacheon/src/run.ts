/**
 * Albacheon / Alba Heaven (알바천국) – HTML scraper
 * Korea's largest part-time & full-time job board (alba.co.kr)
 * Search URL: https://www.alba.co.kr/job/list.asp?page={page}&searchKeyword={term}
 *
 * Optional env:
 *   ALBACHEON_MAX_JOBS_PER_TERM  (default: 60)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseSearchTerms } from "job-ops-shared/utils/search-terms";
import { toStringOrNull } from "job-ops-shared/utils/type-conversion";

const PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const BASE_URL = "https://www.alba.co.kr";
const DEFAULT_SEARCH_TERM = "카페";
const DEFAULT_MAX = 60;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9",
  Referer: "https://www.alba.co.kr/",
};

export type AlbacheonExtractedJob = {
  source: "albacheon";
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

function emitProgress(payload: Record<string, unknown>): void {
  if (process.env.JOBOPS_EMIT_PROGRESS !== "1") return;
  console.log(`${PROGRESS_PREFIX}${JSON.stringify(payload)}`);
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function parseJobCards(html: string): AlbacheonExtractedJob[] {
  const jobs: AlbacheonExtractedJob[] = [];

  // Alba wraps listings in <div class="jobs-list">…<ul>…<li class="job-card">
  const blockPattern = /<li[^>]+class="[^"]*job[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const titleLinkPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const companyPattern = /<strong[^>]+class="[^"]*company[^"]*"[^>]*>([\s\S]*?)<\/strong>/i;
  const locationPattern = /<span[^>]+class="[^"]*area[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const salaryPattern = /<span[^>]+class="[^"]*pay[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const deadlinePattern = /<span[^>]+class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const idPattern = /jobIdx=(\d+)/i;

  let m: RegExpExecArray | null;
  while ((m = blockPattern.exec(html)) !== null) {
    const block = m[0];
    const titleM = titleLinkPattern.exec(block);
    const companyM = companyPattern.exec(block);
    const locationM = locationPattern.exec(block);
    const salaryM = salaryPattern.exec(block);
    const deadlineM = deadlinePattern.exec(block);

    const title = titleM ? stripTags(titleM[2]) : "";
    const employer = companyM ? stripTags(companyM[1]) : "";
    if (!title || !employer) continue;

    const rawHref = titleM?.[1] ?? "";
    const href = rawHref.startsWith("http") ? rawHref : `${BASE_URL}${rawHref}`;
    const idM = idPattern.exec(href);

    jobs.push({
      source: "albacheon",
      sourceJobId: idM?.[1],
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

async function fetchPage(keyword: string, page: number): Promise<string> {
  const url = new URL(`${BASE_URL}/job/list.asp`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("searchKeyword", keyword);

  const response = await fetch(url.toString(), { headers: HEADERS });
  if (!response.ok) throw new Error(`Albacheon fetch error: ${response.status}`);
  return response.text();
}

export interface RunAlbacheonOptions {
  searchTerms: string[];
  maxJobsPerTerm: number;
  onProgress?: (event: { type: "term_start" | "term_complete"; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm?: number }) => void;
}

export interface RunAlbacheonResult {
  success: boolean;
  jobs: AlbacheonExtractedJob[];
  error?: string;
}

export async function runAlbacheon(opts: RunAlbacheonOptions): Promise<RunAlbacheonResult> {
  const jobs: AlbacheonExtractedJob[] = [];

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
        if (cards.length < 10) break;
        page++;
        if (page > 10) break;
      }
      opts.onProgress?.({ type: "term_complete", termIndex, termTotal: opts.searchTerms.length, searchTerm: term, jobsFoundTerm: termCount });
    } catch (err) {
      console.error(`[Albacheon] Error for "${term}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return { success: true, jobs };
}

if (process.env.ALBACHEON_STANDALONE === "1") {
  const searchTerms = parseSearchTerms(process.env.ALBACHEON_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const maxJobsPerTerm = parsePositiveInt(process.env.ALBACHEON_MAX_JOBS_PER_TERM, DEFAULT_MAX);
  const outputJson = process.env.ALBACHEON_OUTPUT_JSON ?? join(process.cwd(), "storage/datasets/default/jobs.json");
  emitProgress({ event: "start", searchTerms });
  const result = await runAlbacheon({ searchTerms, maxJobsPerTerm, onProgress: (e) => emitProgress({ event: e.type, ...e }) });
  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(result.jobs, null, 2)}\n`, "utf-8");
  console.log(`[Albacheon] Wrote ${result.jobs.length} jobs to ${outputJson}`);
}
