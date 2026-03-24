import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runJumpit } from "./src/run";

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
      detail: `Jumpit: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    detail: `Jumpit: completed term ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "jumpit",
  displayName: "점핏 (Jumpit)",
  providesSources: ["jumpit"],

  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const maxJobsPerTerm = context.settings.jumpitMaxJobsPerTerm
      ? parseInt(context.settings.jumpitMaxJobsPerTerm, 10)
      : 100;

    let result: Awaited<ReturnType<typeof runJumpit>>;
    try {
      result = await runJumpit({
        searchTerms: context.searchTerms,
        maxJobsPerTerm,
        onProgress: (event) => {
          if (context.shouldCancel?.()) return;
          context.onProgress?.(toProgress(event));
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error in Jumpit extractor";
      return { success: false, jobs: [], error: message };
    }

    return { success: result.success, jobs: result.jobs };
  },
};

export default manifest;
