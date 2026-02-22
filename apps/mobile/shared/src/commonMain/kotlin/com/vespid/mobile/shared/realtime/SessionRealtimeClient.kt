package com.vespid.mobile.shared.realtime

import com.vespid.mobile.shared.model.SessionAckMessage
import com.vespid.mobile.shared.model.SessionCancelMessage
import com.vespid.mobile.shared.model.SessionDeltaMessage
import com.vespid.mobile.shared.model.SessionErrorMessage
import com.vespid.mobile.shared.model.SessionEventV2Message
import com.vespid.mobile.shared.model.SessionFinalMessage
import com.vespid.mobile.shared.model.SessionJoinMessage
import com.vespid.mobile.shared.model.SessionResetMessage
import com.vespid.mobile.shared.model.SessionSendMessage
import com.vespid.mobile.shared.model.SessionStreamV1Message
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.takeFrom
import io.ktor.http.encodedPath
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlin.random.Random

sealed interface SessionRealtimeMessage {
  data class Ack(val value: SessionAckMessage) : SessionRealtimeMessage
  data class Delta(val value: SessionDeltaMessage) : SessionRealtimeMessage
  data class Final(val value: SessionFinalMessage) : SessionRealtimeMessage
  data class EventV2(val value: SessionEventV2Message) : SessionRealtimeMessage
  data class StreamV1(val value: SessionStreamV1Message) : SessionRealtimeMessage
  data class Error(val value: SessionErrorMessage) : SessionRealtimeMessage
  data class Raw(val value: JsonObject) : SessionRealtimeMessage
}

class SessionRealtimeClient(
  private val httpClient: HttpClient,
  private val gatewayWsBaseUrl: String,
  private val json: Json,
) {
  private val wsBaseCandidates: List<String> = resolveWsBaseCandidates(gatewayWsBaseUrl)
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val events = MutableSharedFlow<SessionRealtimeMessage>(
    replay = 0,
    extraBufferCapacity = 128,
    onBufferOverflow = BufferOverflow.DROP_OLDEST,
  )
  private var session: DefaultClientWebSocketSession? = null

  fun events(): SharedFlow<SessionRealtimeMessage> = events.asSharedFlow()

  suspend fun connect(token: String, orgId: String, sessionId: String) {
    disconnect()

    var lastError: Throwable? = null
    for (wsBase in wsBaseCandidates) {
      val connected = runCatching {
        httpClient.webSocketSession {
          url {
            takeFrom(wsBase)
            encodedPath = "/ws/client"
            protocol = if (wsBase.startsWith("wss://")) URLProtocol.WSS else URLProtocol.WS
            parameters.append("orgId", orgId)
          }
          header(HttpHeaders.Authorization, "Bearer $token")
          header("x-org-id", orgId)
        }
      }.getOrElse { error ->
        lastError = error
        null
      }
      if (connected != null) {
        session = connected
        break
      }
    }
    if (session == null) {
      throw lastError ?: IllegalStateException("WebSocket connect failed for all base URL candidates")
    }

    session?.send(json.encodeToString(SessionJoinMessage(sessionId = sessionId)))

    scope.launch {
      val active = session ?: return@launch
      for (frame in active.incoming) {
        if (frame !is Frame.Text) continue
        val message = frame.readText()
        val parsed = runCatching { parse(message) }
          .getOrElse {
            SessionRealtimeMessage.Raw(JsonObject(emptyMap()))
          }
        events.tryEmit(parsed)
      }
    }
  }

  suspend fun send(sessionId: String, message: String) {
    session?.send(
      json.encodeToString(
        SessionSendMessage(
          sessionId = sessionId,
          message = message,
          idempotencyKey = "mobile-${Random.nextLong()}"
        )
      )
    )
  }

  suspend fun stop(sessionId: String) {
    session?.send(json.encodeToString(SessionCancelMessage(sessionId = sessionId)))
  }

  suspend fun reset(sessionId: String, clearHistory: Boolean) {
    session?.send(
      json.encodeToString(
        SessionResetMessage(
          sessionId = sessionId,
          mode = if (clearHistory) "clear_history" else "keep_history",
        )
      )
    )
  }

  suspend fun disconnect() {
    session?.close(CloseReason(CloseReason.Codes.NORMAL, "disconnect"))
    session = null
  }

  private fun parse(raw: String): SessionRealtimeMessage {
    val element = runCatching { json.parseToJsonElement(raw) }.getOrNull()
      ?: return SessionRealtimeMessage.Raw(JsonObject(emptyMap()))
    val objectValue = element as? JsonObject ?: return SessionRealtimeMessage.Raw(JsonObject(emptyMap()))
    val type = objectValue["type"]?.jsonPrimitive?.contentOrNull
    return when (type) {
      "session_ack" -> SessionRealtimeMessage.Ack(json.decodeFromJsonElement(objectValue))
      "agent_delta" -> SessionRealtimeMessage.Delta(json.decodeFromJsonElement(objectValue))
      "agent_final" -> SessionRealtimeMessage.Final(json.decodeFromJsonElement(objectValue))
      "session_event_v2" -> SessionRealtimeMessage.EventV2(json.decodeFromJsonElement(objectValue))
      "session_stream_v1" -> SessionRealtimeMessage.StreamV1(json.decodeFromJsonElement(objectValue))
      "session_error" -> SessionRealtimeMessage.Error(json.decodeFromJsonElement(objectValue))
      else -> SessionRealtimeMessage.Raw(objectValue)
    }
  }

  private fun resolveWsBaseCandidates(primary: String): List<String> {
    val normalized = normalizeWsBase(primary)
    if (normalized.isEmpty()) return emptyList()
    val swapped = swapLoopbackHost(normalized)
    return if (normalized.contains("10.0.2.2")) {
      listOfNotNull(swapped, normalized).distinct()
    } else {
      listOfNotNull(normalized, swapped).distinct()
    }
  }

  private fun normalizeWsBase(raw: String): String {
    val trimmed = raw.trim().trimEnd('/')
    if (trimmed.isEmpty()) return ""
    return if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) trimmed else "ws://$trimmed"
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
