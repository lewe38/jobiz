import type { ExtractorManifest, ExtractorProgressEvent } from "@shared/types/extractors";
import { runAlbacheon } from "./src/run";

function toProgress(event: { type: string; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm?: number }): ExtractorProgressEvent {
  if (event.type === "term_start") return { phase: "list", termsProcessed: Math.max(event.termIndex - 1, 0), termsTotal: event.termTotal, currentUrl: event.searchTerm, detail: `Albacheon: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})` };
  return { phase: "list", termsProcessed: event.termIndex, termsTotal: event.termTotal, currentUrl: event.searchTerm, detail: `Albacheon: completed ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs` };
}

export const manifest: ExtractorManifest = {
  id: "albacheon",
  displayName: "알바천국 (Albacheon)",
  providesSources: ["albacheon"],
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };
    const maxJobsPerTerm = context.settings.albacheonMaxJobsPerTerm ? parseInt(context.settings.albacheonMaxJobsPerTerm, 10) : 60;
    try {
      const result = await runAlbacheon({ searchTerms: context.searchTerms, maxJobsPerTerm, onProgress: (e) => { if (!context.shouldCancel?.()) context.onProgress?.(toProgress(e)); } });
      return { success: result.success, jobs: result.jobs };
    } catch (err) {
      return { success: false, jobs: [], error: err instanceof Error ? err.message : "Unexpected error in Albacheon extractor" };
    }
  },
};
export default manifest;
