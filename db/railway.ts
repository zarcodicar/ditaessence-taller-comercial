import postgres from 'postgres';

type SqlClient = ReturnType<typeof postgres>;

function placeholders(query: string) {
  let index = 0;
  return query
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'BIGSERIAL PRIMARY KEY')
    .replace(/\?/g, () => `$${++index}`);
}

class Statement {
  values: unknown[] = [];

  constructor(public query: string, private client?: SqlClient) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  private async execute(client = this.client || dbClient()) {
    let query = placeholders(this.query);
    if (/^\s*insert\s+into/i.test(query) && !/\breturning\b/i.test(query)) query += ' RETURNING id';
    return client.unsafe(query, this.values as never[]);
  }

  async first<T>() {
    const rows = await this.execute();
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T>() {
    const rows = await this.execute();
    return { results: rows as unknown as T[] };
  }

  async run(client = this.client || dbClient()) {
    const rows = await this.execute(client);
    const first = rows[0] as { id?: number | string } | undefined;
    return { meta: { last_row_id: first?.id ?? null, changes: rows.count ?? 0 } };
  }
}

function database(client?: SqlClient) {
  return {
    prepare(query: string) {
      return new Statement(query, client);
    },
    async batch(statements: Statement[]) {
      if (client) {
        const results = [];
        for (const statement of statements) results.push(await statement.run(client));
        return results;
      }
      return dbClient().begin(async transaction => {
        const results = [];
        for (const statement of statements) results.push(await statement.run(transaction as unknown as SqlClient));
        return results;
      });
    },
  };
}

let client: SqlClient | null = null;
function dbClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está configurada.');
  client ??= postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 15 });
  return client;
}

export const env = {
  DB: {
    ...database(),
    async transaction<T>(callback: (db: ReturnType<typeof database>) => Promise<T>) {
      return dbClient().begin(transaction => callback(database(transaction as unknown as SqlClient))) as Promise<T>;
    },
  },
};
