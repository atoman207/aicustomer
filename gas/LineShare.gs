/**
 * @OnlyCurrentDoc
 *
 * 受付一覧 → LINE 共有（一畳屋 AI相談）
 *
 * 【使い方】
 *  1. 「受付一覧」のタブで、共有したい受付の行を選ぶ（行のどのセルでも可。複数の行も可）
 *  2. メニューの「LINE共有」→「選択した受付をLINE用にコピー」（シートに置いた「LINE共有」ボタンでも可）
 *  3. 表示された画面で「コピー」を押し、LINE の担当店舗・営業担当のトークに貼り付けて送信
 *  4. 引き継いだら「連絡済にする」を押す（対応状況が「連絡済」になります）
 *
 * 【設定（最初に 1 回だけ）】
 *  1. スプレッドシートの「拡張機能」→「Apps Script」を開く
 *  2. 左の「ファイル」の「＋」→「スクリプト」で「LineShare」を作り、このコードを全部貼り付けて保存
 *     （すでに onOpen という関数があるときは、その中に lineShareAddMenu(); の 1 行を足し、下の onOpen は消す）
 *  3. スプレッドシートを再読み込みすると、メニューに「LINE共有」が出る
 *  4. 初めて使うときだけ、Google の権限の確認が出る →「続行」→ ご自分のアカウント →「許可」
 *     （「Google で確認されていません」と出たら「詳細」→「（プロジェクト名）に移動」。このスプレッドシートの中だけで動きます）
 *  （任意）ボタンを置く：「挿入」→「図形描画」でボタンを作って保存 → ボタンの「︙」→「スクリプトを割り当て」に lineShareSelected と入力
 *
 * 共有する文は管理画面の「LINE共有」と同じ（src/lib/line-share.ts）。変えるときは両方を直す
 *
 * 【連絡済の行を隠す】（一畳屋様のご要望 2026-10-30「連絡済の行がボタン一つで隠れるようにする」）
 *  ・「受付一覧」の 1 行目の右の「連絡済を隠す」の横のチェックボックスを入れる → 連絡済の行が隠れる／外す → すべて表示
 *    （スマホのスプレッドシートのアプリでも使えます）
 *  ・メニューの「LINE共有」→「連絡済を隠す」「すべて表示」でも同じ
 *  ・隠すのはフィルタ（行は消えません）。隠している間に対応状況を「連絡済」にした行も、すぐ隠れます
 *  ・（任意）図形描画のボタンにする：スクリプトの割り当てに receptionToggleContacted と入力
 *  ※すでに onEdit という関数があるときは、その中に receptionOnEdit_(e); と fixesOnEdit_(e); の 2 行を足し、下の onEdit は消してください
 *
 * 【修正点など：修正済みの行を紫にする】（一畳屋様のご要望 2026-11-02「修正したエラーの行を紫にして、チェックを付ける」）
 *  ・「修正点など」のタブで、項目（A 列）の右のセル（B 列）が「✓」か「修正済」で始まると、その行が紫になります
 *    （「修正済み」とだけ書いたときは、頭に ✓ が付きます）。B 列を消す・書き換えると、紫は消えます（ほかの色はそのまま）
 *  ・修正できなかった項目は、B 列に理由を赤い字で書きます（紫にはなりません）
 *  ・メニューの「修正点など」→「修正済みの行を紫にする（✓）」で、タブ全体をまとめてそろえ直せます
 *  ※すでに onOpen という関数があるときは、その中に fixesAddMenu(); の 1 行も足してください
 */

var LINE_SHARE_MAX = 10;
var LINE_SHARE_EMPTY = "（未入力）";
// 11 項目に整理する前（2026-10-28 まで）の見出し
var LINE_SHARE_LEGACY = { "対応状況": "ステータス", "相談内容（AI要約）": "相談内容（AI要約・お客様確認済み）" };

