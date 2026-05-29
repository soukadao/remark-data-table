import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { visit } from "unist-util-visit";
import { parseDelimited } from "./parse-delimited.js";
const pseudoPattern = /^::data-table(?:\s+(.+?))?\s*$/;
function message(file, reason, node, fatal = true) {
    const vfileMessage = file.message(reason);
    vfileMessage.fatal = fatal;
    vfileMessage.source = "remark-data-table";
    vfileMessage.ruleId = "data-table";
}
function paragraphText(node) {
    if (node.type !== "paragraph" || node.children.length !== 1) {
        return undefined;
    }
    const child = node.children[0];
    return child.type === "text" ? child.value : undefined;
}
function parseBoolean(value, fallback) {
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
function parseNumber(value) {
    if (typeof value !== "string" && typeof value !== "number") {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
function parseScrollSize(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) && value >= 0 ? `${value}px` : undefined;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim();
    if (normalized.length === 0) {
        return undefined;
    }
    if (/^\d+(?:\.\d+)?$/.test(normalized)) {
        return `${normalized}px`;
    }
    return /^calc\([^)]+\)$|^\d+(?:\.\d+)?(?:px|r?em|vh|vw|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw|%)$/i.test(normalized)
        ? normalized
        : undefined;
}
function parseColumns(value) {
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        return value.map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value !== "string") {
        return undefined;
    }
    return value.split(",").map((item) => item.trim()).filter(Boolean);
}
function parseClassName(value) {
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        return value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}
function normalizeFormat(value) {
    return value === "csv" || value === "tsv" || value === "auto" ? value : "auto";
}
function normalizeEncoding(value, fallback) {
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = value.trim().toLowerCase().replace(/-/g, "_");
    return normalized === "shift_jis" || normalized === "sjis" ? "shift_jis" : "utf-8";
}
function splitArgs(value) {
    const args = [];
    let current = "";
    let quote;
    for (const char of value.trim()) {
        if (quote) {
            if (char === quote) {
                quote = undefined;
            }
            else {
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
function parseArgs(value) {
    const result = {};
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
function directiveFromAttributes(attributes, options) {
    const src = attributes.src ?? attributes.file ?? attributes.path;
    if (typeof src !== "string" || src.trim().length === 0) {
        return undefined;
    }
    return {
        src: src.trim(),
        format: normalizeFormat(attributes.format),
        encoding: normalizeEncoding(attributes.encoding ?? attributes.charset, options.encoding),
        header: parseBoolean(attributes.header ?? attributes.headers, true),
        columns: parseColumns(attributes.columns),
        caption: typeof attributes.caption === "string" ? attributes.caption : undefined,
        kind: typeof attributes.kind === "string" ? attributes.kind : undefined,
        limit: parseNumber(attributes.limit),
        className: parseClassName(attributes.class ?? attributes.className),
        maxHeight: parseScrollSize(attributes.maxHeight ?? attributes["max-height"] ?? attributes.maxheight ?? attributes.height) ?? options.maxHeight,
        empty: typeof attributes.empty === "string" ? attributes.empty : options.empty,
    };
}
function directiveFromPseudo(value, options) {
    const match = value.match(pseudoPattern);
    if (!match) {
        return undefined;
    }
    return directiveFromAttributes(parseArgs(match[1] ?? ""), options);
}
function resolveSource(src, file, options) {
    if (isUrl(src)) {
        return src;
    }
    if (isAbsolute(src)) {
        return src;
    }
    const filePath = typeof file.path === "string" && file.path.length > 0 ? file.path : undefined;
    const baseDir = options.baseDir ?? (filePath ? dirname(filePath) : process.cwd());
    return resolve(baseDir, src);
}
function inferFormat(src, requested) {
    if (requested === "csv" || requested === "tsv") {
        return requested;
    }
    return extname(src).toLowerCase() === ".tsv" ? "tsv" : "csv";
}
function isUrl(src) {
    return /^https?:\/\//i.test(src);
}
function decodeBytes(bytes, encoding) {
    return new TextDecoder(encoding).decode(bytes);
}
async function readSource(directive, file, node, options) {
    if (isUrl(directive.src)) {
        try {
            const response = await options.fetch(directive.src);
            if (!response.ok) {
                if (options.validate) {
                    message(file, `Data table source request failed: ${directive.src} (${response.status})`, node);
                }
                return undefined;
            }
            return decodeBytes(await response.arrayBuffer(), directive.encoding);
        }
        catch (error) {
            if (options.validate) {
                const reason = error instanceof Error ? error.message : String(error);
                message(file, `Data table source request failed: ${directive.src}: ${reason}`, node);
            }
            return undefined;
        }
    }
    const path = resolveSource(directive.src, file, options);
    if (!existsSync(path)) {
        if (options.validate) {
            message(file, `Data table source not found: ${directive.src}`, node);
        }
        return undefined;
    }
    return decodeBytes(readFileSync(path), directive.encoding);
}
function tableCell(value) {
    return {
        type: "tableCell",
        children: [{ type: "text", value }],
    };
}
function tableRow(values) {
    return {
        type: "tableRow",
        children: values.map(tableCell),
    };
}
function normalizeRows(rows, width, empty) {
    return rows.map((row) => (Array.from({ length: width }, (_, index) => {
        const value = row[index] ?? "";
        return value.length > 0 ? value : empty;
    })));
}
async function loadDataTable(directive, file, node, options) {
    const source = await readSource(directive, file, node, options);
    if (source === undefined) {
        return undefined;
    }
    const format = inferFormat(directive.src, directive.format);
    const delimiter = format === "tsv" ? "\t" : ",";
    const parsedRows = parseDelimited(source, delimiter);
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
        encoding: directive.encoding,
        header: directive.header,
        columns: normalizeRows([columns], width, directive.empty)[0],
        rows: normalizeRows(limitedRows, width, directive.empty),
        kind: directive.kind,
        caption: directive.caption,
    };
}
function captionParagraph(caption) {
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
function tableNode(data) {
    return {
        type: "table",
        align: data.columns.map(() => null),
        children: [
            tableRow(data.columns),
            ...data.rows.map(tableRow),
        ],
    };
}
function wrapperStyle(directive) {
    const declarations = [
        "max-width: 100%",
        "overflow-x: auto",
    ];
    if (directive.maxHeight) {
        declarations.push(`max-height: ${directive.maxHeight}`, "overflow-y: auto");
    }
    return declarations.join("; ");
}
function wrapperNode(data, directive) {
    const className = ["remark-data-table", ...(directive.className ?? [])];
    const children = [
        ...(data.caption ? [captionParagraph(data.caption)] : []),
        tableNode(data),
    ];
    return {
        type: "blockquote",
        data: {
            hName: "div",
            hProperties: {
                className,
                style: wrapperStyle(directive),
                dataTableSrc: data.src,
                dataTableKind: data.kind,
                dataTableFormat: data.format,
                dataTableEncoding: data.encoding,
                dataTableHeader: String(data.header),
                ...(directive.maxHeight ? { dataTableMaxHeight: directive.maxHeight } : {}),
            },
            dataTable: data,
        },
        children,
    };
}
async function transformDirectiveNode(node, file, options) {
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
    const data = await loadDataTable(directive, file, node, options);
    if (!data) {
        return;
    }
    const wrapper = wrapperNode(data, directive);
    node.data = wrapper.data;
    node.children = wrapper.children;
}
async function transformPseudoNodes(tree, file, options) {
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
        const data = await loadDataTable(directive, file, node, options);
        if (!data) {
            tree.children.splice(index, 1);
            index -= 1;
            continue;
        }
        tree.children.splice(index, 1, wrapperNode(data, directive));
    }
}
const remarkDataTable = (options = {}) => {
    const normalized = {
        validate: options.validate ?? true,
        baseDir: options.baseDir,
        empty: options.empty ?? "",
        encoding: options.encoding ?? "utf-8",
        fetch: options.fetch ?? globalThis.fetch,
        maxHeight: parseScrollSize(options.maxHeight),
    };
    return async (tree, file) => {
        await transformPseudoNodes(tree, file, normalized);
        const directiveNodes = [];
        visit(tree, (node) => {
            directiveNodes.push(node);
        });
        for (const node of directiveNodes) {
            await transformDirectiveNode(node, file, normalized);
        }
    };
};
export default remarkDataTable;
