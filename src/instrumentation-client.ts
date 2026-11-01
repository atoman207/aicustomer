// ブラウザで、React がサーバーの HTML を引き継ぐ（hydration）前に一度だけ動く（Next の instrumentation-client）
// Netlify は HTML の <head> に「This site is hosted on Netlify…」のコメントと改行を差し込む（2026-11-02 に確認）。
// React はそれをサーバーの HTML との食い違いとみなし（React #418）、ページ全体をブラウザで描き直してしまうため、
// 引き継ぐ前に <html>・<head> の直下のコメントと空白だけの文字を取り除く（React の目印のコメントは <body> の中にだけあり、ここでは触らない）
for (const parent of [document.documentElement, document.head]) {
  for (const node of Array.from(parent?.childNodes ?? [])) {
    if (node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())) node.remove();
  }
}

export {};
