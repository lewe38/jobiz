import type { ExtractorManifest, ExtractorProgressEvent } from "@shared/types/extractors";
import { runKlik } from "./src/run";

function toProgress(event: { type: string; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm?: number }): ExtractorProgressEvent {
  if (event.type === "term_start") return { phase: "list", termsProcessed: Math.max(event.termIndex - 1, 0), termsTotal: event.termTotal, currentUrl: event.searchTerm, detail: `Klik: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})` };
  return { phase: "list", termsProcessed: event.termIndex, termsTotal: event.termTotal, currentUrl: event.searchTerm, detail: `Klik: completed ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs` };
}

export const manifest: ExtractorManifest = {
  id: "klik",
  displayName: "클릭잡 (Klik)",
  providesSources: ["klik"],
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };
    const maxJobsPerTerm = context.settings.klikMaxJobsPerTerm ? parseInt(context.settings.klikMaxJobsPerTerm, 10) : 40;
    try {
      const result = await runKlik({ searchTerms: context.searchTerms, maxJobsPerTerm, onProgress: (e) => { if (!context.shouldCancel?.()) context.onProgress?.(toProgress(e)); } });
      return { success: result.success, jobs: result.jobs };
    } catch (err) {
      return { success: false, jobs: [], error: err instanceof Error ? err.message : "Unexpected error in Klik extractor" };
    }
  },
};
export default manifest;
