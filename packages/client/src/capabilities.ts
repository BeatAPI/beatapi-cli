/** Public capability projection. Optional fields remain optional until the gateway fills them. */
export type CapabilityKind = 'model' | 'data' | 'workflow';
export interface CapabilitySearchInput {
  query?: string;
  kind?: CapabilityKind;
  platform?: string;
  limit?: number;
  cursor?: string;
}
export interface CapabilityContract {
  reference: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  execution?: { mode: string; status_supported: boolean; result_location?: string };
  validation?: { state: string; evidence?: string[] };
  [key: string]: unknown;
}
export interface CapabilityPage {
  data: CapabilityContract[];
  next_cursor?: string;
  object?: string;
}
export function assertCapabilityReference(reference: string): void {
  if (!/^(model|data|workflow):\S+$/.test(reference)) throw new TypeError('Expected a reference returned by Search: model:<id>, data:<id> or workflow:<id>.');
}
