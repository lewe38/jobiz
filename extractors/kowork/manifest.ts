import type { ExtractorManifest, ExtractorProgressEvent } from "@shared/types/extractors";
import { runKowork } from "./src/run";

function toProgress(event: { type: string; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm?: number }): ExtractorProgressEvent {
  if (event.type === "term_start") return { phase: "list", termsProcessed: Math.max(event.termIndex - 1, 0), termsTotal: event.termTotal, currentUrl: event.searchTerm, detail: `Kowork: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})` };
  return { phase: "list", termsProcessed: event.termIndex, termsTotal: event.termTotal, currentUrl: event.searchTerm, detail: `Kowork: completed ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs` };
}

export const manifest: ExtractorManifest = {
  id: "kowork",
  displayName: "코워크 (Kowork)",
  providesSources: ["kowork"],
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };
    const maxJobsPerTerm = context.settings.koworkMaxJobsPerTerm ? parseInt(context.settings.koworkMaxJobsPerTerm, 10) : 40;
    try {
      const result = await runKowork({ searchTerms: context.searchTerms, maxJobsPerTerm, onProgress: (e) => { if (!context.shouldCancel?.()) context.onProgress?.(toProgress(e)); } });
      return { success: result.success, jobs: result.jobs };
    } catch (err) {
      return { success: false, jobs: [], error: err instanceof Error ? err.message : "Unexpected error in Kowork extractor" };
    }
  },
};
export default manifest;
