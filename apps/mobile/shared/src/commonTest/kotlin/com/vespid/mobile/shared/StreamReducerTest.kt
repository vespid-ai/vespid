package com.vespid.mobile.shared

import com.vespid.mobile.shared.model.AgentSessionEvent
import com.vespid.mobile.shared.model.SessionEventV2Message
import com.vespid.mobile.shared.model.SessionStreamV1Message
import com.vespid.mobile.shared.state.StreamReducer
import com.vespid.mobile.shared.state.TerminalLine
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class StreamReducerTest {
  private val json = Json

  @Test
  fun `merge keeps stable ordering and dedupes by keys`() {
    val historical = listOf(
      AgentSessionEvent(
        id = "e1",
        seq = 1,
        eventType = "user_message",
        level = "info",
        payload = null,
        createdAt = "2026-02-21T10:00:00Z",
      ),
      AgentSessionEvent(
        id = "e2",
        seq = 2,
        eventType = "agent_final",
        level = "info",
        payload = null,
        createdAt = "2026-02-21T10:00:01Z",
      ),
    )

    val initial = StreamReducer.merge(emptyList(), historical)
    val afterDuplicate = StreamReducer.mergeEvent(
      initial,
      SessionEventV2Message(
        type = "session_event_v2",
        sessionId = "s1",
        seq = 2,
        eventType = "agent_final",
        level = "info",
        payload = null,
        createdAt = "2026-02-21T10:00:01Z",
      )
    )

    assertEquals(2, afterDuplicate.size)
    assertEquals("session:1", afterDuplicate[0].key)
    assertEquals("session:2", afterDuplicate[1].key)
  }

  @Test
  fun `merge stream appends session_stream_v1 by request and stream seq`() {
    val existing = listOf<TerminalLine>()

    val one = StreamReducer.mergeStream(
      existing,
      SessionStreamV1Message(
        type = "session_stream_v1",
        sessionId = "s1",
        requestId = "r1",
        streamSeq = 1,
        kind = "turn_started",
        level = "info",
        text = "turn started",
        payload = json.parseToJsonElement("{\"phase\":\"start\"}"),
        createdAt = "2026-02-21T10:00:00Z",
      )
    )

    val two = StreamReducer.mergeStream(
      one,
      SessionStreamV1Message(
        type = "session_stream_v1",
        sessionId = "s1",
        requestId = "r1",
        streamSeq = 2,
        kind = "turn_delta",
        level = "info",
        text = "running",
        payload = null,
        createdAt = "2026-02-21T10:00:01Z",
      )
    )

    assertEquals(2, two.size)
    assertEquals("stream:r1:1", two[0].key)
    assertEquals("stream:r1:2", two[1].key)
  }
}
