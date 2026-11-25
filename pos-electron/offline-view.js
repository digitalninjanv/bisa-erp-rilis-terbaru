const api = window.bisaPosOffline;
const originLabel = document.getElementById("originLabel");
if (api) {
  void api.getStatus().then((data) => {
    originLabel.textContent = "Server: " + (data?.origin || "http://localhost:3000");
  });
  document.getElementById("retryBtn").addEventListener("click", () => api.retryConnection());
  document.getElementById("settingsBtn").addEventListener("click", () => api.openSettings());
}
