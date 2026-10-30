/**
 * AI顧客相談システム 連携用 Google Apps Script
 *
 * 【役割】
 *  - doGet  : ナレッジシート（社内総合マニュアル › 指定1シート）を JSON で返す
 *  - doPost : 受付情報（3窓口＋LINE）を受付一覧シートに記録する（新しい受付は見出しのすぐ下＝いちばん上）
 *
 * 【セットアップ】
 *  1. 「社内総合マニュアル」スプレッドシートを開き、拡張機能 › Apps Script でこのコードを貼り付け
 *  2. KNOWLEDGE_SHEET_DEFAULT / RECEPTION_SHEET_DEFAULT をシート名に合わせる
 *  3. デプロイ › 新しいデプロイ › 種類「ウェブアプリ」
 *       実行ユーザー: 自分 ／ アクセスできるユーザー: 全員
 *  4. 発行された URL を .env の GAS_WEBHOOK_URL に設定
 *
 * ナレッジシート：顧客対応マニュアルの指定1シート（例：「ＡＩ相談ソース」）。
 *   自由形式（上部に文章、下部に料金表）でも、A カテゴリ / B 項目 / C 内容 / D キーワード の表形式でも読み込めます。
 *   自由形式の見出しの判定に空行が必要なため、空行も含めた全セル（grid）を返します。
 */

var KNOWLEDGE_SHEET_DEFAULT = "ＡＩ相談ソース";
var RECEPTION_SHEET_DEFAULT = "受付一覧";

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = params.action || "knowledge";
  try {
    if (action === "knowledge") {
      var sheetName = params.sheet || KNOWLEDGE_SHEET_DEFAULT;
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
      if (!sheet) return json_({ ok: false, error: "シートが見つかりません: " + sheetName });
      var values = sheet.getDataRange().getDisplayValues();
      var rows = values.filter(function (r) {
        return r.some(function (c) {
          return String(c).trim() !== "";
        });
      });
      // grid：空行も位置を保った全セル（新しいアプリはこちらを使う）／rows：空行を除いたもの（旧版との互換）
      return json_({ ok: true, sheet: sheetName, grid: values, rows: rows, fetchedAt: new Date().toISOString() });
    }
    if (action === "ping") return json_({ ok: true, time: new Date().toISOString() });
    return json_({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var action = payload.action || "reception";
    if (action === "reception") {
      var sheetName = payload.sheet || RECEPTION_SHEET_DEFAULT;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      var header = payload.header || [];
      if (sheet.getLastRow() === 0 && header.length) {
        sheet.appendRow(header);
        sheet.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#efe6d6");
        sheet.setFrozenRows(1);
      }
      // 値は見出しで列を探して入れる（担当者が列を足したり並べ替えたりしても正しい欄に入る。11 項目に整理する前の見出しも探す）
      var legacy = { "対応状況": "ステータス", "相談内容（AI要約）": "相談内容（AI要約・お客様確認済み）" };
      var head = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(function (c) {
        return String(c).trim();
      });
      var src = payload.row || [];
      var row = src;
      if (head.indexOf("受付番号") >= 0) {
        row = head.map(function () {
          return "";
        });
        header.forEach(function (h, i) {
          var at = head.indexOf(h);
          if (at < 0 && legacy[h]) at = head.indexOf(legacy[h]);
          if (at >= 0) row[at] = src[i];
        });
      }
      // 新しい受付は見出しのすぐ下（いちばん上）に入れる（一畳屋様のご要望 2026-10-30「新しいものが上」）。
      // 値は書いたとおりの文字で（電話番号の先頭の 0 が消えないように）。書式は下の行（前の受付）と同じにする
      var width = Math.max(row.length, 1);
      if (sheet.getLastRow() >= 2) {
        sheet.insertRowBefore(2);
        if (sheet.getLastRow() >= 3) sheet.getRange(3, 1, 1, width).copyFormatToRange(sheet, 1, width, 2, 2);
      }
      var cells = sheet.getRange(2, 1, 1, width);
      cells.setNumberFormat("@");
      cells.setValues([
        row.map(function (v) {
          return v == null ? "" : String(v);
        }),
      ]);
      sheet.showRows(2);
      // 「対応状況」の欄は 2 択のプルダウン（未連絡・連絡済）
      var statusCol = head.indexOf("対応状況") + 1;
      if (statusCol > 0 && sheet.getMaxRows() > 1) {
        var options = payload.statusOptions || ["未連絡", "連絡済"];
        var rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build();
        sheet.getRange(2, statusCol, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
      }
      return json_({ ok: true, sheet: sheetName, row: 2 });
    }
    return json_({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
