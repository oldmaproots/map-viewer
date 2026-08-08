// ============================================================
// 都市計画図 > 熊本県
// 熊本県の都市計画データ
// (国土交通省の都市計画決定GISデータ・令和7年度)を表示する。
// 元データは市町村ごと・種類ごとに分かれているので、
// scripts/build_kumamoto_data.py で種類ごとに1ファイルへまとめ、
// data/kumamoto/ に置いてある。
// チェックを入れたときに初めて読み込む(遅延読み込み)。
//
// このファイルには「凡例」の仕組みも入っている:
//  - 都市計画レイヤーをONにすると右下に凡例が出る
//  - 凡例は折り畳める
//  - 凡例の項目ごとに、地図上の表示/非表示を切り替えられる
// ============================================================

const KUMAMOTO_DATA_BASE = "data/kumamoto/";

// ---- 用途地域の色（都市計画総括図の公式凡例に準拠） ----
// 建ぺい率・容積率つきの凡例表（_reference/用途地域凡例_色見本.png）の
// 色見本から1マスずつ実測した色をそのまま使う。
// 並べた順番が、そのまま凡例に表示する順番になる（住居系→商業系→工業系）。
const YOUTO_CHIIKI_FILL = {
  第１種低層住居専用地域: "#90BFC1", // 青緑
  第２種低層住居専用地域: "#C5E4E7", // うすい青緑
  第１種中高層住居専用地域: "#B1CC83", // 黄緑
  第２種中高層住居専用地域: "#E2EFDB", // うすい黄緑
  第１種住居地域: "#F6F1A4", // 黄
  第２種住居地域: "#EFDAC4", // うすい黄
  準住居地域: "#F1C999", // 橙
  // 田園住居地域だけは凡例表に載っていない（熊本県内に指定なし）。
  // 国の計画図凡例（用途地域凡例.pdf）の「うすい茶」を将来のために残しておく
  田園住居地域: "#C8A55D",
  近隣商業地域: "#F7E5EE", // 桃
  商業地域: "#F1BEBE", // 赤
  準工業地域: "#BEBDDF", // 紫
  工業地域: "#C8E8FA", // 水色
  工業専用地域: "#6BBBEE", // 青
};

// 色を暗くする。境界線の色を塗りつぶし色から自動で作るために使う
// （公式凡例は塗りつぶし色しか決めていないため）。
function darkenColor(hex, ratio) {
  const n = parseInt(hex.slice(1), 16);
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => Math.round(v * ratio).toString(16).padStart(2, "0"))
      .join("")
  );
}

// 種別ごとの色分け。
//  - 区域区分（市街化区域・調整区域）は公式総括図凡例に無いので従来の色のまま残す。
//  - 防火地域・準防火地域・特別用途地区・公園などは、
//    「熊本県 都市計画総括図の凡例（令和2年2月）」の色をPDFから実測して合わせた。
//    ※斜線ハッチや点線枠での表現は各レイヤー定義（KUMAMOTO_LAYER_DEFS）側の
//      hatch / frameOnly といった目印で切り替える。ここでは色だけを決める。
// 区域区分の5区分。公式凡例の色見本から実測した値。
// 並べた順番が、そのまま凡例に表示する順番になる。
//   市街化区域・市街化調整区域 … 線引きしている都市計画区域
//   用途指定区域・用途指定区域外 … 線引きしていない都市計画区域を用途地域の有無で分けたもの
//   全域用途未指定区域 … 用途地域が1つも定められていない都市計画区域
const KUIKI_KUBUN_FILL = {
  市街化区域: "#F09CAE",          // 濃い桃
  市街化調整区域: "#F7D5DD",      // 淡い桃
  用途指定区域: "#CAAF94",        // 茶
  用途指定区域外: "#EBDBC1",      // 薄い茶
  全域用途未指定区域: "#D1CDE6",  // 薄い紫
};

const KUMAMOTO_CATEGORY_COLORS = {
  // 防火地域・準防火地域（公式凡例の斜線ハッチ。fillColor=斜線の色、color=枠線）
  防火地域: { color: "#6f6c9c", fillColor: "#8c89b8" },   // 灰紫
  準防火地域: { color: "#d05f9c", fillColor: "#e27bb0" }, // 桃
  // 特別用途地区（公式凡例の色付き点線枠。5種。線の色＝そのままの色）
  大規模集客施設制限地区: { color: "#8dba1e", fillColor: "#8dba1e" }, // 黄緑
  特別工業地区: { color: "#e0b000", fillColor: "#f2c206" },           // 金
  文教地区: { color: "#0a6cc0", fillColor: "#0a6cc0" },               // 青
  娯楽レクリエーション地区: { color: "#e30d2e", fillColor: "#e30d2e" }, // 赤
  "行政・文化拠点地区": { color: "#b53877", fillColor: "#b53877" },     // 紫
  // 公園・緑地・墓園（公式凡例は緑の枠線。3種とも同じ緑）
  公園: { color: "#2e8b57", fillColor: "#2e8b57" },
  緑地: { color: "#2e8b57", fillColor: "#2e8b57" },
  墓園: { color: "#2e8b57", fillColor: "#2e8b57" },
};

