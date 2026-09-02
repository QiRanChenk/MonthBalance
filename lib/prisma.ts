import { PrismaClient } from "@prisma/client";

const prismaClientSingleton = () => {
  const client = new PrismaClient();
  // SQLite 性能调优：
  // - WAL 日志模式：读写并发不互斥，导入大批数据时页面查询不再被锁
  // - synchronous=NORMAL：WAL 模式下安全且写入速度大幅提升
  // - cache_size / temp_store / mmap：减少磁盘 IO
  client
    .$queryRawUnsafe("PRAGMA journal_mode=WAL;")
    .then(() => client.$queryRawUnsafe("PRAGMA synchronous=NORMAL;"))
    .then(() => client.$queryRawUnsafe("PRAGMA cache_size=-20000;"))
    .then(() => client.$queryRawUnsafe("PRAGMA temp_store=MEMORY;"))
    .then(() => client.$queryRawUnsafe("PRAGMA mmap_size=268435456;"))
    .then(() => client.$queryRawUnsafe("PRAGMA busy_timeout=5000;"))
    .catch((e) => {
      console.error("SQLite PRAGMA init failed:", e);
    });
  return client;
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;