// 連絡済の行を隠すチェックボックスの見出し（受付一覧の 1 行目。この文字の右のセルがチェックボックス）
var RECEPTION_HIDE_LABEL = "連絡済を隠す";
var RECEPTION_TAB = "受付一覧";

// 修正点など：修正済みの行の色（紫）と、頭に付ける印
var FIXES_TAB = "修正点など";
var FIXES_DONE_COLOR = "#d9c2f0";
var FIXES_MARK = "✓";

function onOpen() {
  lineShareAddMenu();
  fixesAddMenu();
}

function onEdit(e) {
  receptionOnEdit_(e);
  fixesOnEdit_(e);
}

function lineShareAddMenu() {
  SpreadsheetApp.getUi()
    .createMenu("LINE共有")
    .addItem("選択した受付をLINE用にコピー", "lineShareSelected")
    .addSeparator()
    .addItem("連絡済を隠す", "receptionHideContacted")
    .addItem("すべて表示", "receptionShowAll")
    .addToUi();
}

// ---------------- 修正点など：修正済みの行を紫にして ✓ を付ける ----------------

function fixesAddMenu() {
  SpreadsheetApp.getUi().createMenu("修正点など").addItem("修正済みの行を紫にする（✓）", "fixesMarkAll").addToUi();
}

/** B 列の文が「✓」か「修正済」で始まる＝修正済み */
function fixesIsDone_(text) {
  return /^\s*(?:[✓✔☑]|修正済)/.test(String(text));
}

/** 1 行をそろえる：修正済みなら紫にして ✓ を付ける。修正済みでなければ、この仕組みで付けた紫だけ消す */
function fixesMarkRow_(sheet, row) {
  var width = Math.max(2, sheet.getLastColumn());
  var range = sheet.getRange(row, 1, 1, width);
  var cell = sheet.getRange(row, 2);
  var text = String(cell.getDisplayValue());
  if (fixesIsDone_(text)) {
    if (!/^\s*[✓✔☑]/.test(text)) cell.setValue(FIXES_MARK + " " + text.trim());
    range.setBackground(FIXES_DONE_COLOR);
    return;
  }
  var bgs = range.getBackgrounds();
  var changed = false;
  for (var i = 0; i < bgs[0].length; i++) {
    if (String(bgs[0][i]).toLowerCase() === FIXES_DONE_COLOR) {
      bgs[0][i] = null;
      changed = true;
    }
  }
  if (changed) range.setBackgrounds(bgs);
}

/** 修正点などの B 列（か A 列）を書き換えたとき（シンプルトリガー onEdit から） */
function fixesOnEdit_(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== FIXES_TAB) return;
  if (e.range.getColumn() > 2) return;
  for (var r = e.range.getRow(); r <= e.range.getLastRow(); r++) fixesMarkRow_(sheet, r);
}

/** メニュー：修正点などのタブ全体をそろえ直す */
function fixesMarkAll() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FIXES_TAB);
  if (!sheet) {
    SpreadsheetApp.getUi().alert("「" + FIXES_TAB + "」のタブが見つかりません");
    return;
  }
  var last = sheet.getLastRow();
  if (last < 1) return;
  var values = sheet.getRange(1, 1, last, 2).getDisplayValues();
  var done = 0;
  for (var r = 0; r < values.length; r++) {
    if (!String(values[r][0]).trim() && !String(values[r][1]).trim()) continue;
    fixesMarkRow_(sheet, r + 1);
    if (fixesIsDone_(values[r][1])) done++;
  }
  SpreadsheetApp.getActiveSpreadsheet().toast("修正済みの行：" + done + " 行を紫にしました", FIXES_TAB, 5);
}

// ---------------- 連絡済の行を隠す・すべて表示 ----------------

function receptionSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(RECEPTION_TAB) || ss.getActiveSheet();
}

/** 1 行目の「連絡済を隠す」の右のセル（チェックボックス）。なければ null */
function receptionToggleCell_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  var head = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  for (var i = 0; i < head.length; i++) {
    if (String(head[i]).trim() === RECEPTION_HIDE_LABEL) return sheet.getRange(1, i + 2);
  }
  return null;
}

