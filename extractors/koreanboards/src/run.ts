import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { CreateJobInput, JobSource } from "@shared/types/jobs";
import {
  toNumberOrNull,
  toStringOrNull,
} from "@shared/utils/type-conversion.js";

const srcDir = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_DIR = join(srcDir, "..");
const SCRIPT = join(EXTRACTOR_DIR, "scrape_korean_jobs.py");
const OUTPUT_DIR = join(EXTRACTOR_DIR, "storage/imports");
const PROGRESS_PREFIX = "JOBOPS_PROGRESS ";

// ─── All Korean source IDs this extractor can provide ────────────────────────

const KOREAN_SOURCES = new Set<string>([
  "wanted",
  "jumpit",
  "saramin",
  "jobkorea",
  "albamon",
  "peoplenjob",
  "albacheon",
  "kowork",
  "klik",
]);

function isKoreanSource(s: string): s is JobSource {
  return KOREAN_SOURCES.has(s);
}

// ─── Progress events ──────────────────────────────────────────────────────────

export type KoreanProgressEvent =
  | { type: "term_start"; termIndex: number; termTotal: number; searchTerm: string }
  | { type: "term_complete"; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm: number };

export function parseProgressLine(line: string): KoreanProgressEvent | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  const raw = line.slice(PROGRESS_PREFIX.length).trim();
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
  if (event === "term_start") return { type: "term_start", termIndex, termTotal, searchTerm };
  if (event === "term_complete") {
    return { type: "term_complete", termIndex, termTotal, searchTerm, jobsFoundTerm: toNumberOrNull(parsed.jobsFoundTerm) ?? 0 };
  }
  return null;
}

// ─── Job mapper ───────────────────────────────────────────────────────────────

function mapRows(rows: Array<Record<string, unknown>>): CreateJobInput[] {
  const jobs: CreateJobInput[] = [];
  for (const row of rows) {
    const source = toStringOrNull(row.site);
    if (!source || !isKoreanSource(source)) continue;

    const jobUrl = toStringOrNull(row.job_url);
    if (!jobUrl) continue;

    jobs.push({
      source,
      sourceJobId: toStringOrNull(row.id) ?? undefined,
      title: toStringOrNull(row.title) ?? "Unknown Title",
      employer: toStringOrNull(row.company) ?? "Unknown Company",
      jobUrl,
      applicationLink: jobUrl,
      location: toStringOrNull(row.location) ?? undefined,
      salary: toStringOrNull(row.salary) ?? undefined,
      datePosted: toStringOrNull(row.date_posted) ?? undefined,
      deadline: toStringOrNull(row.deadline) ?? undefined,
      jobDescription: toStringOrNull(row.description) ?? undefined,
      jobType: toStringOrNull(row.job_type) ?? undefined,
      isRemote: typeof row.is_remote === "boolean" ? row.is_remote : undefined,
      skills: toStringOrNull(row.skills) ?? undefined,
      companyLogo: toStringOrNull(row.company_logo) ?? undefined,
    });
  }
  return jobs;
}

// ─── Python resolver (same logic as jobspy) ───────────────────────────────────

function resolvePython(extractorDir: string): string {
  const venvPython = join(
    extractorDir,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python3",
  );
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  if (existsSync(venvPython)) return venvPython;
  return process.platform === "win32" ? "python" : "python3";
}

// ─── Run options ──────────────────────────────────────────────────────────────

export interface RunKoreanOptions {
  sites: string[];
  searchTerms: string[];
  resultsWanted?: number;
  saraminAccessKey?: string;
  saraminLocationCode?: string;
  onProgress?: (event: KoreanProgressEvent) => void;
}

export interface KoreanResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runKoreanBoards(opts: RunKoreanOptions): Promise<KoreanResult> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const sites = opts.sites.filter(isKoreanSource);
  if (sites.length === 0) return { success: true, jobs: [] };

  const searchTerms = opts.searchTerms.length ? opts.searchTerms : ["개발자"];
  const resultsWanted = opts.resultsWanted ?? 50;
  const pythonPath = resolvePython(EXTRACTOR_DIR);

  const jobs: CreateJobInput[] = [];
  const seenUrls = new Set<string>();

  try {
    for (let i = 0; i < searchTerms.length; i++) {
      const term = searchTerms[i];
      const termIndex = i + 1;
      const suffix = `${termIndex}_${term.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)}`;
      const outputJson = join(OUTPUT_DIR, `korean_jobs_${suffix}.json`);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(pythonPath, [SCRIPT], {
          cwd: EXTRACTOR_DIR,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            JOBOPS_EMIT_PROGRESS: "1",
            KOREAN_SITES: sites.join(","),
            KOREAN_SEARCH_TERM: term,
            KOREAN_TERM_INDEX: String(termIndex),
            KOREAN_TERM_TOTAL: String(searchTerms.length),
            KOREAN_RESULTS_WANTED: String(resultsWanted),
            KOREAN_OUTPUT_JSON: outputJson,
            SARAMIN_ACCESS_KEY: opts.saraminAccessKey ?? process.env.SARAMIN_ACCESS_KEY ?? "",
            SARAMIN_LOCATION_CODE: opts.saraminLocationCode ?? process.env.SARAMIN_LOCATION_CODE ?? "",
          },
        });

        const handleLine = (line: string, stream: NodeJS.WriteStream) => {
          const event = parseProgressLine(line);
          if (event) { opts.onProgress?.(event); return; }
          stream.write(`${line}\n`);
        };

        const stdoutRl = child.stdout ? createInterface({ input: child.stdout }) : null;
        const stderrRl = child.stderr ? createInterface({ input: child.stderr }) : null;
        stdoutRl?.on("line", (l) => handleLine(l, process.stdout));
        stderrRl?.on("line", (l) => handleLine(l, process.stderr));

        child.on("close", (code) => {
          stdoutRl?.close();
          stderrRl?.close();
          if (code === 0) resolve();
          else reject(new Error(`Korean scraper exited with code ${code}`));
        });
        child.on("error", reject);
      });

      const raw = await readFile(outputJson, "utf-8");
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      for (const job of mapRows(parsed)) {
        if (seenUrls.has(job.jobUrl)) continue;
        seenUrls.add(job.jobUrl);
        jobs.push(job);
      }

      try { await unlink(outputJson); } catch { /* ignore */ }
    }

    return { success: true, jobs };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, jobs: [], error: message };
  }
}
