export type DataTableFormat = "auto" | "csv" | "tsv";

export type DataTableDirective = {
  src: string;
  format: DataTableFormat;
  header: boolean;
  columns?: string[];
  caption?: string;
  kind?: string;
  limit?: number;
  className?: string[];
  empty: string;
};

export type DataTableData = {
  src: string;
  format: Exclude<DataTableFormat, "auto">;
  header: boolean;
  columns: string[];
  rows: string[][];
  kind?: string;
  caption?: string;
};

export type RemarkDataTableOptions = {
  validate?: boolean;
  baseDir?: string;
  empty?: string;
};
