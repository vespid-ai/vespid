package com.vespid.mobile.shared.api

import com.vespid.mobile.shared.model.AgentSessionEventsResponse
import com.vespid.mobile.shared.model.AgentSessionListResponse
import com.vespid.mobile.shared.model.LoginRequest
import com.vespid.mobile.shared.model.LoginResponse
import com.vespid.mobile.shared.model.MeResponse
import com.vespid.mobile.shared.model.SessionCreateRequest
import com.vespid.mobile.shared.model.SessionCreateResponse
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.URLBuilder
import io.ktor.http.contentType

class VespidApiClient(
  private val httpClient: HttpClient,
  private val apiBaseUrl: String,
) {
  private val apiBaseCandidates: List<String> = resolveApiBaseCandidates(apiBaseUrl)

  suspend fun login(email: String, password: String): LoginResponse {
    return requestWithFallback { base ->
      httpClient.post("$base/v1/auth/login") {
        contentType(ContentType.Application.Json)
        setBody(LoginRequest(email = email, password = password))
      }.body()
    }
  }

  suspend fun me(token: String): MeResponse {
    return requestWithFallback { base ->
      httpClient.get("$base/v1/me") {
        header(HttpHeaders.Authorization, "Bearer $token")
      }.body()
    }
  }

  suspend fun listSessions(token: String, orgId: String, status: String = "active"): AgentSessionListResponse {
    return requestWithFallback { base ->
      httpClient.get("$base/v1/orgs/$orgId/sessions?limit=100&status=$status") {
        header(HttpHeaders.Authorization, "Bearer $token")
        header("x-org-id", orgId)
      }.body()
    }
  }

  suspend fun listSessionEvents(token: String, orgId: String, sessionId: String): AgentSessionEventsResponse {
    return requestWithFallback { base ->
      httpClient.get("$base/v1/orgs/$orgId/sessions/$sessionId/events?limit=500") {
        header(HttpHeaders.Authorization, "Bearer $token")
        header("x-org-id", orgId)
      }.body()
    }
  }

  suspend fun createSession(token: String, orgId: String, body: SessionCreateRequest): SessionCreateResponse {
    return requestWithFallback { base ->
      httpClient.post("$base/v1/orgs/$orgId/sessions") {
        header(HttpHeaders.Authorization, "Bearer $token")
        header("x-org-id", orgId)
        contentType(ContentType.Application.Json)
        setBody(body)
      }.body()
    }
  }

  private suspend fun <T> requestWithFallback(request: suspend (baseUrl: String) -> T): T {
    var lastError: Throwable? = null
    for (baseUrl in apiBaseCandidates) {
      try {
        return request(baseUrl)
      } catch (error: Throwable) {
        lastError = error
      }
    }
    throw lastError ?: IllegalStateException("No valid API base URL candidates")
  }

  private fun resolveApiBaseCandidates(primary: String): List<String> {
    val normalized = primary.trim().trimEnd('/')
    if (normalized.isEmpty()) return emptyList()
    val swapped = swapLoopbackHost(normalized)
    return if (normalized.contains("10.0.2.2")) {
      listOfNotNull(swapped, normalized).distinct()
    } else {
      listOfNotNull(normalized, swapped).distinct()
    }
  }

  private fun swapLoopbackHost(rawBase: String): String? {
    val builder = runCatching { URLBuilder(rawBase) }.getOrNull() ?: return null
    val host = builder.host.lowercase()
    val replacement = when (host) {
      "10.0.2.2" -> "127.0.0.1"
      "127.0.0.1", "localhost" -> "10.0.2.2"
      else -> null
    } ?: return null
    builder.host = replacement
    return builder.buildString().trimEnd('/')
  }
}