// 用途地域と区域区分を上の表に流し込む（塗りつぶしは公式色、境界線はそれを暗くした色）
[YOUTO_CHIIKI_FILL, KUIKI_KUBUN_FILL].forEach((table) => {
  Object.entries(table).forEach(([name, fill]) => {
    KUMAMOTO_CATEGORY_COLORS[name] = { color: darkenColor(fill, 0.55), fillColor: fill };
  });
});

// ---- 用途地域の凡例に添える注記（公式凡例の「注)」をそのまま載せる） ----
// {丸:200/60} と書いたところには、容積率(上)と建ぺい率(下)を書いた丸印を描く。
// {丸:} は数字の入っていない丸で、「丸印の表示そのもの」を指すときに使う。
// 先頭の1つだけはこのサイト独自の説明（丸印の読み方と、出てくるズーム）。
const YOUTO_LEGEND_NOTES = [
  {
    mark: "※",
    text: "丸印は上から順に「容積率／用途地域の略称／建ぺい率」。ズーム15以上で表示されます。",
  },
  {
    mark: "注) 1:",
    text: "第１種住居地域・第２種住居地域・準住居地域・準工業地域・工業地域において、" +
      "{丸:}の表示のない地域は総て{丸:200/60}です。",
  },
  {
    mark: "注) 2:",
    text: "用途地域の指定のない区域は{丸:200/70}、ただし益城町は{丸:400/70}です。",
  },
  {
    // 公式凡例の原文は「工業専用地域及び田園住居地域の指定はありません(※令和2年2月時点)」だが、
    // このサイトが使っている令和7年度・熊本県全域のデータには工業専用地域が13区域ある。
    // そのため工業専用地域は外し、データと一致する田園住居地域だけを残している。
    // （原文の「令和2年2月時点」も、令和7年度のデータで確かめたうえで外した）
    mark: "注) 3:",
    text: "田園住居地域の指定はありません。",
  },
];

// 「{丸:200/60}」のような書き方を、実際の丸印に置き換えて並べる
function buildLegendNoteBody(text) {
  const body = document.createElement("span");
  body.className = "legend-note-body";
  // {丸:…} のところで区切りながら、文字と丸印を順に足していく
  const parts = text.split(/(\{丸:[^}]*\})/);
  parts.forEach((part) => {
    const m = part.match(/^\{丸:([^}]*)\}$/);
    if (!m) {
      if (part) body.appendChild(document.createTextNode(part));
      return;
    }
    const [top, bottom] = m[1].split("/");
    const circle = document.createElement("span");
    circle.className = "legend-circle";
    const t = document.createElement("span");
    t.className = "lc-top";
    t.textContent = top || "";
    const b = document.createElement("span");
    b.className = "lc-bottom";
    b.textContent = bottom || "";
    circle.appendChild(t);
    circle.appendChild(b);
    body.appendChild(circle);
  });
  return body;
}

// 凡例に並べる順番。用途地域と区域区分は公式凡例の順、それ以外は五十音順にする
const YOUTO_CHIIKI_ORDER = Object.keys(YOUTO_CHIIKI_FILL);
const KUIKI_KUBUN_ORDER = Object.keys(KUIKI_KUBUN_FILL);

function compareLegendItems(a, b) {
  // 公式凡例で順番が決まっているものは、その順に並べる
  for (const order of [YOUTO_CHIIKI_ORDER, KUIKI_KUBUN_ORDER]) {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib; // どちらも同じ表にある → 公式凡例の順
    if (ia >= 0) return -1;                 // 表にあるものを先に
    if (ib >= 0) return 1;
  }
  return a.localeCompare(b, "ja");
}

const KUMAMOTO_FALLBACK_PALETTE = [
  { color: "#888888", fillColor: "#cccccc" },
  { color: "#c9691f", fillColor: "#f0cba0" },
  { color: "#1f8fc9", fillColor: "#a7dcf2" },
  { color: "#8f1fc9", fillColor: "#dba7f2" },
  { color: "#1fc98f", fillColor: "#a7f2d3" },
  { color: "#c91f5f", fillColor: "#f2a7c3" },
];

