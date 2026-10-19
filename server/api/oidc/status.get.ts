/** 登录页用：是否显示「用统一账号登录」。 */
export default defineEventHandler(() => success({ enabled: Boolean(oidcConfig()) }));
