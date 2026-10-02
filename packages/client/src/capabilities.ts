/** Public capability types follow the gateway's compact search and result views. */
import type { components } from "./types.generated.js";
export type CapabilityKind = "model" | "data" | "workflow";
export type CapabilitySearchInput = Partial<
  components["schemas"]["CapabilitySearchRequest"]
>;
export type CapabilityNext = components["schemas"]["CapabilityNext"];
export type CapabilityView = Pick<
  components["schemas"]["CapabilityRunRequest"],
  "view" | "max_items" | "fields"
>;
export interface CapabilityContract {
  reference: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  readiness?: "ready" | "runnable" | "listed";
  schema_hash?: string;
  execution?: {
    mode: string;
    status_supported: boolean;
    result_location?: string;
  };
  validation?: { state: string; evidence?: string[] };
  next?: CapabilityNext;
  [key: string]: unknown;
}
export interface CapabilityPage
  extends Omit<components["schemas"]["CapabilitySearchPage"], "data"> {
  data: (CapabilityContract | components["schemas"]["CapabilityCard"])[];
}
export type CapabilityResult = components["schemas"]["CapabilityRunResult"];
export function assertCapabilityReference(reference: string): void {
  if (!/^(model|data|workflow):\S+$/.test(reference))
    throw new TypeError(
      "Expected a reference returned by Search: model:<id>, data:<id> or workflow:<id>.",
    );
}