// 表示できるレイヤーの一覧
//  スタイルの目印(公式凡例に合わせるために追加した項目):
//    hatch:true     … 縁を斜線ハッチで縁取りする（防火・風致・特定用途制限・地区計画）
//    hatchDir       … 斜線の向き。"/"=右上がり、"\\"=右下がり。省略すると"/"。
//                     公式凡例の見本から実測した向きに合わせている（下の各行のコメント参照）
//    frameOnly:true … 塗りつぶさず枠線だけにする（公園=緑の枠、特別用途地区=点線の枠）
//    color/fillColor… レイヤー全体で色を1つに固定する（種別ごとに分けない）ときに指定
//
//  濃さについて:
//    塗りつぶし自体は不透明(fillOpacity:1)にしておき、見た目の濃さは
//    defaultOpacity（透過スライダーの初期位置）で作る。
//    こうするとスライダーを一番右にしたとき「完全に透けていない」状態になる。
//    線だけ・枠だけのレイヤーは薄める必要がないので defaultOpacity は 1。
const KUMAMOTO_LAYER_DEFS = [
  // 都市計画区域の境界は公式凡例では「黒の一点鎖線」。dashArrayで一点鎖線を再現する。
  //
  // 描くのは面ではなく「枠線」のデータ(..._line)。元データは市町村ごとに分かれていて、
  // そのまま描くと都市計画区域の中に市町村の境目の線が入ってしまうため、
  // scripts/build_toshikeikaku_frame.py が区域ごとの大枠にまとめ直している。
  // 隣り合う区域が共有している境界は、まったく同じ図形を区域の数だけ用意してある。
  // 同じ図形なら一点鎖線の点の位置もそろうので、重ねてもきれいな一点鎖線に見える。
  //
  // clickFile … 地図をクリックしたときの「どの区域か」の判定に使う面のデータ。
  //             線には内と外が無いので、判定だけは面で行う。
  { key: "toshikeikaku_kuiki", file: "toshikeikaku_kuiki_line.geojson",
    clickFile: "toshikeikaku_kuiki_area.geojson", clickCategoryFields: ["TokeiName"],
    label: "都市計画区域",
    categoryFields: [], fillOpacity: 0, defaultOpacity: 1, weight: 2, dashArray: "14 5 2 5", color: "#333333" },
  // 準都市計画区域は公式凡例では「二点鎖線」(長い線→点2つ)。都市計画区域の一点鎖線と
  // 点の数で見分ける決まりなので、太さや色は都市計画区域とそろえる
  { key: "jun_toshikeikaku_kuiki", file: "jun_toshikeikaku_kuiki_line.geojson",
    clickFile: "jun_toshikeikaku_kuiki_area.geojson", clickCategoryFields: ["TokeiName"],
    label: "準都市計画区域",
    categoryFields: [], fillOpacity: 0, defaultOpacity: 1, weight: 2, dashArray: "14 5 2 5 2 5", color: "#333333" },
  // 区域区分は公式凡例に合わせて5区分。市街化区域・市街化調整区域は元データそのままだが、
  // 用途指定区域・用途指定区域外・全域用途未指定区域は元データに無いため
  // scripts/build_kuiki_kubun5.py が都市計画区域・用途地域から計算して作っている
  { key: "kuiki_kubun", file: "kuiki_kubun5.geojson", label: "区域区分",
    categoryFields: ["AreaType"], fillOpacity: 1, defaultOpacity: 0.35 },
  // 公式凡例の色は淡いものが多いため、背景地図に埋もれないよう濃いめに塗る
  { key: "youto_chiiki", file: "youto_chiiki.geojson", label: "用途地域",
    categoryFields: ["YoutoName", "AreaType"], fillOpacity: 1, defaultOpacity: 0.7 },
  // 防火・準防火地域は公式凡例では「右下がり」の斜線。種別(AreaType)ごとに灰紫/桃で塗り分ける。
  // 細い斜線なので薄めると見えにくい。既定では透けさせない
  { key: "bouka_chiiki", file: "bouka_chiiki.geojson", label: "防火地域・準防火地域",
    categoryFields: ["AreaType"], fillOpacity: 1, defaultOpacity: 1, weight: 1, hatch: true, hatchDir: "\\" },
  // 地区計画は公式凡例では1つの茶色の「右上がり」の斜線。区域名では色分けせず1色にする
  { key: "chiku_keikaku", file: "chiku_keikaku.geojson", label: "地区計画",
    categoryFields: [], fillOpacity: 1, defaultOpacity: 0.85, weight: 1, hatch: true, hatchDir: "/",
    fillColor: "#b98a52", color: "#8a6330" },
  // 特別用途地区は公式凡例では色付きの点線の枠。種別ごとに色を変える
  { key: "tokubetsu_youto_chiku", file: "tokubetsu_youto_chiku.geojson", label: "特別用途地区",
    categoryFields: ["YoutoName"], fillOpacity: 0, defaultOpacity: 1, weight: 3, frameOnly: true, dashArray: "1 5" },
  // 特定用途制限地域は公式凡例では1つの橙色の「右上がり」の斜線。1色にする
  { key: "tokutei_youto_seigen", file: "tokutei_youto_seigen.geojson", label: "特定用途制限地域",
    categoryFields: [], fillOpacity: 1, defaultOpacity: 0.85, weight: 1, hatch: true, hatchDir: "/",
    fillColor: "#e0b45a", color: "#c78a2e" },
  { key: "ricchi_tekiseika_keikaku", file: "ricchi_tekiseika_keikaku.geojson", label: "立地適正化計画区域",
    categoryFields: ["AreaType"], fillOpacity: 1, defaultOpacity: 0.2 },
  // 公園・緑地・墓園は公式凡例では緑の枠線。塗らずに枠だけにする
  { key: "toshikeikaku_koen", file: "toshikeikaku_koen.geojson", label: "都市計画公園・緑地",
    categoryFields: ["ParkType"], fillOpacity: 0, defaultOpacity: 1, weight: 2, frameOnly: true },
  // 都市計画道路は公式凡例では黒い線
  { key: "toshikeikaku_douro", file: "toshikeikaku_douro.geojson", label: "都市計画道路",
    categoryFields: [], fillOpacity: 0, defaultOpacity: 1, weight: 2, color: "#333333" },
  // 風致地区は公式凡例では緑の「右下がり」の斜線
  { key: "fuuchi_chiku", file: "fuuchi_chiku.geojson", label: "風致地区",
    categoryFields: [], fillOpacity: 1, defaultOpacity: 0.85, weight: 1, hatch: true, hatchDir: "\\",
    fillColor: "#67b698", color: "#3f8f6d" },
  { key: "koudo_riyou_chiku", file: "koudo_riyou_chiku.geojson", label: "高度利用地区",
    categoryFields: [], fillOpacity: 1, defaultOpacity: 0.3 },
  { key: "tochikukaku_seiri", file: "tochikukaku_seiri.geojson", label: "土地区画整理事業",
    categoryFields: ["DistName"], fillOpacity: 1, defaultOpacity: 0.3 },
];

