if (import.meta.env.VITE_BUILD_TARGET === 'pages') {
  void import('./public-client');
} else {
  void import('./client');
}
