import prisma from "~/lib/prisma";

/** （已登录）当前账号的统一账号绑定状态。 */
export default defineEventHandler(async (event) => {
  const uid = oidcTokenUserId(event);
  if (!uid) return noPermissions("未登录");
  const me = await prisma.user.findUnique({ where: { id: uid }, select: { oidcSub: true, oidcName: true } });
  if (!me) return noPermissions("未登录");
  return success({ enabled: Boolean(oidcConfig()), linked: Boolean(me.oidcSub), name: me.oidcSub ? me.oidcName || me.oidcSub : null });
});