// ============================================================
// 斜線ハッチを描けるCanvasレンダラー
// ------------------------------------------------------------
// 用途地域(6.9MB)や都市計画道路(5.2MB)のような大きなデータでも軽く動くよう、
// 描画はSVGではなくCanvas(L.canvas)を使う。
// ただし素のL.canvasは「べた塗り」しかできないので、斜線ハッチを塗れるように
// 塗りつぶし処理(_fillStroke)だけ差し替えたレンダラーを用意する。
//
// 斜線は「8×8の小さなcanvasに斜め線を1本描いたタイル」を作り、
// それを ctx.createPattern() で敷き詰めて塗る。
// タイルは色ごとにキャッシュして使い回すので動作は軽い。
// ============================================================

// 縁取りの帯の幅(画面上のピクセル)。ズームしても一定の太さになる
const HATCH_BAND_WIDTH = 12;

// 斜線タイル(オフスクリーンcanvas)を「色＋向き」ごとに覚えておく入れ物
const hatchTileCache = new Map(); // "色|向き" -> 8×8のcanvas

// 指定色・指定の向きの斜線タイルを1枚作る(または使い回す)
//   dir "/"  … 右上がり(左下から右上へ)
//   dir "\\" … 右下がり(左上から右下へ)
function getHatchTile(color, dir) {
  const key = `${color}|${dir}`;
  if (hatchTileCache.has(key)) return hatchTileCache.get(key);
  const size = 8;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const c = tile.getContext("2d");
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  // タイルの継ぎ目でも線がつながるよう、角の外側にもはみ出して引く
  c.beginPath();
  if (dir === "\\") {
    // 右下がり: 左上(0,0)から右下(size,size)へ
    c.moveTo(0, 0); c.lineTo(size, size);
    c.moveTo(-size, 0); c.lineTo(size, size * 2);
    c.moveTo(0, -size); c.lineTo(size * 2, size);
  } else {
    // 右上がり: 左下(0,size)から右上(size,0)へ
    c.moveTo(0, size); c.lineTo(size, 0);
    c.moveTo(-size, size); c.lineTo(size, -size);
    c.moveTo(0, size * 2); c.lineTo(size * 2, 0);
  }
  c.stroke();
  hatchTileCache.set(key, tile);
  return tile;
}

// canvasごとに作った塗りパターンを覚えておく(図形のたびに作り直さないため)
const hatchPatternCache = new WeakMap(); // ctx -> Map("色|向き" -> CanvasPattern)

function getHatchPattern(ctx, color, dir) {
  let perCtx = hatchPatternCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    hatchPatternCache.set(ctx, perCtx);
  }
  const key = `${color}|${dir}`;
  if (!perCtx.has(key)) {
    perCtx.set(key, ctx.createPattern(getHatchTile(color, dir), "repeat"));
  }
  return perCtx.get(key);
}

// L.Canvasを継承し、hatch:true のときだけ「縁を斜線で縁取りする」描き方に差し替える。
// それ以外はLeaflet 1.9.4の元の _fillStroke とまったく同じ挙動にしてある。
//
// 縁取りの作り方(公式総括図と同じ、中は塗らない表現):
//   1. ctx.clip() で「この図形の内側」だけを描画対象に限定する
//   2. その状態で図形の輪郭を、とても太い線(帯の幅の2倍)でなぞる
//   3. 太い線の外半分はclipで消えるので、内側にだけ帯が残る
// 図形より帯のほうが太い小さな区域は、そのまま全体が斜線になる(消えない)。
const HatchCanvas = L.Canvas.extend({
  _fillStroke(ctx, layer) {
    const options = layer.options;

    if (options.fill) {
      if (options.hatch) {
        ctx.save();
        ctx.globalAlpha = options.fillOpacity;
        ctx.clip(options.fillRule || "evenodd"); // 図形の内側だけに描く(穴あきにも対応)
        ctx.strokeStyle = getHatchPattern(
          ctx,
          options.hatchColor || options.fillColor || options.color,
          options.hatchDir || "/"
        );
        ctx.lineWidth = HATCH_BAND_WIDTH * 2; // 外半分はclipで捨てられる
        ctx.setLineDash([]);                  // 帯は実線でなぞる(輪郭の破線設定を引きずらない)
        ctx.stroke();
        ctx.restore();                        // clipと透明度を元に戻す
      } else {
        ctx.globalAlpha = options.fillOpacity;
        ctx.fillStyle = options.fillColor || options.color;
        ctx.fill(options.fillRule || "evenodd");
      }
    }

    if (options.stroke && options.weight !== 0) {
      if (ctx.setLineDash) {
        ctx.setLineDash((layer.options && layer.options._dashArray) || []);
      }
      ctx.globalAlpha = options.opacity;
      ctx.lineWidth = options.weight;
      ctx.strokeStyle = options.color;
      ctx.lineCap = options.lineCap;
      ctx.lineJoin = options.lineJoin;
      ctx.stroke();
    }
  },
});

