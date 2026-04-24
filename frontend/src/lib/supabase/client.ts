type QueryResult<T = unknown> = { data: T; error: null }

class MockQueryBuilder<T = unknown> implements PromiseLike<QueryResult<T>> {
  private result: QueryResult<T>

  constructor(result: QueryResult<T>) {
    this.result = result
  }

  select() {
    return this
  }

  eq() {
    return this
  }

  neq() {
    return this
  }

  in() {
    return this
  }

  or() {
    return this
  }

  filter() {
    return this
  }

  order() {
    return this
  }

  range() {
    return this
  }

  ilike() {
    return this
  }

  like() {
    return this
  }

  not() {
    return this
  }

  is() {
    return this
  }

  contains() {
    return this
  }

  match() {
    return this
  }

  gte() {
    return this
  }

  lte() {
    return this
  }

  limit() {
    return this
  }

  single() {
    this.result = { data: null as T, error: null }
    return this
  }

  maybeSingle() {
    this.result = { data: null as T, error: null }
    return this
  }

  update() {
    return this
  }

  insert() {
    return this
  }

  upsert() {
    return this
  }

  delete() {
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
  from: (table: string) => MockQueryBuilder<unknown[]>
  rpc: (name: string, params?: Record<string, unknown>) => Promise<QueryResult<null>>
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
      async signInWithPassword() {
        return { error: null }
      },
      async signUp() {
        return { error: null }
      },
      async signOut() {
        return { error: null }
      },
      async exchangeCodeForSession() {
        return { error: null }
      },
    },
    from() {
      return new MockQueryBuilder({ data: [], error: null })
    },
    async rpc() {
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
