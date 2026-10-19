import prisma from "~/lib/prisma";

/** （已登录，只认 Authorization 请求头，不认 Cookie）解除当前账号的统一账号绑定。 */
export default defineEventHandler(async (event) => {
  const uid = oidcTokenUserId(event);
  if (!uid) return noPermissions("未登录");
  await prisma.user.updateMany({ where: { id: uid }, data: { oidcSub: null, oidcName: null } });
  console.log(`[oidc] 账号 ${uid} 解除了统一账号绑定`);
  return success({ ok: true });
});
