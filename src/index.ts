import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import type { Blockquote, Paragraph, Root, RootContent, Table, TableCell, TableRow } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { parseDelimited } from "./parse-delimited.js";
import type { DataTableData, DataTableDirective, DataTableFormat, RemarkDataTableOptions } from "./types.js";

export type {
  DataTableData,
  DataTableDirective,
  DataTableFormat,
  RemarkDataTableOptions,
} from "./types.js";

type DirectiveNode = {
  type?: string;
  data?: unknown;
  name?: string;
  label?: string;
  attributes?: Record<string, unknown>;
  children?: RootContent[];
};

type NormalizedOptions = {
  validate: boolean;
  baseDir?: string;
  empty: string;
};

const pseudoPattern = /^::data-table(?:\s+(.+?))?\s*$/;

function message(file: VFile, reason: string, node: unknown, fatal = true): void {
  const vfileMessage = file.message(reason);
  vfileMessage.fatal = fatal;
  vfileMessage.source = "remark-data-table";
  vfileMessage.ruleId = "data-table";
}

function paragraphText(node: RootContent): string | undefined {
  if (node.type !== "paragraph" || node.children.length !== 1) {
    return undefined;
  }

  const child = node.children[0];
  return child.type === "text" ? child.value : undefined;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  return fallback;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseColumns(value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string") {
    return undefined;
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseClassName(value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeFormat(value: unknown): DataTableFormat {
  return value === "csv" || value === "tsv" || value === "auto" ? value : "auto";
}

function splitArgs(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;

  for (const char of value.trim()) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

function parseArgs(value: string): Record<string, string> & { src?: string } {
  const result: Record<string, string> & { src?: string } = {};
  for (const arg of splitArgs(value)) {
    const index = arg.indexOf("=");
    if (index === -1) {
      result.src ??= arg;
      continue;
    }

    result[arg.slice(0, index)] = arg.slice(index + 1);
  }
  return result;
}

function directiveFromAttributes(attributes: Record<string, unknown>, options: NormalizedOptions): DataTableDirective | undefined {
  const src = attributes.src ?? attributes.file ?? attributes.path;
  if (typeof src !== "string" || src.trim().length === 0) {
    return undefined;
  }

  return {
    src: src.trim(),
    format: normalizeFormat(attributes.format),
    header: parseBoolean(attributes.header ?? attributes.headers, true),
    columns: parseColumns(attributes.columns),
    caption: typeof attributes.caption === "string" ? attributes.caption : undefined,
    kind: typeof attributes.kind === "string" ? attributes.kind : undefined,
    limit: parseNumber(attributes.limit),
    className: parseClassName(attributes.class ?? attributes.className),
    empty: typeof attributes.empty === "string" ? attributes.empty : options.empty,
  };
}

function directiveFromPseudo(value: string, options: NormalizedOptions): DataTableDirective | undefined {
  const match = value.match(pseudoPattern);
  if (!match) {
    return undefined;
  }

  return directiveFromAttributes(parseArgs(match[1] ?? ""), options);
}

function resolveSource(src: string, file: VFile, options: NormalizedOptions): string {
  if (isAbsolute(src)) {
    return src;
  }

  const filePath = typeof file.path === "string" && file.path.length > 0 ? file.path : undefined;
  const baseDir = options.baseDir ?? (filePath ? dirname(filePath) : process.cwd());
  return resolve(baseDir, src);
}

function inferFormat(src: string, requested: DataTableFormat): Exclude<DataTableFormat, "auto"> {
  if (requested === "csv" || requested === "tsv") {
    return requested;
  }

  return extname(src).toLowerCase() === ".tsv" ? "tsv" : "csv";
}

function tableCell(value: string): TableCell {
  return {
    type: "tableCell",
    children: [{ type: "text", value }],
  };
}

function tableRow(values: string[]): TableRow {
  return {
    type: "tableRow",
    children: values.map(tableCell),
  };
}

function normalizeRows(rows: string[][], width: number, empty: string): string[][] {
  return rows.map((row) => (
    Array.from({ length: width }, (_, index) => {
      const value = row[index] ?? "";
      return value.length > 0 ? value : empty;
    })
  ));
}

function loadDataTable(directive: DataTableDirective, file: VFile, node: unknown, options: NormalizedOptions): DataTableData | undefined {
  const path = resolveSource(directive.src, file, options);
  if (!existsSync(path)) {
    if (options.validate) {
      message(file, `Data table source not found: ${directive.src}`, node);
    }
    return undefined;
  }

  const format = inferFormat(directive.src, directive.format);
  const delimiter = format === "tsv" ? "\t" : ",";
  const parsedRows = parseDelimited(readFileSync(path, "utf8"), delimiter);
  if (parsedRows.length === 0) {
    if (options.validate) {
      message(file, `Data table source is empty: ${directive.src}`, node);
    }
    return undefined;
  }

  const columns = directive.header
    ? parsedRows[0]
    : directive.columns ?? parsedRows[0].map((_, index) => `Column ${index + 1}`);
  const rows = directive.header ? parsedRows.slice(1) : parsedRows;
  const limitedRows = typeof directive.limit === "number" ? rows.slice(0, directive.limit) : rows;
  const width = Math.max(columns.length, ...limitedRows.map((row) => row.length));

  return {
    src: directive.src,
    format,
    header: directive.header,
    columns: normalizeRows([columns], width, directive.empty)[0],
    rows: normalizeRows(limitedRows, width, directive.empty),
    kind: directive.kind,
    caption: directive.caption,
  };
}

function captionParagraph(caption: string): Paragraph {
  return {
    type: "paragraph",
    data: {
      hName: "p",
      hProperties: {
        className: ["remark-data-table-caption"],
      },
    },
    children: [{ type: "text", value: caption }],
  };
}

function tableNode(data: DataTableData): Table {
  return {
    type: "table",
    align: data.columns.map(() => null),
    children: [
      tableRow(data.columns),
      ...data.rows.map(tableRow),
    ],
  };
}

function wrapperNode(data: DataTableData, directive: DataTableDirective): Blockquote {
  const className = ["remark-data-table", ...(directive.className ?? [])];
  const children: Blockquote["children"] = [
    ...(data.caption ? [captionParagraph(data.caption)] : []),
    tableNode(data),
  ];

  return {
    type: "blockquote",
    data: {
      hName: "div",
      hProperties: {
        className,
        dataTableSrc: data.src,
        dataTableKind: data.kind,
        dataTableFormat: data.format,
        dataTableHeader: String(data.header),
      },
      dataTable: data,
    },
    children,
  };
}

function transformDirectiveNode(node: DirectiveNode, file: VFile, options: NormalizedOptions): void {
  if (node.type !== "containerDirective" && node.type !== "leafDirective" && node.type !== "textDirective") {
    return;
  }
  if (node.name !== "data-table") {
    return;
  }

  const directive = directiveFromAttributes(node.attributes ?? {}, options);
  if (!directive) {
    if (options.validate) {
      message(file, "Missing data table source", node);
    }
    return;
  }

  const data = loadDataTable(directive, file, node, options);
  if (!data) {
    return;
  }

  const wrapper = wrapperNode(data, directive);
  node.data = wrapper.data;
  node.children = wrapper.children;
}

function transformPseudoNodes(tree: Root, file: VFile, options: NormalizedOptions): void {
  for (let index = 0; index < tree.children.length; index += 1) {
    const node = tree.children[index];
    const text = paragraphText(node);
    if (text === undefined) {
      continue;
    }

    const directive = directiveFromPseudo(text, options);
    if (!directive) {
      continue;
    }

    const data = loadDataTable(directive, file, node, options);
    if (!data) {
      tree.children.splice(index, 1);
      index -= 1;
      continue;
    }

    tree.children.splice(index, 1, wrapperNode(data, directive));
  }
}

const remarkDataTable: Plugin<[RemarkDataTableOptions?], Root> = (options = {}) => {
  const normalized: NormalizedOptions = {
    validate: options.validate ?? true,
    baseDir: options.baseDir,
    empty: options.empty ?? "",
  };

  return (tree: Root, file: VFile) => {
    transformPseudoNodes(tree, file, normalized);
    visit(tree, (node: unknown) => {
      transformDirectiveNode(node as DirectiveNode, file, normalized);
    });
  };
};

export default remarkDataTable;
