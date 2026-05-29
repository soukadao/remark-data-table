# @soukadao/remark-data-table

## ライブラリ名

`@soukadao/remark-data-table`

## プラグインの概要

CSV または TSV を Markdown の table ノードとして読み込む remark プラグインです。

ローカルファイルまたは URL を `::data-table` で指定すると、データを読み込み、ヘッダー、行、キャプション、スクロール設定などを持つテーブル構造へ変換します。

## プラグインでの記法

基本形です。最初の引数に CSV/TSV のパスまたは URL を指定します。

```md
::data-table ./data/requirements.csv
```

属性はスペース区切りで指定できます。

```md
::data-table ./data/requirements.csv kind=requirements caption="要件一覧"
```

remark-directive の属性記法も使えます。

```md
::data-table{src="./data/requirements.csv" kind="requirements" class="compact scroll"}
```

TSV、ヘッダーなし、列名指定の例です。

```md
::data-table ./data/events.tsv format=tsv header=false columns="イベントID,名称,発火条件,備考"
```

よく使う属性です。

- `src`, `file`, `path`: 読み込む CSV/TSV のパスまたは URL
- `format`: `auto`, `csv`, `tsv`
- `encoding`: `utf-8`, `shift_jis`
- `header`: 先頭行をヘッダーとして扱うか
- `columns`: `header=false` のときの列名
- `caption`: テーブルのキャプション
- `kind`: テーブル種別
- `limit`: 読み込む行数の上限
- `empty`: 空セルの表示文字
- `class`, `className`: 追加 class
- `maxHeight`, `max-height`, `height`: 縦スクロールの最大高さ
