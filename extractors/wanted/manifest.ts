import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runWanted } from "./src/run";

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
      detail: `Wanted: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    detail: `Wanted: completed term ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "wanted",
  displayName: "원티드 (Wanted)",
  providesSources: ["wanted"],

  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const maxJobsPerTerm = context.settings.wantedMaxJobsPerTerm
      ? parseInt(context.settings.wantedMaxJobsPerTerm, 10)
      : 100;

    const country = context.settings.wantedCountry?.trim() || "kr";

    let result: Awaited<ReturnType<typeof runWanted>>;
    try {
      result = await runWanted({
        searchTerms: context.searchTerms,
        maxJobsPerTerm,
        country,
        onProgress: (event) => {
          if (context.shouldCancel?.()) return;
          context.onProgress?.(toProgress(event));
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error in Wanted extractor";
      return { success: false, jobs: [], error: message };
    }

    return { success: result.success, jobs: result.jobs };
  },
};

export default manifest;
