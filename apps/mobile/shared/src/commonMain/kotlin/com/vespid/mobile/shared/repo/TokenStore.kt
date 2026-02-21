package com.vespid.mobile.shared.repo

interface TokenStore {
  suspend fun get(): String?
  suspend fun set(token: String)
  suspend fun clear()
}

class InMemoryTokenStore : TokenStore {
  private var token: String? = null

  override suspend fun get(): String? = token

  override suspend fun set(token: String) {
    this.token = token
  }

  override suspend fun clear() {
    token = null
  }
}
