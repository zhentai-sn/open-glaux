/**
 * Pi 会话存储的 SQLite 工厂，串行化同一进程内的写。
 *
 * pi 的 node 适配器用同步的 `DatabaseSync`，事务却是异步的（BEGIN → await 若干语句 → COMMIT），
 * 每个会话各开一个连接。两个会话并发写时：连接 A 持有写锁后在 await 处让出事件循环，
 * 连接 B 写入遇锁按 busy_timeout 同步忙等、堵住事件循环，A 无法 COMMIT，B 等满后报
 * 「Failed to append SQLite session entry」。同一连接上并发的两个事务则直接嵌套 BEGIN 失败。
 *
 * 这里用一把进程内异步锁：事务整体、以及事务外的写语句排队执行；读语句（get / all）不加锁，
 * WAL 模式下读不受写阻塞。
 */
import {
  createNodeSqliteFactory,
  type SqliteDatabase,
  type SqliteDatabaseFactory,
  type SqliteStatement,
} from "@earendil-works/pi-storage-sqlite-node";

class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

class SerializedDatabase implements SqliteDatabase {
  /** 本连接正处于自己的事务中：事务内的语句已持有锁，不再排队（否则自锁）。 */
  private inTransaction = false;

  constructor(private readonly inner: SqliteDatabase, private readonly lock: AsyncLock) {}

  exec(sql: string): Promise<void> {
    return this.inTransaction ? this.inner.exec(sql) : this.lock.run(() => this.inner.exec(sql));
  }

  prepare(sql: string): SqliteStatement {
    const statement = this.inner.prepare(sql);
    return {
      run: (...params) => (this.inTransaction ? statement.run(...params) : this.lock.run(() => statement.run(...params))),
      get: (...params) => statement.get(...params),
      all: (...params) => statement.all(...params),
    };
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      this.inTransaction = true;
      try {
        return await this.inner.transaction(fn);
      } finally {
        this.inTransaction = false;
      }
    });
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

/** 同一工厂打开的全部连接共用一把锁。 */
export function createSerializedSqliteFactory(inner: SqliteDatabaseFactory = createNodeSqliteFactory()): SqliteDatabaseFactory {
  const lock = new AsyncLock();
  return {
    async open(path: string): Promise<SqliteDatabase> {
      return new SerializedDatabase(await inner.open(path), lock);
    },
  };
}
