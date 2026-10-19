export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2025-01-10",
  experimental: {
    appManifest: false,
  },
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  app: {
    head: {
      title: "Cashbook",
      charset: "utf-8",
      viewport: "width=device-width, initial-scale=1",
      meta: [
        { name: "description", content: "Cashbook, 快速记账!" },
        { name: "theme-color", content: "#16a34a" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
        { name: "apple-mobile-web-app-title", content: "Cashbook" },
        { name: "application-name", content: "Cashbook" },
        { name: "msapplication-TileColor", content: "#16a34a" },
        { name: "msapplication-tap-highlight", content: "no" },
        { name: "mobile-web-app-capable", content: "yes" },
        { property: "og:title", content: "Cashbook" },
        { property: "og:description", content: "Cashbook, 快速记账!" },
        { property: "og:type", content: "website" },
        { property: "og:image", content: "/logo.png" },
      ],
      link: [
        {
          rel: "manifest",
          href: "/manifest.json",
        },
        {
          rel: "shortcut icon",
          href: "/logo.png",
        },
        {
          rel: "icon",
          href: "/logo.png",
        },
        {
          rel: "apple-touch-icon",
          href: "/pwa/apple-icon-180.png",
        },
        {
          rel: "apple-touch-startup-image",
          href: "/pwa/apple-splash-640-1136.jpg",
          media:
            "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
        },
        {
          rel: "apple-touch-startup-image",
          href: "/pwa/apple-splash-750-1334.jpg",
          media:
            "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
        },
        {
          rel: "apple-touch-startup-image",
          href: "/pwa/apple-splash-1242-2208.jpg",
          media:
            "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
        },
        {
          rel: "apple-touch-startup-image",
          href: "/pwa/apple-splash-1125-2436.jpg",
          media:
            "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
        },
        {
          rel: "apple-touch-startup-image",
          href: "/pwa/apple-splash-1536-2048.jpg",
          media:
            "(min-device-width: 768px) and (max-device-width: 1024px) and (-webkit-min-device-pixel-ratio: 2) and (orientation: portrait)",
        },
      ],
    },
  },
  devServer: {
    port: 9090,
  },
  nitro: {
    experimental: {
      openAPI: true,
    },
    // routeRules: {
    //   "/api/**": { swr: true },
    // },
  },
  // scalar: {
  //   darkMode: true,
  //   // hideClientButton: true,
  //   hiddenClients: true,
  //   defaultHttpClient: {
  //     targetKey: "node",
  //     clientKey: "server",
  //   },
  //   url: "/api/openapi.json",
  // },
  runtimeConfig: {
    public: {},
    appVersion: "",
    dataPath: "",
    authSecret: "",
    adminUsername: "",
    adminPassword: "",
    // 统一登录（Casdoor OIDC），环境变量 NUXT_OIDC_*；Client ID + Secret 都填了才启用
    oidcIssuer: "https://auth.mmkj.site", // NUXT_OIDC_ISSUER：公网 issuer（发现文档、JWKS 只从这里取）
    oidcClientId: "", // NUXT_OIDC_CLIENT_ID
    oidcClientSecret: "", // NUXT_OIDC_CLIENT_SECRET
    oidcInternalUrl: "", // NUXT_OIDC_INTERNAL_URL：可选，只用于换令牌和 userinfo，如 http://192.168.123.227:8001
    oidcRedirectOrigins: "", // NUXT_OIDC_REDIRECT_ORIGINS：允许的站点地址（空格 / 逗号分隔），默认见 server/utils/oidcAuth.ts
    oidcAutoCreate: "", // NUXT_OIDC_AUTO_CREATE=1：没有对应账号时自动建普通用户（默认不建）
    oidcTrustProxy: "", // NUXT_OIDC_TRUST_PROXY=1：信任 X-Forwarded-Proto / X-Forwarded-Host
  },

  modules: [
    "@nuxtjs/i18n",
    "@nuxtjs/tailwindcss",
    "nuxt-echarts",
    "@prisma/nuxt",
    "nuxt-openapi-docs-module",
  ],

  i18n: {
    strategy: "prefix_except_default",
    defaultLocale: "zh",
    locales: [
      {
        code: "en",
        name: "English",
      },
      {
        code: "zh",
        name: "简体中文",
      },
    ],
    vueI18n: "./i18n.config.ts",
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "i18n_redirected",
      redirectOn: "root",
    },
  },
  // 动态引入echars图表
  echarts: {
    features: ["LabelLayout", "UniversalTransition"],
    charts: ["BarChart", "LineChart", "PieChart"],
    components: [
      "DatasetComponent",
      "GridComponent",
      "TooltipComponent",
      "LegendComponent",
      "ToolboxComponent",
      "DataZoomComponent",
    ],
  },
  tailwindcss: {
    // 使用根目录的 tailwind.config.js 文件
  },
  vite: {
    resolve: {
      alias: {
        ".prisma/client/index-browser":
          "./node_modules/.prisma/client/index-browser.js",
      },
    },
  },
});
