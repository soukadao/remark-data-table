import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Root } from "mdast";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { VFile } from "vfile";
import remarkDataTable from "../src/index.js";

const fixtureDir = join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8");
}

async function createTree(name: string, options = {}) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkDataTable, options);

  const file = new VFile({
    value: fixture(name),
    path: join(fixtureDir, name),
  });
  const tree = processor.parse(file) as Root;
  const result = await processor.run(tree, file) as Root;
  return { tree: result, file };
}

describe("remarkDataTable", () => {
  test("loads CSV with header row", async () => {
    const { tree, file } = await createTree("basic.md");
    expect(file.messages).toHaveLength(0);

    const wrapper = tree.children[0];
    expect(wrapper?.data?.hName).toBe("div");
    expect(wrapper?.data?.hProperties).toEqual({
      className: ["remark-data-table"],
      style: "max-width: 100%; overflow-x: auto",
      dataTableSrc: "./data/requirements.csv",
      dataTableKind: "requirements",
      dataTableFormat: "csv",
      dataTableEncoding: "utf-8",
      dataTableHeader: "true",
    });
    expect(wrapper?.data?.dataTable).toEqual({
      src: "./data/requirements.csv",
      format: "csv",
      encoding: "utf-8",
      header: true,
      columns: ["id", "type", "priority", "status", "title"],
      rows: [
        ["REQ-001", "functional", "must", "approved", "ユーザー検索"],
        ["REQ-002", "functional", "should", "draft", "ユーザー停止"],
      ],
      kind: "requirements",
      caption: "要件一覧",
    });
    expect(wrapper?.children[0]?.data?.hProperties).toEqual({
      className: ["remark-data-table-caption"],
    });
    expect(wrapper?.children[1]?.type).toBe("table");
  });

  test("uses manual columns when header is false", async () => {
    const { tree, file } = await createTree("no-header.md");
    expect(file.messages).toHaveLength(0);

    expect(tree.children[0]?.data?.dataTable).toMatchObject({
      src: "./data/events.tsv",
      format: "tsv",
      encoding: "utf-8",
      header: false,
      columns: ["イベントID", "名称", "発火条件", "備考"],
      rows: [
        ["EVT-001", "検索実行", "検索ボタン押下", "検索条件を送信する"],
        ["EVT-002", "条件初期化", "クリアボタン押下", "入力値を空にする"],
      ],
    });
  });

  test("applies limit and empty value", async () => {
    const { tree, file } = await createTree("limit-empty.md");
    expect(file.messages).toHaveLength(0);

    expect(tree.children[0]?.data?.dataTable).toMatchObject({
      columns: ["id", "name", "description"],
      rows: [["ITEM-001", "-", "説明あり"]],
    });
  });

  test("supports directive attributes", async () => {
    const { tree, file } = await createTree("directive.md");
    expect(file.messages).toHaveLength(0);

    expect(tree.children[0]?.data?.hProperties).toEqual({
      className: ["remark-data-table", "compact", "scroll"],
      style: "max-width: 100%; overflow-x: auto",
      dataTableSrc: "./data/requirements.csv",
      dataTableKind: "requirements",
      dataTableFormat: "csv",
      dataTableEncoding: "utf-8",
      dataTableHeader: "true",
    });
  });

  test("adds vertical scrolling when max height is configured on a directive", async () => {
    const { tree, file } = await createTree("vertical-scroll.md");
    expect(file.messages).toHaveLength(0);

    expect(tree.children[0]?.data?.hProperties).toMatchObject({
      style: "max-width: 100%; overflow-x: auto; max-height: 16rem; overflow-y: auto",
      dataTableMaxHeight: "16rem",
    });
  });

  test("uses configured max height option", async () => {
    const { tree, file } = await createTree("basic.md", { maxHeight: 320 });
    expect(file.messages).toHaveLength(0);

    expect(tree.children[0]?.data?.hProperties).toMatchObject({
      style: "max-width: 100%; overflow-x: auto; max-height: 320px; overflow-y: auto",
      dataTableMaxHeight: "320px",
    });
  });

  test("loads remote CSV URLs", async () => {
    const encoder = new TextEncoder();
    const { tree, file } = await createTree("url.md", {
      fetch: async (url: string) => ({
        ok: url === "https://example.test/holidays.csv",
        status: 200,
        arrayBuffer: async () => encoder.encode("date,name\n2026-01-01,New Year\n").buffer,
      }),
    });
    expect(file.messages).toHaveLength(0);
    expect(tree.children[0]?.data?.dataTable).toMatchObject({
      src: "https://example.test/holidays.csv",
      format: "csv",
      encoding: "shift_jis",
      columns: ["date", "name"],
      rows: [["2026-01-01", "New Year"]],
    });
    expect(tree.children[0]?.data?.hProperties).toMatchObject({
      dataTableEncoding: "shift_jis",
    });
  });

  test("reports missing files", async () => {
    const { file } = await createTree("missing.md");
    expect(file.messages.some((message) => message.fatal === true && /source not found/.test(message.reason))).toBe(true);
  });

  test("suppresses validation messages when validate is false", async () => {
    const { file } = await createTree("missing.md", { validate: false });
    expect(file.messages).toHaveLength(0);
  });
});
