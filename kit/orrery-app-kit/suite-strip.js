// Framework-neutral Orrery suite strip. Usage:
//   <script src="/suite-strip.js" data-orrery-url="https://orrery.example.com"
//           data-apps='[{"name":"StatMesh","url":"https://statmesh.vercel.app"}]'></script>
(function () {
  var s = document.currentScript;
  var orrery = (s && s.getAttribute("data-orrery-url")) || "/";
  var apps = [];
  try { apps = JSON.parse((s && s.getAttribute("data-apps")) || "[]"); } catch (_) { /* keep empty list */ }
  var css = ".orrery-strip{box-sizing:border-box;height:32px;display:flex;align-items:center;gap:12px;padding:0 12px;font:12px/1 system-ui,sans-serif;background:#f4f4f5;color:#52525b;border-bottom:1px solid #e4e4e7;overflow:hidden;white-space:nowrap}" +
    ".orrery-strip a{color:inherit;text-decoration:none;padding:3px 8px;border-radius:6px;border:1px solid #d4d4d8}.orrery-strip a:hover{background:#e4e4e7}" +
    "@media(prefers-color-scheme:dark){.orrery-strip{background:#18181b;color:#a1a1aa;border-color:#27272a}.orrery-strip a{border-color:#3f3f46}.orrery-strip a:hover{background:#27272a}}";
  function link(name, url) { var a = document.createElement("a"); a.href = url; a.textContent = name; return a; }
  function init() {
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var bar = document.createElement("div"); bar.className = "orrery-strip"; bar.setAttribute("role", "navigation");
    var t = document.createElement("span"); t.textContent = "Part of Orrery ·"; bar.appendChild(t);
    bar.appendChild(link("Open Orrery", orrery));
    apps.forEach(function (a) { bar.appendChild(link(a.name, a.url)); });
    document.body.insertBefore(bar, document.body.firstChild);
  }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
