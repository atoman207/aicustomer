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
 */

var LINE_SHARE_MAX = 10;
var LINE_SHARE_EMPTY = "（未入力）";
// 11 項目に整理する前（2026-10-28 まで）の見出し
var LINE_SHARE_LEGACY = { "対応状況": "ステータス", "相談内容（AI要約）": "相談内容（AI要約・お客様確認済み）" };

function onOpen() {
  lineShareAddMenu();
}

function lineShareAddMenu() {
  SpreadsheetApp.getUi().createMenu("LINE共有").addItem("選択した受付をLINE用にコピー", "lineShareSelected").addToUi();
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
