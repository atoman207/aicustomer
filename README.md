# AI顧客相談・電話受付システム（デモ）

熊本県で畳・襖・障子・網戸・住宅リフォームを行う会社向けの、AI による問い合わせ・見積受付システムです。
**テキスト相談・音声相談・AI電話受付の3窓口**を、Googleスプレッドシートの**共通ナレッジ 1 シート**で動かし、
見積依頼は**お客様の確認を経て**スプレッドシートに一元記録します。

| 窓口 | URL | 技術 |
| --- | --- | --- |
| ① テキストAI相談 | `/chat` | OpenAI Chat Completions（ストリーミング）＋ ハイブリッド検索（埋め込み＋キーワード） |
| ② 音声AI相談 | `/voice` | OpenAI Realtime API（WebRTC・semantic VAD・割り込み対応）＋ function calling |
| ③ AI電話受付 | `/phone` ＋ Twilio Webhook | Twilio `<Gather input="speech">` ＋ 構造化出力エージェント。ブラウザ上の通話シミュレーター付き |
| LINE 見積受付 | `/api/line/webhook` | LINE Messaging API（③と同じ受付エージェント） |
| 管理画面 | `/admin` | 受付一覧・会話履歴・AI／人間切替・営業時間・ナレッジ・接続状況 |

**OpenAI API キーが未設定でも全画面が動作します**（デモモード：ナレッジのキーワード検索によるテンプレート応答、ブラウザ音声認識・合成）。
`.env` に `OPENAI_API_KEY` を入れて再起動すると、同じ画面がそのまま本番の AI 応答に切り替わります。

---

## 1. クイックスタート

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
# .env の OPENAI_API_KEY を設定（未設定でもデモモードで動作）
npm run dev                  # http://localhost:3000
```

本番ビルド:

```bash
npm run build
npm start
```

疎通テスト（サーバー起動中に別ターミナルで）:

```bash
npm run smoke
```

---

## 1.5 Vercel へのデプロイ

GitHub リポジトリを Vercel にインポートするだけでビルド・デプロイできます（追加設定なしで `next build` が通ります）。公開後は以下を推奨します。

| 設定 | 目的 |
| --- | --- |
| `OPENAI_API_KEY` | AI 応答・音声・要約（未設定時はデモモード） |
| `ADMIN_PASSWORD` | **公開 URL では必須。** 管理画面（受付一覧＝お客様情報、AI／人間切替）を保護 |
| `PUBLIC_BASE_URL` | `https://<your-app>.vercel.app`。Twilio/LINE の署名検証と OGP に使用 |
| Storage › **Upstash Redis** | 受付・会話・設定・会話セッションの永続化。追加すると `UPSTASH_REDIS_REST_URL/TOKEN` が自動設定されます |
| `GAS_WEBHOOK_URL` | ナレッジの読み取りと受付のスプレッドシート記録（§3） |

**サーバーレスでの保存について**：Vercel ではファイル書き込みが一時的（インスタンスごとの `/tmp`）です。Redis 未設定でも次の工夫で動作しますが、受付一覧・会話履歴・管理画面の設定変更は再デプロイやスリープで消えます。

- ブラウザの電話シミュレーター／音声相談（デモモード）は会話セッションをクライアントと往復させるため、インスタンスが変わっても途切れません
- Twilio の電話受付は通話ごとの Cookie に会話状態を圧縮して持たせるため、Redis なしでも 1 通話内の状態が保たれます
- LINE と管理画面の設定・受付一覧の永続化には Upstash Redis（無料枠あり）の接続を推奨します。受付そのものは `GAS_WEBHOOK_URL` を設定すればスプレッドシートに必ず記録されます

管理画面の「接続状況」タブに、現在の保存先（Redis／ファイル／一時保存）が表示されます。

---

