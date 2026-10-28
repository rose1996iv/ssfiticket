export type ExportResource =
  | "dashboard"
  | "payments"
  | "orders"
  | "tickets"
  | "customers"
  | "sellers";

export type ExportFormat = "xlsx" | "csv" | "pdf" | "json";

export type ColumnFormat = "text" | "number" | "currency" | "date" | "datetime" | "status";

export type ColumnAlignment = "left" | "center" | "right";

export interface ExportColumn<T = unknown> {
  header: string;
  key: string;
  width?: number; // character width approx
  format?: ColumnFormat;
  align?: ColumnAlignment;
  getValue: (row: T) => unknown;
}

export interface ExportDataset<T = unknown> {
  title: string;
  resource: ExportResource;
  filename: string;
  columns: ExportColumn<T>[];
  data: T[];
  summary?: Record<string, string | number>;
  metadata?: Record<string, unknown>;
}

export interface ExportOptions {
  resource: ExportResource;
  format: ExportFormat;
  status?: string;
  search?: string;
}
