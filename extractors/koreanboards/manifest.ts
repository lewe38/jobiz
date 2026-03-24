import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runKoreanBoards } from "./src/run";

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
      detail: `Korean Boards: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    detail: `Korean Boards: completed ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "koreanboards",
  displayName: "Korean Job Boards (KR)",
  providesSources: [
    "wanted",
    "jumpit",
    "saramin",
    "jobkorea",
    "albamon",
    "peoplenjob",
    "albacheon",
    "kowork",
    "klik",
  ],

  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    // Only scrape the sources the user has selected
    const sites = context.selectedSources.filter((s) =>
      manifest.providesSources.includes(s),
    );
    if (sites.length === 0) return { success: true, jobs: [] };

    const resultsWanted = context.settings.koreanResultsWanted
      ? parseInt(context.settings.koreanResultsWanted, 10)
      : 50;

    const saraminAccessKey =
      context.settings.saraminAccessKey ?? process.env.SARAMIN_ACCESS_KEY;
    const saraminLocationCode =
      context.settings.saraminLocationCode ?? process.env.SARAMIN_LOCATION_CODE;

    try {
      const result = await runKoreanBoards({
        sites,
        searchTerms: context.searchTerms,
        resultsWanted,
        saraminAccessKey,
        saraminLocationCode,
        onProgress: (event) => {
          if (context.shouldCancel?.()) return;
          context.onProgress?.(toProgress(event));
        },
      });
      return { success: result.success, jobs: result.jobs, error: result.error };
    } catch (err) {
      return {
        success: false,
        jobs: [],
        error: err instanceof Error ? err.message : "Unexpected error in Korean Boards extractor",
      };
    }
  },
};

export default manifest;
