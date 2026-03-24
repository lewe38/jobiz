import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runSaramin } from "./src/run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Saramin: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    detail: `Saramin: completed term ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "saramin",
  displayName: "사람인 (Saramin)",
  providesSources: ["saramin"],
  requiredEnvVars: ["SARAMIN_ACCESS_KEY"],

  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const accessKey = context.settings.saraminAccessKey ?? process.env.SARAMIN_ACCESS_KEY ?? "";
    if (!accessKey) {
      return {
        success: false,
        jobs: [],
        error: "Missing SARAMIN_ACCESS_KEY. Register at https://oapi.saramin.co.kr",
      };
    }

    const maxJobsPerTerm = context.settings.saraminMaxJobsPerTerm
      ? parseInt(context.settings.saraminMaxJobsPerTerm, 10)
      : 110;

    const locMcd = context.settings.saraminLocationCode?.trim() || undefined;

    let result: Awaited<ReturnType<typeof runSaramin>>;
    try {
      result = await runSaramin({
        accessKey,
        searchTerms: context.searchTerms,
        maxJobsPerTerm,
        locMcd,
        onProgress: (event) => {
          if (context.shouldCancel?.()) return;
          context.onProgress?.(toProgress(event));
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error in Saramin extractor";
      return { success: false, jobs: [], error: message };
    }

    return { success: result.success, jobs: result.jobs, error: result.error };
  },
};

export default manifest;
