package com.vespid.mobile.shared.repo

import com.vespid.mobile.shared.api.VespidApiClient
import com.vespid.mobile.shared.model.AgentSession
import com.vespid.mobile.shared.model.AgentSessionEvent
import com.vespid.mobile.shared.model.SessionCreateEngine
import com.vespid.mobile.shared.model.SessionCreatePrompt
import com.vespid.mobile.shared.model.SessionCreateRequest
import com.vespid.mobile.shared.model.SessionCreateTools
import com.vespid.mobile.shared.realtime.SessionRealtimeClient
import com.vespid.mobile.shared.realtime.SessionRealtimeMessage
import kotlinx.coroutines.flow.SharedFlow

class SessionRepository(
  private val apiClient: VespidApiClient,
  private val realtimeClient: SessionRealtimeClient,
) {
  suspend fun listSessions(token: String, orgId: String): List<AgentSession> {
    return apiClient.listSessions(token = token, orgId = orgId).sessions
  }

  suspend fun listEvents(token: String, orgId: String, sessionId: String): List<AgentSessionEvent> {
    return apiClient.listSessionEvents(token = token, orgId = orgId, sessionId = sessionId).events
  }

  suspend fun createSession(
    token: String,
    orgId: String,
    engineId: String,
    model: String,
    instructions: String,
    system: String?,
    allowTools: List<String>,
  ): AgentSession {
    val request = SessionCreateRequest(
      engine = SessionCreateEngine(id = engineId, model = model),
      prompt = SessionCreatePrompt(system = system, instructions = instructions),
      tools = SessionCreateTools(allow = allowTools),
    )
    return apiClient.createSession(token = token, orgId = orgId, body = request).session
  }

  suspend fun connect(token: String, orgId: String, sessionId: String) {
    realtimeClient.connect(token = token, orgId = orgId, sessionId = sessionId)
  }

  suspend fun disconnect() {
    realtimeClient.disconnect()
  }

  suspend fun send(sessionId: String, message: String) {
    realtimeClient.send(sessionId = sessionId, message = message)
  }

  suspend fun stop(sessionId: String) {
    realtimeClient.stop(sessionId = sessionId)
  }

  suspend fun reset(sessionId: String, clearHistory: Boolean) {
    realtimeClient.reset(sessionId = sessionId, clearHistory = clearHistory)
  }

  fun events(): SharedFlow<SessionRealtimeMessage> = realtimeClient.events()
}