/** 連絡済の行を隠す（hide=true）・すべて表示（false）。フィルタで隠す（行は消さない） */
function receptionApplyHide_(sheet, hide) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var cols = lineShareColumns_(sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]);
  if (cols.status < 0) return;
  // フィルタをかけるのは受付の欄（見出しのある欄）だけ。「連絡済を隠す」のチェックボックスの欄は入れない
  var known = [cols.status, cols.id, cols.name, cols.address, cols.phone, cols.summary].concat(cols.dates);
  var width = Math.max.apply(null, known) + 1;
  var filter = sheet.getFilter();
  if (!filter) {
    if (!hide) return;
    filter = sheet.getRange(1, 1, sheet.getMaxRows(), width).createFilter();
  }
  if (!hide) {
    filter.removeColumnFilterCriteria(cols.status + 1);
    return;
  }
  // 隠す値：「連絡済」と、整理前の「連絡済み」「日程確定」「完了」
  var hidden = ["連絡済"];
  if (sheet.getLastRow() >= 2) {
    sheet
      .getRange(2, cols.status + 1, sheet.getLastRow() - 1, 1)
      .getDisplayValues()
      .forEach(function (r) {
        var v = String(r[0]).trim();
        if (/^(連絡済|日程確定|完了)/.test(v) && hidden.indexOf(v) < 0) hidden.push(v);
      });
  }
  filter.setColumnFilterCriteria(cols.status + 1, SpreadsheetApp.newFilterCriteria().setHiddenValues(hidden).build());
}

/** チェックボックス・対応状況を変えたとき（シンプルトリガー onEdit から） */
function receptionOnEdit_(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== RECEPTION_TAB) return;
  var toggle = receptionToggleCell_(sheet);
  if (!toggle) return;
  var r = e.range;
  if (r.getRow() === toggle.getRow() && r.getColumn() === toggle.getColumn()) {
    receptionApplyHide_(sheet, toggle.getValue() === true);
    return;
  }
  // 隠している間に対応状況を変えた：フィルタをかけ直して、連絡済にした行もすぐ隠す
  if (toggle.getValue() !== true || r.getRow() < 2) return;
  var cols = lineShareColumns_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]);
  if (cols.status >= 0 && r.getColumn() <= cols.status + 1 && r.getLastColumn() >= cols.status + 1) receptionApplyHide_(sheet, true);
}

/** メニュー：連絡済を隠す */
function receptionHideContacted() {
  var sheet = receptionSheet_();
  receptionApplyHide_(sheet, true);
  var toggle = receptionToggleCell_(sheet);
  if (toggle) toggle.setValue(true);
}

/** メニュー：すべて表示 */
function receptionShowAll() {
  var sheet = receptionSheet_();
  receptionApplyHide_(sheet, false);
  var toggle = receptionToggleCell_(sheet);
  if (toggle) toggle.setValue(false);
}

/** 図形描画のボタン用：隠す・すべて表示を切り替える */
function receptionToggleContacted() {
  var sheet = receptionSheet_();
  var toggle = receptionToggleCell_(sheet);
  var hide = toggle ? toggle.getValue() !== true : true;
  receptionApplyHide_(sheet, hide);
  if (toggle) toggle.setValue(hide);
}

/** 見出し行 → 列の位置（0 始まり。ない列は -1） */
function lineShareColumns_(head) {
  var names = head.map(function (c) {
    return String(c).trim();
  });
  var find = function (h) {
    var at = names.indexOf(h);
    if (at < 0 && LINE_SHARE_LEGACY[h]) at = names.indexOf(LINE_SHARE_LEGACY[h]);
    return at;
  };
  return {
    status: find("対応状況"),
    id: find("受付番号"),
    name: find("氏名"),
    address: find("住所"),
    phone: find("電話番号"),
    summary: find("相談内容（AI要約）"),
    dates: [find("第1希望"), find("第2希望"), find("第3希望")],
  };
}

