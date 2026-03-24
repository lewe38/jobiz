/**
 * Kowork (코워크) – HTML scraper
 * Remote-friendly Korean job board
 * Search URL: https://kowork.net/search?q={term}&page={page}
 *
 * Optional env:
 *   KOWORK_MAX_JOBS_PER_TERM  (default: 40)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseSearchTerms } from "job-ops-shared/utils/search-terms";
import { toStringOrNull } from "job-ops-shared/utils/type-conversion";

const PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const BASE_URL = "https://kowork.net";
const DEFAULT_SEARCH_TERM = "개발자";
const DEFAULT_MAX = 40;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
  Referer: "https://kowork.net/",
};

export type KoworkExtractedJob = {
  source: "kowork";
  sourceJobId?: string;
  title: string;
  employer: string;
  jobUrl: string;
  applicationLink: string;
  location?: string;
  salary?: string;
  deadline?: string;
  jobType?: string;
  isRemote?: boolean;
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

function parseJobCards(html: string): KoworkExtractedJob[] {
  const jobs: KoworkExtractedJob[] = [];

  // Kowork job cards
  const blockPattern = /<div[^>]+class="[^"]*job-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  const titleLinkPattern = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*job-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  const titleLinkPattern2 = /<a[^>]+class="[^"]*job-title[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const companyPattern = /<span[^>]+class="[^"]*company[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const locationPattern = /<span[^>]+class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const salaryPattern = /<span[^>]+class="[^"]*salary[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const remotePattern = /재택|리모트|remote/i;
  const idPattern = /\/jobs?\/(\d+)/i;

  let m: RegExpExecArray | null;
  while ((m = blockPattern.exec(html)) !== null) {
    const block = m[0];
    const titleM = titleLinkPattern.exec(block) ?? titleLinkPattern2.exec(block);
    const companyM = companyPattern.exec(block);
    const locationM = locationPattern.exec(block);
    const salaryM = salaryPattern.exec(block);

    const title = titleM ? stripTags(titleM[2]) : "";
    const employer = companyM ? stripTags(companyM[1]) : "";
    if (!title || !employer) continue;

    const rawHref = titleM?.[1] ?? "";
    const href = rawHref.startsWith("http") ? rawHref : `${BASE_URL}${rawHref}`;
    const idM = idPattern.exec(href);
    const isRemote = remotePattern.test(block);

    jobs.push({
      source: "kowork",
      sourceJobId: idM?.[1],
      title,
      employer,
      jobUrl: href,
      applicationLink: href,
      location: locationM ? stripTags(locationM[1]) : undefined,
      salary: salaryM ? stripTags(salaryM[1]) : undefined,
      isRemote,
    });
  }

  return jobs;
}

async function fetchPage(keyword: string, page: number): Promise<string> {
  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set("q", keyword);
  url.searchParams.set("page", String(page));

  const response = await fetch(url.toString(), { headers: HEADERS });
  if (!response.ok) throw new Error(`Kowork fetch error: ${response.status}`);
  return response.text();
}

export interface RunKoworkOptions {
  searchTerms: string[];
  maxJobsPerTerm: number;
  onProgress?: (event: { type: "term_start" | "term_complete"; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm?: number }) => void;
}

export interface RunKoworkResult {
  success: boolean;
  jobs: KoworkExtractedJob[];
  error?: string;
}

export async function runKowork(opts: RunKoworkOptions): Promise<RunKoworkResult> {
  const jobs: KoworkExtractedJob[] = [];

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
      console.error(`[Kowork] Error for "${term}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return { success: true, jobs };
}

if (process.env.KOWORK_STANDALONE === "1") {
  const searchTerms = parseSearchTerms(process.env.KOWORK_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const maxJobsPerTerm = parsePositiveInt(process.env.KOWORK_MAX_JOBS_PER_TERM, DEFAULT_MAX);
  const outputJson = process.env.KOWORK_OUTPUT_JSON ?? join(process.cwd(), "storage/datasets/default/jobs.json");
  emitProgress({ event: "start", searchTerms });
  const result = await runKowork({ searchTerms, maxJobsPerTerm, onProgress: (e) => emitProgress({ event: e.type, ...e }) });
  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(result.jobs, null, 2)}\n`, "utf-8");
  console.log(`[Kowork] Wrote ${result.jobs.length} jobs to ${outputJson}`);
}
