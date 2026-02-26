import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { CreateJobInput } from "@shared/types/jobs";
import {
  toNumberOrNull,
  toStringOrNull,
} from "@shared/utils/type-conversion.js";

const srcDir = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_DIR = join(srcDir, "..");
const STORAGE_DIR = join(EXTRACTOR_DIR, "storage/datasets/default");
const JOBOPS_PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const require = createRequire(import.meta.url);
const TSX_CLI_PATH = resolveTsxCliPath();

type WtjRawDataset = Record<string, unknown>;

export type WtjProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "page_fetched";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      pageNo: number;
      jobsOnPage: number;
      totalCollected: number;
      totalAvailable: number;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

export interface RunWtjOptions {
  searchTerms?: string[];
  countryCode?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: WtjProgressEvent) => void;
}

export interface WtjResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

function resolveTsxCliPath(): string | null {
  try {
    return require.resolve("tsx/dist/cli.mjs");
  } catch {
    return null;
  }
}

function canRunNpmCommand(): boolean {
  const result = spawnSync("npm", ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function parseProgressLine(line: string): WtjProgressEvent | null {
  if (!line.startsWith(JOBOPS_PROGRESS_PREFIX)) return null;
  const raw = line.slice(JOBOPS_PROGRESS_PREFIX.length).trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const event = toStringOrNull(parsed.event);
  const termIndex = toNumberOrNull(parsed.termIndex);
  const termTotal = toNumberOrNull(parsed.termTotal);
  const searchTerm = toStringOrNull(parsed.searchTerm) ?? "";
  if (!event || termIndex === null || termTotal === null) return null;

  if (event === "term_start") {
    return { type: "term_start", termIndex, termTotal, searchTerm };
  }

  if (event === "page_fetched") {
    const pageNo = toNumberOrNull(parsed.pageNo);
    if (pageNo === null) return null;
    return {
      type: "page_fetched",
      termIndex,
      termTotal,
      searchTerm,
      pageNo,
      jobsOnPage: toNumberOrNull(parsed.jobsOnPage) ?? 0,
      totalCollected: toNumberOrNull(parsed.totalCollected) ?? 0,
      totalAvailable: toNumberOrNull(parsed.totalAvailable) ?? 0,
    };
  }

  if (event === "term_complete") {
    return {
      type: "term_complete",
      termIndex,
      termTotal,
      searchTerm,
      jobsFoundTerm: toNumberOrNull(parsed.jobsFoundTerm) ?? 0,
    };
  }

  return null;
}

function mapDatasetRow(row: WtjRawDataset): CreateJobInput | null {
  const jobUrl = toStringOrNull(row.jobUrl);
  if (!jobUrl) return null;

  return {
    source: "wtj",
    sourceJobId: toStringOrNull(row.sourceJobId) ?? undefined,
    title: toStringOrNull(row.title) ?? "Unknown Title",
    employer: toStringOrNull(row.employer) ?? "Unknown Employer",
    employerUrl: toStringOrNull(row.employerUrl) ?? undefined,
    jobUrl,
    applicationLink: toStringOrNull(row.applicationLink) ?? jobUrl,
    location: toStringOrNull(row.location) ?? undefined,
    salary: toStringOrNull(row.salary) ?? undefined,
    datePosted: toStringOrNull(row.datePosted) ?? undefined,
    jobDescription: toStringOrNull(row.jobDescription) ?? undefined,
    jobType: toStringOrNull(row.jobType) ?? undefined,
    jobLevel: toStringOrNull(row.jobLevel) ?? undefined,
  };
}

async function readDataset(): Promise<CreateJobInput[]> {
  const jobs: CreateJobInput[] = [];

  try {
    const files = await readdir(STORAGE_DIR);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    for (const file of jsonFiles.sort()) {
      try {
        const content = await readFile(join(STORAGE_DIR, file), "utf-8");
        const row = JSON.parse(content) as WtjRawDataset;
        const mapped = mapDatasetRow(row);
        if (mapped) jobs.push(mapped);
      } catch {
        // ignore invalid file
      }
    }
  } catch {
    // ignore missing dir
  }

  return jobs;
}

async function clearStorageDataset(): Promise<void> {
  await rm(STORAGE_DIR, { recursive: true, force: true });
  await mkdir(STORAGE_DIR, { recursive: true });
}

export async function runWtj(options: RunWtjOptions = {}): Promise<WtjResult> {
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : ["software engineer"];
  const maxJobsPerTerm = options.maxJobsPerTerm ?? 100;
  const countryCode = options.countryCode ?? "";

  const useNpmCommand = canRunNpmCommand();
  if (!useNpmCommand && !TSX_CLI_PATH) {
    return {
      success: false,
      jobs: [],
      error: "Unable to execute WTJ extractor (npm/tsx unavailable)",
    };
  }

  try {
    await clearStorageDataset();

    await new Promise<void>((resolve, reject) => {
      const extractorEnv = {
        ...process.env,
        JOBOPS_EMIT_PROGRESS: "1",
        WTJ_SEARCH_TERMS: JSON.stringify(searchTerms),
        WTJ_MAX_JOBS_PER_TERM: String(maxJobsPerTerm),
        WTJ_COUNTRY_CODE: countryCode,
      };

      const child = useNpmCommand
        ? spawn("npm", ["run", "start"], {
            cwd: EXTRACTOR_DIR,
            stdio: ["ignore", "pipe", "pipe"],
            env: extractorEnv,
          })
        : (() => {
            const tsxCliPath = TSX_CLI_PATH;
            if (!tsxCliPath) {
              // Should not be reachable: the guard above returns early when both
              // useNpmCommand is false and TSX_CLI_PATH is null. This throw
              // exists solely for TypeScript type narrowing.
              throw new Error(
                "Unable to execute WTJ extractor (tsx path unavailable during spawn)",
              );
            }
            return spawn(process.execPath, [tsxCliPath, "src/main.ts"], {
              cwd: EXTRACTOR_DIR,
              stdio: ["ignore", "pipe", "pipe"],
              env: extractorEnv,
            });
          })();

      const handleLine = (line: string, stream: NodeJS.WriteStream) => {
        const progressEvent = parseProgressLine(line);
        if (progressEvent) {
          options.onProgress?.(progressEvent);
          return;
        }
        stream.write(`${line}\n`);
      };

      const stdoutRl = child.stdout
        ? createInterface({ input: child.stdout })
        : null;
      const stderrRl = child.stderr
        ? createInterface({ input: child.stderr })
        : null;

      stdoutRl?.on("line", (line) => handleLine(line, process.stdout));
      stderrRl?.on("line", (line) => handleLine(line, process.stderr));

      child.on("close", (code) => {
        stdoutRl?.close();
        stderrRl?.close();
        if (code === 0) resolve();
        else reject(new Error(`WTJ extractor exited with code ${code}`));
      });
      child.on("error", reject);
    });

    const jobs = await readDataset();
    const seen = new Set<string>();
    const deduped: CreateJobInput[] = [];
    for (const job of jobs) {
      const key = job.sourceJobId ?? job.jobUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(job);
    }

    return { success: true, jobs: deduped };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, jobs: [], error: message };
  }
}