function lineShareRecord_(row, cols) {
  var cell = function (i) {
    return i >= 0 && row[i] != null ? String(row[i]) : "";
  };
  return {
    id: cell(cols.id).trim(),
    name: cell(cols.name),
    address: cell(cols.address),
    phone: cell(cols.phone),
    summary: cell(cols.summary),
    preferredDates: cols.dates.map(cell),
  };
}

/** LINE に送る文（src/lib/line-share.ts の lineShareText と同じ） */
function lineShareText(e) {
  var v = function (s) {
    return String(s == null ? "" : s).trim() || LINE_SHARE_EMPTY;
  };
  var name = String(e.name == null ? "" : e.name).trim();
  var dates = (e.preferredDates || [])
    .map(function (d) {
      return String(d == null ? "" : d).trim();
    })
    .filter(function (d) {
      return d;
    });
  var lines = [
    "【見積依頼】受付番号：" + v(e.id),
    "お名前：" + (name ? (/様$/.test(name) ? name : name + " 様") : LINE_SHARE_EMPTY),
    "ご住所：" + v(e.address),
    "電話番号：" + v(e.phone),
    "ご相談内容：" + v(e.summary),
  ];
  if (dates.length) {
    lines.push(
      ["訪問希望日："]
        .concat(
          dates.map(function (d, i) {
            return "・第" + (i + 1) + "希望 " + d;
          }),
        )
        .join("\n"),
    );
  } else {
    lines.push("訪問希望日：" + LINE_SHARE_EMPTY);
  }
  return lines.join("\n");
}

/** メニュー・ボタン：選んだ行の受付を、LINE に貼り付ける文にして表示する */
function lineShareSelected() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var values = lastRow > 0 && lastCol > 0 ? sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];
  var cols = lineShareColumns_(values[0] || []);
  if (cols.id < 0) {
    ui.alert("LINE共有", "「受付一覧」のタブで、共有したい受付の行を選んでから、もう一度お試しください。", ui.ButtonSet.OK);
    return;
  }
  var rows = [];
  var list = sheet.getActiveRangeList();
  var ranges = list ? list.getRanges() : [];
  for (var k = 0; k < ranges.length && rows.length <= LINE_SHARE_MAX; k++) {
    for (var n = Math.max(ranges[k].getRow(), 2); n <= Math.min(ranges[k].getLastRow(), lastRow) && rows.length <= LINE_SHARE_MAX; n++) {
      if (rows.indexOf(n) >= 0 || !String(values[n - 1][cols.id] || "").trim()) continue;
      // フィルタや非表示で隠れている行は、範囲で選んでいても共有しない
      if (sheet.isRowHiddenByFilter(n) || sheet.isRowHiddenByUser(n)) continue;
      rows.push(n);
    }
  }
  if (!rows.length) {
    ui.alert("LINE共有", "共有したい受付の行（2 行目から下の、受付番号がある行）を選んでから、もう一度お試しください。", ui.ButtonSet.OK);
    return;
  }
  if (rows.length > LINE_SHARE_MAX) {
    ui.alert("LINE共有", "一度に共有できるのは " + LINE_SHARE_MAX + " 件までです。行を選び直してください。", ui.ButtonSet.OK);
    return;
  }
  rows.sort(function (a, b) {
    return a - b;
  });
  var records = rows.map(function (r) {
    return lineShareRecord_(values[r - 1], cols);
  });
  var text = records.map(lineShareText).join("\n\n");
  var ids = records.map(function (r) {
    return r.id;
  });
  var html = HtmlService.createHtmlOutput(lineShareHtml_(text, ids, sheet.getSheetId(), cols.status >= 0))
    .setWidth(480)
    .setHeight(470);
  ui.showModalDialog(html, records.length > 1 ? "LINE共有（" + records.length + " 件）" : "LINE共有");
}

