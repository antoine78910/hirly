const { createProxyMiddleware } = require("http-proxy-middleware");

const backendTarget = (process.env.REACT_APP_BACKEND_URL || "http://localhost:8001")
  .replace(/\/api\/?$/i, "")
  .replace(/\/+$/, "");

module.exports = function setupProxy(app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: backendTarget,
      changeOrigin: true,
    }),
  );
};
