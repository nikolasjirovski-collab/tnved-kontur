// Classic script: file:// pages cannot load the application's ES modules.
(function () {
  var online = 'https://nikolasjirovski-collab.github.io/tnved-kontur/?release=4.2.1';
  if (window.location.protocol === 'file:') {
    document.getElementById('load-status').textContent = 'Открываем онлайн-версию';
    document.getElementById('search-button').disabled = true;
    document.getElementById('search-status').textContent = 'Переходим на сайт…';
    var content = document.getElementById('results-content');
    content.textContent = '';
    var link = document.createElement('a');
    link.className = 'secondary-button';
    link.href = online;
    link.textContent = 'Открыть онлайн-версию';
    content.appendChild(link);
    window.location.replace(online);
    return;
  }
  var app = document.createElement('script');
  app.type = 'module';
  app.src = './app.js?v=4.2.0';
  app.onerror = function () {
    document.getElementById('load-status').textContent = 'Не удалось загрузить приложение';
    document.getElementById('search-status').textContent = 'Проверьте соединение и обновите страницу.';
  };
  document.body.appendChild(app);
})();
