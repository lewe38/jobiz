import { z } from "zod";

export const EXTRACTOR_SOURCE_IDS = [
  "gradcracker",
  "indeed",
  "linkedin",
  "glassdoor",
  "ukvisajobs",
  "adzuna",
  "hiringcafe",
  "startupjobs",
  // Korean platforms
  "saramin",
  "wanted",
  "jumpit",
  "jobkorea",
  "albamon",
  "peoplenjob",
  "albacheon",
  "kowork",
  "klik",
  "manual",
] as const;

export type ExtractorSourceId = (typeof EXTRACTOR_SOURCE_IDS)[number];

export interface ExtractorSourceMetadata {
  label: string;
  order: number;
  category: "pipeline" | "manual";
  requiresCredentials?: boolean;
  ukOnly?: boolean;
  koreaOnly?: boolean;
}

export const EXTRACTOR_SOURCE_METADATA: Record<
  ExtractorSourceId,
  ExtractorSourceMetadata
> = {
  gradcracker: {
    label: "Gradcracker",
    order: 10,
    category: "pipeline",
    ukOnly: true,
  },
  indeed: { label: "Indeed", order: 20, category: "pipeline" },
  linkedin: { label: "LinkedIn", order: 30, category: "pipeline" },
  glassdoor: { label: "Glassdoor", order: 40, category: "pipeline" },
  ukvisajobs: {
    label: "UK Visa Jobs",
    order: 50,
    category: "pipeline",
    requiresCredentials: true,
    ukOnly: true,
  },
  adzuna: {
    label: "Adzuna",
    order: 60,
    category: "pipeline",
    requiresCredentials: true,
  },
  hiringcafe: { label: "Hiring Cafe", order: 70, category: "pipeline" },
  startupjobs: { label: "startup.jobs", order: 80, category: "pipeline" },
  // Korean platforms
  saramin: {
    label: "사람인 (Saramin)",
    order: 100,
    category: "pipeline",
    requiresCredentials: true,
    koreaOnly: true,
  },
  wanted: {
    label: "원티드 (Wanted)",
    order: 110,
    category: "pipeline",
    koreaOnly: true,
  },
  jumpit: {
    label: "점핏 (Jumpit)",
    order: 120,
    category: "pipeline",
    koreaOnly: true,
  },
  jobkorea: {
    label: "잡코리아 (JobKorea)",
    order: 130,
    category: "pipeline",
    koreaOnly: true,
  },
  albamon: {
    label: "알바몬 (Albamon)",
    order: 140,
    category: "pipeline",
    koreaOnly: true,
  },
  peoplenjob: {
    label: "피플앤잡 (PeopleNJob)",
    order: 150,
    category: "pipeline",
    koreaOnly: true,
  },
  albacheon: {
    label: "알바천국 (Albacheon)",
    order: 160,
    category: "pipeline",
    koreaOnly: true,
  },
  kowork: {
    label: "코워크 (Kowork)",
    order: 170,
    category: "pipeline",
    koreaOnly: true,
  },
  klik: {
    label: "클릭잡 (Klik)",
    order: 180,
    category: "pipeline",
    koreaOnly: true,
  },
  manual: { label: "Manual", order: 200, category: "manual" },
};

export const PIPELINE_EXTRACTOR_SOURCE_IDS = EXTRACTOR_SOURCE_IDS.filter(
  (source) => EXTRACTOR_SOURCE_METADATA[source].category === "pipeline",
);

const extractorSourceTuple = EXTRACTOR_SOURCE_IDS as unknown as [
  ExtractorSourceId,
  ...ExtractorSourceId[],
];

export const extractorSourceEnum = z.enum(extractorSourceTuple);

export function isExtractorSourceId(value: string): value is ExtractorSourceId {
  return EXTRACTOR_SOURCE_IDS.includes(value as ExtractorSourceId);
}

export function sourceLabel(source: ExtractorSourceId): string {
  return EXTRACTOR_SOURCE_METADATA[source].label;
}

export function sortSources<T extends { source: ExtractorSourceId }>(
  values: T[],
): T[] {
  return [...values].sort(
    (left, right) =>
      EXTRACTOR_SOURCE_METADATA[left.source].order -
      EXTRACTOR_SOURCE_METADATA[right.source].order,
  );
}
