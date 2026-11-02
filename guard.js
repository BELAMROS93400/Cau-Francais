/* Premier script chargé : au lieu d'une page blanche, affiche ce qui a échoué. */
(function () {
  var problems = [], shown = false;
  var L = (navigator.language || 'vi').slice(0, 2), TX = {
    vi: ['Không mở được ứng dụng', 'Thiếu hoặc lỗi:', 'Thử lại', 'Hãy gửi ảnh chụp màn hình này cho người hỗ trợ. Nếu thiếu tệp, hãy tải lại toàn bộ tệp lên GitHub.'],
    fr: ['L\'application n\'a pas pu démarrer', 'Manquant ou en erreur :', 'Réessayer', 'Envoyez une capture de cet écran. Si des fichiers manquent, renvoyez tous les fichiers sur GitHub.'],
    en: ['The app could not start', 'Missing or failed:', 'Try again', 'Send a screenshot of this screen. If files are missing, upload all the files to GitHub again.'],
  }, X = TX[L] || TX.vi;
  function show() {
    var root = document.getElementById('app'); if (!root || (root.firstChild && !shown)) return; shown = true;
    root.innerHTML = '';
    var box = document.createElement('div'); box.style.cssText = 'padding:24px;font:17px/1.5 -apple-system,Segoe UI,sans-serif;color:#242133;background:#FBFBF6;min-height:100vh;box-sizing:border-box;overflow-wrap:anywhere';
    var h = document.createElement('h1'); h.textContent = X[0]; h.style.cssText = 'font-size:24px;color:#C8321F;margin:0 0 12px';
    var p = document.createElement('p'); p.textContent = X[3];
    var w = document.createElement('p'); w.textContent = X[1]; w.style.fontWeight = '700';
    var ul = document.createElement('ul'); problems.slice(0, 12).forEach(function (m) { var li = document.createElement('li'); li.textContent = m; ul.appendChild(li); });
    var v = document.createElement('p'); v.textContent = navigator.userAgent; v.style.cssText = 'font-size:12px;color:#5F5A8C';
    var b = document.createElement('button'); b.textContent = X[2]; b.style.cssText = 'font:inherit;font-weight:700;padding:10px 18px;background:#2E2470;color:#fff;border:0;border-radius:8px';
    b.onclick = function () {
      var done = function () { location.reload(); };
      var clear = window.caches ? caches.keys().then(function (k) { return Promise.all(k.map(function (x) { return caches.delete(x); })); }) : Promise.resolve();
      var sw = navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(function (r) { return Promise.all(r.map(function (x) { return x.unregister(); })); }) : Promise.resolve();
      Promise.all([clear, sw]).then(done, done);
    };
    box.appendChild(h); box.appendChild(p); box.appendChild(w); box.appendChild(ul); box.appendChild(b); box.appendChild(v); root.appendChild(box);
  }
  window.cauFail = function (m) { problems.push(String(m)); show(); };
  addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) { if (t.tagName === 'SCRIPT') window.cauFail((t.src || '').split('/').pop()); return; }
    window.cauFail((e.message || 'erreur') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  }, true);
  addEventListener('unhandledrejection', function (e) { if (!document.querySelector('#app > *')) window.cauFail((e.reason && e.reason.message) || e.reason); });
  setTimeout(function () { if (!document.querySelector('#app > *')) window.cauFail('timeout'); }, 15000);
})();