## 2. 環境変数（`.env.example` 参照）

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 推奨 | 未設定時はデモモード |
| `OPENAI_CHAT_MODEL` | | 既定 `gpt-4.1-mini`（テキスト相談・電話・LINE・要約） |
| `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` | | 既定 `gpt-realtime` / `marin`（音声相談） |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | | 既定 `gpt-4o-mini-tts` / `coral`（電話シミュレーターの読み上げ） |
| `OPENAI_EMBEDDING_MODEL` | | 既定 `text-embedding-3-small`（ナレッジ検索） |
| `GAS_WEBHOOK_URL` | ナレッジ連携 A | `gas/Code.gs` をデプロイした URL（読み書き両対応・推奨） |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `KNOWLEDGE_SHEET_ID` | ナレッジ連携 B | Sheets API を直接利用 |
| `KNOWLEDGE_SHEET_CSV_URL` | ナレッジ連携 C | 「ウェブに公開」した CSV の URL（読み取り専用） |
| `KNOWLEDGE_SHEET_NAME` | | 既定 `AI回答用`（回答根拠にする **1 シート**の名前） |
| `KNOWLEDGE_CACHE_SECONDS` | | 既定 60（シート更新の反映間隔） |
| `RECEPTION_SHEET_ID` / `RECEPTION_SHEET_NAME` | | 受付記録先（既定シート名 `受付一覧`） |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | 電話 | 署名検証・発信者番号 |
| `TWILIO_TTS_VOICE` | | 既定 `Polly.Mizuki`（`Polly.Takumi-Neural`, `Google.ja-JP-Neural2-B` なども可） |
| `STAFF_FORWARD_NUMBER` | 電話 | 営業時間内の転送先（管理画面でも変更可） |
| `PUBLIC_BASE_URL` | 電話/LINE | 公開 URL（Webhook 署名検証に使用） |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | LINE | Messaging API |
| `NEXT_PUBLIC_LINE_ADD_FRIEND_URL` | | 「LINEで見積依頼」ボタンの遷移先 |
| `ADMIN_PASSWORD` | 推奨 | 管理画面の保護（未設定時は誰でも閲覧可。公開 URL では必ず設定） |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Vercel 推奨 | アプリ内データ（受付・会話・設定・セッション）の永続化。旧 `KV_REST_API_URL/TOKEN` も可 |
| `OPENAI_BASE_URL` | | 互換 API／プロキシ／モック用（既定 `https://api.openai.com/v1`） |
| `COMPANY_NAME` / `COMPANY_PHONE` | | 会社名・0120 番号（管理画面でも変更可） |

ナレッジ連携は **A（GAS）→ B（Sheets API）→ C（CSV）→ ローカルのサンプル** の優先順で自動選択されます。

---

## 3. ナレッジシート（社内総合マニュアル › 指定 1 シート）

| A | B | C | D | E |
| --- | --- | --- | --- | --- |
| カテゴリ | 項目（質問） | 内容（回答） | キーワード（読点区切り） | 備考 |
| 畳 | 畳の料金目安 | 表替え：国産い草 8,800円〜 … | 料金、価格、いくら | |

- 1 行目は見出し行。列名は「カテゴリ／質問・項目／回答・内容／キーワード／備考」を含んでいれば順不同で認識します。
- AI は **このシートの内容だけ**を根拠に回答し、記載のない質問は推測せず「担当者より折り返し」を案内します（`src/lib/prompts.ts`）。
- 更新は `KNOWLEDGE_CACHE_SECONDS`（既定 60 秒）以内に 3 窓口すべてへ反映。管理画面の「シートから再読み込み」で即時反映できます。
- シート未接続時は `data/seed/knowledge.json`（38 件のサンプル）を使用し、管理画面から編集できます。

### GAS（Google Apps Script）のセットアップ（推奨・最も簡単）

1. 「社内総合マニュアル」を開き、**拡張機能 › Apps Script** に `gas/Code.gs` を貼り付け
2. `KNOWLEDGE_SHEET_DEFAULT`（回答用シート名）/ `RECEPTION_SHEET_DEFAULT`（受付一覧）を確認
3. **デプロイ › 新しいデプロイ › ウェブアプリ**（実行ユーザー: 自分、アクセス: 全員）
4. 発行 URL を `.env` の `GAS_WEBHOOK_URL` に設定して再起動

これだけで、ナレッジの読み取りと受付情報の書き込み（受付一覧シートへ自動追記・見出し自動作成）が有効になります。

---

## 4. 見積受付の流れ（3 窓口共通）

1. 相談対応（ナレッジに基づく回答）
2. 見積希望 → 氏名・住所・電話番号・見積希望日（第1〜第3）・相談内容（AI 要約）を取得
3. **登録前に内容を提示し、お客様が確認・修正**
   - テキスト／音声：確認フォーム（入力 → 確認 → 完了）。`confirmed=true` でないと API が受け付けません
   - 電話／LINE：AI が全項目を復唱し「この内容でお間違いないでしょうか」→「はい」で確定
4. スプレッドシート（受付一覧）へ記録：受付日時・受付経路・氏名・住所・電話番号・確認済み相談内容・第1〜第3希望・受付番号
5. 担当者が折り返して日程確定（AI は日程を確定しません）

---

## 5. AI電話受付（Twilio）

```
お客様 → NTT 0120番号（転送設定）→ Twilio 番号 → POST /api/twilio/voice
   ├ 営業時間内 かつ「営業時間外のみAI」設定 → <Dial> スタッフ転送
   └ それ以外 → <Gather input="speech"> ⇄ POST /api/twilio/gather（AI 応答ループ）→ 受付完了で <Hangup>
```

1. Twilio で日本の番号を取得し、0120 番号の転送先に設定（0120 番号は継続利用）
2. Twilio 番号の Voice Webhook に `https://<公開URL>/api/twilio/voice`、Status Callback に `/api/twilio/status`
3. `.env` に Twilio 各種・`STAFF_FORWARD_NUMBER`・`PUBLIC_BASE_URL` を設定
4. 管理画面「電話・営業時間」で **常時AI／営業時間外のみAI／常にスタッフ** を切替、営業時間・休業日・転送先を設定