// レイヤーごとに専用のHatchCanvasレンダラーを作る。
// 重ね順(pane)をレイヤーごとに変えられるよう、共有せずに1レイヤー1つ作る。
function createKumamotoRenderer(paneName) {
  return new HatchCanvas({ padding: 0.5, pane: paneName || "overlayPane" });
}

// 色が決まっていない種別にも一貫した色を割り当てるためのキャッシュ
const kumamotoColorCache = new Map();
function kumamotoColorFor(layerKey, name, fallbackIndex) {
  if (!name) return KUMAMOTO_FALLBACK_PALETTE[fallbackIndex % KUMAMOTO_FALLBACK_PALETTE.length];
  if (KUMAMOTO_CATEGORY_COLORS[name]) return KUMAMOTO_CATEGORY_COLORS[name];
  const cacheKey = `${layerKey}::${name}`;
  if (!kumamotoColorCache.has(cacheKey)) {
    kumamotoColorCache.set(
      cacheKey,
      KUMAMOTO_FALLBACK_PALETTE[kumamotoColorCache.size % KUMAMOTO_FALLBACK_PALETTE.length]
    );
  }
  return kumamotoColorCache.get(cacheKey);
}

function kumamotoCategoryName(properties, categoryFields) {
  for (const key of categoryFields) {
    if (properties && properties[key]) return String(properties[key]);
  }
  return null;
}

// ============================================================
// 色の決め方（設定画面で好きな色に変えられるようにするための入口）
// ------------------------------------------------------------
// 地図の塗りと凡例の色見本は必ずここを通す。
// 利用者が設定画面で色を変えたら kumamotoColorOverrides に入り、公式の色より優先される。
// 変えた色はブラウザに保存され、次に開いたときも残る。
// ============================================================
const KUMAMOTO_COLOR_STORAGE_KEY = "map-viewer-kumamoto-colors";

// "レイヤーkey::項目名" -> "#rrggbb"
const kumamotoColorOverrides = new Map();

(function loadColorOverrides() {
  try {
    const saved = JSON.parse(localStorage.getItem(KUMAMOTO_COLOR_STORAGE_KEY));
    if (saved && typeof saved === "object") {
      Object.entries(saved).forEach(([k, v]) => kumamotoColorOverrides.set(k, v));
    }
  } catch (e) { /* 壊れていたら公式の色で始める */ }
})();

function saveColorOverrides() {
  const obj = {};
  kumamotoColorOverrides.forEach((v, k) => (obj[k] = v));
  localStorage.setItem(KUMAMOTO_COLOR_STORAGE_KEY, JSON.stringify(obj));
}

function colorOverrideKey(def, itemName) {
  return `${def.key}::${itemName ?? "__all__"}`;
}

// 公式凡例で決まっている色（利用者が変えていないときの色）を返す
function officialKumamotoColors(def, itemName) {
  if (def.color || def.fillColor) {
    const fillColor = def.fillColor || def.color;
    return { fillColor, color: def.color || darkenColor(fillColor, 0.7) };
  }
  const name = itemName === "__all__" ? null : itemName;
  const c = kumamotoColorFor(def.key, name, KUMAMOTO_LAYER_DEFS.indexOf(def));
  return { fillColor: c.fillColor, color: c.color };
}

// 実際に使う色を返す。利用者が設定していればそちらを優先する。
// 塗り色を変えたときは、枠線もそれに合わせて自動で暗くする。
function resolveKumamotoColors(def, itemName) {
  const custom = kumamotoColorOverrides.get(colorOverrideKey(def, itemName));
  if (custom) return { fillColor: custom, color: darkenColor(custom, 0.7) };
  return officialKumamotoColors(def, itemName);
}

// 凡例で項目を非表示にしたときの目印。項目名がこのSetに入っていたら描かない。
// 種別を持たないレイヤー(都市計画道路など)は「__all__」という名前で扱う。
function kumamotoItemName(def, feature) {
  return kumamotoCategoryName(feature.properties, def.categoryFields) ?? "__all__";
}

