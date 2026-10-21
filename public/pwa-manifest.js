(function () {
  const link = document.createElement('link');
  link.rel = 'manifest';
  document.head.appendChild(link);

  window.updatePwaManifest = function () {
    const match = /^\/(contact|staff)\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);
    link.href = match
      ? `/pwa/${match[1]}/${match[2]}.webmanifest`
      : '/manifest.webmanifest';
  };

  window.updatePwaManifest();
})();
