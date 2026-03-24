import type { ExtractorManifest, ExtractorProgressEvent } from "@shared/types/extractors";
import { runAlbamon } from "./src/run";

function toProgress(event: { type: string; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm?: number }): ExtractorProgressEvent {
  if (event.type === "term_start") return { phase: "list", termsProcessed: Math.max(event.termIndex - 1, 0), termsTotal: event.termTotal, currentUrl: event.searchTerm, detail: `Albamon: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})` };
  return { phase: "list", termsProcessed: event.termIndex, termsTotal: event.termTotal, currentUrl: event.searchTerm, detail: `Albamon: completed ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs` };
}

export const manifest: ExtractorManifest = {
  id: "albamon",
  displayName: "알바몬 (Albamon)",
  providesSources: ["albamon"],
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };
    const maxJobsPerTerm = context.settings.albamon_maxJobsPerTerm ? parseInt(context.settings.albamon_maxJobsPerTerm, 10) : 60;
    try {
      const result = await runAlbamon({ searchTerms: context.searchTerms, maxJobsPerTerm, onProgress: (e) => { if (!context.shouldCancel?.()) context.onProgress?.(toProgress(e)); } });
      return { success: result.success, jobs: result.jobs };
    } catch (err) {
      return { success: false, jobs: [], error: err instanceof Error ? err.message : "Unexpected error in Albamon extractor" };
    }
  },
};
export default manifest;
