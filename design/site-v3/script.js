// Interactions kept from the artifact (no routing)
document.addEventListener('click', function (e) {
  var b = e.target.closest('.opt'); if (!b) return;
  b.parentNode.querySelectorAll('.opt').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
});
document.addEventListener('keydown', function (e) {
  var menu = document.getElementById('menu');
  if (e.key === 'Escape' && menu && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
});
['contact-form', 'news-form'].forEach(function (id) {
  var f = document.getElementById(id); if (f) f.addEventListener('submit', function (e) { e.preventDefault(); });
});
