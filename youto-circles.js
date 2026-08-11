// ============================================================
// 容積率・建ぺい率の丸印
// ------------------------------------------------------------
// 都市計画図の決まりに従い、用途地域の中に丸を描いて
//   上段＝容積率 / 中段＝用途地域の略称 / 下段＝建ぺい率
// と表示する。
//
// 丸を置く場所は scripts/build_kumamoto_data.py が先に計算して
// data/kumamoto/youto_circles.geojson に入れてある（区域の中で
// 境界からいちばん離れた点）。ここではそれを読んで並べるだけ。
//
// 全部で720個あるので、まとめて出すと重なって読めないうえに動作も重くなる。
// そのため「ズーム15以上」「画面に入っているもの」「区域が丸より大きいもの」
// の3つの条件で絞ってから描く。
// ============================================================

// 読むファイルは data/kumamoto/layers.json に書いてある（kumamoto.js が読む）。
// 市町を足したときにここを直し忘れる事故を防ぐため、直書きはしない。
// 一覧が無いときのために、国交省データ分だけは既定として持っておく。
const YOUTO_CIRCLE_KEY = "youto-circles";
const YOUTO_CIRCLE_FILE = "youto_circles.geojson";

// これ未満のズームでは丸を出さない（出すと重なって読めなくなる）
const YOUTO_CIRCLE_MIN_ZOOM = 15;

// 丸の直径(画面上のピクセル)。style.css の .youto-circle と合わせること
const YOUTO_CIRCLE_SIZE = 58;

let youtoCirclePoints = null;      // 読み込んだ点の一覧（一度読んだら使い回す）
let youtoCircleLoading = null;     // 読み込み中のPromise

function loadYoutoCirclePoints() {
  if (youtoCirclePoints) return Promise.resolve(youtoCirclePoints);
  if (youtoCircleLoading) return youtoCircleLoading;
  // 用途地域と同じく、国交省データ分と県が計画図から起こした追加分を
  // ファイルとして分けて持つ。どれを読むかは layers.json が決める。
  // 読み込みそのものは kumamoto.js の loadKumamotoData に任せる
  // （http:// なら fetch、file:// なら <script>。切り替えを1か所にまとめるため）
  youtoCircleLoading = loadLayersManifest()
    .then(() => {
      const files = filesForLayer({ key: YOUTO_CIRCLE_KEY, file: YOUTO_CIRCLE_FILE });
      return Promise.all(files.map(loadKumamotoData));
    })
    .then((list) => ({ features: list.flatMap((g) => g.features) }))
    .then((geojson) => {
      youtoCirclePoints = geojson.features.map((f) => ({
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        far: f.properties.FAR,
        abbr: f.properties.ABBR,
        bcr: f.properties.BCR,
        name: f.properties.YoutoName,
        // 区域の広さの目安(度)。境界までの距離が入っている
        r: f.properties.R,
      }));
      return youtoCirclePoints;
    })
    .catch((err) => {
      youtoCircleLoading = null; // 次回もう一度試せるようにする
      alert("容積率・建ぺい率の読み込みに失敗しました");
      throw err;
    });
  return youtoCircleLoading;
}

// 丸1つ分のHTMLを作る。CSSで円に切り抜き、中段の上下に線を引いて三分割する
function youtoCircleHtml(p) {
  return (
    '<div class="youto-circle">' +
    `<span class="youto-far">${p.far}</span>` +
    `<span class="youto-abbr">${p.abbr}</span>` +
    `<span class="youto-bcr">${p.bcr}</span>` +
    "</div>"
  );
}

// 画面に出す条件を満たしているかどうか
function youtoCircleFits(map, p) {
  // 区域の「境界までの距離」を画面上のピクセルに直して、丸の半径と比べる。
  // 丸が区域からはみ出すような小さい区域には出さない。
  const center = map.latLngToLayerPoint([p.lat, p.lng]);
  const edge = map.latLngToLayerPoint([p.lat + p.r, p.lng]);
  const radiusPx = Math.abs(center.y - edge.y);
  return radiusPx >= YOUTO_CIRCLE_SIZE / 2;
}

// 丸印のレイヤー本体。地図を動かすたびに、出すものを選び直す
const YoutoCircleLayer = L.LayerGroup.extend({
  initialize(points, options) {
    L.LayerGroup.prototype.initialize.call(this, [], options);
    this._points = points;
  },

  onAdd(map) {
    L.LayerGroup.prototype.onAdd.call(this, map);
    this._boundRefresh = () => this._refresh();
    map.on("moveend zoomend", this._boundRefresh);
    this._refresh();
  },

  onRemove(map) {
    map.off("moveend zoomend", this._boundRefresh);
    L.LayerGroup.prototype.onRemove.call(this, map);
  },

  _refresh() {
    const map = this._map;
    if (!map) return;
    this.clearLayers();
    if (map.getZoom() < YOUTO_CIRCLE_MIN_ZOOM) return;

    // 画面の範囲より少し広めを対象にする(端で急に出たり消えたりしないように)
    const bounds = map.getBounds().pad(0.15);
    const paneName = this.options.pane;

    this._points.forEach((p) => {
      if (!bounds.contains([p.lat, p.lng])) return;
      if (!youtoCircleFits(map, p)) return;
      const icon = L.divIcon({
        className: "youto-circle-icon",
        html: youtoCircleHtml(p),
        iconSize: [YOUTO_CIRCLE_SIZE, YOUTO_CIRCLE_SIZE],
        iconAnchor: [YOUTO_CIRCLE_SIZE / 2, YOUTO_CIRCLE_SIZE / 2],
      });
      const marker = L.marker([p.lat, p.lng], {
        icon,
        pane: paneName,
        interactive: false, // 地図のクリック(区域名の表示)を邪魔しない
        keyboard: false,
      });
      this.addLayer(marker);
    });
  },
});

// script.js から呼ぶ。点を読み込んでレイヤーを作る
function createYoutoCircleLayer(paneName) {
  return loadYoutoCirclePoints().then(
    (points) => new YoutoCircleLayer(points, { pane: paneName })
  );
}
