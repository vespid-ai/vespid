package com.vespid.mobile.shared.state

import com.vespid.mobile.shared.model.AgentSessionEvent
import com.vespid.mobile.shared.model.SessionDeltaMessage
import com.vespid.mobile.shared.model.SessionEventV2Message
import com.vespid.mobile.shared.model.SessionFinalMessage
import com.vespid.mobile.shared.model.SessionStreamV1Message

sealed interface TerminalLine {
  val key: String
  val createdAt: String

  data class SessionEventLine(
    val seq: Int,
    val eventType: String,
    val level: String,
    override val createdAt: String,
  ) : TerminalLine {
    override val key: String = "session:$seq"
  }

  data class StreamEventLine(
    val requestId: String,
    val streamSeq: Int,
    val kind: String,
    val level: String,
    val text: String?,
    override val createdAt: String,
  ) : TerminalLine {
    override val key: String = "stream:$requestId:$streamSeq"
  }
}

object StreamReducer {
  fun merge(
    existing: List<TerminalLine>,
    historical: List<AgentSessionEvent>,
  ): List<TerminalLine> {
    val merged = existing.toMutableList()
    historical.forEach { event ->
      merged.add(
        TerminalLine.SessionEventLine(
          seq = event.seq,
          eventType = event.eventType,
          level = event.level,
          createdAt = event.createdAt,
        )
      )
    }
    return dedupeAndSort(merged)
  }

  fun mergeEvent(existing: List<TerminalLine>, event: SessionEventV2Message): List<TerminalLine> {
    return dedupeAndSort(
      existing + TerminalLine.SessionEventLine(
        seq = event.seq,
        eventType = event.eventType,
        level = event.level,
        createdAt = event.createdAt,
      )
    )
  }

  fun mergeDelta(existing: List<TerminalLine>, event: SessionDeltaMessage): List<TerminalLine> {
    return dedupeAndSort(
      existing + TerminalLine.StreamEventLine(
        requestId = "delta",
        streamSeq = event.seq,
        kind = "turn_delta",
        level = "info",
        text = event.content,
        createdAt = event.createdAt,
      )
    )
  }

  fun mergeFinal(existing: List<TerminalLine>, event: SessionFinalMessage): List<TerminalLine> {
    return dedupeAndSort(
      existing + TerminalLine.StreamEventLine(
        requestId = "final",
        streamSeq = event.seq,
        kind = "turn_finished",
        level = "info",
        text = event.content,
        createdAt = event.createdAt,
      )
    )
  }

  fun mergeStream(existing: List<TerminalLine>, event: SessionStreamV1Message): List<TerminalLine> {
    return dedupeAndSort(
      existing + TerminalLine.StreamEventLine(
        requestId = event.requestId,
        streamSeq = event.streamSeq,
        kind = event.kind,
        level = event.level,
        text = event.text,
        createdAt = event.createdAt,
      )
    )
  }

  private fun dedupeAndSort(lines: List<TerminalLine>): List<TerminalLine> {
    val unique = linkedMapOf<String, TerminalLine>()
    lines.forEach { unique[it.key] = it }
    return unique.values.sortedBy { it.createdAt }
  }
}