/** 画面の「連絡済にする」：受付番号で行を探して、対応状況を「連絡済」にする（画面を開いたあとに並べ替えても正しい行に書く） */
function lineShareMarkContacted(sheetId, ids) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheets()
    .filter(function (s) {
      return s.getSheetId() === sheetId;
    })[0];
  if (!sheet) throw new Error("受付一覧のタブが見つかりません");
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return 0;
  var values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var cols = lineShareColumns_(values[0]);
  if (cols.status < 0 || cols.id < 0) throw new Error("「対応状況」または「受付番号」の列が見つかりません");
  var done = 0;
  for (var n = 2; n <= lastRow; n++) {
    if (ids.indexOf(String(values[n - 1][cols.id] || "").trim()) < 0) continue;
    sheet.getRange(n, cols.status + 1).setValue("連絡済");
    done++;
  }
  return done;
}

function lineShareHtml_(text, ids, sheetId, canMark) {
  // お客様の入力をそのまま画面に書かない（< を逃がした JSON で渡し、textarea の値として入れる）
  var data = JSON.stringify({ text: text, ids: ids, sheetId: sheetId, canMark: canMark }).replace(/</g, "\\u003c");
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_top"><style>' +
    "body{font-family:'Noto Sans JP',sans-serif;margin:0;padding:4px 2px;color:#222;font-size:13px}" +
    "p{margin:0 0 8px;line-height:1.6}" +
    "textarea{box-sizing:border-box;width:100%;height:290px;padding:10px;border:1px solid #ccc;border-radius:8px;font:inherit;font-size:14px;line-height:1.6;resize:none}" +
    ".row{display:flex;gap:8px;margin-top:10px}" +
    "button{flex:1;padding:10px 0;border-radius:8px;border:1px solid #bbb;background:#fff;font:inherit;font-size:14px;cursor:pointer}" +
    "button.primary{background:#06c755;border-color:#06c755;color:#fff;font-weight:bold}" +
    "button:disabled{opacity:.5;cursor:default}" +
    "#msg{min-height:1.6em;margin-top:8px;font-weight:bold;color:#0a7a3a}#msg.ng{color:#b3261e}" +
    "</style></head><body>" +
    "<p>「コピー」を押して、LINE のトークに貼り付けてください。</p>" +
    '<textarea id="t" readonly aria-label="LINE に送る文"></textarea>' +
    '<div class="row"><button id="copy" class="primary">コピー</button><button id="mark">連絡済にする</button><button id="close">閉じる</button></div>' +
    '<p id="msg" role="status"></p>' +
    "<script>var D=" +
    data +
    ";" +
    'var t=document.getElementById("t"),msg=document.getElementById("msg"),mark=document.getElementById("mark");' +
    "t.value=D.text;t.focus();t.select();" +
    'function say(s,ng){msg.textContent=s;msg.className=ng?"ng":"";}' +
    'document.getElementById("copy").onclick=function(){' +
    "var done=function(){say(\"コピーしました。LINE のトークに貼り付けて送信してください。\");};" +
    "var fail=function(){t.focus();t.select();say(\"コピーできませんでした。文が選ばれた状態で Ctrl+C（Mac は ⌘+C）を押してください。\",true);};" +
    "t.focus();t.select();var ok=false;try{ok=document.execCommand(\"copy\");}catch(e){}" +
    "if(ok){done();return;}" +
    "if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(D.text).then(done,fail);}else{fail();}};" +
    'if(!D.canMark){mark.style.display="none";}' +
    "mark.onclick=function(){mark.disabled=true;say(\"記録しています…\");" +
    "google.script.run.withSuccessHandler(function(n){say(\"対応状況を「連絡済」にしました（\"+n+\" 件）。\");})" +
    ".withFailureHandler(function(e){mark.disabled=false;say(\"連絡済にできませんでした：\"+((e&&e.message)||e),true);})" +
    ".lineShareMarkContacted(D.sheetId,D.ids);};" +
    'document.getElementById("close").onclick=function(){google.script.host.close();};' +
    "</script></body></html>"
  );
}
