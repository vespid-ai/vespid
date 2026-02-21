package com.vespid.mobile.shared.repo

import com.vespid.mobile.shared.api.VespidApiClient
import com.vespid.mobile.shared.model.LoginResponse

class AuthRepository(
  private val apiClient: VespidApiClient,
  private val tokenStore: TokenStore,
) {
  suspend fun login(email: String, password: String): LoginResponse {
    val response = apiClient.login(email = email, password = password)
    tokenStore.set(response.session.token)
    return response
  }

  suspend fun token(): String? = tokenStore.get()

  suspend fun logout() {
    tokenStore.clear()
  }
}
