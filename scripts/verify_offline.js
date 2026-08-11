// 庁内版の動作確認（file:// で開いたときに何が起きるかを自動で調べる）。
// ------------------------------------------------------------
// サイトそのものは使わない。確認したいときだけ、次の手順で走らせる。
//
//  1. index.html を _verify.html という名前でコピーし、いちばん下の
//     <script src="script.js"></script> のすぐ後ろに次の1行を足す
//       <script src="scripts/verify_offline.js"></script>
//  2. ヘッドレスのChromeで開き、DOMを取り出す
//       "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
//         --headless=new --disable-gpu --window-size=1400,900 ^
//         --virtual-time-budget=120000 --proxy-server=http://127.0.0.1:1 ^
//         --dump-dom file:///C:/.../05MapViewerLocal/_verify.html > dom.html
//     --proxy-server に届かない宛先を指定しておくと、
//     外部へ出ようとした瞬間に必ず失敗するので、通信の有無を確かめやすい。
//  3. dom.html の ===VERIFY-START=== から ===VERIFY-END=== までを読む
//  4. _verify.html は消す（配布物に入れない）
//
// 注意: ヘッドレスのChromeでは requestAnimationFrame が回らないため、
// 地図の「飛ぶ」動き(flyTo)は進まない。飛び先が正しいかを見るために、
// このスクリプトの中だけ flyTo を瞬間移動に差し替えている。
(function () {
  const errors = [];
  const origError = console.error;
  console.error = function (...a) { errors.push("console.error: " + a.join(" ")); origError.apply(console, a); };
  const origWarn = console.warn;
  console.warn = function (...a) { errors.push("console.warn: " + a.join(" ")); origWarn.apply(console, a); };
  window.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t !== window && t.tagName) errors.push(`load失敗: <${t.tagName.toLowerCase()}> ${t.src || t.href}`);
    else errors.push("onerror: " + (e.message || e));
  }, true);
  window.addEventListener("unhandledrejection", (e) => errors.push("未処理のreject: " + e.reason));

  const out = [];
  const say = (k, v) => out.push(k + "\t" + v);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function check(id) {
    const c = layerControls.get(id);
    if (!c) return null;
    if (!c.checkbox.checked) { c.checkbox.checked = true; await c.applyCheck(); }
    return c;
  }
  const defOf = (key) => KUMAMOTO_LAYER_DEFS.find((d) => d.key === key);
  const countOf = (key) => {
    const def = defOf(key);
    if (!def || !def._layer) return "レイヤー未読込";
    let n = 0;
    def._layer.eachLayer(() => n++);
    return n;
  };

  window.addEventListener("load", async () => {
    await sleep(1500); // restoreLayerState(初期レイヤー)の読み込み待ち

    // ---- 都市計画レイヤー ----
    await check("kumamoto-youto_chiiki");
    await check("kumamoto-chiku_keikaku");
    await check("youto-circles");
    await sleep(1200);
    say("用途地域の件数", countOf("youto_chiiki"));
    say("地区計画の件数", countOf("chiku_keikaku"));
    say("KUMAMOTO_DATAのキー数", Object.keys(window.KUMAMOTO_DATA || {}).length);

    // ---- 地区計画のクリック（吹き出しの中身が作れるか）----
    const ck = defOf("chiku_keikaku");
    let sample = null;
    ck._layer.eachLayer((l) => { if (!sample) sample = l; });
    const c0 = sample.getBounds().getCenter();
    const html = kumamotoPopupHtml(kumamotoMatchesAt(map, c0));
    say("地区計画クリックの吹き出し", html && html.length > 20 ? "出る(" + html.length + "文字)" : "出ない");

    // ---- 熊本市街地へ移動して背景タイルと丸印を見る ----
    map.setView([32.8032, 130.7079], 16, { animate: false });
    await sleep(4000);
    const imgs = [...document.querySelectorAll("#map img.leaflet-tile")];
    const real = imgs.filter((i) => i.src.indexOf("data:") !== 0);
    say("背景タイル(実画像)の枚数", real.length);
    const byz = {};
    real.forEach((i) => { const m = /fgd_tiles\/(\d+)\//.exec(i.getAttribute("src")); if (m) byz[m[1]] = (byz[m[1]] || 0) + 1; });
    say("背景タイルのズーム別枚数", JSON.stringify(byz));
    say("背景タイルの例", real.length ? real[real.length - 1].getAttribute("src") : "なし");
    say("丸印(z16)の個数", document.querySelectorAll(".youto-circle").length);

    map.setView([32.8032, 130.7079], 14, { animate: false });
    map.fire("zoomend"); map.fire("moveend");
    await sleep(3000);
    say("丸印(z14・出ないのが正しい)", document.querySelectorAll(".youto-circle").length);

    // ---- 検索 ----
    const g = searchLocal("岩倉台");
    say("検索『岩倉台』の候補数", g.length);
    say("検索『岩倉台』の先頭", g.length ? `${g[0].e.n} / ${g[0].e.k} / ${g[0].e.c}` : "なし");
    // headless Chrome では requestAnimationFrame が回らず flyTo の動きが進まない
    // （素のLeafletでも同じ）。飛び先が正しいかを見たいので、ここだけ瞬間移動に差し替える
    map.flyTo = (ll, z) => map.setView(ll, z, { animate: false });
    searchInput.value = "岩倉台";
    searchInput.dispatchEvent(new Event("input"));
    await sleep(200);
    const rows = document.querySelectorAll("#search-results .selectable");
    say("検索欄に出た候補の行数", rows.length);
    if (rows.length) {
      rows[0].click();
      await sleep(20000);
      say("飛んだ先", `${map.getCenter().lat.toFixed(4)},${map.getCenter().lng.toFixed(4)} z${map.getZoom()}`);
      say("索引が指す場所", `${g[0].e.y},${g[0].e.x} z${g[0].e.z}`);
      say("ピンの場所", searchMarker ? `${searchMarker.getLatLng().lat.toFixed(4)},${searchMarker.getLatLng().lng.toFixed(4)}` : "なし");
      say("ピン", document.querySelectorAll(".leaflet-marker-icon:not(.youto-circle-icon)").length ? "立った" : "立たない");
      document.getElementById("search-clear").click();
      await sleep(300);
      say("✕のあとのピン", document.querySelectorAll(".leaflet-marker-icon:not(.youto-circle-icon)").length ? "残っている" : "消えた");
    }
    say("検索索引の件数", (window.SEARCH_INDEX || []).length);

    // ---- 都市計画区域の外をz17まで拡大したとき（z14を引き伸ばして出るはず）----
    map.setView([32.55, 130.95], 17, { animate: false });   // 五木村あたり(区域外)
    await sleep(3000);
    const byz2 = {};
    [...document.querySelectorAll("#map img.leaflet-tile")]
      .filter((i) => i.src.indexOf("data:") !== 0)
      .forEach((i) => { const m = /fgd_tiles\/(\d+)\//.exec(i.getAttribute("src")); if (m) byz2[m[1]] = (byz2[m[1]] || 0) + 1; });
    say("区域外z17の背景タイル", JSON.stringify(byz2));

    // ---- 背景地図の切り替え（白紙）----
    baseRadioByName["白紙"].checked = true;
    baseRadioByName["白紙"].dispatchEvent(new Event("change"));
    await sleep(1000);
    say("白紙に切替後の背景名", currentBaseName);
    baseRadioByName["基盤地図情報"].checked = true;
    baseRadioByName["基盤地図情報"].dispatchEvent(new Event("change"));
    await sleep(1000);
    say("基盤地図情報に戻した", currentBaseName);

    // ---- 都市計画レイヤーを全部つけてみる（読み込めないものが無いか）----
    map.setView([32.8032, 130.7079], 13, { animate: false });
    for (const def of KUMAMOTO_LAYER_DEFS) await check("kumamoto-" + def.key);
    await sleep(4000);
    const notLoaded = KUMAMOTO_LAYER_DEFS.filter((d) => !d._layer).map((d) => d.label);
    say("都市計画レイヤーの数", KUMAMOTO_LAYER_DEFS.length);
    say("読み込めなかったレイヤー", notLoaded.length ? notLoaded.join(" , ") : "なし");
    say("読み込んだデータファイル数", Object.keys(window.KUMAMOTO_DATA || {}).length);

    // ---- 凡例 ----
    say("凡例の項目数", document.querySelectorAll(".legend-item").length);
    say("凡例の色見本の数", document.querySelectorAll(".legend-swatch").length);
    say("凡例の注記の数", document.querySelectorAll(".legend-note").length);
    const sw = document.querySelector(".legend-item .legend-swatch");
    say("凡例の先頭", sw ? `${sw.parentElement.querySelector(".legend-name").textContent} / ${sw.style.background || sw.style.backgroundColor}` : "なし");

    // ---- 外部への通信 ----
    const res = performance.getEntriesByType("resource").map((r) => r.name);
    const ext = res.filter((n) => !/^(file:|data:|blob:|about:)/.test(n));
    say("読み込んだ資源の数", res.length);
    say("外部への要求", ext.length === 0 ? "0件" : ext.length + "件: " + ext.slice(0, 10).join(" , "));

    // ---- エラー ----
    say("エラー・警告の数", errors.length);
    errors.slice(0, 25).forEach((e, i) => say("  エラー" + (i + 1), e));

    const pre = document.createElement("pre");
    pre.id = "verify-out";
    pre.textContent = "===VERIFY-START===\n" + out.join("\n") + "\n===VERIFY-END===";
    document.body.appendChild(pre);
  });
})();
