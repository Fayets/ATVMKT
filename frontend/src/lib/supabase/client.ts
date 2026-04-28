type QueryResult<T = any> = { data: T; error: null }

class MockQueryBuilder<T = any> implements PromiseLike<QueryResult<T>> {
  private result: QueryResult<T>

  constructor(result: QueryResult<T>) {
    this.result = result
  }

  select(..._args: unknown[]) {
    return this
  }

  eq(..._args: unknown[]) {
    return this
  }

  neq(..._args: unknown[]) {
    return this
  }

  in(..._args: unknown[]) {
    return this
  }

  or(..._args: unknown[]) {
    return this
  }

  filter(..._args: unknown[]) {
    return this
  }

  order(..._args: unknown[]) {
    return this
  }

  range(..._args: unknown[]) {
    return this
  }

  ilike(..._args: unknown[]) {
    return this
  }

  like(..._args: unknown[]) {
    return this
  }

  not(..._args: unknown[]) {
    return this
  }

  is(..._args: unknown[]) {
    return this
  }

  contains(..._args: unknown[]) {
    return this
  }

  match(..._args: unknown[]) {
    return this
  }

  gte(..._args: unknown[]) {
    return this
  }

  lte(..._args: unknown[]) {
    return this
  }

  limit(..._args: unknown[]) {
    return this
  }

  single(..._args: unknown[]) {
    this.result = { data: null as T, error: null }
    return this
  }

  maybeSingle(..._args: unknown[]) {
    this.result = { data: null as T, error: null }
    return this
  }

  update(..._args: unknown[]) {
    return this
  }

  insert(..._args: unknown[]) {
    return this
  }

  upsert(..._args: unknown[]) {
    return this
  }

  delete(..._args: unknown[]) {
    return this
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined)
  }
}

type MockClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string; email: string } }; error: null }>
    signInWithPassword: () => Promise<{ error: null }>
    signUp: () => Promise<{ error: null }>
    signOut: () => Promise<{ error: null }>
    exchangeCodeForSession: () => Promise<{ error: null }>
  }
  from: (...args: unknown[]) => MockQueryBuilder<any[]>
  rpc: (...args: unknown[]) => Promise<QueryResult<any>>
  storage: {
    from: (bucket: string) => {
      upload: (path: string, data: Blob | ArrayBuffer, options?: Record<string, unknown>) => Promise<{ error: null }>
      getPublicUrl: (path: string) => { data: { publicUrl: string } }
    }
  }
}

let client: MockClient | null = null

export function createClient(): MockClient {
  if (client) return client

  client = {
    auth: {
      async getUser() {
        return {
          data: { user: { id: 'local-dev-user', email: 'dev@local.test' } },
          error: null,
        }
      },
      async signInWithPassword(..._args: unknown[]) {
        return { error: null }
      },
      async signUp(..._args: unknown[]) {
        return { error: null }
      },
      async signOut() {
        return { error: null }
      },
      async exchangeCodeForSession(..._args: unknown[]) {
        return { error: null }
      },
    },
    from(..._args: unknown[]) {
      return new MockQueryBuilder({ data: [], error: null })
    },
    async rpc(..._args: unknown[]) {
      return { data: null, error: null }
    },
    storage: {
      from() {
        return {
          async upload() {
            return { error: null }
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `/mock-storage/${path}` } }
          },
        }
      },
    },
  }

  return client
}
