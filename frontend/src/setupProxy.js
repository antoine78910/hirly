const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function setupProxy(app) {
  const target = (process.env.REACT_APP_BACKEND_URL || "http://localhost:8001").replace(/\/api\/?$/i, "");
  app.use(
    "/api",
    createProxyMiddleware({
      target,
      changeOrigin: true,
      proxyTimeout: 120000,
      timeout: 120000,
    }),
  );
};
