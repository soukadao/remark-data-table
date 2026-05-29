export type DataTableFormat = "auto" | "csv" | "tsv";
export type DataTableEncoding = "utf-8" | "shift_jis";

export type DataTableFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type DataTableScrollSize = number | string;

export type DataTableDirective = {
  src: string;
  format: DataTableFormat;
  encoding: DataTableEncoding;
  header: boolean;
  columns?: string[];
  caption?: string;
  kind?: string;
  limit?: number;
  className?: string[];
  maxHeight?: string;
  empty: string;
};

export type DataTableData = {
  src: string;
  format: Exclude<DataTableFormat, "auto">;
  encoding: DataTableEncoding;
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
  encoding?: DataTableEncoding;
  fetch?: DataTableFetch;
  maxHeight?: DataTableScrollSize;
};