// 1つの図形(feature)のスタイルを計算する。
// 凡例で非表示にされた項目は透明にして見えなくする。
function computeKumamotoStyle(def, feature) {
  const itemName = kumamotoItemName(def, feature);
  if (def._hiddenItems && def._hiddenItems.has(itemName)) {
    return { opacity: 0, fillOpacity: 0 }; // 非表示(透明)
  }
  // 色は resolveKumamotoColors にまかせる（設定画面で変えた色があればそちらが returns される）
  const { color: strokeColor, fillColor } = resolveKumamotoColors(def, itemName);

  return {
    color: strokeColor,
    fillColor: fillColor,
    weight: def.weight ?? 1,
    dashArray: def.dashArray,
    // frameOnly(枠だけ)のレイヤーは塗らない
    fillOpacity: def.frameOnly ? 0 : def.fillOpacity,
    // 自作HatchCanvasレンダラーが読む目印。斜線で縁取りするか、その色と向き
    hatch: !!def.hatch,
    hatchColor: fillColor,
    hatchDir: def.hatchDir || "/",
  };
}

// チェックを入れたときに初めてGeoJSONを取得してレイヤーを作る。
// paneName … このレイヤー専用の描画面(重ね順を変えるために使う)。script.jsが渡す。
function ensureKumamotoLayer(def, paneName) {
  if (def._loadPromise) return def._loadPromise;
  // clickFile があるレイヤーは、描く用(線)とクリック判定用(面)の2つを読む
  const fetchJson = (name) =>
    fetch(KUMAMOTO_DATA_BASE + name).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
  def._loadPromise = fetchJson(def.file)
    .then((geojson) =>
      def.clickFile
        ? fetchJson(def.clickFile).then((areaJson) => {
            def._clickFeatures = areaJson.features;
            return geojson;
          })
        : geojson
    )
    .then((geojson) => {
      def._hiddenItems = new Set();

      // 凡例に並べる項目名の一覧を集めておく(データに実際に出てくる種別)
      const names = new Set();
      geojson.features.forEach((f) => names.add(kumamotoItemName(def, f)));
      def._itemNames = [...names].sort(compareLegendItems);

      def._layer = L.geoJSON(geojson, {
        // このレイヤー専用のレンダラー(専用paneに描く)。重ね順の変更に対応する
        renderer: createKumamotoRenderer(paneName),
        style: (feature) => computeKumamotoStyle(def, feature),
      });
      return def._layer;
    })
    .catch((err) => {
      def._loadPromise = null; // 次回チェック時に再試行できるようにする
      alert(`「${def.label}」の読み込みに失敗しました`);
      throw err;
    });
  return def._loadPromise;
}

// 設定画面で色を変えたときに呼ぶ。地図と凡例を描き直す。
//   newColor に null を渡すと、その項目を公式凡例の色に戻す。
function setKumamotoColor(def, itemName, newColor) {
  const key = colorOverrideKey(def, itemName);
  if (newColor) kumamotoColorOverrides.set(key, newColor);
  else kumamotoColorOverrides.delete(key);
  saveColorOverrides();
  redrawKumamotoLayer(def);
}

// 色をすべて公式凡例に戻す
function resetKumamotoColors() {
  kumamotoColorOverrides.clear();
  saveColorOverrides();
  KUMAMOTO_LAYER_DEFS.forEach(redrawKumamotoLayer);
}

// 1つのレイヤーを今の色で描き直し、凡例も作り直す
function redrawKumamotoLayer(def) {
  if (def._layer) {
    def._layer.setStyle((feature) => computeKumamotoStyle(def, feature));
  }
  rebuildKumamotoLegend();
}

// ============================================================
// 設定画面の「都市計画図の色」の中身を組み立てる（script.jsから呼ばれる）
// ------------------------------------------------------------
// どんな種別があるかはGeoJSONを読んで初めて分かるので、
// 「今チェックが入っていて読み込み済みのレイヤー」だけを並べる。
// ============================================================
function buildKumamotoColorSettings(container) {
  container.innerHTML = "";
  const loaded = KUMAMOTO_LAYER_DEFS.filter((def) => def._layer && def._itemNames);

  if (loaded.length === 0) {
    const note = document.createElement("p");
    note.className = "settings-note";
    note.textContent =
      "都市計画図のレイヤーにチェックを入れると、ここでその色を変えられるようになります。";
    container.appendChild(note);
    return;
  }

  loaded.forEach((def) => {
    const box = document.createElement("div");
    box.className = "settings-layer";

    const title = document.createElement("div");
    title.className = "settings-layer-title";
    title.textContent = def.label;
    box.appendChild(title);

    def._itemNames.forEach((itemName) => {
      const row = document.createElement("div");
      row.className = "settings-color-row";

      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = resolveKumamotoColors(def, itemName).fillColor;
      picker.title = "クリックして色を選ぶ";
      picker.addEventListener("input", () => {
        setKumamotoColor(def, itemName, picker.value);
        refreshRevertButton();
      });

      const name = document.createElement("span");
      name.className = "settings-color-name";
      name.textContent = itemName === "__all__" ? "(全体)" : itemName;

      // 公式の色から変えたときだけ「戻す」ボタンを出す
      const revert = document.createElement("button");
      revert.className = "settings-revert";
      revert.textContent = "戻す";
      revert.title = "この項目を公式凡例の色に戻す";
      revert.addEventListener("click", () => {
        setKumamotoColor(def, itemName, null);
        picker.value = officialKumamotoColors(def, itemName).fillColor;
        refreshRevertButton();
      });

      function refreshRevertButton() {
        const changed = kumamotoColorOverrides.has(colorOverrideKey(def, itemName));
        revert.style.display = changed ? "" : "none";
      }
      refreshRevertButton();

      row.appendChild(picker);
      row.appendChild(name);
      row.appendChild(revert);
      box.appendChild(row);
    });

    container.appendChild(box);
  });
}

