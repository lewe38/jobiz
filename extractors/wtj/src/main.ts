import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_DIR = join(srcDir, "..");
const STORAGE_DIR = join(EXTRACTOR_DIR, "storage/datasets/default");

const BASE_URL = "https://www.welcometothejungle.com";
const JOBS_URL = `${BASE_URL}/en/jobs`;
const JOBS_API_URL = "https://api.welcometothejungle.com/api/v1/jobs_search?";

const JOBOPS_EMIT_PROGRESS = process.env.JOBOPS_EMIT_PROGRESS === "1";

function emitProgress(payload: Record<string, unknown>): void {
  if (JOBOPS_EMIT_PROGRESS) {
    process.stdout.write(`JOBOPS_PROGRESS ${JSON.stringify(payload)}\n`);
  }
}

interface WtjRawJob {
  slug?: string;
  reference?: string;
  name?: string;
  contract_type?: { name?: string };
  experience_level_minimum?: { name?: string };
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: string;
  };
  offices?: Array<{ city?: string; country?: { name?: string } }>;
  published_at?: string;
  new_target_profile?: string;
  description?: string;
  department?: { name?: string };
  organization?: {
    slug?: string;
    name?: string;
    website?: string;
    description?: string;
  };
}

interface WtjRawResult {
  jobs?: WtjRawJob[];
  pagination?: {
    total_items?: number;
    page?: number;
    per_page?: number;
  };
}

export interface WtjJobOutput {
  sourceJobId: string;
  title: string;
  employer: string;
  employerUrl: string;
  jobUrl: string;
  location: string | null;
  salary: string | null;
  datePosted: string | null;
  jobDescription: string | null;
  jobType: string | null;
  jobLevel: string | null;
}

function buildJobUrl(orgSlug: string | undefined, jobSlug: string): string {
  if (orgSlug) {
    return `${BASE_URL}/en/companies/${orgSlug}/jobs/${jobSlug}`;
  }
  return `${BASE_URL}/en/jobs/${jobSlug}`;
}

function buildSalaryString(salary: WtjRawJob["salary"]): string | null {
  if (!salary) return null;
  const parts: string[] = [];
  if (salary.min != null) parts.push(String(salary.min));
  if (salary.max != null && salary.max !== salary.min)
    parts.push(String(salary.max));
  const range = parts.join(" - ");
  const currency = salary.currency ?? "";
  const period = salary.period ? ` / ${salary.period}` : "";
  return range ? `${range} ${currency}${period}`.trim() : null;
}

function mapRawJob(raw: WtjRawJob): WtjJobOutput | null {
  const slug = raw.slug;
  if (!slug) return null;

  const org = raw.organization;
  const orgSlug = org?.slug;
  const employer = org?.name ?? "Unknown Employer";
  const employerUrl = orgSlug
    ? `${BASE_URL}/en/companies/${orgSlug}`
    : BASE_URL;

  const office = raw.offices?.[0];
  const city = office?.city ?? null;
  const country = office?.country?.name ?? null;
  const location =
    city && country ? `${city}, ${country}` : (city ?? country ?? null);

  return {
    sourceJobId: slug,
    title: raw.name ?? "Unknown Title",
    employer,
    employerUrl,
    jobUrl: buildJobUrl(orgSlug, slug),
    location,
    salary: buildSalaryString(raw.salary),
    datePosted: raw.published_at ?? null,
    jobDescription: raw.new_target_profile ?? raw.description ?? null,
    jobType: raw.contract_type?.name ?? null,
    jobLevel: raw.experience_level_minimum?.name ?? null,
  };
}

async function fetchJobsPage(
  searchTerm: string,
  page: number,
  countryCode: string,
): Promise<WtjRawResult> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: "30",
    query: searchTerm,
    ...(countryCode ? { country_code: countryCode } : {}),
  });
  const url = `${JOBS_API_URL}${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent":
        "Mozilla/5.0 (compatible; job-ops-wtj-extractor/1.0; +https://github.com/DaKheera47/job-ops)",
      Referer: JOBS_URL,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(
      `WTJ API responded with ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as WtjRawResult;
}

async function saveJobToDataset(
  job: WtjJobOutput,
  index: number,
): Promise<void> {
  const filename = join(
    STORAGE_DIR,
    `job-${String(index).padStart(6, "0")}.json`,
  );
  await writeFile(filename, JSON.stringify(job, null, 2), "utf-8");
}

async function run(): Promise<void> {
  const searchTermsEnv = process.env.WTJ_SEARCH_TERMS;
  const searchTerms: string[] = searchTermsEnv
    ? (JSON.parse(searchTermsEnv) as string[])
    : ["software engineer"];

  const maxJobsPerTerm = process.env.WTJ_MAX_JOBS_PER_TERM
    ? parseInt(process.env.WTJ_MAX_JOBS_PER_TERM, 10)
    : 100;

  const countryCode = process.env.WTJ_COUNTRY_CODE ?? "";

  await mkdir(STORAGE_DIR, { recursive: true });

  const termTotal = searchTerms.length;
  let globalIndex = 0;

  for (let termIndex = 0; termIndex < searchTerms.length; termIndex += 1) {
    const searchTerm = searchTerms[termIndex];
    let page = 1;
    let totalCollected = 0;
    let totalAvailable = 0;

    emitProgress({
      event: "term_start",
      termIndex: termIndex + 1,
      termTotal,
      searchTerm,
    });

    while (totalCollected < maxJobsPerTerm) {
      let result: WtjRawResult;
      try {
        result = await fetchJobsPage(searchTerm, page, countryCode);
      } catch (err) {
        const message = err instanceof Error ? err.message : "fetch error";
        process.stderr.write(
          `WTJ: error fetching page ${page} for "${searchTerm}": ${message}\n`,
        );
        break;
      }

      const rawJobs = result.jobs ?? [];
      if (rawJobs.length === 0) break;

      if (totalAvailable === 0) {
        totalAvailable = result.pagination?.total_items ?? rawJobs.length;
      }

      let jobsOnPage = 0;
      for (const raw of rawJobs) {
        if (totalCollected >= maxJobsPerTerm) break;
        const mapped = mapRawJob(raw);
        if (!mapped) continue;
        await saveJobToDataset(mapped, globalIndex);
        globalIndex += 1;
        totalCollected += 1;
        jobsOnPage += 1;
      }

      emitProgress({
        event: "page_fetched",
        termIndex: termIndex + 1,
        termTotal,
        searchTerm,
        pageNo: page,
        jobsOnPage,
        totalCollected,
        totalAvailable,
      });

      const perPage = result.pagination?.per_page ?? 30;
      if (rawJobs.length < perPage || totalCollected >= totalAvailable) break;

      page += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    emitProgress({
      event: "term_complete",
      termIndex: termIndex + 1,
      termTotal,
      searchTerm,
      jobsFoundTerm: totalCollected,
    });

    if (termIndex < searchTerms.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`WTJ extractor failed: ${message}\n`);
  process.exitCode = 1;
});
