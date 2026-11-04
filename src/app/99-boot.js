// Start: first render, load projects, keep the background server alive.
render();
initStore();
setInterval(() => { fetch('/api/ping').catch(() => {}); }, 60000); // keeps the background server alive while a window is open
