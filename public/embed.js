/*!
 * 一畳屋 AI相談窓口：今のホームページに「AIに相談」ボタンを付ける
 *
 * 使い方（ホームページの </body> の直前に 1 行貼るだけ）：
 *   <script src="https://aicustomer-flax.vercel.app/embed.js" async></script>
 * 任意の設定（script タグに書く）：
 *   data-position="left"   … ボタンを左下に出す（既定は右下）
 *   data-bottom="80"       … ボタンを下から何 px 上げるか（ほかの固定ボタンと重なるとき。既定 16）
 *
 * ・ボタンを押すと、ページの上に相談の窓を開く（文字でも声でも、1 つの画面で相談できる）。スマホでは画面いっぱいに開く
 * ・窓の中身は AI相談窓口のページ（別のサイト）なので、ホームページの見た目や動きには影響しない
 * ・声で話している途中に窓を閉じると、マイクを止める（会話は残り、次に開いたときに続きから相談できる）
 * ・AI相談窓口は、許可したホームページ（EMBED_ALLOWED_ORIGINS）の中でだけ窓として開ける
 */
(function () {
  "use strict";
  if (window.__ichijoyaAiEmbed) return;
  window.__ichijoyaAiEmbed = true;

  var script = document.currentScript || document.querySelector('script[src*="/embed.js"]');
  var base;
  try {
    base = new URL(script && script.src ? script.src : "/", location.href).origin;
  } catch (e) {
    return;
  }
  var left = script && script.getAttribute("data-position") === "left";
  var bottom = Math.max(0, parseInt((script && script.getAttribute("data-bottom")) || "16", 10) || 16);

  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>';
  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_EXT =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

  var side = left ? "left" : "right";
  var css =
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:'Noto Sans JP','Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif}" +
    ".fab{position:fixed;" + side + ":16px;bottom:calc(" + bottom + "px + env(safe-area-inset-bottom));z-index:2147483000;display:flex;align-items:center;gap:8px;" +
    "padding:12px 18px 12px 14px;border:0;border-radius:999px;background:#1c4911;color:#fff;font-size:15px;font-weight:700;letter-spacing:.04em;line-height:1;" +
    "box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer;transition:transform .15s ease,background .15s ease}" +
    ".fab:hover{background:#488937;transform:translateY(-1px)}" +
    ".fab:focus-visible,.panel button:focus-visible,.panel a:focus-visible{outline:3px solid #fdd000;outline-offset:2px}" +
    ".fab small{display:block;margin-top:3px;font-size:10px;font-weight:500;letter-spacing:.08em;color:#fdd000}" +
    ".fab[aria-expanded=true]{display:none}" +
    ".panel{position:fixed;" + side + ":16px;bottom:calc(" + bottom + "px + env(safe-area-inset-bottom));z-index:2147483001;display:flex;flex-direction:column;" +
    "width:400px;height:min(720px,calc(100vh - " + (bottom + 32) + "px));background:#fffdea;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3)}" +
    ".panel[hidden]{display:none}" +
    ".bar{display:flex;align-items:center;gap:6px;padding:8px 8px 8px 14px;background:#1c4911;color:#fff}" +
    ".title{flex:1;min-width:0;font-size:14px;font-weight:700;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".title small{margin-left:6px;font-size:11px;font-weight:500;color:#fdd000}" +
    ".icon{display:grid;place-items:center;width:38px;height:38px;flex:none;border:0;border-radius:8px;background:transparent;color:#fff;cursor:pointer;text-decoration:none}" +
    ".icon:hover{background:rgba(255,255,255,.14)}" +
    "iframe{flex:1;width:100%;border:0;background:#fffdea}" +
    "@media (max-width:640px){.panel{inset:0;width:auto;height:auto;border-radius:0;padding-bottom:env(safe-area-inset-bottom)}" +
    ".fab{padding:11px 16px 11px 12px;font-size:14px}}" +
    "@media (prefers-reduced-motion:reduce){.fab{transition:none}}";

  var host = document.createElement("div");
  host.id = "ichijoya-ai-embed";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML =
    "<style>" + css + "</style>" +
    '<button type="button" class="fab" aria-haspopup="dialog" aria-expanded="false" aria-controls="ichijoya-ai-panel">' + ICON_CHAT +
    "<span>AI相談<small>24時間受付</small></span></button>" +
    '<div class="panel" id="ichijoya-ai-panel" role="dialog" aria-modal="false" aria-label="一畳屋 AI相談" hidden>' +
    '<div class="bar"><p class="title">一畳屋 AI相談<small>24時間受付</small></p>' +
    '<a class="icon ext" target="_blank" rel="noopener" title="新しいタブで開く" aria-label="新しいタブで開く">' + ICON_EXT + "</a>" +
    '<button type="button" class="icon close" title="閉じる" aria-label="閉じる">' + ICON_CLOSE + "</button></div>" +
    '<iframe title="一畳屋 AI相談" allow="microphone; autoplay; clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
    "</div>";

  var fab = root.querySelector(".fab");
  var panel = root.querySelector(".panel");
  var frame = root.querySelector("iframe");
  var ext = root.querySelector(".ext");
  var closeBtn = root.querySelector(".close");
  var loaded = false;
  var voiceLive = false;
  var prevOverflow = "";
  var mobile = window.matchMedia ? window.matchMedia("(max-width:640px)") : { matches: false };
  ext.href = base + "/chat";

  // 窓の中から：声で話しているか（閉じたらマイクを止めるため）
  window.addEventListener("message", function (e) {
    if (e.origin !== base || !e.data || e.data.source !== "ichijoya-ai") return;
    voiceLive = e.data.voice === "live" || e.data.voice === "connecting";
  });

  function open(kind) {
    // 初めて開くとき（または声を止めて閉じたあと）だけ読み込む。開き直しても会話はそのまま
    if (!loaded) {
      frame.src = base + "/chat?embed=1" + (kind === "voice" ? "&voice=1" : "");
      loaded = true;
    }
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    if (mobile.matches) {
      prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    }
    closeBtn.focus();
  }

  function close() {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    document.documentElement.style.overflow = prevOverflow;
    // 声で話している途中なら、窓の中身を閉じてマイクを止める（会話はこの端末に残り、次に開いたときに続きから相談できる）
    if (voiceLive) {
      voiceLive = false;
      loaded = false;
      frame.src = "about:blank";
    }
    fab.focus();
  }

  fab.addEventListener("click", function () {
    open("text");
  });
  closeBtn.addEventListener("click", close);
  root.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panel.hidden) close();
  });

  // ホームページのほかのボタンから開く：<a href="#ai-chat"> ／ <a href="#ai-voice">、または window.ichijoyaAi.open("voice")
  window.ichijoyaAi = {
    open: function (kind) {
      open(kind === "voice" ? "voice" : "text");
    },
    close: close,
  };
  function fromHash() {
    if (location.hash === "#ai-chat") open("text");
    else if (location.hash === "#ai-voice") open("voice");
  }
  window.addEventListener("hashchange", fromHash);

  function mount() {
    document.body.appendChild(host);
    fromHash();
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