// 凡例のチェックで項目の表示/非表示を切り替える
function setKumamotoItemVisible(def, itemName, visible) {
  if (!def._hiddenItems) def._hiddenItems = new Set();
  if (visible) def._hiddenItems.delete(itemName);
  else def._hiddenItems.add(itemName);
  // スタイルを計算し直して描き直す
  def._layer.setStyle((feature) => computeKumamotoStyle(def, feature));
}

// ---- クリックした地点の区域名を調べる(script.jsのクリック処理から呼ぶ) ----
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates;
    if (!pointInRing(lng, lat, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) {
      if (pointInRing(lng, lat, rings[k])) return false; // 穴の中
    }
    return true;
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) =>
      pointInGeometry(lng, lat, { type: "Polygon", coordinates: poly })
    );
  }
  return false;
}

// 表示中の都市計画レイヤーのうち、クリック地点に当たるものを列挙する
// (凡例で非表示にした項目は対象外)。
// 元データの属性をそのまま持って返すので、呼び出し側で全部表示できる。
function kumamotoMatchesAt(map, latlng) {
  const matches = [];
  KUMAMOTO_LAYER_DEFS.forEach((def) => {
    if (!def._layer || !map.hasLayer(def._layer)) return;

    // 線で描いているレイヤー(都市計画区域)は、判定だけ面のデータで行う
    if (def._clickFeatures) {
      if (def._hiddenItems && def._hiddenItems.has("__all__")) return;
      def._clickFeatures.forEach((feature) => {
        if (!pointInGeometry(latlng.lng, latlng.lat, feature.geometry)) return;
        matches.push({
          label: def.label,
          name: kumamotoCategoryName(feature.properties, def.clickCategoryFields || []),
          properties: feature.properties || {},
        });
      });
      return;
    }

    def._layer.eachLayer((fl) => {
      const feature = fl.feature;
      if (!feature) return;
      if (def._hiddenItems && def._hiddenItems.has(kumamotoItemName(def, feature))) return;
      if (!pointInGeometry(latlng.lng, latlng.lat, feature.geometry)) return;
      matches.push({
        label: def.label,
        name: kumamotoCategoryName(feature.properties, def.categoryFields),
        properties: feature.properties || {},
      });
    });
  });
  return matches;
}

// ---- クリックしたときに出す表の作り方 ----
// 元データの属性名は英語なので、日本語の見出しに直して表示する。
// ここに無い項目は、元データの名前のまま出す（勝手に意味を決めない）。
const KUMAMOTO_FIELD_LABELS = {
  Pref: "都道府県",
  Cityname: "市町村",
  Citycode: "市町村コード",
  AreaType: "種別",
  AreaCode: "種別コード",
  DistType: "種別",
  DistCode: "種別コード",
  DistName: "地区名",
  TokeiType: "種別",
  TokeiCode: "種別コード",
  TokeiName: "名称",
  DouroType: "種別",
  DouroCode: "種別コード",
  ParkType: "種別",
  ParkCode: "種別コード",
  ParkName: "名称",
  YoutoName: "用途地域",
  YoutoCode: "用途地域コード",
  FAR: "容積率",
  BCR: "建ぺい率",
  FNDate: "決定年月日",
  FNNumber: "告示番号",
  // 地区計画の統合データで増えた項目。区域データの出どころを1地区ずつ示す
  AreaHa: "面積(ha)",
  GeomSource: "区域データの出所",
  GeomSourceDoc: "出典資料",
  GeomNote: "注記",
  GeomAccuracy: "精度",
};

// 「%」を付けて読みやすくする項目
const KUMAMOTO_PERCENT_FIELDS = new Set(["FAR", "BCR"]);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// クリック地点に当たった区域を、レイヤーごとの表にして返す
function kumamotoPopupHtml(matches) {
  if (!matches.length) return "";
  return matches
    .map((m) => {
      const heading = m.name ? `${m.label}: ${m.name}` : m.label;
      const rows = Object.entries(m.properties)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => {
          const label = KUMAMOTO_FIELD_LABELS[k] || k;
          const value = KUMAMOTO_PERCENT_FIELDS.has(k) ? `${v}%` : v;
          return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
        })
        .join("");
      return (
        `<div class="popup-section">` +
        `<div class="popup-section-title">${escapeHtml(heading)}</div>` +
        (rows ? `<table class="popup-table">${rows}</table>` : "") +
        `</div>`
      );
    })
    .join("");
}

// ============================================================
// 凡例(右下)。チェック中の都市計画レイヤーだけを載せる。
// ============================================================
let legendBody = null;      // 凡例の中身(折り畳み対象)
let legendContainer = null; // 凡例全体
let legendCollapsed = false;
let legendMap = null;

