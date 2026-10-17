/**
 * AI顧客相談システム 連携用 Google Apps Script
 *
 * 【役割】
 *  - doGet  : ナレッジシート（社内総合マニュアル › 指定1シート）を JSON で返す
 *  - doPost : 受付情報（3窓口＋LINE）を受付一覧シートに追記する
 *
 * 【セットアップ】
 *  1. 「社内総合マニュアル」スプレッドシートを開き、拡張機能 › Apps Script でこのコードを貼り付け
 *  2. KNOWLEDGE_SHEET_DEFAULT / RECEPTION_SHEET_DEFAULT をシート名に合わせる
 *  3. デプロイ › 新しいデプロイ › 種類「ウェブアプリ」
 *       実行ユーザー: 自分 ／ アクセスできるユーザー: 全員
 *  4. 発行された URL を .env の GAS_WEBHOOK_URL に設定
 *
 * ナレッジシートの列: A カテゴリ / B 項目（質問） / C 内容（回答） / D キーワード / E 備考（1行目は見出し）
 */

var KNOWLEDGE_SHEET_DEFAULT = "AI回答用";
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
      return json_({ ok: true, sheet: sheetName, rows: rows, fetchedAt: new Date().toISOString() });
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
      if (sheet.getLastRow() === 0 && payload.header && payload.header.length) {
        sheet.appendRow(payload.header);
        sheet.getRange(1, 1, 1, payload.header.length).setFontWeight("bold").setBackground("#efe6d6");
        sheet.setFrozenRows(1);
      }
      var row = payload.row || [];
      sheet.appendRow(row);
      return json_({ ok: true, sheet: sheetName, row: sheet.getLastRow() });
    }
    return json_({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
