package com.vespid.mobile.shared.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
sealed interface SessionWsClientMessage

@Serializable
data class SessionJoinMessage(
  val type: String = "session_join",
  @SerialName("sessionId") val sessionId: String,
) : SessionWsClientMessage

@Serializable
data class SessionSendMessage(
  val type: String = "session_send",
  @SerialName("sessionId") val sessionId: String,
  val message: String,
  @SerialName("idempotencyKey") val idempotencyKey: String,
) : SessionWsClientMessage

@Serializable
data class SessionCancelMessage(
  val type: String = "session_cancel",
  @SerialName("sessionId") val sessionId: String,
) : SessionWsClientMessage

@Serializable
data class SessionResetMessage(
  val type: String = "session_reset_agent",
  @SerialName("sessionId") val sessionId: String,
  val mode: String,
) : SessionWsClientMessage

@Serializable
data class SessionAckMessage(
  val type: String,
  @SerialName("sessionId") val sessionId: String,
)

@Serializable
data class SessionDeltaMessage(
  val type: String,
  @SerialName("sessionId") val sessionId: String,
  val seq: Int,
  val content: String,
  @SerialName("createdAt") val createdAt: String,
)

@Serializable
data class SessionFinalMessage(
  val type: String,
  @SerialName("sessionId") val sessionId: String,
  val seq: Int,
  val content: String,
  val payload: JsonElement? = null,
  @SerialName("createdAt") val createdAt: String,
)

@Serializable
data class SessionEventV2Message(
  val type: String,
  @SerialName("sessionId") val sessionId: String,
  val seq: Int,
  @SerialName("eventType") val eventType: String,
  val level: String,
  val payload: JsonElement? = null,
  @SerialName("createdAt") val createdAt: String,
)

@Serializable
data class SessionStreamV1Message(
  val type: String,
  @SerialName("sessionId") val sessionId: String,
  @SerialName("requestId") val requestId: String,
  @SerialName("streamSeq") val streamSeq: Int,
  val kind: String,
  val level: String,
  val text: String? = null,
  val payload: JsonElement? = null,
  @SerialName("createdAt") val createdAt: String,
)

@Serializable
data class SessionErrorMessage(
  val type: String,
  @SerialName("sessionId") val sessionId: String? = null,
  val code: String,
  val message: String,
)