function buildLegendSection(def) {
  const section = document.createElement("div");
  section.className = "legend-section";

  const title = document.createElement("div");
  title.className = "legend-section-title";
  title.textContent = def.label;
  section.appendChild(title);

  def._itemNames.forEach((itemName) => {
    const row = document.createElement("label");
    row.className = "legend-item";

    // 表示/非表示のチェック
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !def._hiddenItems.has(itemName);
    checkbox.addEventListener("change", () => {
      setKumamotoItemVisible(def, itemName, checkbox.checked);
    });

    // 色見本。地図の見た目(べた塗り/斜線ハッチ/点線枠/枠線/線)に合わせて描く。
    // 色は地図と同じ resolveKumamotoColors から取るので、設定で変えると見本も一緒に変わる
    const { color: strokeColor, fillColor } = resolveKumamotoColors(def, itemName);
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.borderColor = strokeColor;

    if (def.hatch) {
      // 地図と同じ「縁だけ斜線」を小さな見本でも再現する。
      // CSSの角度は、45deg で右下がり「\」、-45deg で右上がり「/」になる
      // (グラデーションの軸と縞は直角の関係にあるため、見た目は逆向きになる)。
      const angle = (def.hatchDir === "\\") ? "45deg" : "-45deg";
      swatch.classList.add("legend-swatch-frame");
      swatch.style.background =
        `repeating-linear-gradient(${angle}, ${fillColor} 0 1.5px, transparent 1.5px 4px)`;
    } else if (def.frameOnly) {
      // 枠だけ(公園=実線の枠、特別用途地区=点線の枠)
      swatch.style.background = "transparent";
      swatch.style.borderStyle = def.dashArray ? "dotted" : "solid";
      swatch.style.borderColor = strokeColor;
    } else if (def.fillOpacity === 0) {
      // 線だけのレイヤー(都市計画区域の境界・都市計画道路)
      swatch.style.background = strokeColor;
    } else {
      swatch.style.background = fillColor;
    }

    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = itemName === "__all__" ? "(全体)" : itemName;

    row.appendChild(checkbox);
    row.appendChild(swatch);
    row.appendChild(name);
    section.appendChild(row);
  });

  // 用途地域には公式凡例の注記を添える（容積率・建ぺい率の丸印の読み方もここ）
  if (def.key === "youto_chiiki") {
    const notes = document.createElement("div");
    notes.className = "legend-notes";
    YOUTO_LEGEND_NOTES.forEach((note) => {
      const line = document.createElement("div");
      line.className = "legend-note";
      const mark = document.createElement("span");
      mark.className = "legend-note-mark";
      mark.textContent = note.mark;
      line.appendChild(mark);
      line.appendChild(buildLegendNoteBody(note.text));
      notes.appendChild(line);
    });
    section.appendChild(notes);
  }

  return section;
}

// 凡例を作り直す(レイヤーのON/OFFのたびに呼ぶ)
function rebuildKumamotoLegend() {
  if (!legendBody) return;
  legendBody.innerHTML = "";
  let count = 0;
  KUMAMOTO_LAYER_DEFS.forEach((def) => {
    if (!def._layer || !legendMap.hasLayer(def._layer)) return;
    legendBody.appendChild(buildLegendSection(def));
    count++;
  });
  // 表示中の都市計画レイヤーが1つもなければ凡例ごと隠す
  legendContainer.style.display = count > 0 ? "block" : "none";
}

// 凡例パネルをLeafletのコントロール(右下)として作る
function initKumamotoLegend(map) {
  legendMap = map;
  const LegendControl = L.Control.extend({
    onAdd() {
      legendContainer = L.DomUtil.create("div", "legend-panel");
      L.DomEvent.disableClickPropagation(legendContainer);
      L.DomEvent.disableScrollPropagation(legendContainer);

      const header = L.DomUtil.create("div", "legend-header", legendContainer);
      const titleSpan = document.createElement("span");
      titleSpan.textContent = "凡例";
      const toggleSpan = document.createElement("span");
      toggleSpan.className = "legend-toggle";
      toggleSpan.textContent = "▼";
      header.appendChild(titleSpan);
      header.appendChild(toggleSpan);

      legendBody = L.DomUtil.create("div", "legend-body", legendContainer);

      // ヘッダーをクリックすると折り畳み
      header.addEventListener("click", () => {
        legendCollapsed = !legendCollapsed;
        legendBody.style.display = legendCollapsed ? "none" : "block";
        toggleSpan.textContent = legendCollapsed ? "▲" : "▼";
      });

      legendContainer.style.display = "none"; // 最初は何もないので隠す
      return legendContainer;
    },
  });
  new LegendControl({ position: "bottomright" }).addTo(map);

  // 都市計画レイヤーが地図に足されたり消えたりしたら凡例を作り直す
  map.on("layeradd layerremove", (e) => {
    if (KUMAMOTO_LAYER_DEFS.some((def) => def._layer === e.layer)) {
      rebuildKumamotoLegend();
    }
  });
}
