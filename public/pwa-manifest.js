(function () {
  const link = document.createElement('link');
  link.rel = 'manifest';
  document.head.appendChild(link);

  window.updatePwaManifest = function () {
    const match = /^\/(contact|staff)\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);
    link.href = match
      ? `/api/v1/${match[1] === 'staff' ? 'staff' : 'public'}/contact/${match[2]}/manifest`
      : '/manifest.webmanifest';
  };

  window.updatePwaManifest();
})();
