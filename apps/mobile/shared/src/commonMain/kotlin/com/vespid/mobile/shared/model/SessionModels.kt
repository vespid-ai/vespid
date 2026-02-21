package com.vespid.mobile.shared.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class AgentSession(
  val id: String,
  @SerialName("organizationId") val organizationId: String,
  val title: String = "",
  val status: String,
  @SerialName("engineId") val engineId: String,
  @SerialName("llmModel") val llmModel: String,
  @SerialName("updatedAt") val updatedAt: String,
)

@Serializable
data class AgentSessionListResponse(
  val sessions: List<AgentSession>,
  @SerialName("nextCursor") val nextCursor: String? = null,
)

@Serializable
data class AgentSessionEvent(
  val id: String,
  val seq: Int,
  @SerialName("eventType") val eventType: String,
  val level: String,
  val payload: JsonElement? = null,
  @SerialName("createdAt") val createdAt: String,
)

@Serializable
data class AgentSessionEventsResponse(
  val events: List<AgentSessionEvent>,
  @SerialName("nextCursor") val nextCursor: String? = null,
)

@Serializable
data class SessionCreateRequest(
  val title: String? = null,
  val engine: SessionCreateEngine,
  val prompt: SessionCreatePrompt,
  val tools: SessionCreateTools,
  @SerialName("executionMode") val executionMode: String = "pinned-node-host",
  @SerialName("executorSelector") val executorSelector: SessionCreateExecutorSelector = SessionCreateExecutorSelector(),
)

@Serializable
data class SessionCreateEngine(
  val id: String,
  val model: String? = null,
)

@Serializable
data class SessionCreatePrompt(
  val system: String? = null,
  val instructions: String,
)

@Serializable
data class SessionCreateTools(
  val allow: List<String> = emptyList(),
)

@Serializable
data class SessionCreateExecutorSelector(
  val pool: String = "byon",
)

@Serializable
data class SessionCreateResponse(
  val session: AgentSession,
)