ブラウザの `/phone` ページは同じ応答エンジン（`src/lib/agent.ts`）を使う通話シミュレーターです。Twilio 未設定でも電話フロー全体（相談 → 聞き取り → 復唱確認 → 登録）を試せます。

> さらに自然な電話会話（Realtime API × Twilio Media Streams）は WebSocket サーバーが必要なため、本デモでは Gather 方式を採用しています。応答ロジックは共通のため、将来の差し替えが可能です。

---

## 6. LINE Messaging API

1. LINE Developers で Messaging API チャネルを作成
2. Webhook URL に `https://<公開URL>/api/line/webhook` を設定し、Webhook を有効化
3. `.env` に `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `NEXT_PUBLIC_LINE_ADD_FRIEND_URL`

友だち追加時に挨拶、テキストで相談対応、「見積を依頼したい」で受付フロー（復唱確認付き）へ。クイックリプライで確認・修正を選べます。

---

## 7. 管理画面（`/admin`）

- **受付一覧**：3 窓口＋LINE の受付を検索・絞り込み・ステータス変更・CSV 出力
- **会話履歴**：全窓口の会話ログを閲覧
- **電話・営業時間**：AI／人間の切替、営業日・時間、休業日、転送先、会社名、第一声
- **ナレッジ**：情報源の確認、シート再読み込み、回答テスト（どのナレッジが使われるか）、ローカル編集
- **接続状況**：OpenAI・ナレッジ・記録先・Twilio・LINE の設定状況、Webhook URL のコピー

---

## 8. 構成

```
src/app                 ページと API Route（App Router）
  api/chat              テキスト相談（ストリーミング）
  api/realtime/session  音声相談用 ephemeral key（Realtime API）
  api/agent/*           電話シミュレーター／音声フォールバック用エージェント
  api/twilio/*          Twilio Webhook（voice / gather / status）
  api/line/webhook      LINE Webhook
  api/estimates         見積受付（confirmed=true 必須）
  api/knowledge/*       ナレッジ取得・再読込・検索・ローカル編集
  api/settings, status, conversations, summarize, tts, admin/login
src/lib
  knowledge.ts          シート読込（GAS / Sheets API / CSV / ローカル）・キャッシュ
  retrieval.ts          ハイブリッド検索（埋め込み＋日本語バイグラム）
  prompts.ts            ナレッジ限定の回答ルール（全窓口共通）
  agent.ts / fallback.ts 相談＋見積受付エージェント（OpenAI 構造化出力／ルールベース）
  estimates.ts          受付レコード作成とシート追記
  store.ts              JSON ストア（data/runtime）。読み取り専用環境ではメモリ動作
  openai.ts, google.ts, twiml.ts, line.ts, hours.ts
data/seed               サンプルナレッジ・サンプル受付
gas/Code.gs             スプレッドシート連携用 Apps Script
public/images           画像（すべて日本の風景・住まい）
```

---

## 9. 画像クレジット

すべて日本国内で撮影された写真です（Wikimedia Commons の CC ライセンス画像、および Unsplash License 画像）。

| 画像 | 撮影者 | ライセンス |
| --- | --- | --- |
| 石谷家住宅の和室（ヒーロー） | 663highland | CC BY 2.5 |
| 畳の修理作業 | Rosewoman | CC BY 2.0 |
| 圓徳院の襖絵 | 663highland | CC BY 2.5 |
| 雪見障子 | Tamaki Sono | CC BY 2.0 |
| 縁側のある日本家屋 | Emzett85 | CC BY-SA 3.0 |
| 高木家住宅の和室 | ignis | CC BY-SA 3.0 |
| 熊本城 | 663highland | CC BY 2.5 |
| 和室の内装 | TANAKA Juuyoh（田中十洋） | CC BY 2.0 |
| 旧三浦家住宅の障子 | LLAAYY | CC BY 4.0 |
| 縁側と庭（奥国家住宅） | Reggaeman | CC BY-SA 3.0 |
| 土岐家住宅の和室 | 妖精書士 | CC0 |
| 龍の襖絵 | Asturio Cantabrio | CC BY-SA 4.0 |
| 京都・富士山・箱根・東京などの風景 10 点 | Unsplash 投稿者 | Unsplash License |

---

## 10. 運用上の注意

- 表示される価格・工期・会社情報はすべて**デモ用サンプル**です。
- `data/runtime/` は実行時データ（受付・会話・設定）で Git 管理外です。本番ではスプレッドシートが正となります。
- Vercel 等のサーバーレス環境では §1.5 のとおり Upstash Redis と GAS 連携を設定してください。
- 公開 API（チャット・音声・要約など）には IP ごとの簡易レートリミットを設けています（1 分あたり：チャット 20 回、音声セッション 10 回など）。OpenAI への各リクエストには 15〜55 秒のタイムアウトを設定し、関数の最大実行時間は 60 秒です。
- 画像は `scripts/optimize-images.mjs` で Web 向けに再圧縮済み（合計 約5.5MB）。Next.js の画像最適化（AVIF/WebP・レスポンシブ）が有効です。
