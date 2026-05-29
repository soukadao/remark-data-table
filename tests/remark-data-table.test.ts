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

function createTree(name: string, options = {}) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkDataTable, options);

  const file = new VFile({
    value: fixture(name),
    path: join(fixtureDir, name),
  });
  const tree = processor.parse(file) as Root;
  const result = processor.runSync(tree, file) as Root;
  return { tree: result, file };
}

describe("remarkDataTable", () => {
  test("loads CSV with header row", () => {
    const { tree, file } = createTree("basic.md");
    expect(file.messages).toHaveLength(0);

    const wrapper = tree.children[0];
    expect(wrapper?.data?.hName).toBe("div");
    expect(wrapper?.data?.hProperties).toEqual({
      className: ["remark-data-table"],
      dataTableSrc: "./data/requirements.csv",
      dataTableKind: "requirements",
      dataTableFormat: "csv",
      dataTableHeader: "true",
    });
    expect(wrapper?.data?.dataTable).toEqual({
      src: "./data/requirements.csv",
      format: "csv",
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

  test("uses manual columns when header is false", () => {
    const { tree, file } = createTree("no-header.md");
    expect(file.messages).toHaveLength(0);

    expect(tree.children[0]?.data?.dataTable).toMatchObject({
      src: "./data/events.tsv",
      format: "tsv",
      header: false,
      columns: ["イベントID", "名称", "発火条件", "備考"],
      rows: [
        ["EVT-001", "検索実行", "検索ボタン押下", "検索条件を送信する"],
        ["EVT-002", "条件初期化", "クリアボタン押下", "入力値を空にする"],
      ],
    });
  });

  test("applies limit and empty value", () => {
    const { tree, file } = createTree("limit-empty.md");
    expect(file.messages).toHaveLength(0);

    expect(tree.children[0]?.data?.dataTable).toMatchObject({
      columns: ["id", "name", "description"],
      rows: [["ITEM-001", "-", "説明あり"]],
    });
  });

  test("supports directive attributes", () => {
    const { tree, file } = createTree("directive.md");
    expect(file.messages).toHaveLength(0);

    expect(tree.children[0]?.data?.hProperties).toEqual({
      className: ["remark-data-table", "compact", "scroll"],
      dataTableSrc: "./data/requirements.csv",
      dataTableKind: "requirements",
      dataTableFormat: "csv",
      dataTableHeader: "true",
    });
  });

  test("reports missing files", () => {
    const { file } = createTree("missing.md");
    expect(file.messages.some((message) => message.fatal === true && /source not found/.test(message.reason))).toBe(true);
  });

  test("suppresses validation messages when validate is false", () => {
    const { file } = createTree("missing.md", { validate: false });
    expect(file.messages).toHaveLength(0);
  });
});
