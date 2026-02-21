package com.vespid.mobile.shared.repo

import com.vespid.mobile.shared.api.VespidApiClient
import com.vespid.mobile.shared.model.MeResponse

class OrgRepository(
  private val apiClient: VespidApiClient,
) {
  suspend fun loadMe(token: String): MeResponse = apiClient.me(token)
}
