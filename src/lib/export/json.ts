import type { ExportDataset } from "./types.ts";
import { paiseToRupees } from "./formatters.ts";

/**
 * Generates structured JSON export with complete administrative metadata envelope.
 */
export function generateJson<T>(dataset: ExportDataset<T>): Uint8Array {
  const records = dataset.data.map((row) => {
    const recordObj: Record<string, unknown> = {};
    for (const col of dataset.columns) {
      const val = col.getValue(row);
      recordObj[col.key] = val;
      if (col.format === "currency" && typeof val === "number") {
        // Include rupees conversion for developer/auditor convenience
        recordObj[`${col.key}_inr`] = paiseToRupees(val);
      }
    }
    return recordObj;
  });

  const payload = {
    metadata: {
      system: "SSFI Lucky Draw Administration System",
      organization: "Speed Skating Federation of India (SSFI)",
      report: dataset.title,
      resource: dataset.resource,
      generatedAt: new Date().toISOString(),
      recordCount: dataset.data.length,
      summary: dataset.summary || null,
      filters: dataset.metadata?.filters || {},
      ...dataset.metadata,
    },
    records,
  };

  const jsonString = JSON.stringify(payload, null, 2);
  return new TextEncoder().encode(jsonString);
}
